// Standalone client adapter. Replace with covered-base's finance/import exports
// when the shared package is supplied; no server or shared module is shadowed.
import { z } from "zod";

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
    bills: state.bills.map((b) => (b.id === id ? { ...b, status: "paid" } : b)),
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
    bills: state.bills.map((b) =>
      closed.some((c) => c.id === b.id) ? { ...b, status: "paid" } : b,
    ),
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
export type Proposal = {
  id: string;
  stateVersion: number;
  billId: string;
  amountCents: number;
};
export function previewProposal(state: AppState, proposal: Proposal) {
  if (
    !Number.isSafeInteger(proposal.amountCents) ||
    proposal.amountCents <= 0 ||
    proposal.amountCents > 1e12 ||
    !state.bills.some(
      (b) => b.id === proposal.billId && b.status === "confirmed",
    )
  )
    return null;
  return computePlan({
    ...state,
    bills: state.bills.map((b) =>
      b.id === proposal.billId
        ? { ...b, amountCents: proposal.amountCents }
        : b,
    ),
  });
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
  if (!previewProposal(state, proposal)) return { status: "invalid", state };
  return {
    status: "applied",
    state: {
      ...state,
      stateVersion: state.stateVersion + 1,
      appliedProposalIds: [...state.appliedProposalIds, proposal.id],
      bills: state.bills.map((b) =>
        b.id === proposal.billId
          ? { ...b, amountCents: proposal.amountCents }
          : b,
      ),
    },
  };
}

