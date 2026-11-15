import { describe, expect, it } from "vitest";
import { computePlan, emptyState, markBillPaid, paymentsInPeriod, type AppState, type Bill } from "../../src/lib/client/model";
import { buildAssistantRequest, MAX_SENT_BILLS } from "../../src/lib/client/assistant";
import { computePlan as serverPlan, paymentsBy } from "../../src/lib/finance/calc";
import { executeTool } from "../../src/lib/ai/tools";
import { AssistantRequestSchema } from "../../src/lib/schemas/assistant";

const NOW = "2026-11-15";
const PAYDAY = "2026-11-28";

function bill(id: string, name: string, dollars: number, dueDate: string, frequency: Bill["frequency"], status: Bill["status"] = "confirmed"): Bill {
  return { id, name, amountCents: dollars * 100, dueDate, frequency, status, evidence: [], note: "" };
}
/** $1,000 in the bank, payday in 13 days, $200 of everyday spending, no reserve. */
function plan(bills: Bill[]): AppState {
  return {
    ...emptyState(),
    plan: { balanceCents: 100000, balanceDate: NOW, horizonEndDate: PAYDAY, essentialsCents: 20000, everydayPerPeriodCents: 20000, reserveCents: 0, confirmed: true },
    bills,
  };
}
/** The number the assistant's server tools compute from exactly what the browser sends. */
function assistantSees(state: AppState) {
  const req = AssistantRequestSchema.parse(buildAssistantRequest(state, "Explain my plan", "plan"));
  const p = req.context.plan!;
  return serverPlan({
    today: NOW,
    balanceCents: p.balanceCents,
    balanceAsOf: p.balanceAsOf,
    startDate: p.startDate,
    endDate: p.endDate,
    essentialRemainingCents: p.essentialRemainingCents,
    reserveTargetCents: p.reserveTargetCents,
    obligations: req.context.obligations,
  });
}

describe("a bill that comes due more than once before payday", () => {
  it("is set aside each time: weekly $200 due in 2 and in 9 days leaves $400, not $600", () => {
    const state = plan([bill("care", "Childcare", 200, "2026-11-17", "Weekly")]);
    const p = computePlan(state);
    expect(p.payments).toEqual({ care: 2 });
    expect(p.paymentCount).toBe(2);
    expect(p.billsCents).toBe(40000);
    expect(p.remainderCents).toBe(40000);
  });

  it("paying one of them does not change what is available", () => {
    const state = plan([bill("care", "Childcare", 200, "2026-11-17", "Weekly")]);
    const before = computePlan(state).remainderCents;
    const after = markBillPaid(state, "care", false);
    expect(after.plan.balanceCents).toBe(80000);
    // The next one (Nov 24) is now its own bill, counted once.
    expect(computePlan(after).billsCents).toBe(20000);
    expect(computePlan(after).remainderCents).toBe(before);
  });

  it("counts by the bill's rhythm: every two weeks, monthly, once", () => {
    const state = plan([
      bill("loan", "Car loan", 100, "2026-11-14", "Biweekly"), // Nov 14 (overdue, still owed) and Nov 28
      bill("rent", "Rent", 300, "2026-11-21", "Monthly"), // next is Dec 21
      bill("vet", "Vet", 50, "2026-11-20", "One-time"),
      bill("gym", "Gym", 40, "2026-12-01", "Weekly"), // after payday
    ]);
    expect(paymentsInPeriod(state)).toEqual({ loan: 2, rent: 1, vet: 1, gym: 0 });
    expect(computePlan(state).billsCents).toBe(2 * 10000 + 30000 + 5000);
  });

  it("never counts one payment twice: two unpaid entries of a bill, or a paid one on a repeat date", () => {
    // Nov 17 and Nov 24 are both in the list already; payday Dec 5 adds Dec 1 once.
    const two = { ...plan([bill("a", "Childcare", 200, "2026-11-17", "Weekly"), bill("b", "Childcare", 200, "2026-11-24", "Weekly")]) };
    two.plan = { ...two.plan, horizonEndDate: "2026-12-05" };
    expect(paymentsInPeriod(two)).toEqual({ a: 1, b: 2 });
    expect(computePlan(two).billsCents).toBe(3 * 20000);
    // The Nov 24 payment was made early and stands in the list as paid.
    const paidAhead = plan([bill("a", "Childcare", 200, "2026-11-17", "Weekly"), bill("b", "Childcare", 200, "2026-11-24", "Weekly", "paid")]);
    expect(computePlan(paidAhead).billsCents).toBe(20000);
  });

  it("the shared rule: monthly bills keep their day across short months", () => {
    const b = { id: "x", name: "Rent", dueDate: "2027-01-31", paid: false, repeat: "monthly" as const, anchorDay: 31 };
    expect(paymentsBy(b, [b], "2027-02-27")).toBe(1);
    expect(paymentsBy(b, [b], "2027-02-28")).toBe(2);
    expect(paymentsBy(b, [b], "2027-03-31")).toBe(3);
    expect(paymentsBy({ ...b, repeat: undefined }, [b], "2027-03-31")).toBe(1);
    expect(paymentsBy(b, [b], "2027-01-30")).toBe(0);
  });
});

