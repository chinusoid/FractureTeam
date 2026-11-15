/**
 * The fixed list of tools the model may call. They run on the server against the request context
 * with the shared finance module. None of them writes data: proposals are drafts the user confirms in the app.
 */
import { computePlan, simulatePurchase, type PlanResult, type SimulationResult } from "../finance/calc";
import { dollarsToCents, formatUSD } from "../finance/money";
import { formatDate, isISODate, addDays } from "../finance/dates";
import { previewProposal, type ChangeProposal, type ProposalPayload, type ProposalPreview } from "../finance/proposals";
import { newId } from "../finance/state";
import type { PlanInput } from "../finance/types";
import { simulationMessage, proposalMessage, summaryMessage } from "./templates";
import { collectCents } from "./guard";
import { STATUS_MEANING, TOOL_DESCRIPTIONS } from "./prompts";

export const MAX_TOOL_CALLS = 3;
const MAX_PURCHASE_USD = 1_000_000;

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    name: "get_plan_summary",
    description: TOOL_DESCRIPTIONS.get_plan_summary,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "simulate_purchase",
    description: TOOL_DESCRIPTIONS.simulate_purchase,
    parameters: {
      type: "object",
      properties: {
        amount_usd: { type: "number", description: "Purchase price in US dollars, e.g. 400 or 59.99." },
        purchase_date: {
          type: ["string", "null"],
          description: "Planned purchase date as YYYY-MM-DD, or null when the user did not say (means today).",
        },
      },
      required: ["amount_usd", "purchase_date"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "propose_bill_change",
    description: TOOL_DESCRIPTIONS.propose_bill_change,
    parameters: {
      type: "object",
      properties: {
        bill_id: { type: "string", description: "The id of an existing bill from the plan data." },
        new_amount_usd: { type: ["number", "null"], description: "New full amount in dollars, or null if unchanged." },
        new_due_date: { type: ["string", "null"], description: "New due date YYYY-MM-DD, or null if unchanged." },
        new_name: { type: ["string", "null"], description: "New name, or null if unchanged." },
      },
      required: ["bill_id", "new_amount_usd", "new_due_date", "new_name"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "propose_new_bill",
    description: TOOL_DESCRIPTIONS.propose_new_bill,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short bill name, e.g. 'Dentist'." },
        amount_usd: { type: "number", description: "Amount in dollars." },
        due_date: { type: "string", description: "Due date YYYY-MM-DD." },
      },
      required: ["name", "amount_usd", "due_date"],
      additionalProperties: false,
    },
    strict: true,
  },
] as const;

export const TOOL_NAMES = new Set<string>(TOOL_DEFINITIONS.map((t) => t.name));

export interface ToolContext {
  planInput: PlanInput;
  baseVersion: number;
  /**
   * What the user wrote (see userTextOf). When present, the bill tools refuse to guess what the user
   * did not say: which of two similar bills, or the amount and due date of a new bill.
   */
  userText?: string;
}

const GENERIC_WORDS = new Set(["bill", "payment", "monthly", "weekly", "auto", "autopay", "pay", "plan", "the", "and", "for", "online", "pmt", "inc", "llc"]);

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 ? w.replace(/s$/, "") : w));
}

/** The unpaid bills whose names fit the user's words best. More than one means the user has to choose. */
export function billsNamedBy<B extends { name: string; paymentStatus: string }>(userText: string, bills: readonly B[]): B[] {
  const said = new Set(wordsOf(userText));
  let best = 0;
  let top: B[] = [];
  for (const b of bills) {
    if (b.paymentStatus === "paid") continue;
    const score = new Set(wordsOf(b.name).filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w) && said.has(w))).size;
    if (score > best) {
      best = score;
      top = [b];
    } else if (score === best && score > 0) top.push(b);
  }
  return top;
}

const SAYS_WHEN =
  /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(\/\d{2,4})?|(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?|\d{1,2}(st|nd|rd|th)|(due|on)\s+(the\s+)?\d{1,2}|today|tonight|tomorrow|(mon|tues|wednes|thurs|fri|satur|sun)day|(next|this)\s+(week|month)|end\s+of\s+(the\s+)?(week|month)|in\s+\d+\s+(day|week)s?|payday)\b/i;

export interface ToolEffects {
  simulation?: SimulationResult;
  proposal?: ChangeProposal;
  preview?: ProposalPreview;
  summary?: PlanResult;
  factRefs: Set<string>;
  /** Every amount (cents) that tool results contain; the money guard allows these. */
  amounts: Set<number>;
  toolNames: string[];
}

export function emptyEffects(): ToolEffects {
  return { factRefs: new Set(), amounts: new Set(), toolNames: [] };
}