export type Mapping = { date: number; description: number; amount: number };
export type DateFormat = "" | "ISO" | "MDY" | "DMY";
export function parseCsv(text: string) {
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024)
    throw new Error(
      "This file is larger than 2 MB. Export a smaller date range.",
    );
  const delimiter = text.split(/\r?\n/)[0]?.includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted)
    throw new Error(
      "A quoted field is not closed. Check your CSV and try again.",
    );
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2 || rows[0].length < 3)
    throw new Error(
      "Include a header and at least one transaction, with date, description, and amount columns.",
    );
  if (rows.length > 5001)
    throw new Error(
      "This file has more than 5,000 transactions. Export a smaller date range.",
    );
  const headers = rows.shift()!.map((h) => h.replace(/^\uFEFF/, ""));
  const guess = (pattern: RegExp) => headers.findIndex((h) => pattern.test(h));
  return {
    headers,
    rows,
    mapping: {
      date: guess(/date/i),
      description: guess(/description|merchant|memo|name/i),
      amount: guess(/amount|total|value/i),
    },
  };
}
export function detectDateFormats(values: string[]): DateFormat {
  if (values.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) return "ISO";
  if (values.some((v) => Number(v.split(/[/.\-]/)[0]) > 12)) return "DMY";
  if (values.some((v) => Number(v.split(/[/.\-]/)[1]) > 12)) return "MDY";
  return "";
}
function parseDate(value: string, format: DateFormat) {
  if (format === "ISO") return day.safeParse(value).success ? value : null;
  if (!format) return null;
  const parts = value.split(/[/.\-]/);
  if (
    parts.length !== 3 ||
    !parts.every((p) => /^\d+$/.test(p)) ||
    parts[2].length !== 4
  )
    return null;
  const [a, b, y] = parts;
  const result = `${y}-${(format === "MDY" ? a : b).padStart(2, "0")}-${(format === "MDY" ? b : a).padStart(2, "0")}`;
  return day.safeParse(result).success ? result : null;
}
export function normalizeRows(
  rows: string[][],
  mapping: Mapping,
  format: DateFormat,
  invert: boolean,
) {
  const transactions: Transaction[] = [],
    errors: string[] = [],
    seen = new Set<string>();
  if (
    Object.values(mapping).some((n) => n < 0) ||
    new Set(Object.values(mapping)).size !== 3
  )
    return {
      transactions,
      errors: [
        "Choose three different columns for date, description, and amount.",
      ],
    };
  rows.forEach((row, i) => {
    const date = parseDate(row[mapping.date] ?? "", format),
      description = (row[mapping.description] ?? "").slice(0, 500),
      parsed = parseMoney(row[mapping.amount] ?? "");
    if (!date || !description || parsed === null) {
      errors.push(
        `Row ${i + 2}: ${!date ? "invalid or unknown date" : !description ? "missing description" : "invalid amount"}.`,
      );
      return;
    }
    const amountCents = parsed * (invert ? -1 : 1),
      key = `${date}|${description.toLowerCase()}|${amountCents}`;
    transactions.push({
      id: newId(),
      date,
      description,
      amountCents,
      row: i + 2,
      duplicate: seen.has(key),
      transfer: /transfer|venmo|zelle|internal|savings/i.test(description),
    });
    seen.add(key);
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
export function buildSetupSuggestion(
  transactions: Transaction[],
  now = today(),
) {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions.filter(
    (t) => !t.transfer && !t.duplicate && t.date <= now,
  )) {
    const key = t.description.toLowerCase().replace(/\d/g, "").trim();
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const bills: Bill[] = [];
  let horizon = addDays(now, 13),
    horizonSource = "A two-week planning period";
  for (const group of groups.values()) {
    group.sort((a, b) => a.date.localeCompare(b.date));
    if (group.length < 2) continue;
    const last = group.at(-1)!,
      previous = group.at(-2)!,
      interval = daysBetween(previous.date, last.date);
    if (
      interval < 6 ||
      interval > 35 ||
      Math.abs(last.amountCents - previous.amountCents) >
        Math.abs(last.amountCents) * 0.1
    )
      continue;
    let next = addDays(last.date, interval);
    while (next < now) next = addDays(next, interval);
    if (
      last.amountCents > 0 &&
      /salary|payroll|paycheck|direct deposit/i.test(last.description)
    ) {
      horizon = next;
      horizonSource = `Expected paycheck, based on ${group.length} deposits`;
    }
    if (last.amountCents < 0)
      bills.push({
        id: newId(),
        name: last.description,
        amountCents: -last.amountCents,
        dueDate: next,
        frequency:
          interval <= 8 ? "Weekly" : interval <= 16 ? "Biweekly" : "Monthly",
        status: "candidate",
        evidence: group.map((t) => t.id),
        note: "Estimated from similar recurring transactions. Confirm the amount and next date.",
      });
  }
  const evidenceIds = new Set(bills.flatMap((b) => b.evidence));
  const largePurchases = transactions.filter(
    (t) =>
      t.date >= addDays(now, -13) &&
      t.date <= now &&
      t.amountCents <= -20000 &&
      !evidenceIds.has(t.id) &&
      !t.transfer,
  );
  const everyday = transactions.filter(
    (t) =>
      t.date >= addDays(now, -13) &&
      t.date <= now &&
      t.amountCents < 0 &&
      t.amountCents > -20000 &&
      !t.transfer &&
      !evidenceIds.has(t.id),
  );
  const essentialsCents = Math.round(
    (everyday.reduce((n, t) => n - t.amountCents, 0) / 14) *
      (daysBetween(now, horizon) + 1),
  );
  return {
    bills,
    horizon,
    horizonSource,
    essentialsCents,
    basisDays: 14,
    largePurchases,
  };
}
export function generateSampleCsv(variant: "A" | "B", now = today()) {
  const rows: (string | number)[][] = [["Date", "Description", "Amount"]];
  const names =
    variant === "A"
      ? ([
          ["Rent", 1100, 2],
          ["Car insurance", 120, 5],
          ["Internet", 80, 9],
        ] as const)
      : ([
          ["Rent", 1350, 2],
          ["Car insurance", 160, 5],
          ["Internet", 95, 9],
        ] as const);
  for (const [name, amount, offset] of names)
    for (const ago of [60, 30])
      rows.push([addDays(now, offset - ago), name, -amount]);
  rows.push(
    [addDays(now, -15), "Payroll", 2500],
    [addDays(now, -1), "Payroll", 2500],
  );
  const spending =
    variant === "A" ? [85, 60, 45, 90, 70] : [110, 80, 65, 120, 90];
  spending.forEach((amount, i) =>
    rows.push([
      addDays(now, -12 + i * 2),
      [
        "Whole Foods",
        "Trader Joe's",
        "Transit",
        "Groceries",
        "Everyday essentials",
      ][i],
      -amount,
    ]),
  );
  return rows.map((row) => row.join(",")).join("\n");
}
