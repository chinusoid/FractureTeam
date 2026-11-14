import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonths,
  applyBalanceUpdate,
  applyConfirmedProposal,
  computePlan,
  emptyState,
  formatUSD,
  markBillPaid,
  parseMoneyString,
  planInputFromState,
  previewBalanceUpdate,
  previewProposal,
  recordEssentialSpend,
  simulatePurchase,
  dollarsToCents,
  type AppState,
  type Obligation,
} from "../../src/lib/finance";

const TODAY = "2026-11-14";
const NOW = "2026-11-14T10:00:00.000Z";

function bill(id: string, name: string, amountCents: number, dueDate: string, extra: Partial<Obligation> = {}): Obligation {
  return {
    id,
    name,
    amountCents,
    dueDate,
    paymentStatus: "unpaid",
    confirmationStatus: "confirmed",
    source: "manual",
    sourceTransactionIds: [],
    recurrence: "monthly",
    paidOn: null,
    ...extra,
  };
}

/** Plan section 5 example: $2,200 / $1,300 bills / $350 essentials / $250 reserve. */
function exampleState(): AppState {
  return {
    ...emptyState("client_test"),
    stateVersion: 7,
    account: { currency: "USD", balanceCents: 220000, balanceAsOf: TODAY },
    plan: {
      startDate: TODAY,
      endDate: "2026-11-24",
      essentialRemainingCents: 35000,
      reserveTargetCents: 25000,
      confirmed: true,
    },
    obligations: [
      bill("bill_insurance", "Car insurance", 15000, "2026-11-17"),
      bill("bill_rent", "Rent", 110000, "2026-11-20"),
      bill("bill_internet", "Internet", 5000, "2026-11-24"),
      bill("bill_netflix", "Netflix", 1549, "2026-12-01"),
    ],
  };
}

function plan(state: AppState) {
  return computePlan(planInputFromState(state, TODAY)!);
}

test("money parsing and formatting", () => {
  assert.equal(parseMoneyString("$1,234.56"), 123456);
  assert.equal(parseMoneyString("(45.00)"), -4500);
  assert.equal(parseMoneyString("-12.3"), -1230);
  assert.equal(parseMoneyString("45.00-"), -4500);
  assert.equal(parseMoneyString("$-7"), -700);
  assert.equal(parseMoneyString("1.005"), 101);
  assert.equal(parseMoneyString("1,23"), null);
  assert.equal(parseMoneyString("abc"), null);
  assert.equal(dollarsToCents(400), 40000);
  assert.equal(dollarsToCents(1.005), 101);
  assert.equal(formatUSD(30000), "$300");
  assert.equal(formatUSD(-10000), "-$100");
  assert.equal(formatUSD(1549), "$15.49");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-02-28", 1, 31), "2026-03-31");
});

test("base plan: 220000 - 130000 - 35000 - 25000 = 30000", () => {
  const p = plan(exampleState());
  assert.equal(p.billsCents, 130000);
  assert.equal(p.remainderCents, 30000);
  assert.equal(p.status, "ok");
  assert.deepEqual(p.billsOutsidePeriod.map((b) => b.id), ["bill_netflix"]);
});

test("purchase 40000: scenario -10000, shortfall belongs to the reserve, nothing stored changes", () => {
  const state = exampleState();
  const before = JSON.stringify(state);
  const sim = simulatePurchase(planInputFromState(state, TODAY)!, 40000, "2026-11-15");
  assert.equal(sim.kind, "ok");
  if (sim.kind !== "ok") return;
  assert.equal(sim.before.remainderCents, 30000);
  assert.equal(sim.after.remainderCents, -10000);
  assert.equal(sim.after.status, "reserve_short");
  assert.equal(sim.after.shortfallCents, 10000);
  assert.equal(sim.after.reserveLeftCents, 15000);
  assert.equal(sim.after.billsCovered, true);
  assert.equal(sim.after.essentialsCovered, true);
  assert.equal(JSON.stringify(state), before);
});