describe("the assistant counts what the overview counts", () => {
  it("for a weekly bill, and after a bill change keeps the repeat rule", () => {
    const state = plan([bill("care", "Childcare", 200, "2026-11-17", "Weekly"), bill("rent", "Rent", 300, "2026-11-21", "Monthly")]);
    const seen = assistantSees(state);
    expect(seen.billsCents).toBe(computePlan(state).billsCents);
    expect(seen.remainderCents).toBe(computePlan(state).remainderCents);
    expect(seen.billsInPeriod.find((b) => b.id === "care")).toMatchObject({ payments: 2, totalCents: 40000 });
  });

  it("the plan summary tells the model a bill is counted twice", () => {
    const state = plan([bill("care", "Childcare", 200, "2026-11-17", "Weekly")]);
    const req = AssistantRequestSchema.parse(buildAssistantRequest(state, "Explain my plan", "plan"));
    const p = req.context.plan!;
    const effects = { toolNames: [] as string[], factRefs: new Set<string>(), amounts: new Set<number>() };
    const out = JSON.parse(
      executeTool(
        "get_plan_summary",
        "{}",
        {
          planInput: { today: NOW, balanceCents: p.balanceCents, balanceAsOf: p.balanceAsOf, startDate: p.startDate, endDate: p.endDate, essentialRemainingCents: p.essentialRemainingCents, reserveTargetCents: p.reserveTargetCents, obligations: req.context.obligations },
          baseVersion: 0,
          userText: "Explain my plan",
        },
        effects as never,
      ),
    );
    expect(out.bills_counted[0]).toMatchObject({ payments_before_period_end: 2, counted: "$400" });
    // The total is a verified amount the answer may quote.
    expect(effects.amounts.has(40000)).toBe(true);
  });

  it("when paid bills have piled up past the server's limit, every unpaid bill is still sent", () => {
    // Five months in: 62 paid records sit in front of the 8 bills that are owed now.
    const paid = Array.from({ length: 62 }, (_, i) => bill(`paid${i}`, `Bill ${i % 8}`, 100, "2026-10-01", "One-time", "paid"));
    const owed = Array.from({ length: 8 }, (_, i) => bill(`owed${i}`, `Bill ${i}`, 100, "2026-11-20", "One-time"));
    const state = { ...plan([...paid, ...owed]) };
    state.plan = { ...state.plan, balanceCents: 200000 };
    const req = buildAssistantRequest(state, "Explain my plan", "plan");
    expect(req.context.obligations).toHaveLength(MAX_SENT_BILLS);
    expect(req.context.obligations.filter((o) => o.paymentStatus === "unpaid")).toHaveLength(8);
    expect(assistantSees(state).remainderCents).toBe(computePlan(state).remainderCents);
    // The most recently paid ones fill the rest.
    expect(req.context.obligations.some((o) => o.id === "paid61")).toBe(true);
    expect(req.context.obligations.some((o) => o.id === "paid0")).toBe(false);
  });

  it("a plan within the limit is sent in its own order, unchanged", () => {
    const state = plan([bill("b", "Rent", 300, "2026-11-21", "Monthly"), bill("a", "Old rent", 300, "2026-10-21", "One-time", "paid"), bill("c", "Vet", 50, "2026-11-20", "One-time")]);
    expect(buildAssistantRequest(state, "Explain my plan", "plan").context.obligations.map((o) => o.id)).toEqual(["b", "a", "c"]);
  });
});
