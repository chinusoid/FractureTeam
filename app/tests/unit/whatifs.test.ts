import { describe, expect, it } from "vitest";
import {
  AppStateSchema,
  computePlan,
  emptyState,
  everydayForNextPeriod,
  markBillPaid,
  nextPayday,
  previewBalanceUpdate,
  startNextPeriod,
  type AppState,
  type Bill,
} from "../../src/lib/client/model";
import { addScenario, evaluateScenario, MAX_SCENARIOS, removeScenario, scenarioTitle } from "../../src/lib/client/scenarios";

const NOW = "2026-11-15";

function bill(name: string, dollars: number, dueDate: string, frequency: Bill["frequency"] = "Monthly"): Bill {
  return { id: name.toLowerCase(), name, amountCents: dollars * 100, dueDate, frequency, status: "confirmed", evidence: [], note: "" };
}

/** $2,200 in the bank, payday Nov 25, $1,300 of bills before it, $350 everyday, $250 reserve: $300 free. */
function plan(extraBills: Bill[] = []): AppState {
  return {
    ...emptyState(),
    plan: { balanceCents: 220000, balanceDate: NOW, horizonEndDate: "2026-11-25", essentialsCents: 35000, everydayPerPeriodCents: 35000, reserveCents: 25000, confirmed: true },
    bills: [bill("Rent", 1100, "2026-11-21"), bill("Insurance", 150, "2026-11-18"), bill("Internet", 50, "2026-11-23"), ...extraBills],
  };
}

describe("saved what-ifs", () => {
  it("a purchase is judged against the plan as it is now", () => {
    let state = addScenario(plan(), { kind: "purchase", label: "Sneakers", amountCents: 40000 });
    const s = state.scenarios[0];
    expect(scenarioTitle(s)).toBe("Sneakers, $400");
    expect(evaluateScenario(state, s, NOW)).toMatchObject({ remainderCents: -10000, changeCents: -40000, touches: "reserve" });
    // The balance drops by $200: the same what-if now reaches further into the reserve.
    state = { ...state, plan: { ...state.plan, balanceCents: 200000 } };
    expect(evaluateScenario(state, s, NOW)).toMatchObject({ remainderCents: -30000, touches: "everyday" });
  });

  it("names what a what-if would touch: nothing, the reserve, everyday spending or bills", () => {
    const state = plan();
    const touches = (amountCents: number) =>
      evaluateScenario(state, { id: "x", kind: "purchase", label: "", amountCents }, NOW).touches;
    expect(touches(30000)).toBe("nothing");
    expect(touches(30001)).toBe("reserve");
    expect(touches(55001)).toBe("everyday");
    expect(touches(90001)).toBe("bills");
  });

  it("a new bill counts only when it is due before the next payday", () => {
    const state = plan();
    const before = evaluateScenario(state, { id: "a", kind: "new_bill", label: "Vet", amountCents: 12000, dueDate: "2026-11-20" }, NOW);
    expect(before).toMatchObject({ remainderCents: 18000, changeCents: -12000, touches: "nothing" });
    const after = evaluateScenario(state, { id: "b", kind: "new_bill", label: "Vet", amountCents: 12000, dueDate: "2026-11-27" }, NOW);
    expect(after).toMatchObject({ remainderCents: 30000, changeCents: 0 });
    expect(after.detail).toContain("after this period ends");
    // Left over from an earlier period: it no longer counts, and says so.
    const stale = evaluateScenario(state, { id: "c", kind: "new_bill", label: "Vet", amountCents: 12000, dueDate: "2026-11-10" }, NOW);
    expect(stale).toMatchObject({ remainderCents: 30000, changeCents: 0 });
    expect(stale.detail).toContain("no longer counts");
  });

  it("a late paycheck adds the bills that land first and the extra days of everyday spending", () => {
    const state = plan([bill("Gym", 40, "2026-11-28")]);
    const out = evaluateScenario(state, { id: "l", kind: "late_payday", lateDays: 7 }, NOW);
    // 11 days left at $350: about $31.82 a day, seven more days, plus the $40 gym bill.
    expect(out.changeCents).toBe(-(4000 + 3182 * 7));
    expect(out.touches).toBe("nothing");
    expect(out.detail).toContain("1 bill ($40)");
  });

  it("saving never changes the plan or its version, and old documents load without what-ifs", () => {
    const base = plan();
    const saved = addScenario(base, { kind: "late_payday", lateDays: 3 });
    expect(saved.stateVersion).toBe(base.stateVersion);
    expect(computePlan(saved).remainderCents).toBe(30000);
    expect(addScenario(saved, { kind: "late_payday", lateDays: 3 }).scenarios).toHaveLength(1);
    expect(removeScenario(saved, saved.scenarios[0].id).scenarios).toHaveLength(0);
    const { scenarios: _dropped, ...old } = base;
    expect(AppStateSchema.parse(old).scenarios).toEqual([]);
    expect(AppStateSchema.safeParse(saved).success).toBe(true);
  });

  it("refuses empty amounts, nameless bills and more than the limit", () => {
    expect(() => addScenario(plan(), { kind: "purchase", label: "", amountCents: 0 })).toThrow(/greater than \$0/);
    expect(() => addScenario(plan(), { kind: "new_bill", label: " ", amountCents: 100, dueDate: "2026-11-20" })).toThrow(/name/);
    let state = plan();
    for (let i = 0; i < MAX_SCENARIOS; i++) state = addScenario(state, { kind: "purchase", label: `P${i}`, amountCents: 100 });
    expect(() => addScenario(state, { kind: "purchase", label: "one more", amountCents: 100 })).toThrow(/up to/);
  });
});