function fail(code: string, message: string): string {
  return JSON.stringify({ ok: false, error: code, message });
}

function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function usdToCents(value: unknown, max = MAX_PURCHASE_USD): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max) return null;
  const c = dollarsToCents(value);
  return c !== null && c > 0 ? c : null;
}

function evaluationForModel(e: { status: string; remainderCents: number; shortfallCents: number; reserveLeftCents: number; reserveTargetCents: number; billsCents: number; essentialsCents: number }) {
  return {
    status: e.status,
    meaning: STATUS_MEANING[e.status as keyof typeof STATUS_MEANING],
    left_after_everything: formatUSD(e.remainderCents),
    shortfall: formatUSD(e.shortfallCents),
    reserve_target: formatUSD(e.reserveTargetCents),
    reserve_still_protected: formatUSD(e.reserveLeftCents),
    bills_in_period: formatUSD(e.billsCents),
    everyday_spending: formatUSD(e.essentialsCents),
  };
}

function addDerivedAmounts(effects: ToolEffects, values: number[]) {
  for (const v of values) effects.amounts.add(Math.abs(Math.round(v)));
}

/** Runs one tool call. Returns the JSON string sent back to the model. Unknown tools do nothing. */
export function executeTool(name: string, rawArgs: string, ctx: ToolContext, effects: ToolEffects): string {
  effects.toolNames.push(name);
  if (!TOOL_NAMES.has(name)) return fail("unknown_tool", "This tool does not exist. Use only the listed tools.");
  const args = parseArgs(rawArgs);
  if (!args) return fail("invalid_arguments", "Arguments must be a JSON object.");
  const input = ctx.planInput;

  if (name === "get_plan_summary") {
    const plan = computePlan(input);
    effects.summary = plan;
    effects.factRefs.add("plan_remainder");
    plan.billsInPeriod.forEach((b) => effects.factRefs.add(b.id));
    collectCents(plan, effects.amounts);
    return JSON.stringify({
      ok: true,
      period: { start: plan.periodStart, end: plan.periodEnd },
      balance: formatUSD(plan.availableCents),
      balance_as_of: plan.balanceAsOf,
      ...evaluationForModel(plan),
      bills_counted: plan.billsInPeriod.map((b) => ({
        id: b.id,
        name: b.name,
        amount: formatUSD(b.amountCents),
        due: b.dueDate,
        overdue: b.overdue,
        ...(b.payments > 1 ? { payments_before_period_end: b.payments, counted: formatUSD(b.totalCents) } : {}),
      })),
      bills_after_period: plan.billsOutsidePeriod.map((b) => ({ id: b.id, name: b.name, amount: formatUSD(b.amountCents), due: b.dueDate })),
      verified_summary: summaryMessage(plan),
    });
  }

  if (name === "simulate_purchase") {
    const amountCents = usdToCents(args.amount_usd);
    if (amountCents === null) return fail("invalid_amount", "amount_usd must be a positive number of dollars. Ask the user for the price.");
    let date = input.today;
    if (args.purchase_date !== null && args.purchase_date !== undefined) {
      if (!isISODate(args.purchase_date)) return fail("invalid_date", "purchase_date must be YYYY-MM-DD or null.");
      date = args.purchase_date;
    }
    const sim = simulatePurchase(input, amountCents, date);
    effects.simulation = sim;
    effects.factRefs.add("plan_remainder");
    collectCents(sim, effects.amounts);
    if (sim.kind === "ok") {
      addDerivedAmounts(effects, [sim.before.remainderCents - sim.after.remainderCents]);
      return JSON.stringify({
        ok: true,
        purchase: formatUSD(amountCents),
        purchase_date: date,
        before: { left_after_everything: formatUSD(sim.before.remainderCents), status: sim.before.status },
        after: evaluationForModel(sim.after),
        verified_summary: simulationMessage(sim),
        note: "This is a what-if check. Nothing was recorded.",
      });
    }
    if (sim.kind === "outside_period") {
      return JSON.stringify({
        ok: true,
        status: "outside_period",
        period: { start: sim.periodStart, end: sim.periodEnd },
        verified_summary: simulationMessage(sim),
      });
    }
    return fail("invalid", sim.reason);
  }

  if (name === "propose_bill_change") {
    const billId = typeof args.bill_id === "string" ? args.bill_id : "";
    const bill = input.obligations.find((o) => o.id === billId);
    if (!bill) {
      return fail("unknown_bill", "No bill with this id. Use an id from the plan data, or ask the user which bill they mean.");
    }
    const changes: { amountCents?: number; dueDate?: string; name?: string } = {};
    if (args.new_amount_usd !== null && args.new_amount_usd !== undefined) {
      const c = usdToCents(args.new_amount_usd);
      if (c === null) return fail("invalid_amount", "new_amount_usd must be a positive dollar amount or null.");
      if (c !== bill.amountCents) changes.amountCents = c;
    }
    if (args.new_due_date !== null && args.new_due_date !== undefined) {
      if (!isISODate(args.new_due_date)) return fail("invalid_date", "new_due_date must be YYYY-MM-DD or null.");
      if (args.new_due_date !== bill.dueDate) changes.dueDate = args.new_due_date;
    }
    if (args.new_name !== null && args.new_name !== undefined) {
      if (typeof args.new_name !== "string" || !args.new_name.trim() || args.new_name.trim().length > 60) {
        return fail("invalid_name", "new_name must be 1-60 characters or null.");
      }
      if (args.new_name.trim() !== bill.name) changes.name = args.new_name.trim();
    }
    if (Object.keys(changes).length === 0) {
      return fail("no_change", "The values are the same as the current bill. Ask the user what changed.");
    }
    if (ctx.userText !== undefined) {
      const named = billsNamedBy(ctx.userText, input.obligations);
      if (named.length > 1) {
        return fail(
          "ambiguous_bill",
          `The user's words fit more than one bill: ${named.map((b) => `${b.name} (${formatUSD(b.amountCents)}, due ${b.dueDate})`).join("; ")}. Do not pick one. Ask the user which bill they mean.`,
        );
      }
    }
    return finishProposal({ type: "update_obligation", targetId: bill.id, changes }, ctx, effects, [bill.id]);
  }

  if (name === "propose_new_bill") {
    const billName = typeof args.name === "string" ? args.name.trim() : "";
    if (!billName || billName.length > 60) return fail("invalid_name", "name must be 1-60 characters.");
    const c = usdToCents(args.amount_usd);
    if (c === null) return fail("invalid_amount", "amount_usd must be a positive dollar amount. Ask the user.");
    if (!isISODate(args.due_date)) return fail("invalid_date", "due_date must be YYYY-MM-DD. Ask the user when it is due.");
    if (args.due_date < addDays(input.today, -31)) return fail("invalid_date", "due_date is too far in the past.");
    if (ctx.userText !== undefined) {
      if (!/\d/.test(ctx.userText)) return fail("missing_amount", "The user did not give an amount. Do not invent one. Ask the user how much the bill is.");
      if (!SAYS_WHEN.test(ctx.userText)) return fail("missing_due_date", "The user did not say when this bill is due. Do not invent a date. Ask the user for the due date.");
    }
    return finishProposal(
      { type: "add_obligation", obligation: { name: billName, amountCents: c, dueDate: args.due_date } },
      ctx,
      effects,
      [],
    );
  }
  return fail("unknown_tool", "This tool does not exist.");
}

