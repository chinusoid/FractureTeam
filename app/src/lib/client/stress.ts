// "What if payday is late?" A what-if on the plan: it never changes stored data.
// A late paycheck stretches the period: more days of everyday spending, and bills that were safely after
// payday now land before the money arrives.
import { addMonths } from "../finance/dates";
import { addDays, computePlan, daysBetween, today, type AppState, type Bill } from "./model";

export interface GapBill {
  name: string;
  amountCents: number;
  dueDate: string;
  /** True when the date comes from the bill's repeat rule rather than a bill already in the plan. */
  expected: boolean;
}

export interface LatePayResult {
  lateDays: number;
  /** The day the paycheck would arrive. */
  newEnd: string;
  gapBills: GapBill[];
  gapBillsCents: number;
  /** Everyday spending for the extra days, at the plan's current daily pace. */
  extraEverydayCents: number;
  /** What would be free with the late paycheck (negative: below the reserve or short). */
  remainderCents: number;
  /** covered: reserve untouched; reserve: bills and everyday covered by using part of the reserve; short: not covered. */
  status: "covered" | "reserve" | "short";
  /** Reserve used (status reserve) or money missing beyond the reserve (status short). */
  gapCents: number;
}

/** Days left in the period, today included (at least 1). */
export function daysLeft(state: AppState, now = today()): number {
  const start = now > state.plan.balanceDate ? now : state.plan.balanceDate;
  return Math.max(1, daysBetween(start, state.plan.horizonEndDate) + 1);
}

/**
 * Everyday spending per day at the current plan: what was left for everyday on the balance date, spread
 * over the days from that date to payday (at least 1). Both are as of the balance date, so the pace
 * does not change when only the calendar moves; `now` is kept for callers and no longer matters.
 */
export function everydayPerDay(state: AppState, now = today()): number {
  void now;
  return Math.round(
    state.plan.essentialsCents / Math.max(1, daysBetween(state.plan.balanceDate, state.plan.horizonEndDate) + 1),
  );
}

const STEP_DAYS: Partial<Record<Bill["frequency"], number>> = { Weekly: 7, Biweekly: 14 };
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Confirmed bills due after the period end and up to `until`, plus repeat dates of recurring bills in that window. */
export function billsInGap(state: AppState, until: string): GapBill[] {
  const end = state.plan.horizonEndDate;
  const confirmed = state.bills.filter((b) => b.status === "confirmed" && b.amountCents > 0);
  const out: GapBill[] = confirmed
    .filter((b) => b.dueDate > end && b.dueDate <= until)
    .map((b) => ({ name: b.name, amountCents: b.amountCents, dueDate: b.dueDate, expected: false }));
  for (const b of confirmed) {
    if (b.frequency === "One-time") continue;
    const anchor = b.recurrenceAnchorDay ?? Number(b.dueDate.slice(8));
    let next = b.dueDate;
    for (let i = 0; i < 60; i++) {
      next = b.frequency === "Monthly" ? addMonths(next, 1, anchor) : addDays(next, STEP_DAYS[b.frequency]!);
      if (next > until) break;
      if (next <= end) continue;
      // The next occurrence may already be in the plan (created when the bill was marked paid).
      const known = out.some((g) => sameName(g.name, b.name) && Math.abs(daysBetween(g.dueDate, next)) <= 3);
      if (!known) out.push({ name: b.name, amountCents: b.amountCents, dueDate: next, expected: true });
    }
  }
  return out.sort((a, b) => (a.dueDate === b.dueDate ? a.name.localeCompare(b.name) : a.dueDate < b.dueDate ? -1 : 1));
}

export function latePaycheck(state: AppState, lateDays: number, now = today()): LatePayResult {
  const days = Math.max(0, Math.min(60, Math.round(lateDays)));
  const newEnd = addDays(state.plan.horizonEndDate, days);
  const plan = computePlan(state);
  const gapBills = days ? billsInGap(state, newEnd) : [];
  const gapBillsCents = gapBills.reduce((n, b) => n + b.amountCents, 0);
  const extraEverydayCents = everydayPerDay(state, now) * days;
  const afterEssentials = plan.afterEssentials - gapBillsCents - extraEverydayCents;
  const remainderCents = afterEssentials - state.plan.reserveCents;
  const status = afterEssentials < 0 ? "short" : remainderCents < 0 ? "reserve" : "covered";
  return {
    lateDays: days,
    newEnd,
    gapBills,
    gapBillsCents,
    extraEverydayCents,
    remainderCents,
    status,
    gapCents: status === "short" ? -afterEssentials : status === "reserve" ? -remainderCents : 0,
  };
}

/**
 * How many days the paycheck can be late before bills or everyday spending are no longer covered
 * (the reserve may be used). 0 when the plan is already short; `max` means "at least max days".
 */
export function lateCushionDays(state: AppState, max = 30, now = today()): number {
  if (computePlan(state).afterEssentials < 0) return 0;
  for (let d = 1; d <= max; d++) {
    if (latePaycheck(state, d, now).status === "short") return d - 1;
  }
  return max;
}
