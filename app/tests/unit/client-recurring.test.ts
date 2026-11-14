import { describe, expect, it } from "vitest";
import { AppStateSchema, applyConfirmedProposal, computePlan, emptyState, markBillPaid, previewBalanceUpdate, type Proposal } from "../../src/lib/client/model";

function state() {
  const s = emptyState();
  s.plan = { balanceCents: 220000, balanceDate: "2026-11-14", horizonEndDate: "2026-11-28", essentialsCents: 35000, reserveCents: 25000, confirmed: true };
  s.bills = [{ id: "bill", name: "Rent", amountCents: 110000, dueDate: "2026-11-20", frequency: "Monthly", status: "confirmed", evidence: [], note: "" }];
  return s;
}
function update(changes: { amountCents?: number; name?: string; dueDate?: string }): Proposal {
  return { id: "proposal", stateVersion: 0, payload: { type: "update_obligation", targetId: "bill", changes } };
}
describe("recurring bill payments", () => {
  it.each([
    ["Monthly", "2026-12-20"], ["Biweekly", "2026-12-04"], ["Weekly", "2026-11-27"],
  ] as const)("creates one confirmed next occurrence for %s", (frequency, dueDate) => {
    const s = state(); s.bills[0].frequency = frequency;
    const next = markBillPaid(s, "bill", false);
    expect(next.bills[0].status).toBe("paid");
    expect(next.bills[1]).toMatchObject({ name: "Rent", dueDate, status: "confirmed", frequency });
    expect(next.plan.balanceCents).toBe(110000);
    expect(markBillPaid(next, "bill", false)).toBe(next);
    expect(next.bills).toHaveLength(2);
  });
  it("does not repeat one-time bills", () => {
    const s = state(); s.bills[0].frequency = "One-time";
    expect(markBillPaid(s, "bill", true).bills).toHaveLength(1);
  });
  it.each([["2027-01-31", "2027-02-28", "2027-03-31"], ["2028-01-31", "2028-02-29", "2028-03-31"]])("preserves the day across short months from %s", (start, february, march) => {
    const s = state(); s.bills[0].dueDate = start;
    const next = AppStateSchema.parse(JSON.parse(JSON.stringify(markBillPaid(s, "bill", true))));
    expect(next.bills[1].dueDate).toBe(february);
    expect(markBillPaid(next, next.bills[1].id, true).bills[2].dueDate).toBe(march);
  });
  it("creates recurrences when a balance update closes bills, without a second deduction", () => {
    const s = state(); s.bills[0].frequency = "Weekly";
    const next = previewBalanceUpdate(s, 110000, ["bill", "bill"], false).state;
    expect(next.plan.balanceCents).toBe(110000);
    expect(next.bills).toHaveLength(2);
    expect(next.bills[1]).toMatchObject({ dueDate: "2026-11-27", status: "confirmed" });
    expect(computePlan(next).billsCents).toBe(110000);
    expect(previewBalanceUpdate(next, 110000, ["bill"], false).state.bills).toHaveLength(2);
  });
  it("resets the monthly anchor after an explicitly changed due date", () => {
    const s = state(); s.bills[0].recurrenceAnchorDay = 31;
    const changed = applyConfirmedProposal(s, update({ dueDate: "2026-11-25" })).state;
    expect(markBillPaid(changed, "bill", true).bills[1].dueDate).toBe("2026-12-25");
  });
});
