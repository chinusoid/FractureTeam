import { type Cents, sumCents } from "./money";
import { type ISODate, addDays, addMonths, diffDays, isWithin } from "./dates";
import type { AppState, PlanInput } from "./types";

export type PlanStatus = "ok" | "reserve_short" | "essentials_short" | "bills_short";

export interface BillLine {
  id: string;
  name: string;
  amountCents: Cents;
  dueDate: ISODate;
  overdue: boolean;
  /** Payments of this bill that fall on or before the period end: 1, or more for a bill that repeats inside it. */
  payments: number;
  /** amountCents × payments: what the plan sets aside for this bill. */
  totalCents: Cents;
}

export type Repeat = "weekly" | "biweekly" | "monthly";

/** What counting a bill's payments needs to know about it and about the bills around it. */
export interface RepeatingBill {
  id: string;
  name: string;
  dueDate: ISODate;
  paid: boolean;
  repeat?: Repeat;
  /** Day of the month a monthly bill keeps across short months. */
  anchorDay?: number;
}

/**
 * How many payments of an unpaid bill fall on or before `endDate`: the one on its due date, plus its
 * repeats. A weekly bill can come due twice before payday, and the plan has to set both aside.
 * Only the latest unpaid bill of a name projects repeats, and a repeat is skipped when another bill
 * of that name already stands within three days of it, so a payment is never counted twice.
 * Shared by the browser and the server: the overview and the assistant count the same way.
 */
export function paymentsBy(bill: RepeatingBill, all: readonly RepeatingBill[], endDate: ISODate): number {
  if (bill.dueDate > endDate) return 0;
  if (!bill.repeat) return 1;
  const name = bill.name.trim().toLowerCase();
  const others = all.filter((o) => o.id !== bill.id && o.name.trim().toLowerCase() === name);
  const laterUnpaid = others.some((o) => !o.paid && (o.dueDate > bill.dueDate || (o.dueDate === bill.dueDate && o.id > bill.id)));
  if (laterUnpaid) return 1;
  const anchor = bill.anchorDay ?? Number(bill.dueDate.slice(8));
  let count = 1;
  let next = bill.dueDate;
  for (let i = 0; i < 60; i++) {
    next = bill.repeat === "monthly" ? addMonths(next, 1, anchor) : addDays(next, bill.repeat === "weekly" ? 7 : 14);
    if (next > endDate) break;
    const date = next;
    if (!others.some((o) => Math.abs(diffDays(o.dueDate, date)) <= 3)) count++;
  }
  return count;
}

/** Result of checking money against the three layers, in priority order. */
export interface Evaluation {
  availableCents: Cents;
  billsCents: Cents;
  essentialsCents: Cents;
  reserveTargetCents: Cents;
  /** available - bills - essentials - reserve. Negative values are kept, never clamped. */
  remainderCents: Cents;
  status: PlanStatus;
  /** Money missing for the first layer that is not covered (0 when status is ok). */
  shortfallCents: Cents;
  billsCovered: boolean;
  essentialsCovered: boolean;
  /** How much of the chosen reserve is still protected (can be below target, never below 0 here). */
  reserveLeftCents: Cents;
}

export interface PlanResult extends Evaluation {
  today: ISODate;
  balanceAsOf: ISODate;
  periodStart: ISODate;
  periodEnd: ISODate;
  billsInPeriod: BillLine[];
  billsOutsidePeriod: BillLine[];
  unconfirmedCount: number;
}

/**
 * Status is decided in a fixed order (plan section 7):
 * bills first, then essentials, then the reserve.
 */
export function evaluate(
  availableCents: Cents,
  billsCents: Cents,
  essentialsCents: Cents,
  reserveTargetCents: Cents,
): Evaluation {
  const remainderCents = availableCents - billsCents - essentialsCents - reserveTargetCents;
  const afterBills = availableCents - billsCents;
  const afterEssentials = afterBills - essentialsCents;
  let status: PlanStatus;
  let shortfallCents: Cents;
  if (afterBills < 0) {
    status = "bills_short";
    shortfallCents = -afterBills;
  } else if (afterEssentials < 0) {
    status = "essentials_short";
    shortfallCents = -afterEssentials;
  } else if (remainderCents < 0) {
    status = "reserve_short";
    shortfallCents = -remainderCents;
  } else {
    status = "ok";
    shortfallCents = 0;
  }
  return {
    availableCents,
    billsCents,
    essentialsCents,
    reserveTargetCents,
    remainderCents,
    status,
    shortfallCents,
    billsCovered: afterBills >= 0,
    essentialsCovered: afterEssentials >= 0,
    reserveLeftCents: Math.max(0, Math.min(reserveTargetCents, afterEssentials)),
  };
}

