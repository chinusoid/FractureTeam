// Browser model for the UI. CSV import, recurring-bill detection and sample data come from the shared
// modules (src/lib/import, src/lib/demo); plan math mirrors src/lib/finance used by the server.
import { z } from "zod";
import { addMonths } from "../finance/dates";
import { validatePayload } from "../finance/proposals";
import { ChangeProposalSchema } from "../schemas/assistant";
import { parseCsv as sharedParseCsv } from "../import/csv";
import {
  detectDateFormats as sharedDetectDateFormats,
  guessMapping,
  normalizeRows as sharedNormalizeRows,
} from "../import/normalize";
import { buildSetupSuggestion as sharedSetupSuggestion } from "../import/prefill";
import { generateSampleCsvA, generateSampleCsvB } from "../demo/sample";

export const STALE_AFTER_DAYS = 7;
export const RESERVE_OPTIONS_CENTS = [0, 10000, 25000, 50000];
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000,
  );
export const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const money = (cents: number, decimals = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: decimals || cents % 100 !== 0 ? 2 : 0,
  }).format(cents / 100);
export const dateLabel = (date: string, year = false) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(year ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
export function parseMoney(value: string): number | null {
  const s = value.trim().replace(/\$/g, "").replace(/,/g, "");
  const n = /^\(.*\)$/.test(s) ? `-${s.slice(1, -1)}` : s;
  if (!/^-?\d+(\.\d{1,2})?$/.test(n)) return null;
  const result = Math.round(Number(n) * 100);
  return Number.isSafeInteger(result) && Math.abs(result) <= 1e12
    ? result
    : null;
}
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const n = new Date(`${v}T12:00:00Z`);
    return !Number.isNaN(n.getTime()) && n.toISOString().slice(0, 10) === v;
  });
