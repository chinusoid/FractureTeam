/**
 * Runs one assistant request against a model provider: builds the context, runs the tool loop
 * (max 3 tool calls), applies the money guard and returns a response that matches the contract.
 */
import { z } from "zod";
import { computePlan } from "../finance/calc";
import type { PlanInput } from "../finance/types";
import type { AssistantRequest, AssistantResponse } from "../schemas/assistant";
import type { ServerEnv } from "./env";
import { AssistantFailure } from "./errors";
import { collectCents, extractUserAmounts, moneyIsVerified } from "./guard";
import { type InputItem, type ModelProvider, baseRequest, functionCalls, textOf } from "./openai";
import {
  CHAT_SYSTEM_PROMPT,
  SETUP_SCHEMA,
  SETUP_SYSTEM_PROMPT,
  buildChatContext,
  buildSetupContext,
} from "./prompts";
import { CAPABILITIES_MESSAGE, NO_PLAN_MESSAGE, proposalMessage, simulationMessage, summaryMessage } from "./templates";
import { MAX_TOOL_CALLS, TOOL_DEFINITIONS, emptyEffects, executeTool, type ToolEffects } from "./tools";

export interface RunStats {
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
  toolNames: string[];
  guardReplaced: boolean;
}

export interface RunResult {
  response: AssistantResponse;
  stats: RunStats;
}

const MAX_MESSAGE = 1000;

function clip(text: string): string {
  const t = text.replace(/\s+\n/g, "\n").trim();
  return t.length > MAX_MESSAGE ? `${t.slice(0, MAX_MESSAGE - 1)}…` : t;
}

export function planInputOf(req: AssistantRequest): PlanInput | null {
  const plan = req.context.plan;
  if (!plan) return null;
  return {
    today: req.context.today,
    balanceCents: plan.balanceCents,
    balanceAsOf: plan.balanceAsOf,
    startDate: plan.startDate,
    endDate: plan.endDate,
    essentialRemainingCents: plan.essentialRemainingCents,
    reserveTargetCents: plan.reserveTargetCents,
    obligations: req.context.obligations,
  };
}

/**
 * What the user said about the current request: this message, plus their previous one when the assistant
 * had answered it with a question (the user is now replying to that question).
 */
export function userTextOf(req: AssistantRequest): string {
  const history = req.context.history ?? [];
  const last = history[history.length - 1];
  const answering = last?.role === "assistant" && /\?\s*$/.test(last.text);
  const previous = answering ? ([...history].reverse().find((h) => h.role === "user")?.text ?? "") : "";
  return `${previous} ${req.message}`.trim();
}

/** Answers that need no model call (and therefore no quota). */
export function deterministicResponse(req: AssistantRequest): AssistantResponse | null {
  if (req.mode === "chat" && !req.context.plan) {
    return { kind: "answer", baseVersion: req.baseVersion, message: NO_PLAN_MESSAGE, factRefs: [], requiresConfirmation: false };
  }
  if (req.mode === "chat" && !req.message.trim()) {
    return { kind: "question", baseVersion: req.baseVersion, message: `${CAPABILITIES_MESSAGE} What would you like to do?`, factRefs: [], requiresConfirmation: false };
  }
  if (req.mode === "setup" && !(req.context.candidates?.length)) {
    return {
      kind: "setup_review",
      baseVersion: req.baseVersion,
      message: "No repeating payments were found in your file. Add your bills manually.",
      factRefs: [],
      setupReview: { items: [] },
      requiresConfirmation: false,
    };
  }
  return null;
}

export async function runAssistant(
  req: AssistantRequest,
  env: ServerEnv,
  provider: ModelProvider,
  signal: AbortSignal,
): Promise<RunResult> {
  return req.mode === "setup" ? runSetup(req, env, provider, signal) : runChat(req, env, provider, signal);
}

// ---------------------------------------------------------------------------
// Chat: purchases, bill changes, explanations
// ---------------------------------------------------------------------------