export function computePlan(input: PlanInput): PlanResult {
  const confirmedUnpaid = input.obligations.filter(
    (o) => o.confirmationStatus === "confirmed" && o.paymentStatus === "unpaid",
  );
  const standing: RepeatingBill[] = input.obligations
    .filter((o) => o.confirmationStatus === "confirmed")
    .map((o) => ({ id: o.id, name: o.name, dueDate: o.dueDate, paid: o.paymentStatus === "paid", repeat: o.repeat, anchorDay: o.anchorDay }));
  const toLine = (o: PlanInput["obligations"][number]): BillLine => {
    const payments = Math.max(
      1,
      paymentsBy({ id: o.id, name: o.name, dueDate: o.dueDate, paid: false, repeat: o.repeat, anchorDay: o.anchorDay }, standing, input.endDate),
    );
    return {
      id: o.id,
      name: o.name,
      amountCents: o.amountCents,
      dueDate: o.dueDate,
      overdue: o.dueDate < input.today,
      payments,
      totalCents: o.amountCents * payments,
    };
  };
  const byDate = (a: BillLine, b: BillLine) => (a.dueDate === b.dueDate ? a.name.localeCompare(b.name) : a.dueDate < b.dueDate ? -1 : 1);
  // Bills due up to and including the end date count. Unpaid bills from before the period are still owed.
  const billsInPeriod = confirmedUnpaid.filter((o) => o.dueDate <= input.endDate).map(toLine).sort(byDate);
  const billsOutsidePeriod = confirmedUnpaid.filter((o) => o.dueDate > input.endDate).map(toLine).sort(byDate);
  const billsCents = sumCents(billsInPeriod.map((b) => b.totalCents));
  const evaluation = evaluate(input.balanceCents, billsCents, input.essentialRemainingCents, input.reserveTargetCents);
  return {
    ...evaluation,
    today: input.today,
    balanceAsOf: input.balanceAsOf,
    periodStart: input.startDate,
    periodEnd: input.endDate,
    billsInPeriod,
    billsOutsidePeriod,
    unconfirmedCount: input.obligations.filter((o) => o.confirmationStatus !== "confirmed").length,
  };
}

export type SimulationResult =
  | {
      kind: "ok";
      amountCents: Cents;
      purchaseDate: ISODate;
      before: PlanResult;
      after: Evaluation;
    }
  | { kind: "outside_period"; amountCents: Cents; purchaseDate: ISODate; periodStart: ISODate; periodEnd: ISODate }
  | { kind: "invalid"; reason: string };

/** A what-if check. It never changes the balance or any stored data. */
export function simulatePurchase(input: PlanInput, amountCents: Cents, purchaseDate: ISODate): SimulationResult {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return { kind: "invalid", reason: "Purchase amount must be greater than $0." };
  }
  if (amountCents > 100_000_000) {
    return { kind: "invalid", reason: "Purchase amount is too large for this plan." };
  }
  const earliest = input.today > input.startDate ? input.today : input.startDate;
  if (!isWithin(purchaseDate, earliest, input.endDate)) {
    return {
      kind: "outside_period",
      amountCents,
      purchaseDate,
      periodStart: earliest,
      periodEnd: input.endDate,
    };
  }
  const before = computePlan(input);
  const after = evaluate(
    before.availableCents - amountCents,
    before.billsCents,
    before.essentialsCents,
    before.reserveTargetCents,
  );
  return { kind: "ok", amountCents, purchaseDate, before, after };
}

export function planInputFromState(state: AppState, today: ISODate): PlanInput | null {
  if (!state.account || !state.plan) return null;
  return {
    today,
    balanceCents: state.account.balanceCents,
    balanceAsOf: state.account.balanceAsOf,
    startDate: state.plan.startDate,
    endDate: state.plan.endDate,
    essentialRemainingCents: state.plan.essentialRemainingCents,
    reserveTargetCents: state.plan.reserveTargetCents,
    obligations: state.obligations.map((o) => ({
      id: o.id,
      name: o.name,
      amountCents: o.amountCents,
      dueDate: o.dueDate,
      paymentStatus: o.paymentStatus,
      confirmationStatus: o.confirmationStatus,
    })),
  };
}

export const STATUS_LABEL: Record<PlanStatus, string> = {
  ok: "On track",
  reserve_short: "Below your reserve",
  essentials_short: "Short for everyday spending",
  bills_short: "Short for bills",
};