describe("the next pay period", () => {
  it("carries bills, reserve and settings over, closes what was paid and restarts everyday spending", () => {
    const spent = { ...plan(), plan: { ...plan().plan, essentialsCents: 4000 } };
    const { state, remainderCents } = startNextPeriod(spent, 290000, ["rent", "insurance", "internet"], "2026-12-09", everydayForNextPeriod(spent), "2026-11-25");
    expect(state.plan).toMatchObject({ balanceCents: 290000, balanceDate: "2026-11-25", horizonEndDate: "2026-12-09", essentialsCents: 35000, reserveCents: 25000, confirmed: true });
    // Each paid monthly bill is closed and its next date is already in the plan.
    expect(state.bills.filter((b) => b.status === "paid").map((b) => b.name).sort()).toEqual(["Insurance", "Internet", "Rent"]);
    expect(state.bills.filter((b) => b.status === "confirmed").map((b) => `${b.name} ${b.dueDate}`).sort()).toEqual([
      "Insurance 2026-12-18",
      "Internet 2026-12-23",
      "Rent 2026-12-21",
    ]);
    // None of them is due before Dec 9, so the new period is balance − everyday − reserve.
    expect(remainderCents).toBe(290000 - 35000 - 25000);
    expect(state.lastUpdate).toMatchObject({ newPeriod: true, closedBills: ["Rent", "Insurance", "Internet"] });
    // The recap of the period that ended: its dates and what was paid from it.
    expect(state.lastUpdate?.endedPeriod).toEqual({ start: NOW, end: "2026-11-25", paidCents: 130000 });
    expect(state.stateVersion).toBe(spent.stateVersion + 1);
  });

  it("the recap counts a bill marked paid earlier in the period, not only those ticked at the move", () => {
    // Reported on 15 Nov: rent marked paid first, then the move to the next period showed "$0 of bills paid".
    const afterRent = markBillPaid(plan(), "rent", false);
    const { state, remainderCents } = startNextPeriod(afterRent, 290000, [], "2026-12-09", 35000, "2026-11-25");
    expect(state.lastUpdate?.endedPeriod).toEqual({ start: NOW, end: "2026-11-25", paidCents: 110000 });
    expect(state.lastUpdate?.closedBills).toEqual([]);
    // The number itself was always right: insurance and internet are still owed, rent repeats on Dec 21.
    expect(remainderCents).toBe(290000 - 15000 - 5000 - 35000 - 25000);
  });

  it("adds up bills paid on the bills page, with a balance update and at the move, from the day the period began", () => {
    const began = { ...plan(), plan: { ...plan().plan, balanceDate: "2026-11-11", periodStartDate: "2026-11-11", periodPaidCents: 0 } };
    const afterRent = markBillPaid(began, "rent", true);
    expect(afterRent.plan.periodPaidCents).toBe(110000);
    // A balance update moves the balance date; the period still began on Nov 11.
    const afterUpdate = previewBalanceUpdate(afterRent, 90000, ["insurance"], true).state;
    expect(afterUpdate.plan).toMatchObject({ periodStartDate: "2026-11-11", periodPaidCents: 125000 });
    const { state } = startNextPeriod(afterUpdate, 290000, ["internet"], "2026-12-09", 35000, "2026-11-25");
    expect(state.lastUpdate?.endedPeriod).toEqual({ start: "2026-11-11", end: "2026-11-25", paidCents: 130000 });
    expect(state.lastUpdate?.closedBills).toEqual(["Internet"]);
    // The new period starts its own count.
    expect(state.plan).toMatchObject({ periodStartDate: "2026-11-25", periodPaidCents: 0 });
    expect(AppStateSchema.safeParse(state).success).toBe(true);
  });

  it("a plan saved before the count existed reports the bills already marked paid, once", () => {
    const paidRent = { ...plan(), bills: plan().bills.map((b) => (b.id === "rent" ? { ...b, status: "paid" as const } : b)) };
    const first = startNextPeriod(paidRent, 290000, ["insurance"], "2026-12-09", 35000, "2026-11-25").state;
    expect(first.lastUpdate?.endedPeriod?.paidCents).toBe(125000);
    // A plan that moved to a new period before the count existed: bills closed in the earlier period stay out.
    const moved = { ...first, plan: { ...first.plan, periodStartDate: undefined, periodPaidCents: undefined } };
    const second = startNextPeriod(moved, 300000, ["internet"], "2026-12-23", 35000, "2026-12-09").state;
    expect(second.lastUpdate?.endedPeriod).toEqual({ start: "2026-11-25", end: "2026-12-09", paidCents: 5000 });
  });

  it("a paycheck that comes early ends the period that day, so the recap does not run into the new period", () => {
    const { state } = startNextPeriod(plan(), 290000, [], "2026-12-04", 35000, "2026-11-20");
    expect(state.lastUpdate?.endedPeriod).toEqual({ start: NOW, end: "2026-11-20", paidCents: 0 });
  });

  it("an unpaid bill stays owed in the new period", () => {
    const { remainderCents } = startNextPeriod(plan(), 290000, ["insurance", "internet"], "2026-12-09", 35000, "2026-11-25");
    expect(remainderCents).toBe(290000 - 110000 - 35000 - 25000);
  });

  it("needs a payday after today and valid amounts", () => {
    expect(() => startNextPeriod(plan(), 100, [], "2026-11-25", 0, "2026-11-25")).toThrow(/after today/);
    expect(() => startNextPeriod(plan(), -1, [], "2026-12-09", 0, "2026-11-25")).toThrow(/balance/);
  });

  it("suggests the next payday from the pay rhythm", () => {
    expect(nextPayday("2026-11-25", "biweekly", "2026-11-25")).toBe("2026-12-09");
    expect(nextPayday("2026-11-25", "weekly", "2026-11-26")).toBe("2026-12-02");
    expect(nextPayday("2026-11-25", "monthly", "2026-11-25")).toBe("2026-12-25");
    expect(nextPayday("2026-11-25", null, "2026-12-20")).toBe("2026-12-23");
    expect(nextPayday("2026-11-25", "biweekly", "2026-11-20")).toBe("2026-11-25");
  });

  it("falls back to what was planned plus what was counted as spent, for plans saved before the field existed", () => {
    const old = { ...plan(), plan: { ...plan().plan, everydayPerPeriodCents: undefined, essentialsCents: 20000 }, lastUpdate: { date: NOW, previousBalanceCents: 220000, newBalanceCents: 205000, closedBills: [], essentialsSpentCents: 15000, excessCents: 0 } };
    expect(everydayForNextPeriod(old)).toBe(35000);
  });
});
