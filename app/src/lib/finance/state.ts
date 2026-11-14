import { type Cents } from "./money";
import { type ISODate, addDays, addMonths } from "./dates";
import { computePlan } from "./calc";
import type { AppState, Obligation, PlanSettings, Recurrence, UpdateSummary } from "./types";

export function newId(prefix: string): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  let raw: string;
  try {
    raw = c && typeof c.randomUUID === "function" ? c.randomUUID() : "";
  } catch {
    raw = "";
  }
  if (!raw) raw = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${raw.replace(/-/g, "").slice(0, 16)}`;
}

export function emptyState(clientId = newId("client")): AppState {
  return {
    schemaVersion: 1,
    stateVersion: 0,
    clientId,
    isSample: false,
    account: null,
    plan: null,
    obligations: [],
    transactions: [],
    importBatches: [],
    snapshots: [],
    scenarios: [],
    appliedProposalIds: [],
    changeLog: [],
    lastUpdate: null,
    consent: { aiEnabled: false, acceptedAt: null, policyVersion: 1 },
  };
}

/** Every stored change increments stateVersion (plan rule 11). */
export function bumpVersion(state: AppState): AppState {
  return { ...state, stateVersion: state.stateVersion + 1 };
}

export function nextOccurrence(date: ISODate, recurrence: Recurrence): ISODate | null {
  switch (recurrence) {
    case "monthly":
      return addMonths(date, 1);
    case "biweekly":
      return addDays(date, 14);
    case "weekly":
      return addDays(date, 7);
    default:
      return null;
  }
}

export function upsertObligation(state: AppState, obligation: Obligation): AppState {
  const exists = state.obligations.some((o) => o.id === obligation.id);
  return bumpVersion({
    ...state,
    obligations: exists
      ? state.obligations.map((o) => (o.id === obligation.id ? obligation : o))
      : [...state.obligations, obligation],
  });
}

export function removeObligation(state: AppState, id: string): AppState {
  return bumpVersion({ ...state, obligations: state.obligations.filter((o) => o.id !== id) });
}

/**
 * Marks a bill as paid (plan rule 3).
 * reflectedInBalance = the payment was already taken out of the balance the user entered.
 * If not, the balance goes down by the bill amount in the same operation, so it is never counted twice.
 * A recurring bill gets its next occurrence created automatically.
 */
export function markBillPaid(state: AppState, id: string, reflectedInBalance: boolean, today: ISODate): AppState {
  const bill = state.obligations.find((o) => o.id === id);
  if (!bill || bill.paymentStatus === "paid" || !state.account) return state;
  let obligations = state.obligations.map((o) =>
    o.id === id ? { ...o, paymentStatus: "paid" as const, paidOn: today } : o,
  );
  obligations = withNextOccurrence(obligations, bill);
  return bumpVersion({
    ...state,
    account: reflectedInBalance
      ? state.account
      : { ...state.account, balanceCents: state.account.balanceCents - bill.amountCents },
    obligations,
  });
}

function withNextOccurrence(obligations: Obligation[], paid: Obligation): Obligation[] {
  const nextDate = nextOccurrence(paid.dueDate, paid.recurrence);
  if (!nextDate) return obligations;
  const already = obligations.some(
    (o) => o.id !== paid.id && o.name === paid.name && o.dueDate === nextDate && o.paymentStatus === "unpaid",
  );
  if (already) return obligations;
  return [
    ...obligations,
    {
      ...paid,
      id: newId("bill"),
      dueDate: nextDate,
      paymentStatus: "unpaid",
      paidOn: null,
      sourceTransactionIds: [],
    },
  ];
}

export function setPlan(state: AppState, plan: PlanSettings): AppState {
  return bumpVersion({ ...state, plan });
}

export function setBalance(state: AppState, balanceCents: Cents, asOf: ISODate): AppState {
  return bumpVersion({ ...state, account: { currency: "USD", balanceCents, balanceAsOf: asOf } });
}

// ---------------------------------------------------------------------------
// Balance update ("Update plan", plan rule 15)
// ---------------------------------------------------------------------------

export interface BalanceUpdateInput {
  newBalanceCents: Cents;
  /** Bills the user marks as paid AND already taken out of the new balance. */
  paidBillIds: string[];
  /** Whether the unexplained decrease is confirmed as everyday spending. */
  assignToEssentials: boolean;
}

export interface BalanceUpdatePreview {
  oldBalanceCents: Cents;
  newBalanceCents: Cents;
  paidBills: { id: string; name: string; amountCents: Cents }[];
  paidTotalCents: Cents;
  expectedBalanceCents: Cents;
  unexplainedDecreaseCents: Cents;
  unexplainedIncreaseCents: Cents;
  essentialsAssignableCents: Cents;
  excessDecreaseCents: Cents;
  essentialsBeforeCents: Cents;
  essentialsAfterCents: Cents;
  remainderBeforeCents: Cents;
  remainderAfterCents: Cents;
  suggestNewPeriod: boolean;
}

export function previewBalanceUpdate(state: AppState, input: BalanceUpdateInput, today: ISODate): BalanceUpdatePreview | null {
  if (!state.account || !state.plan) return null;
  const old = state.account.balanceCents;
  const paidBills = state.obligations
    .filter((o) => input.paidBillIds.includes(o.id) && o.paymentStatus === "unpaid" && o.confirmationStatus === "confirmed")
    .map((o) => ({ id: o.id, name: o.name, amountCents: o.amountCents }));
  const paidTotalCents = paidBills.reduce((a, b) => a + b.amountCents, 0);
  const expected = old - paidTotalCents;
  const delta = expected - input.newBalanceCents; // > 0: balance fell more than the paid bills explain
  const unexplainedDecreaseCents = Math.max(0, delta);
  const unexplainedIncreaseCents = Math.max(0, -delta);
  const essentialsBefore = state.plan.essentialRemainingCents;
  const essentialsAssignableCents = Math.min(unexplainedDecreaseCents, essentialsBefore);
  const assigned = input.assignToEssentials ? essentialsAssignableCents : 0;
  const essentialsAfter = essentialsBefore - assigned;

  const nextState = applyBalanceUpdateInternal(state, input, today, "preview");
  const before = computePlan({
    today,
    balanceCents: old,
    balanceAsOf: state.account.balanceAsOf,
    startDate: state.plan.startDate,
    endDate: state.plan.endDate,
    essentialRemainingCents: essentialsBefore,
    reserveTargetCents: state.plan.reserveTargetCents,
    obligations: state.obligations,
  });
  const after = computePlan({
    today,
    balanceCents: input.newBalanceCents,
    balanceAsOf: today,
    startDate: state.plan.startDate,
    endDate: state.plan.endDate,
    essentialRemainingCents: essentialsAfter,
    reserveTargetCents: state.plan.reserveTargetCents,
    obligations: nextState.obligations,
  });
  return {
    oldBalanceCents: old,
    newBalanceCents: input.newBalanceCents,
    paidBills,
    paidTotalCents,
    expectedBalanceCents: expected,
    unexplainedDecreaseCents,
    unexplainedIncreaseCents,
    essentialsAssignableCents,
    excessDecreaseCents: unexplainedDecreaseCents - essentialsAssignableCents,
    essentialsBeforeCents: essentialsBefore,
    essentialsAfterCents: essentialsAfter,
    remainderBeforeCents: before.remainderCents,
    remainderAfterCents: after.remainderCents,
    suggestNewPeriod: unexplainedIncreaseCents > 0 || today > state.plan.endDate,
  };
}

function applyBalanceUpdateInternal(state: AppState, input: BalanceUpdateInput, today: ISODate, _mode: "preview" | "apply"): AppState {
  let obligations = state.obligations;
  for (const id of input.paidBillIds) {
    const bill = obligations.find((o) => o.id === id);
    if (!bill || bill.paymentStatus === "paid" || bill.confirmationStatus !== "confirmed") continue;
    obligations = obligations.map((o) => (o.id === id ? { ...o, paymentStatus: "paid" as const, paidOn: today } : o));
    obligations = withNextOccurrence(obligations, bill);
  }
  return { ...state, obligations };
}

export function applyBalanceUpdate(state: AppState, input: BalanceUpdateInput, today: ISODate, nowIso: string): AppState {
  const preview = previewBalanceUpdate(state, input, today);
  if (!preview || !state.account || !state.plan) return state;
  const withBills = applyBalanceUpdateInternal(state, input, today, "apply");
  const summary: UpdateSummary = {
    at: nowIso,
    fromDate: state.account.balanceAsOf,
    toDate: today,
    balanceBeforeCents: preview.oldBalanceCents,
    balanceAfterCents: preview.newBalanceCents,
    closedBills: preview.paidBills,
    essentialsBeforeCents: preview.essentialsBeforeCents,
    essentialsAfterCents: preview.essentialsAfterCents,
    unassignedDecreaseCents: preview.unexplainedDecreaseCents - (preview.essentialsBeforeCents - preview.essentialsAfterCents),
    unexplainedIncreaseCents: preview.unexplainedIncreaseCents,
    remainderBeforeCents: preview.remainderBeforeCents,
    remainderAfterCents: preview.remainderAfterCents,
  };
  const next: AppState = {
    ...withBills,
    account: { currency: "USD", balanceCents: input.newBalanceCents, balanceAsOf: today },
    plan: { ...state.plan, essentialRemainingCents: preview.essentialsAfterCents },
    snapshots: [
      ...state.snapshots,
      {
        id: newId("snap"),
        balanceCents: state.account.balanceCents,
        asOf: state.account.balanceAsOf,
        stateVersion: state.stateVersion,
        createdAt: nowIso,
      },
    ].slice(-20),
    lastUpdate: summary,
  };
  return bumpVersion(next);
}

/**
 * Records real everyday spending (plan rule 14): the balance and the remaining essentials budget
 * go down together, so the free remainder does not change and nothing is counted twice.
 */
export function recordEssentialSpend(state: AppState, amountCents: Cents, reflectedInBalance: boolean): AppState {
  if (!state.account || !state.plan || amountCents <= 0) return state;
  const fromEssentials = Math.min(amountCents, state.plan.essentialRemainingCents);
  return bumpVersion({
    ...state,
    account: reflectedInBalance
      ? state.account
      : { ...state.account, balanceCents: state.account.balanceCents - amountCents },
    plan: { ...state.plan, essentialRemainingCents: state.plan.essentialRemainingCents - fromEssentials },
  });
}

export const STALE_AFTER_DAYS = 3;