test("confirmed bill increase of 3000 -> remainder 27000", () => {
  const state = exampleState();
  const proposal = {
    id: "proposal_1",
    baseVersion: 7,
    payload: { type: "update_obligation" as const, targetId: "bill_insurance", changes: { amountCents: 18000 } },
    factRefs: ["bill_insurance"],
  };
  const preview = previewProposal(planInputFromState(state, TODAY)!, proposal.payload);
  assert.ok(!("errors" in preview));
  if ("errors" in preview) return;
  assert.equal(preview.after.remainderCents, 27000);
  const res = applyConfirmedProposal(state, proposal, NOW);
  assert.equal(res.kind, "applied");
  assert.equal(plan(res.state).remainderCents, 27000);
  assert.equal(res.state.stateVersion, 8);
});

test("double confirmation applies once", () => {
  const state = exampleState();
  const proposal = {
    id: "proposal_twice",
    baseVersion: 7,
    payload: { type: "update_obligation" as const, targetId: "bill_insurance", changes: { amountCents: 18000 } },
    factRefs: [],
  };
  const first = applyConfirmedProposal(state, proposal, NOW);
  const second = applyConfirmedProposal(first.state, proposal, NOW);
  assert.equal(second.kind, "already_applied");
  assert.equal(second.state.stateVersion, first.state.stateVersion);
  assert.equal(plan(second.state).remainderCents, 27000);
});

test("proposal created before a plan change is rejected as stale", () => {
  const state = exampleState();
  const proposal = {
    id: "proposal_old",
    baseVersion: 6,
    payload: { type: "update_obligation" as const, targetId: "bill_insurance", changes: { amountCents: 99000 } },
    factRefs: [],
  };
  const res = applyConfirmedProposal(state, proposal, NOW);
  assert.equal(res.kind, "stale");
  assert.equal(plan(res.state).remainderCents, 30000);
});

test("proposal for a missing bill is invalid", () => {
  const res = applyConfirmedProposal(
    exampleState(),
    { id: "p", baseVersion: 7, payload: { type: "update_obligation", targetId: "nope", changes: { amountCents: 100 } }, factRefs: [] },
    NOW,
  );
  assert.equal(res.kind, "invalid");
});

test("imported past spending does not reduce the entered balance again", () => {
  const state = exampleState();
  const withHistory: AppState = {
    ...state,
    transactions: [
      { id: "t1", importBatchId: "b", postedDate: "2026-11-10", description: "GROCERY", amountCents: -9000, reviewStatus: "ok" },
      { id: "t2", importBatchId: "b", postedDate: "2026-11-12", description: "RENT", amountCents: -110000, reviewStatus: "ok" },
    ],
  };
  assert.equal(plan(withHistory).remainderCents, 30000);
  assert.equal(plan(withHistory).availableCents, 220000);
});

test("essentials spend of 2000 not yet in balance: balance and essentials both drop, remainder unchanged", () => {
  const state = exampleState();
  const next = recordEssentialSpend(state, 2000, false);
  assert.equal(next.account!.balanceCents, 218000);
  assert.equal(next.plan!.essentialRemainingCents, 33000);
  assert.equal(plan(next).remainderCents, 30000);
});

test("purchase outside the period asks to revisit the period and changes nothing", () => {
  const state = exampleState();
  const sim = simulatePurchase(planInputFromState(state, TODAY)!, 5000, "2026-12-05");
  assert.equal(sim.kind, "outside_period");
  const past = simulatePurchase(planInputFromState(state, TODAY)!, 5000, "2026-11-01");
  assert.equal(past.kind, "outside_period");
});

test("negative remainder keeps the exact shortfall and its parts", () => {
  const state = exampleState();
  state.account = { currency: "USD", balanceCents: 100000, balanceAsOf: TODAY };
  const p = plan(state);
  assert.equal(p.status, "bills_short");
  assert.equal(p.shortfallCents, 30000); // bills 130000 vs 100000
  assert.equal(p.remainderCents, -90000); // never clamped to 0
  assert.equal(p.billsCovered, false);
  assert.equal(p.reserveLeftCents, 0);

  state.account = { currency: "USD", balanceCents: 150000, balanceAsOf: TODAY };
  const e = plan(state);
  assert.equal(e.status, "essentials_short");
  assert.equal(e.shortfallCents, 15000);
});