function finishProposal(payload: ProposalPayload, ctx: ToolContext, effects: ToolEffects, refs: string[]): string {
  const preview = previewProposal(ctx.planInput, payload);
  if ("errors" in preview) return fail("invalid_change", preview.errors.join(" "));
  const proposal: ChangeProposal = {
    id: newId("proposal"),
    baseVersion: ctx.baseVersion,
    payload,
    factRefs: [...refs, "plan_remainder"],
  };
  effects.proposal = proposal;
  effects.preview = preview;
  refs.forEach((r) => effects.factRefs.add(r));
  effects.factRefs.add("plan_remainder");
  collectCents(preview, effects.amounts);
  collectCents(payload, effects.amounts);
  const deltas = [preview.after.remainderCents - preview.before.remainderCents];
  if (preview.target) deltas.push(preview.updated.amountCents - preview.target.amountCents);
  addDerivedAmounts(effects, deltas);
  return JSON.stringify({
    ok: true,
    draft_only: true,
    change:
      payload.type === "update_obligation"
        ? {
            bill: preview.target!.name,
            amount: `${formatUSD(preview.target!.amountCents)} -> ${formatUSD(preview.updated.amountCents)}`,
            due: `${formatDate(preview.target!.dueDate)} -> ${formatDate(preview.updated.dueDate)}`,
          }
        : { new_bill: preview.updated.name, amount: formatUSD(preview.updated.amountCents), due: preview.updated.dueDate },
    left_after_everything: { before: formatUSD(preview.before.remainderCents), after: formatUSD(preview.after.remainderCents) },
    status_after: preview.after.status,
    verified_summary: proposalMessage(payload, preview),
    note: "Not saved. The user must press Confirm in the app.",
  });
}
