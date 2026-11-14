import { describe, expect, it } from "vitest";
import {
  AppStateSchema, applyConfirmedProposal, computePlan, emptyState,
  previewProposal,
  type Proposal,
} from "../../src/lib/client/model";

function state() {
  const s = emptyState();
  s.plan = { balanceCents: 220000, balanceDate: "2026-11-14", horizonEndDate: "2026-11-28", essentialsCents: 35000, reserveCents: 25000, confirmed: true };
  s.bills = [{ id: "bill", name: "Rent", amountCents: 110000, dueDate: "2026-11-20", frequency: "Monthly", status: "confirmed", evidence: [], note: "" }];
  return s;
}
function update(changes: { amountCents?: number; name?: string; dueDate?: string }): Proposal {
  return { id: "proposal", stateVersion: 0, payload: { type: "update_obligation", targetId: "bill", changes } };
}
const add: Proposal = { id: "new_bill", stateVersion: 0, payload: { type: "add_obligation", obligation: { name: "Dentist", amountCents: 9000, dueDate: "2026-11-25" } } };

describe("confirmed assistant proposals", () => {
  it("previews all changed fields without mutating the plan", () => {
    const s = state(), original = structuredClone(s);
    const preview = previewProposal(s, update({ name: "New rent", amountCents: 115000, dueDate: "2026-11-21" }))!;
    expect(preview.target).toMatchObject({ name: "Rent", amountCents: 110000, dueDate: "2026-11-20" });
    expect(preview.updated).toMatchObject({ name: "New rent", amountCents: 115000, dueDate: "2026-11-21" });
    expect(preview.before.remainderCents).toBe(50000);
    expect(preview.after.remainderCents).toBe(45000);
    expect(s).toEqual(original);
  });
  it("recomputes inclusion when a bill moves outside or back into the period", () => {
    const s = state();
    const next = applyConfirmedProposal(s, update({ dueDate: "2026-12-01" })).state;
    expect(computePlan(next).remainderCents).toBe(160000);
    const result = applyConfirmedProposal(next, { ...update({ dueDate: "2026-11-28" }), id: "move_back", stateVersion: 1 });
    expect(result.status).toBe("applied");
    expect(computePlan(result.state).remainderCents).toBe(50000);
  });
  it("adds a confirmed bill once, persists it and leaves the bank balance unchanged", () => {
    const s = state();
    expect(previewProposal(s, add)?.target).toBeNull();
    expect(s.bills).toHaveLength(1);
    const first = applyConfirmedProposal(s, add);
    const persisted = AppStateSchema.parse(JSON.parse(JSON.stringify(first.state)));
    expect(persisted.bills).toHaveLength(2);
    expect(persisted.bills[1]).toMatchObject({ name: "Dentist", amountCents: 9000, status: "confirmed", frequency: "One-time" });
    expect(persisted.bills[1].id).not.toBe("__preview__");
    expect(persisted.plan.balanceCents).toBe(220000);
    expect(computePlan(persisted).remainderCents).toBe(41000);
    expect(applyConfirmedProposal(persisted, add)).toEqual({ status: "already_applied", state: persisted });
  });
  it("rejects a stale addition after a manual edit", () => {
    const s = { ...state(), stateVersion: 1 };
    expect(applyConfirmedProposal(s, add)).toEqual({ status: "stale", state: s });
  });
  it.each([
    {}, { name: "  " }, { dueDate: "2026-02-30" }, { amountCents: -1 }, { amountCents: 1.5 },
  ])("rejects an invalid update without changes: %j", (changes) => {
    const s = state();
    expect(applyConfirmedProposal(s, update(changes))).toEqual({ status: "invalid", state: s });
  });
  it.each(["paid", "candidate", "dismissed"] as const)("rejects an update to a %s bill", (status) => {
    const s = state(); s.bills[0].status = status;
    expect(previewProposal(s, update({ name: "Changed" }))).toBeNull();
  });
  it("does not add a bill beyond the storage limit", () => {
    const s = state();
    s.bills = Array.from({ length: 500 }, (_, i) => ({ ...s.bills[0], id: `bill_${i}` }));
    expect(applyConfirmedProposal(s, add)).toEqual({ status: "invalid", state: s });
  });
});
