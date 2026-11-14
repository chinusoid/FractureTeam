import { describe, it, expect } from "vitest";
import {
  addDays,
  AppStateSchema,
  applyConfirmedProposal,
  buildSetupSuggestion,
  computePlan,
  detectDateFormats,
  emptyState,
  generateSampleCsv,
  markBillPaid,
  normalizeRows,
  parseCsv,
  parseMoney,
  previewBalanceUpdate,
  simulatePurchase,
  type AppState,
} from "../../src/lib/client/model";
const NOW = "2026-11-14";
function sample(variant: "A" | "B" = "A"): AppState {
  const csv = parseCsv(generateSampleCsv(variant, NOW)),
    format = detectDateFormats(csv.rows.map((r) => r[csv.mapping.date])),
    { transactions } = normalizeRows(csv.rows, csv.mapping, format, false),
    suggestion = buildSetupSuggestion(transactions, NOW);
  return {
    ...emptyState(),
    sample: true,
    transactions,
    bills: suggestion.bills.map((b) => ({ ...b, status: "confirmed" })),
    plan: {
      balanceCents: variant === "A" ? 220000 : 310000,
      balanceDate: NOW,
      horizonEndDate: suggestion.horizon,
      essentialsCents: suggestion.essentialsCents,
      reserveCents: 25000,
      confirmed: true,
    },
  };
}
describe("independent financial examples", () => {
  it("reconstructs sample A from actual CSV: 3 bills in the period, $350 essentials, $300 remaining", () => {
    const s = sample();
    expect(computePlan(s).bills).toHaveLength(3);
    expect(s.bills.some((b) => /transfer/i.test(b.note))).toBe(true);
    expect(s.plan.essentialsCents).toBe(35000);
    expect(computePlan(s).billsCents).toBe(130000);
    expect(computePlan(s).remainderCents).toBe(30000);
  });
  it("keeps a $400 purchase hypothetical and identifies the $100 reserve shortfall", () => {
    const s = sample(),
      before = structuredClone(s);
    const result = simulatePurchase(s, 40000, NOW);
    expect(result).toMatchObject({
      remainderCents: -10000,
      reserveRemainingCents: 15000,
    });
    expect(result.message).toContain("$100 below your $250 reserve");
    expect(s).toEqual(before);
  });
  it("distinguishes a bills shortfall from a reserve shortfall", () => {
    const s = sample();
    s.plan.balanceCents = 100000;
    expect(computePlan(s).status).toBe("bills_short");
    expect(simulatePurchase(s, 1000, NOW).message).toContain("all your bills");
  });
  it("distinguishes an everyday spending shortfall", () => {
    const s = sample();
    s.plan.balanceCents = 140000;
    expect(computePlan(s).status).toBe("essentials_short");
  });
  it("preserves a negative reserve remainder", () => {
    const s = sample();
    s.plan.balanceCents = 180000;
    expect(computePlan(s)).toMatchObject({
      status: "reserve_short",
      remainderCents: -10000,
    });
  });
  it("includes bills due on the final date and separates later bills", () => {
    const s = sample();
    s.bills[0].dueDate = s.plan.horizonEndDate;
    s.bills[1].dueDate = addDays(s.plan.horizonEndDate, 1);
    const r = computePlan(s);
    expect(r.bills.map((b) => b.id)).toContain(s.bills[0].id);
    expect(r.outsideBills.map((b) => b.id)).toContain(s.bills[1].id);
  });
  it("does not silently drop an overdue unpaid bill", () => {
    const s = sample();
    s.bills[0].dueDate = addDays(NOW, -2);
    expect(computePlan(s).billsCents).toBe(130000);
  });
  it("rejects a purchase outside the period", () => {
    const s = sample();
    expect(
      simulatePurchase(s, 40000, addDays(s.plan.horizonEndDate, 1)).error,
    ).toContain("outside");
  });
  it("rejects zero and fractional-cent purchases", () => {
    expect(simulatePurchase(sample(), 0, NOW).error).toBeTruthy();
    expect(simulatePurchase(sample(), 10.5, NOW).error).toBeTruthy();
  });
  it("raising insurance by $30 leaves $270", () => {
    const s = sample(),
      insurance = s.bills.find((b) => /insurance/i.test(b.name))!;
    const result = applyConfirmedProposal(s, {
      id: "p1",
      stateVersion: 0,
      payload: { type: "update_obligation", targetId: insurance.id, changes: { amountCents: insurance.amountCents + 3000 } },
    });
    expect(result.status).toBe("applied");
    expect(computePlan(result.state).remainderCents).toBe(27000);
  });
  it("applies a proposal once even on repeat confirmation", () => {
    const s = sample(),
      p = {
        id: "p2",
        stateVersion: 0,
        payload: { type: "update_obligation" as const, targetId: s.bills[1].id, changes: { amountCents: 15000 } },
      };
    const first = applyConfirmedProposal(s, p);
    const second = applyConfirmedProposal(first.state, p);
    expect(second.status).toBe("already_applied");
    expect(second.state.stateVersion).toBe(1);
  });
  it("rejects stale and invalid proposals without changing the plan", () => {
    const s = sample(),
      p = {
        id: "p3",
        stateVersion: 3,
        payload: { type: "update_obligation" as const, targetId: s.bills[1].id, changes: { amountCents: 15000 } },
      };
    expect(applyConfirmedProposal(s, p)).toEqual({ status: "stale", state: s });
    expect(
      applyConfirmedProposal(s, { ...p, stateVersion: 0, payload: { ...p.payload, changes: { amountCents: -1 } } })
        .status,
    ).toBe("invalid");
  });
  it("does not count CSV spending or expected payroll against the current balance", () => {
    const s = sample();
    s.transactions.push({
      ...s.transactions[0],
      id: "extra",
      amountCents: -999999,
    });
    expect(computePlan(s).remainderCents).toBe(30000);
  });
  it("closes an already-deducted bill without reducing the balance again", () => {
    const s = sample(),
      rent = s.bills.find((b) => /apartments|rent/i.test(b.name))!;
    const next = markBillPaid(s, rent.id, true);
    expect(next.plan.balanceCents).toBe(220000);
    expect(computePlan(next).billsCents).toBe(20000);
  });
  it("deducts a newly paid bill only once", () => {
    const s = sample(),
      id = s.bills.find((b) => /apartments|rent/i.test(b.name))!.id;
    const next = markBillPaid(s, id, false);
    expect(next.plan.balanceCents).toBe(110000);
    expect(markBillPaid(next, id, false)).toBe(next);
    expect(computePlan(next).remainderCents).toBe(30000);
  });
  it("$950 after rent and $150 everyday spending preserves the $270 remainder", () => {
    const s = sample(),
      insurance = s.bills.find((b) => /insurance/i.test(b.name))!,
      rent = s.bills.find((b) => /apartments|rent/i.test(b.name))!;
    const changed = applyConfirmedProposal(s, {
      id: "p4",
      stateVersion: 0,
      payload: { type: "update_obligation", targetId: insurance.id, changes: { amountCents: insurance.amountCents + 3000 } },
    }).state;
    const next = previewBalanceUpdate(changed, 95000, [rent.id], true);
    expect(next.unexplainedCents).toBe(15000);
    expect(next.state.plan.essentialsCents).toBe(20000);
    expect(computePlan(next.state).billsCents).toBe(23000);
    expect(next.remainderCents).toBe(27000);
    expect(next.state.lastUpdate?.closedBills).toEqual([rent.name]);
  });
  it("caps everyday allocation and surfaces overspending separately", () => {
    const s = sample(),
      rent = s.bills.find((b) => /apartments|rent/i.test(b.name))!;
    const next = previewBalanceUpdate(s, 50000, [rent.id], true);
    expect(next.essentialsSpentCents).toBe(35000);
    expect(next.excessCents).toBe(25000);
    expect(next.state.plan.essentialsCents).toBe(0);
  });
  it("leaves everyday allocation to the user and flags incoming money", () => {
    const s = sample();
    expect(
      previewBalanceUpdate(s, 210000, [], false).essentialsSpentCents,
    ).toBe(0);
    expect(previewBalanceUpdate(s, 250000, [], true).unexplainedCents).toBe(
      -30000,
    );
  });
  it("produces a different result for sample B", () => {
    const b = computePlan(sample("B")).remainderCents;
    expect(b).toBe(280001);
    expect(b === computePlan(sample("A")).remainderCents).toBe(false);
  });
});
describe("CSV input and persisted state", () => {
  it("parses cents exactly and rejects more than two decimals", () => {
    expect(parseMoney("$1,234.56")).toBe(123456);
    expect(parseMoney("(10.30)")).toBe(-1030);
    expect(parseMoney("0.001")).toBeNull();
    expect(parseMoney("1e3")).toBeNull();
  });
  it("handles quoted commas, semicolons and an incomplete quote", () => {
    expect(
      parseCsv('Date,Description,Amount\n2026-11-14,"Store, downtown",-12.50')
        .rows[0][1],
    ).toBe("Store, downtown");
    expect(
      parseCsv("Date;Description;Amount\n2026-11-14;Store;-12.50").rows,
    ).toHaveLength(1);
    expect(() =>
      parseCsv('Date,Description,Amount\n2026-11-14,"Store,-12'),
    ).toThrow("not closed");
  });
  it("requires a choice for ambiguous dates and rejects impossible dates", () => {
    expect(detectDateFormats(["01/02/2026"])).toBe("");
    const p = parseCsv("Date,Description,Amount\n02/30/2026,Store,-10");
    expect(normalizeRows(p.rows, p.mapping, "MDY", false).errors[0]).toContain(
      "Row 2",
    );
  });
  it("keeps duplicate and transfer rows for explicit review", () => {
    const p = parseCsv(
      "Date,Description,Amount\n2026-11-14,Store,-10\n2026-11-14,Store,-10\n2026-11-14,Internal transfer,-20",
    );
    const r = normalizeRows(p.rows, p.mapping, "ISO", false);
    expect(r.transactions).toHaveLength(3);
    expect(r.transactions[1].duplicate).toBe(true);
    expect(r.transactions[2].transfer).toBe(true);
  });
  it("rejects oversize imports and corrupted or fractional-cent saved states", () => {
    expect(() => parseCsv("x".repeat(2097153))).toThrow("2 MB");
    const s = sample();
    expect(AppStateSchema.safeParse(s).success).toBe(true);
    s.plan.reserveCents = 0.5;
    expect(AppStateSchema.safeParse(s).success).toBe(false);
  });
});
