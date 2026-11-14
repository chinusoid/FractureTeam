import { z } from "zod";
import { newId, ProposalSchema, today, type AppState, type Bill, type Transaction } from "./model";
import {
  AssistantErrorSchema,
  AssistantResponseSchema as ContractResponseSchema,
  type AssistantRequest,
  type AssistantResponse as ContractResponse,
} from "../schemas/assistant";
import { scrubDescription } from "../ai/scrub";

/**
 * Browser side of POST /api/assistant.
 * The wire format is the shared contract in src/lib/schemas/assistant.ts; this file adapts it to the
 * shape the assistant UI renders. Amounts in cards are always recomputed on the device.
 */
export const AssistantResponseSchema = z
  .object({
    kind: z.enum(["simulation", "change_proposal", "question", "answer", "setup"]),
    message: z.string().max(6000),
    proposal: ProposalSchema.optional(),
    simulation: z
      .object({
        amountCents: z.number().int().positive().max(1e12),
        purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .optional(),
    setupReview: z
      .object({
        items: z.array(
          z.object({
            candidateId: z.string(),
            name: z.string(),
            reason: z.string(),
            question: z.string().optional(),
          }),
        ),
      })
      .optional(),
  })
  .refine((r) => r.kind !== "change_proposal" || !!r.proposal)
  .refine((r) => r.kind !== "simulation" || !!r.simulation);
export type AssistantResponse = z.infer<typeof AssistantResponseSchema>;

export const ERROR_MESSAGES: Record<string, string> = {
  AI_UNAVAILABLE: "The assistant isn’t connected yet. Use the purchase checker or bill forms to keep going.",
  AI_DISABLED: "The assistant is turned off. Your plan and manual forms are still available.",
  CONSENT_REQUIRED: "Review the data-sharing notice and enable the assistant before sending a message.",
  INVALID_REQUEST: "This request couldn’t be read. Rephrase it or use the form instead.",
  RATE_LIMITED: "Too many requests right now. Wait a minute or use the form instead.",
  QUOTA_EXCEEDED: "The assistant’s quota has been reached. Use the manual forms and try again later.",
  QUOTA_UNAVAILABLE: "The assistant’s request limit service is unavailable. Try again shortly or use the form instead.",
  BUDGET_EXCEEDED: "Today’s assistant budget has been reached. Your plan and forms still work.",
  DAILY_BUDGET_EXCEEDED: "Today’s assistant budget has been reached. Use the form instead.",
  UPSTREAM_ERROR: "The assistant service couldn’t reply. Try again or use the form instead.",
  MODEL_UNAVAILABLE: "The assistant model is unavailable. Use the manual forms while the connection is restored.",
  TIMEOUT: "The assistant took too long. Try again or use the form instead.",
  INVALID_RESPONSE: "The assistant returned an incomplete reply. Nothing was changed. Try again or use the form.",
  INTERNAL_ERROR: "The assistant couldn’t finish this request. Your data is unchanged. Use the form instead.",
};

/** Contract error codes (lower case) -> messages above. Upper-case codes are accepted as they are. */
const CONTRACT_CODE: Record<string, string> = {
  bad_request: "INVALID_REQUEST",
  too_large: "INVALID_REQUEST",
  forbidden_origin: "INVALID_REQUEST",
  no_consent: "CONSENT_REQUIRED",
  ai_disabled: "AI_DISABLED",
  rate_limited: "RATE_LIMITED",
  free_limit: "QUOTA_EXCEEDED",
  budget_exhausted: "BUDGET_EXCEEDED",
  quota_unavailable: "QUOTA_UNAVAILABLE",
  upstream_error: "UPSTREAM_ERROR",
  timeout: "TIMEOUT",
};

/** The free plan's daily questions are used up; the UI answers with the Covered Plus offer. */
export class PlusRequiredError extends Error {}

const PLUS_KEY = "covered:plus";
let memoryPlus = false;
export function plusActive(): boolean {
  try {
    return localStorage.getItem(PLUS_KEY) === "early-access";
  } catch {
    return memoryPlus;
  }
}

/** Turns Plus on for this browser (free during early access) and tells the server one more browser asked for it. */
export async function activatePlus(): Promise<void> {
  memoryPlus = true;
  try {
    localStorage.setItem(PLUS_KEY, "early-access");
  } catch {
    /* Storage is unavailable: Plus stays on until the page is closed. */
  }
  try {
    await fetch("/api/plus", { method: "POST", headers: { "x-client-id": clientId() } });
  } catch {
    /* The counter is best effort; Plus is already on. */
  }
}

export type HistoryItem = { role: "user" | "assistant"; text: string };

let memoryId = "";
function clientId() {
  try {
    const existing = localStorage.getItem("covered:client-id");
    if (existing) return existing;
    const id = newId();
    localStorage.setItem("covered:client-id", id);
    return id;
  } catch {
    memoryId ||= newId();
    return memoryId;
  }
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CADENCE: Record<Bill["frequency"], "monthly" | "biweekly" | "weekly" | null> = {
  Monthly: "monthly",
  Biweekly: "biweekly",
  Weekly: "weekly",
  "One-time": null,
};

function billName(name: string) {
  return scrubDescription(name).slice(0, 60) || "Bill";
}

/** Builds the minimal context the server needs (plan section 13). The raw CSV never leaves the browser. */
export function buildAssistantRequest(
  state: AppState,
  message: string,
  mode: "setup" | "plan",
  history: HistoryItem[] = [],
): AssistantRequest {
  const { plan } = state;
  const obligations = state.bills
    .filter((b) => b.status !== "dismissed" && b.amountCents > 0 && SAFE_ID.test(b.id))
    .filter((b) => mode === "setup" || b.status !== "candidate")
    .slice(0, 60)
    .map((b) => ({
      id: b.id,
      name: billName(b.name),
      amountCents: b.amountCents,
      dueDate: b.dueDate,
      paymentStatus: b.status === "paid" ? ("paid" as const) : ("unpaid" as const),
      confirmationStatus: b.status === "candidate" ? ("suggested" as const) : ("confirmed" as const),
    }));
  const request: AssistantRequest = {
    mode: mode === "setup" ? "setup" : "chat",
    message: message.slice(0, 500),
    baseVersion: state.stateVersion,
    consent: { aiEnabled: true, policyVersion: 1 },
    context: {
      today: today(),
      plan: {
        balanceCents: plan.balanceCents,
        balanceAsOf: plan.balanceDate,
        startDate: plan.balanceDate,
        endDate: plan.horizonEndDate,
        essentialRemainingCents: plan.essentialsCents,
        reserveTargetCents: plan.reserveCents,
      },
      obligations,
      history: history.slice(-6).map((h) => ({ role: h.role, text: h.text.slice(0, 600) })),
    },
  };
  if (mode === "setup") {
    const byId = new Map(state.transactions.map((t) => [t.id, t]));
    request.context.candidates = state.bills
      .filter((b) => b.status === "candidate" && b.amountCents > 0 && SAFE_ID.test(b.id) && CADENCE[b.frequency])
      .slice(0, 30)
      .map((b) => {
        const evidence = b.evidence.map((id) => byId.get(id)).filter((t): t is Transaction => t !== undefined);
        const amounts = evidence.map((t) => Math.abs(t.amountCents));
        return {
          id: b.id,
          displayName: billName(b.name),
          amountCents: b.amountCents,
          minCents: amounts.length ? Math.min(...amounts) : b.amountCents,
          maxCents: amounts.length ? Math.max(...amounts) : b.amountCents,
          cadence: CADENCE[b.frequency]!,
          occurrences: Math.max(1, Math.min(500, b.evidence.length)),
          nextDueDate: b.dueDate,
          sampleDescriptions: [...new Set(evidence.map((t) => scrubDescription(t.description)))].slice(0, 3),
          possibleTransfer: evidence.some((t) => t.transfer),
        };
      });
  }
  return request;
}

/** Contract response -> what the assistant UI renders. */
export function toUiResponse(r: ContractResponse): AssistantResponse {
  const base = { message: r.message };
  if (r.kind === "setup_review") {
    return {
      ...base,
      kind: "setup",
      setupReview: {
        items: (r.setupReview?.items ?? []).map((i) => ({
          candidateId: i.candidateId,
          name: i.displayName,
          reason: i.isLikelyBill ? i.reason : `Probably not a bill. ${i.reason}`,
          question: i.question ?? undefined,
        })),
      },
    };
  }
  if (r.kind === "simulation" && r.simulation && r.simulation.kind !== "invalid") {
    return {
      ...base,
      kind: "simulation",
      simulation: { amountCents: r.simulation.amountCents, purchaseDate: r.simulation.purchaseDate },
    };
  }
  if (r.kind === "change_proposal" && r.proposal) {
    return {
      ...base,
      kind: "change_proposal",
      proposal: { id: r.proposal.id, stateVersion: r.proposal.baseVersion, payload: r.proposal.payload },
    };
  }
  return { ...base, kind: r.kind === "question" ? "question" : "answer" };
}

export async function requestAssistant(
  state: AppState,
  message: string,
  mode: "setup" | "plan",
  history: HistoryItem[] = [],
): Promise<AssistantResponse> {
  if (!state.aiConsent) throw new Error(ERROR_MESSAGES.CONSENT_REQUIRED);
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 28000);
  try {
    const response = await fetch("/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json", "x-client-id": clientId(), ...(plusActive() ? { "x-plan": "plus" } : {}) },
      signal: controller.signal,
      body: JSON.stringify(buildAssistantRequest(state, message, mode, history)),
    });
    if (!response.ok) {
      let code =
        response.status === 404 || response.status === 405
          ? "AI_UNAVAILABLE"
          : response.status === 429
            ? "RATE_LIMITED"
            : "UPSTREAM_ERROR";
      let serverMessage = "";
      try {
        const body = await response.json();
        const parsed = AssistantErrorSchema.safeParse(body);
        if (parsed.success) {
          if (parsed.data.error.code === "free_limit") throw new PlusRequiredError(parsed.data.error.message);
          code = CONTRACT_CODE[parsed.data.error.code] ?? code;
          serverMessage = parsed.data.error.message;
        } else {
          code = body.error?.code ?? body.code ?? code;
        }
      } catch (e) {
        if (e instanceof PlusRequiredError) throw e;
        /* Non-JSON proxy response. */
      }
      const known = ERROR_MESSAGES[code];
      throw new Error(code === "UPSTREAM_ERROR" && serverMessage ? serverMessage : (known ?? ERROR_MESSAGES.UPSTREAM_ERROR));
    }
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error(ERROR_MESSAGES.AI_UNAVAILABLE);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error(ERROR_MESSAGES.INVALID_RESPONSE);
    }
    const contract = ContractResponseSchema.safeParse(body);
    if (!contract.success) throw new Error(ERROR_MESSAGES.INVALID_RESPONSE);
    const ui = AssistantResponseSchema.safeParse(toUiResponse(contract.data));
    if (!ui.success) throw new Error(ERROR_MESSAGES.INVALID_RESPONSE);
    return ui.data;
  } catch (e) {
    if (controller.signal.aborted) throw new Error(ERROR_MESSAGES.TIMEOUT);
    if (e instanceof TypeError) throw new Error(ERROR_MESSAGES.AI_UNAVAILABLE);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