const cents = z.number().int().min(0).max(1e12);
const TransactionSchema = z.object({
  id: z.string(),
  date: day,
  description: z.string().max(500),
  amountCents: z.number().int().min(-1e12).max(1e12),
  row: z.number().int(),
  duplicate: z.boolean(),
  transfer: z.boolean(),
});
const BillSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  amountCents: cents,
  dueDate: day,
  frequency: z.enum(["Monthly", "Biweekly", "Weekly", "One-time"]),
  recurrenceAnchorDay: z.number().int().min(1).max(31).optional(),
  status: z.enum(["candidate", "confirmed", "dismissed", "paid"]),
  evidence: z.array(z.string()),
  note: z.string().max(1000),
});
export const AppStateSchema = z.object({
  schemaVersion: z.literal(1),
  stateVersion: z.number().int().min(0),
  plan: z
    .object({
      balanceCents: cents,
      balanceDate: day,
      horizonEndDate: day,
      essentialsCents: cents,
      reserveCents: cents,
      confirmed: z.boolean(),
    })
    .refine((p) => p.horizonEndDate >= p.balanceDate, {
      message: "The period must end on or after the balance date.",
    }),
  bills: z.array(BillSchema).max(500),
  transactions: z.array(TransactionSchema).max(5000),
  importHashes: z.array(z.string()).max(100),
  aiConsent: z.boolean(),
  sample: z.boolean(),
  appliedProposalIds: z.array(z.string()),
  lastUpdate: z
    .object({
      date: day,
      previousBalanceCents: cents,
      newBalanceCents: cents,
      closedBills: z.array(z.string()),
      essentialsSpentCents: cents,
      excessCents: cents,
    })
    .nullable(),
});
export type AppState = z.infer<typeof AppStateSchema>;
export type Bill = z.infer<typeof BillSchema>;
export type Transaction = z.infer<typeof TransactionSchema>;
export type Plan = AppState["plan"];
export function emptyState(): AppState {
  return {
    schemaVersion: 1,
    stateVersion: 0,
    plan: {
      balanceCents: 0,
      balanceDate: today(),
      horizonEndDate: addDays(today(), 13),
      essentialsCents: 0,
      reserveCents: 25000,
      confirmed: false,
    },
    bills: [],
    transactions: [],
    importHashes: [],
    aiConsent: false,
    sample: false,
    appliedProposalIds: [],
    lastUpdate: null,
  };
}
export const STATUS_LABEL = {
  covered: "Your plan is covered",
  bills_short: "Your bills need attention",
  essentials_short: "Everyday spending needs attention",
  reserve_short: "Your reserve needs attention",
};
export function computePlan(state: AppState) {
  const { plan } = state;
  const bills = state.bills.filter(
    (b) => b.status === "confirmed" && b.dueDate <= plan.horizonEndDate,
  );
  const outsideBills = state.bills.filter(
    (b) => b.status === "confirmed" && b.dueDate > plan.horizonEndDate,
  );
  const billsCents = bills.reduce((n, b) => n + b.amountCents, 0);
  const afterBills = plan.balanceCents - billsCents;
  const afterEssentials = afterBills - plan.essentialsCents;
  const remainderCents = afterEssentials - plan.reserveCents;
  const status =
    afterBills < 0
      ? "bills_short"
      : afterEssentials < 0
        ? "essentials_short"
        : remainderCents < 0
          ? "reserve_short"
          : "covered";
  return {
    bills,
    outsideBills,
    billsCents,
    afterBills,
    afterEssentials,
    remainderCents,
    status,
  } as const;
}
export function simulatePurchase(
  state: AppState,
  amountCents: number,
  date: string,
) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0)
    return { error: "Enter a purchase amount greater than $0." };
  if (!day.safeParse(date).success)
    return { error: "Choose a valid calendar date for this purchase." };
  if (date < state.plan.balanceDate || date > state.plan.horizonEndDate)
    return {
      error:
        "This date is outside your plan. Adjust the period in Settings before checking this purchase.",
    };
  const plan = computePlan(state),
    remainderCents = plan.remainderCents - amountCents;
  const afterBills = plan.afterBills - amountCents,
    afterEssentials = plan.afterEssentials - amountCents;
  const message =
    afterBills < 0
      ? `${money(-afterBills)} short of covering all your bills. Review your plan before spending.`
      : afterEssentials < 0
        ? `Bills are covered, but everyday spending would be ${money(-afterEssentials)} short.`
        : remainderCents < 0
          ? `${money(-remainderCents)} below your ${money(state.plan.reserveCents)} reserve; bills and everyday spending are still covered.`
          : `${money(remainderCents)} would remain. Your bills, everyday spending, and reserve are still covered.`;
  return {
    remainderCents,
    message,
    reserveRemainingCents: Math.max(
      0,
      Math.min(state.plan.reserveCents, afterEssentials),
    ),
  };
}
/** Close each occurrence once and keep the original monthly day across short months. */
function closeBills(bills: Bill[], paidIds: string[]): Bill[] {
  const closing = bills.filter((b) => b.status === "confirmed" && paidIds.includes(b.id));
  const next = bills.map((b) => closing.includes(b) ? { ...b, status: "paid" as const } : b);
  for (const bill of closing) {
    if (bill.frequency === "One-time") continue;
    const anchor = bill.recurrenceAnchorDay ?? Number(bill.dueDate.slice(8));
    next.push({
      ...bill,
      id: newId(),
      dueDate: bill.frequency === "Monthly"
        ? addMonths(bill.dueDate, 1, anchor)
        : addDays(bill.dueDate, bill.frequency === "Weekly" ? 7 : 14),
      status: "confirmed",
      recurrenceAnchorDay: bill.frequency === "Monthly" ? anchor : undefined,
    });
  }
  if (next.length > 500) throw new Error("Your bill list is full. Delete old paid bills before recording another payment.");
  return next;
}