async function runChat(req: AssistantRequest, env: ServerEnv, provider: ModelProvider, signal: AbortSignal): Promise<RunResult> {
  const planInput = planInputOf(req)!;
  const stats: RunStats = { inputTokens: 0, outputTokens: 0, modelCalls: 0, toolNames: [], guardReplaced: false };
  const effects: ToolEffects = emptyEffects();
  const userText = userTextOf(req);
  const input: InputItem[] = [
    { role: "developer", content: buildChatContext(req) },
    ...(req.context.history ?? []).map((h) => ({ role: h.role, content: h.text }) as InputItem),
    { role: "user", content: req.message },
  ];
  const body = {
    ...baseRequest(env, CHAT_SYSTEM_PROMPT, input),
    tools: TOOL_DEFINITIONS as unknown as unknown[],
    tool_choice: "auto" as "auto" | "none",
    parallel_tool_calls: false,
  };

  let toolCalls = 0;
  let finalText = "";
  let refusal: string | null = null;
  let incomplete = false;
  for (let round = 0; round < MAX_TOOL_CALLS + 2; round++) {
    const res = await provider(body, signal);
    stats.modelCalls++;
    stats.inputTokens += res.usage.inputTokens;
    stats.outputTokens += res.usage.outputTokens;
    if (res.status === "failed") {
      throw new AssistantFailure("upstream_error", "The assistant could not answer. Use the form instead.", undefined, "response failed");
    }
    const calls = functionCalls(res.output);
    if (calls.length === 0) {
      const t = textOf(res.output);
      finalText = t.text;
      refusal = t.refusal;
      incomplete = res.status === "incomplete";
      break;
    }
    body.input.push(...res.output);
    for (const c of calls) {
      let output: string;
      if (toolCalls >= MAX_TOOL_CALLS) {
        output = JSON.stringify({ ok: false, error: "tool_limit", message: "No more tool calls for this request. Answer with what you have." });
      } else {
        toolCalls++;
        output = executeTool(c.name, c.arguments ?? "{}", { planInput, baseVersion: req.baseVersion, userText }, effects);
      }
      body.input.push({ type: "function_call_output", call_id: c.call_id, output });
    }
    if (toolCalls >= MAX_TOOL_CALLS) body.tool_choice = "none";
  }
  stats.toolNames = effects.toolNames;

  // Amounts the message may mention: tool results, the request context and what the user typed.
  const allowed = new Set<number>(effects.amounts);
  collectCents(req.context, allowed);
  for (const c of extractUserAmounts(req.message)) allowed.add(c);

  const template = templateFor(effects);
  let message = refusal ? CAPABILITIES_MESSAGE : finalText;
  if (!message) {
    if (incomplete && !template) {
      throw new AssistantFailure("upstream_error", "The assistant's answer was cut off. Try a shorter question.", undefined, "incomplete");
    }
    message = template ?? CAPABILITIES_MESSAGE;
  } else if (!moneyIsVerified(message, allowed)) {
    stats.guardReplaced = true;
    message = template ?? summaryMessage(computePlan(planInput));
  }
  if (effects.proposal && /\b(saved|has been (updated|changed)|is (now )?updated|i('ve| have) (changed|updated|saved))\b/i.test(message)) {
    // Never let the text claim a change was saved: the user still has to confirm.
    message = template!;
  }
  if (effects.proposal && /\?\s*$/.test(message)) {
    // A draft is on screen: the text describes it instead of asking something the draft already answers.
    message = template!;
  }

  let kind: AssistantResponse["kind"];
  if (effects.proposal) kind = "change_proposal";
  else if (effects.simulation) kind = "simulation";
  else if (/\?\s*$/.test(message) && !effects.summary) kind = "question";
  else kind = "answer";

  const response: AssistantResponse = {
    kind,
    baseVersion: req.baseVersion,
    message: clip(message),
    factRefs: [...effects.factRefs].slice(0, 20),
    requiresConfirmation: Boolean(effects.proposal),
  };
  if (effects.simulation) response.simulation = effects.simulation as AssistantResponse["simulation"];
  if (effects.proposal) response.proposal = effects.proposal;
  return { response, stats };
}

function templateFor(effects: ToolEffects): string | null {
  if (effects.proposal && effects.preview) return proposalMessage(effects.proposal.payload, effects.preview);
  if (effects.simulation) return simulationMessage(effects.simulation);
  if (effects.summary) return summaryMessage(effects.summary);
  return null;
}

// ---------------------------------------------------------------------------
// Setup: review rule-based candidates with structured output
// ---------------------------------------------------------------------------

const SetupOutputSchema = z.object({
  items: z.array(
    z.object({
      candidateId: z.string(),
      displayName: z.string(),
      isLikelyBill: z.boolean(),
      reason: z.string(),
      question: z.string().nullable(),
    }),
  ),
});

async function runSetup(req: AssistantRequest, env: ServerEnv, provider: ModelProvider, signal: AbortSignal): Promise<RunResult> {
  const candidates = req.context.candidates ?? [];
  const stats: RunStats = { inputTokens: 0, outputTokens: 0, modelCalls: 0, toolNames: [], guardReplaced: false };
  const input: InputItem[] = [
    { role: "developer", content: buildSetupContext(req) },
    { role: "user", content: req.message.trim() || "Review these repeating payments." },
  ];
  const body = {
    ...baseRequest(env, SETUP_SYSTEM_PROMPT, input),
    text: { format: { type: "json_schema" as const, name: "setup_review", schema: SETUP_SCHEMA, strict: true } },
  };
  // Room for one JSON item per candidate (plus reasoning); a cut-off answer falls back to the rule results.
  body.max_output_tokens = Math.min(6000, Math.max(env.maxOutputTokens, 600 + 150 * candidates.length));
  const res = await provider(body, signal);
  stats.modelCalls = 1;
  stats.inputTokens = res.usage.inputTokens;
  stats.outputTokens = res.usage.outputTokens;
  if (res.status === "failed") {
    throw new AssistantFailure("upstream_error", "The assistant could not review your payments. Review them yourself below.");
  }
  const { text } = textOf(res.output);
  let parsed: z.infer<typeof SetupOutputSchema> | null = null;
  try {
    const result = SetupOutputSchema.safeParse(JSON.parse(text));
    parsed = result.success ? result.data : null;
  } catch {
    parsed = null;
  }
  const byId = new Map((parsed?.items ?? []).map((i) => [i.candidateId, i]));
  let reviewed = 0;
  const items = candidates.map((c) => {
    const m = byId.get(c.id);
    if (m) reviewed++;
    const cleanName = m?.displayName.trim() ?? "";
    const nameOk = cleanName.length > 0 && cleanName.length <= 60 && !/\$|\d{4,}/.test(cleanName);
    const reasonRaw = m?.reason.trim() ?? "";
    const reason = reasonRaw && reasonRaw.length <= 200 && !reasonRaw.includes("$")
      ? reasonRaw
      : c.possibleTransfer
        ? "Looks like a transfer; check before adding it."
        : `Repeats ${c.cadence}; based on the payment pattern only.`;
    let question = m?.question?.trim() || null;
    if (question && (question.length > 200 || question.includes("$"))) question = "Should this be part of your plan?";
    const isLikelyBill = m ? m.isLikelyBill : !c.possibleTransfer;
    if (c.possibleTransfer && isLikelyBill && !question) {
      question = "This looks like a transfer. Is it a bill you must pay?";
    }
    return {
      candidateId: c.id,
      displayName: nameOk ? cleanName : c.displayName.slice(0, 60),
      isLikelyBill,
      reason,
      question,
    };
  });
  const likely = items.filter((i) => i.isLikelyBill).length;
  const questions = items.filter((i) => i.question).length;
  let message =
    reviewed === 0
      ? "The assistant couldn't review these payments, so they are shown as found. Check each one before confirming."
      : `I reviewed ${candidates.length} repeating payments: ${likely} look like bills${questions ? `, ${questions} need your answer` : ""}. Amounts and dates come from your file — confirm each one.`;
  message = clip(message);
  return {
    response: {
      kind: "setup_review",
      baseVersion: req.baseVersion,
      message,
      factRefs: candidates.slice(0, 20).map((c) => c.id),
      setupReview: { items },
      requiresConfirmation: false,
    },
    stats,
  };
}
