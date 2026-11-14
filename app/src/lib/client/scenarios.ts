// Saved what-ifs: a purchase, a new bill or a late paycheck, kept with the plan.
// Each one is re-evaluated against the plan as it is now, so the answer stays true after every update.
// A what-if never changes the plan.
import { computePlan, dateLabel, money, newId, type AppState, type Scenario } from "./model";
import { latePaycheck } from "./stress";

/** What the what-if would dip into: nothing, the reserve, everyday spending, or the bills themselves. */
export type Touches = "nothing" | "reserve" | "everyday" | "bills";

export interface ScenarioOutcome {
  /** What would be available to spend. */
  remainderCents: number;
  /** The difference from the plan as it is (zero or negative). */
  changeCents: number;
  touches: Touches;
  summary: string;
  /** One line on what the what-if is made of, when the title does not say it. */
  detail: string | null;
}

export const MAX_SCENARIOS = 12;

export const TOUCHES_LABEL: Record<Touches, string> = {
  nothing: "Covered",
  reserve: "Uses your reserve",
  everyday: "Cuts everyday spending",
  bills: "Bills not covered",
};

type Draft =
  | { kind: "purchase"; label: string; amountCents: number }
  | { kind: "new_bill"; label: string; amountCents: number; dueDate: string }
  | { kind: "late_payday"; lateDays: number };

export function scenarioTitle(s: Scenario): string {
  if (s.kind === "late_payday") return `Paycheck ${s.lateDays} day${s.lateDays === 1 ? "" : "s"} late`;
  if (s.kind === "new_bill") return `New bill: ${s.label}, ${money(s.amountCents)}`;
  return s.label ? `${s.label}, ${money(s.amountCents)}` : `A ${money(s.amountCents)} purchase`;
}

function outcome(
  state: AppState,
  afterBills: number,
  afterEssentials: number,
  remainderCents: number,
  detail: string | null,
): ScenarioOutcome {
  const touches: Touches =
    afterBills < 0 ? "bills" : afterEssentials < 0 ? "everyday" : remainderCents < 0 ? "reserve" : "nothing";
  const summary =
    touches === "bills"
      ? `${money(-afterBills)} short of covering your bills.`
      : touches === "everyday"
        ? `Bills are covered, but everyday spending would be ${money(-afterEssentials)} short.`
        : touches === "reserve"
          ? `${money(-remainderCents)} below your ${money(state.plan.reserveCents)} reserve. Bills and everyday spending stay covered.`
          : `Still covered: ${money(remainderCents)} left to spend.`;
  return { remainderCents, changeCents: remainderCents - computePlan(state).remainderCents, touches, summary, detail };
}

export function evaluateScenario(state: AppState, s: Scenario, now?: string): ScenarioOutcome {
  const plan = computePlan(state);
  if (s.kind === "late_payday") {
    const late = latePaycheck(state, s.lateDays, now);
    const cost = late.gapBillsCents + late.extraEverydayCents;
    const bills = late.gapBills.length;
    return outcome(
      state,
      plan.afterBills - late.gapBillsCents,
      plan.afterEssentials - cost,
      late.remainderCents,
      `${bills ? `${bills} bill${bills === 1 ? "" : "s"} (${money(late.gapBillsCents)})` : "No bills"} land before the money, plus ${money(late.extraEverydayCents)} of everyday spending.`,
    );
  }
  // A bill due after this period ends does not change this period.
  const inPeriod = s.kind === "purchase" || s.dueDate <= state.plan.horizonEndDate;
  const cost = inPeriod ? s.amountCents : 0;
  return outcome(
    state,
    plan.afterBills - cost,
    plan.afterEssentials - cost,
    plan.remainderCents - cost,
    s.kind === "new_bill"
      ? inPeriod
        ? `Due ${dateLabel(s.dueDate)}, before your next payday.`
        : `Due ${dateLabel(s.dueDate)}, after this period ends: this period is unchanged.`
      : null,
  );
}

/** Adds a what-if to the plan document. The plan itself (and its version) is left alone. */
export function addScenario(state: AppState, draft: Draft): AppState {
  if (state.scenarios.length >= MAX_SCENARIOS)
    throw new Error(`You can keep up to ${MAX_SCENARIOS} what-ifs. Remove one to save another.`);
  if (draft.kind === "late_payday") {
    if (!Number.isInteger(draft.lateDays) || draft.lateDays < 1 || draft.lateDays > 60)
      throw new Error("Choose a delay between 1 and 60 days.");
    if (state.scenarios.some((s) => s.kind === "late_payday" && s.lateDays === draft.lateDays)) return state;
    return { ...state, scenarios: [...state.scenarios, { id: newId(), kind: "late_payday", lateDays: draft.lateDays }] };
  }
  if (!Number.isSafeInteger(draft.amountCents) || draft.amountCents <= 0 || draft.amountCents > 1e12)
    throw new Error("Enter an amount greater than $0.");
  const label = draft.label.trim().slice(0, 60);
  if (draft.kind === "new_bill") {
    if (!label) throw new Error("Give the bill a name.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate)) throw new Error("Choose a due date.");
    return { ...state, scenarios: [...state.scenarios, { id: newId(), kind: "new_bill", label, amountCents: draft.amountCents, dueDate: draft.dueDate }] };
  }
  return { ...state, scenarios: [...state.scenarios, { id: newId(), kind: "purchase", label, amountCents: draft.amountCents }] };
}

export function removeScenario(state: AppState, id: string): AppState {
  return { ...state, scenarios: state.scenarios.filter((s) => s.id !== id) };
}