test("bill due on the last day of the period is included; unpaid overdue bills still count", () => {
  const state = exampleState();
  const p = plan(state);
  assert.ok(p.billsInPeriod.some((b) => b.id === "bill_internet" && b.dueDate === "2026-11-24"));
  state.obligations.push(bill("bill_late", "Phone", 6500, "2026-11-10"));
  const late = plan(state);
  assert.ok(late.billsInPeriod.find((b) => b.id === "bill_late")?.overdue);
  assert.equal(late.billsCents, 136500);
});

test("unconfirmed suggestions do not enter the plan", () => {
  const state = exampleState();
  state.obligations.push(bill("bill_maybe", "Gym", 4000, "2026-11-18", { confirmationStatus: "suggested" }));
  const p = plan(state);
  assert.equal(p.billsCents, 130000);
  assert.equal(p.unconfirmedCount, 1);
});

test("marking a bill paid: reflected vs not reflected in the balance", () => {
  const state = exampleState();
  const reflected = markBillPaid(state, "bill_rent", true, TODAY);
  assert.equal(reflected.account!.balanceCents, 220000);
  assert.equal(plan(reflected).billsCents, 20000);
  const notReflected = markBillPaid(state, "bill_rent", false, TODAY);
  assert.equal(notReflected.account!.balanceCents, 110000);
  assert.equal(plan(notReflected).remainderCents, 30000);
  // monthly bill gets its next occurrence outside the period
  assert.ok(notReflected.obligations.some((o) => o.name === "Rent" && o.dueDate === "2026-12-20" && o.paymentStatus === "unpaid"));
  // paying twice does nothing
  assert.equal(markBillPaid(notReflected, "bill_rent", false, TODAY), notReflected);
});

test("balance update example from the plan: remainder stays 27000", () => {
  let state = exampleState();
  state = applyConfirmedProposal(
    state,
    { id: "p30", baseVersion: 7, payload: { type: "update_obligation", targetId: "bill_insurance", changes: { amountCents: 18000 } }, factRefs: [] },
    NOW,
  ).state;
  const input = { newBalanceCents: 95000, paidBillIds: ["bill_rent"], assignToEssentials: true };
  const preview = previewBalanceUpdate(state, input, "2026-11-21");
  assert.ok(preview);
  assert.equal(preview!.unexplainedDecreaseCents, 15000);
  assert.equal(preview!.essentialsAfterCents, 20000);
  assert.equal(preview!.remainderBeforeCents, 27000);
  assert.equal(preview!.remainderAfterCents, 27000);
  const next = applyBalanceUpdate(state, input, "2026-11-21", NOW);
  const p = computePlan(planInputFromState(next, "2026-11-21")!);
  assert.equal(p.billsCents, 23000);
  assert.equal(p.essentialsCents, 20000);
  assert.equal(p.remainderCents, 27000);
  assert.equal(next.lastUpdate?.closedBills[0].name, "Rent");
  assert.equal(next.snapshots.length, 1);
  assert.equal(next.account!.balanceAsOf, "2026-11-21");
});

test("decrease larger than the essentials budget: excess shown separately, not assigned", () => {
  const state = exampleState();
  const preview = previewBalanceUpdate(state, { newBalanceCents: 50000, paidBillIds: ["bill_rent"], assignToEssentials: true }, TODAY)!;
  assert.equal(preview.unexplainedDecreaseCents, 60000);
  assert.equal(preview.essentialsAssignableCents, 35000);
  assert.equal(preview.excessDecreaseCents, 25000);
  assert.equal(preview.essentialsAfterCents, 0);
});

test("balance higher than expected suggests a new period", () => {
  const state = exampleState();
  const preview = previewBalanceUpdate(state, { newBalanceCents: 400000, paidBillIds: [], assignToEssentials: true }, TODAY)!;
  assert.equal(preview.unexplainedIncreaseCents, 180000);
  assert.equal(preview.suggestNewPeriod, true);
  assert.equal(preview.essentialsAfterCents, 35000);
});