export function markBillPaid(
  state: AppState,
  id: string,
  alreadyDeducted: boolean,
): AppState {
  const bill = state.bills.find((b) => b.id === id);
  if (!bill || bill.status !== "confirmed") return state;
  if (!alreadyDeducted && bill.amountCents > state.plan.balanceCents)
    throw new Error(
      "This payment exceeds your balance. Update your balance first.",
    );
  return {
    ...state,
    stateVersion: state.stateVersion + 1,
    plan: {
      ...state.plan,
      balanceCents:
        state.plan.balanceCents - (alreadyDeducted ? 0 : bill.amountCents),
    },
    bills: closeBills(state.bills, [id]),
  };
}
export function previewBalanceUpdate(
  state: AppState,
  newBalanceCents: number,
  paidIds: string[],
  allocate: boolean,
) {
  if (
    !Number.isSafeInteger(newBalanceCents) ||
    newBalanceCents < 0 ||
    newBalanceCents > 1e12
  )
    throw new Error("Enter a valid non-negative balance.");
  const closed = state.bills.filter(
    (b) => paidIds.includes(b.id) && b.status === "confirmed",
  );
  const billPayments = closed.reduce((n, b) => n + b.amountCents, 0);
  const unexplainedCents =
    state.plan.balanceCents - newBalanceCents - billPayments;
  const essentialsSpentCents = allocate
    ? Math.min(state.plan.essentialsCents, Math.max(0, unexplainedCents))
    : 0;
  const excessCents = Math.max(
    0,
    unexplainedCents - state.plan.essentialsCents,
  );
  const next: AppState = {
    ...state,
    stateVersion: state.stateVersion + 1,
    plan: {
      ...state.plan,
      balanceCents: newBalanceCents,
      balanceDate: today(),
      essentialsCents: state.plan.essentialsCents - essentialsSpentCents,
    },
    bills: closeBills(state.bills, closed.map((b) => b.id)),
    lastUpdate: {
      date: today(),
      previousBalanceCents: state.plan.balanceCents,
      newBalanceCents,
      closedBills: closed.map((b) => b.name),
      essentialsSpentCents,
      excessCents,
    },
  };
  return {
    state: next,
    closed,
    unexplainedCents,
    essentialsSpentCents,
    excessCents,
    remainderCents: computePlan(next).remainderCents,
  };
}
export const ProposalSchema = ChangeProposalSchema.pick({ id: true, payload: true }).extend({
  stateVersion: z.number().int().min(0),
});
export type Proposal = z.infer<typeof ProposalSchema>;
export function previewProposal(state: AppState, proposal: Proposal) {
  const parsed = ProposalSchema.safeParse(proposal);
  if (!parsed.success) return null;
  const payload = parsed.data.payload;
  const obligations = state.bills.map((b) => ({
    ...b,
    paymentStatus: b.status === "paid" ? "paid" as const : "unpaid" as const,
    confirmationStatus: b.status === "candidate" ? "suggested" as const : "confirmed" as const,
  }));
  if (validatePayload({ obligations }, payload).length) return null;
  const target = payload.type === "update_obligation"
    ? state.bills.find((b) => b.id === payload.targetId && b.status === "confirmed")
    : null;
  if (payload.type === "update_obligation" && !target) return null;
  if (payload.type === "add_obligation" && state.bills.length >= 500) return null;
  const updated: Bill = payload.type === "update_obligation"
    ? {
        ...target!,
        ...payload.changes,
        name: payload.changes.name?.trim() ?? target!.name,
        recurrenceAnchorDay: payload.changes.dueDate ? undefined : target!.recurrenceAnchorDay,
      }
    : {
        id: "__preview__",
        ...payload.obligation,
        name: payload.obligation.name.trim(),
        frequency: "One-time",
        status: "confirmed",
        evidence: [],
        note: "Added after confirming an assistant suggestion.",
      };
  const bills = target
    ? state.bills.map((b) => b.id === target.id ? updated : b)
    : [...state.bills, updated];
  return { before: computePlan(state), after: computePlan({ ...state, bills }), target: target ?? null, updated };
}
export function applyConfirmedProposal(
  state: AppState,
  proposal: Proposal,
): {
  status: "applied" | "already_applied" | "stale" | "invalid";
  state: AppState;
} {
  if (state.appliedProposalIds.includes(proposal.id))
    return { status: "already_applied", state };
  if (proposal.stateVersion !== state.stateVersion)
    return { status: "stale", state };
  const preview = previewProposal(state, proposal);
  if (!preview) return { status: "invalid", state };
  return {
    status: "applied",
    state: {
      ...state,
      stateVersion: state.stateVersion + 1,
      appliedProposalIds: [...state.appliedProposalIds, proposal.id],
      bills: preview.target
        ? state.bills.map((b) => b.id === preview.target!.id ? preview.updated : b)
        : [...state.bills, { ...preview.updated, id: newId() }],
    },
  };
}

