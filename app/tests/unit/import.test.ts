import { test } from "vitest";
import assert from "node:assert/strict";
import { parseCsv } from "../../src/lib/import/csv";
import { detectDateFormats, guessMapping, normalizeRows, mappingProblems } from "../../src/lib/import/normalize";
import { merchantKey } from "../../src/lib/import/recurring";
import { buildSetupSuggestion } from "../../src/lib/import/prefill";
import { generateSampleCsvA, generateSampleCsvB } from "../../src/lib/demo/sample";
import { addDays, computePlan, type Transaction } from "../../src/lib/finance";

function load(csv: string): Transaction[] {
  const parsed = parseCsv(csv);
  const mapping = guessMapping(parsed.headers);
  assert.deepEqual(mappingProblems(mapping), []);
  const dates = detectDateFormats(parsed.rows.map((r) => r[mapping.date!]));
  const res = normalizeRows(parsed.rows, { mapping, dateFormat: dates.fits[0], sign: "negative_is_out" });
  assert.deepEqual(res.errors, []);
  return res.transactions.map((t) => ({ ...t, importBatchId: "batch" }));
}

test("csv reader handles quotes, escaped quotes, CRLF and BOM", () => {
  const p = parseCsv('﻿Date,Description,Amount\r\n01/02/2026,"ACME, INC ""HQ""",-12.50\r\n01/03/2026,COFFEE,-3\r\n');
  assert.deepEqual(p.headers, ["Date", "Description", "Amount"]);
  assert.equal(p.rows[0][1], 'ACME, INC "HQ"');
  assert.equal(p.rows.length, 2);
  assert.throws(() => parseCsv("Date,Description\n"), /header row/);
  assert.throws(() => parseCsv('a,b\n"x,y\n'), /unclosed quote/);
});

test("date format detection requires a choice only when ambiguous", () => {
  assert.deepEqual(detectDateFormats(["01/02/2026", "03/04/2026"]).ambiguous, true);
  assert.deepEqual(detectDateFormats(["01/13/2026", "03/04/2026"]).fits, ["MDY"]);
  assert.deepEqual(detectDateFormats(["2026-01-13"]).fits, ["YMD"]);
});

test("row errors are reported, not hidden", () => {
  const p = parseCsv("Date,Description,Amount\n13/45/2026,X,-1\n01/02/2026,,-2\n01/03/2026,Y,abc\n01/04/2026,Z,-4\n");
  const r = normalizeRows(p.rows, { mapping: guessMapping(p.headers), dateFormat: "MDY", sign: "negative_is_out" });
  assert.equal(r.transactions.length, 1);
  assert.equal(r.errors.length, 3);
  assert.equal(r.errors[0].row, 2);
});

test("identical legitimate charges are flagged, never removed", () => {
  const p = parseCsv("Date,Description,Amount\n01/02/2026,CAFE,-5.75\n01/02/2026,CAFE,-5.75\n");
  const r = normalizeRows(p.rows, { mapping: guessMapping(p.headers), dateFormat: "MDY", sign: "negative_is_out" });
  assert.equal(r.transactions.length, 2);
  assert.equal(r.duplicates, 1);
  assert.equal(r.transactions[1].reviewStatus, "possible_duplicate");
});

test("merchant keys group card noise", () => {
  assert.equal(merchantKey("SAFEROAD AUTO INSURANCE"), "SAFEROAD AUTO INSURANCE");
  assert.equal(merchantKey("OAKWOOD APARTMENTS ONLINE PMT"), "OAKWOOD APARTMENTS");
  assert.equal(merchantKey("ACME LOGISTICS PAYROLL PPD"), "ACME LOGISTICS PAYROLL");
  assert.equal(merchantKey("GREENLEAF MARKET #0412"), "GREENLEAF MARKET");
});

test("sample A reproduces the plan numbers on any day of the year", () => {
  let day = "2026-01-01";
  for (let i = 0; i < 400; i += 3) {
    const today = addDays(day, i);
    const txs = load(generateSampleCsvA(today));
    const s = buildSetupSuggestion(txs, today);
    assert.equal(s.endDate, addDays(today, 10), `end date for ${today}`);
    assert.equal(s.endDateSource, "payday");
    assert.equal(s.essentials?.cents, 35000, `essentials for ${today}`);
    const names = s.candidates.map((c) => c.key);
    for (const k of ["SAFEROAD AUTO INSURANCE", "OAKWOOD APARTMENTS", "BRIGHTWAVE INTERNET", "SKYTALK WIRELESS"]) {
      assert.ok(names.includes(k), `${k} missing on ${today}: ${names.join(", ")}`);
    }
    assert.ok(!names.includes("GREENLEAF MARKET"), "groceries are not a bill");
    const confirmed = s.candidates
      .filter((c) => !c.possibleTransfer)
      .map((c) => ({
        id: c.id,
        name: c.displayName,
        amountCents: c.amountCents,
        dueDate: c.nextDueDate,
        paymentStatus: "unpaid" as const,
        confirmationStatus: "confirmed" as const,
      }));
    const plan = computePlan({
      today,
      balanceCents: 220000,
      balanceAsOf: today,
      startDate: today,
      endDate: s.endDate,
      essentialRemainingCents: s.essentials!.cents,
      reserveTargetCents: 25000,
      obligations: confirmed,
    });
    assert.equal(plan.billsCents, 130000, `bills in period for ${today}`);
    assert.equal(plan.remainderCents, 30000);
    const transfer = s.candidates.find((c) => c.possibleTransfer);
    assert.ok(transfer && transfer.notes.some((n) => n.includes("transfer")));
  }
});

test("sample B (debit/credit columns, semi-monthly pay) imports and gives its own plan", () => {
  const today = "2026-11-14";
  const csv = generateSampleCsvB(today);
  const parsed = parseCsv(csv);
  const mapping = guessMapping(parsed.headers);
  assert.equal(mapping.amount, null);
  assert.equal(parsed.headers[mapping.debit!], "Debit");
  const txs = load(csv);
  const s = buildSetupSuggestion(txs, today);
  assert.equal(s.income?.cadence, "semimonthly");
  assert.equal(s.endDate, "2026-11-15");
  const keys = s.candidates.map((c) => c.key);
  for (const k of ["MAPLE COURT RESIDENCES", "RIVERBANK LOAN", "CITY POWER LIGHT", "BLUEBELL MOBILE"]) {
    assert.ok(keys.some((x) => x.startsWith(k.split(" ")[0])), `${k} missing: ${keys.join(", ")}`);
  }
  const power = s.candidates.find((c) => c.key.startsWith("CITY"))!;
  assert.ok(power.notes.some((n) => n.startsWith("Amount varies")));
});