// CSV import and setup suggestions delegate to the shared modules in src/lib/import and src/lib/demo
// (the same code the tests and the assistant server use), adapted to this UI's types.
export type Mapping = {
  date: number;
  description: number;
  /** One signed amount column. -1 when the file uses separate debit/credit columns. */
  amount: number;
  debit: number;
  credit: number;
};
export type DateFormat = "" | "ISO" | "MDY" | "DMY";
const toIndex = (n: number | null) => (n === null ? -1 : n);
const toCol = (n: number) => (n >= 0 ? n : null);
export function parseCsv(text: string) {
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024)
    throw new Error("This file is larger than 2 MB. Export a smaller date range.");
  let parsed;
  try {
    parsed = sharedParseCsv(text);
  } catch (e) {
    const message = (e as Error).message;
    if (/unclosed quote/i.test(message))
      throw new Error("A quoted field is not closed. Check your CSV and try again.");
    if (/header row/i.test(message) || /empty/i.test(message))
      throw new Error(
        "Include a header and at least one transaction, with date, description, and amount columns.",
      );
    throw new Error(message);
  }
  if (parsed.headers.length < 3)
    throw new Error(
      "Include a header and at least one transaction, with date, description, and amount columns.",
    );
  const guess = guessMapping(parsed.headers);
  return {
    headers: parsed.headers,
    rows: parsed.rows,
    mapping: {
      date: toIndex(guess.date),
      description: toIndex(guess.description),
      amount: toIndex(guess.amount),
      debit: toIndex(guess.debit),
      credit: toIndex(guess.credit),
    } satisfies Mapping,
  };
}
const DATE_LIKE = /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/;
/** "" means the user has to choose (ambiguous, or nothing recognizable). */
export function detectDateFormats(values: string[]): DateFormat {
  const dateLike = values.map((v) => (v ?? "").trim()).filter((v) => DATE_LIKE.test(v));
  if (!dateLike.length) return "";
  const { fits, ambiguous } = sharedDetectDateFormats(dateLike);
  if (fits.includes("YMD")) return "ISO";
  if (ambiguous) return "";
  if (fits.includes("MDY")) return "MDY";
  if (fits.includes("DMY")) return "DMY";
  return "";
}
export function usesDebitCredit(mapping: Mapping) {
  return mapping.amount < 0 && mapping.debit >= 0 && mapping.credit >= 0;
}
export function normalizeRows(
  rows: string[][],
  mapping: Mapping,
  format: DateFormat,
  invert: boolean,
) {
  const transactions: Transaction[] = [],
    errors: string[] = [];
  const used = [mapping.date, mapping.description, ...(usesDebitCredit(mapping) ? [mapping.debit, mapping.credit] : [mapping.amount])];
  if (used.some((n) => n < 0) || new Set(used).size !== used.length)
    return {
      transactions,
      errors: [
        usesDebitCredit(mapping) || mapping.amount < 0
          ? "Choose different columns for date, description, and either an amount or both debit and credit."
          : "Choose three different columns for date, description, and amount.",
      ],
    };
  if (!format) return { transactions, errors };
  const result = sharedNormalizeRows(rows, {
    mapping: {
      date: toCol(mapping.date),
      description: toCol(mapping.description),
      amount: usesDebitCredit(mapping) ? null : toCol(mapping.amount),
      debit: usesDebitCredit(mapping) ? toCol(mapping.debit) : null,
      credit: usesDebitCredit(mapping) ? toCol(mapping.credit) : null,
    },
    dateFormat: format === "ISO" ? "YMD" : format,
    sign: invert ? "positive_is_out" : "negative_is_out",
  });
  for (const e of result.errors) {
    const message = e.message.replace(/"/g, "“").replace(/“([^“]*)“/, "“$1”");
    errors.push(`Row ${e.row}: ${message.charAt(0).toLowerCase()}${message.slice(1)}.`);
  }
  for (const t of result.transactions)
    transactions.push({
      id: newId(),
      date: t.postedDate,
      description: t.description,
      amountCents: t.amountCents,
      row: t.row,
      duplicate: t.reviewStatus === "possible_duplicate",
      transfer: t.possibleTransfer,
    });
  return { transactions, errors };
}
export async function fileHash(text: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
const FREQUENCY: Record<string, Bill["frequency"]> = {
  monthly: "Monthly",
  biweekly: "Biweekly",
  weekly: "Weekly",
};
const PAY_LABEL: Record<string, string> = {
  weekly: "weekly",
  biweekly: "every two weeks",
  semimonthly: "twice a month",
  monthly: "monthly",
};
export function buildSetupSuggestion(
  transactions: Transaction[],
  now = today(),
) {
  const shared = transactions.map((t) => ({
    id: t.id,
    importBatchId: "import",
    postedDate: t.date,
    description: t.description,
    amountCents: t.amountCents,
    reviewStatus: "ok" as const,
    possibleTransfer: t.transfer,
  }));
  const s = sharedSetupSuggestion(shared, now);
  const bills: Bill[] = s.candidates.map((c) => ({
    id: newId(),
    name: c.displayName,
    amountCents: c.amountCents,
    dueDate: c.nextDueDate,
    frequency: FREQUENCY[c.cadence] ?? "Monthly",
    status: "candidate",
    evidence: c.sourceTransactionIds,
    note: [
      `Seen ${c.occurrences} times${c.occurrences >= 3 && c.minCents === c.maxCents ? " with the same amount" : ""}. Confirm the amount and next date.`,
      ...c.notes.filter((n) => !n.startsWith("Seen only")),
    ].join(" "),
  }));
  const evidenceIds = new Set(bills.flatMap((b) => b.evidence));
  const windowDays = s.essentials?.windowDays ?? 0;
  const lastDate = transactions.reduce((m, t) => (t.date > m ? t.date : m), "");
  const windowStart = lastDate ? addDays(lastDate, -(Math.max(windowDays, 1) - 1)) : now;
  const largePurchases = transactions.filter(
    (t) =>
      t.date >= windowStart &&
      t.amountCents <= -40000 &&
      !evidenceIds.has(t.id) &&
      !t.transfer,
  );
  return {
    bills,
    horizon: s.endDate,
    horizonSource: s.income
      ? `Your next expected deposit from ${s.income.displayName} (paid ${PAY_LABEL[s.income.cadence]}, ${s.income.occurrences} deposits found)`
      : "A two-week planning period",
    essentialsCents: s.essentials?.cents ?? 0,
    basisDays: windowDays,
    largePurchases,
  };
}
export function generateSampleCsv(variant: "A" | "B", now = today()) {
  return variant === "A" ? generateSampleCsvA(now) : generateSampleCsvB(now);
}
