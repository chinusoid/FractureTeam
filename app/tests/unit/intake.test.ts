import { test } from "vitest";
import assert from "node:assert/strict";
import { handleIntake, interpretIntake, parseExtraction, type IntakeExtraction } from "../../src/lib/ai/intake";
import { handleAssistant } from "../../src/lib/ai/handler";
import { mockProvider } from "../../src/lib/ai/mock";
import { readEnv } from "../../src/lib/ai/env";
import { MemoryStore } from "../../src/lib/limits/store";
import { applyAnswer, draftToState, emptyDraft, nextStep, INTERVIEW_NOTE } from "../../src/lib/client/intake";
import { emptyState } from "../../src/lib/client/model";
import type { IntakeRequest, IntakeResponse, IntakeStep } from "../../src/lib/schemas/intake";

const TODAY = "2026-11-14";
const NOW = new Date("2026-11-14T13:30:15Z");

const req = (step: IntakeStep, extra: Partial<IntakeRequest> = {}): IntakeRequest => ({
  consent: { aiEnabled: true, policyVersion: 1 },
  today: TODAY,
  step,
  answer: "x",
  endDate: "2026-11-28",
  knownBills: [],
  ...extra,
});
const form = (x: Partial<IntakeExtraction>): IntakeExtraction => ({ amount_usd: null, date: null, bills: [], no_more: false, unclear: false, ...x });

test("interview: an amount is range-checked and the reply is written from the checked value", () => {
  const ok = interpretIntake(req("balance"), form({ amount_usd: 2200.5 }));
  assert.deepEqual(ok, { step: "balance", understood: true, balanceCents: 220_050, message: "Got it: $2,200.50 in your account." });
  for (const bad of [form({ amount_usd: -5 }), form({ amount_usd: 5_000_000 }), form({ amount_usd: 300, unclear: true }), form({}), null]) {
    const r = interpretIntake(req("balance"), bad);
    assert.equal(r.understood, false);
    assert.equal(r.balanceCents, undefined);
  }
  assert.equal(interpretIntake(req("balance"), form({ amount_usd: 0 })).understood, false);
  assert.equal(interpretIntake(req("everyday"), form({ amount_usd: 0 })).everydayCents, 0);
  assert.equal(interpretIntake(req("reserve"), form({ amount_usd: 250 })).reserveCents, 25_000);
});

test("interview: each step returns only its own field, whatever else the model filled in", () => {
  const noisy = form({ amount_usd: 500, date: "2026-11-20", bills: [{ name: "Hack", amount_usd: 5, due_date: "2026-11-20" }], no_more: true });
  const balance = interpretIntake(req("balance"), noisy);
  assert.deepEqual(Object.keys(balance).sort(), ["balanceCents", "message", "step", "understood"]);
  const payday = interpretIntake(req("payday"), noisy);
  assert.deepEqual(Object.keys(payday).sort(), ["endDate", "message", "step", "understood"]);
});

test("interview: a payday must be a real day within the next two months", () => {
  assert.equal(interpretIntake(req("payday"), form({ date: "2026-11-27" })).endDate, "2026-11-27");
  for (const bad of ["2026-11-13", "2027-03-01", "2026-02-30", "next friday", null]) {
    const r = interpretIntake(req("payday"), form({ date: bad }));
    assert.equal(r.understood, false, String(bad));
    assert.equal(r.endDate, undefined);
  }
});

test("interview: bills need a name, an amount and a date; incomplete and repeated ones are not added", () => {
  const r = interpretIntake(
    req("bills", { knownBills: ["Rent"] }),
    form({
      bills: [
        { name: "phone", amount_usd: 65, due_date: "2026-11-22" },
        { name: "internet", amount_usd: 50, due_date: null },
        { name: "gym", amount_usd: null, due_date: "2026-11-27" },
        { name: "rent", amount_usd: 1100, due_date: "2026-11-20" },
        { name: "old", amount_usd: 10, due_date: "2026-11-01" },
        { name: "", amount_usd: 10, due_date: "2026-11-20" },
      ],
    }),
  );
  assert.deepEqual(r.bills, [{ name: "Phone", amountCents: 6_500, dueDate: "2026-11-22" }]);
  assert.equal(r.done, undefined);
  assert.match(r.message, /Added Phone, \$65, due Nov 22/);
  assert.match(r.message, /Already on the list: Rent/);
  assert.match(r.message, /the due date for Internet/);
  assert.match(r.message, /the amount for Gym/);
  assert.match(r.message, /the due date for Old/);
});

test("interview: 'that's all' ends the bills step only when nothing is left half-said", () => {
  assert.equal(interpretIntake(req("bills"), form({ no_more: true })).done, true);
  const half = interpretIntake(req("bills"), form({ no_more: true, bills: [{ name: "internet", amount_usd: 50, due_date: null }] }));
  assert.equal(half.done, undefined);
  assert.equal(half.understood, false);
  const nothing = interpretIntake(req("bills"), form({}));
  assert.equal(nothing.understood, false);
  assert.match(nothing.message, /couldn’t read a bill/);
});

test("interview: account numbers and emails are removed from bill names", () => {
  const r = interpretIntake(req("bills"), form({ bills: [{ name: "loan jane@example.com", amount_usd: 310, due_date: "2026-11-20" }] }));
  assert.equal(r.bills?.[0].name.includes("@"), false);
});

test("interview: malformed model output is dropped, never thrown", () => {
  assert.equal(parseExtraction("not json"), null);
  assert.equal(parseExtraction("[]")?.bills.length, 0);
  assert.deepEqual(parseExtraction('{"amount_usd":"12","date":5,"bills":"x","no_more":"yes"}'), form({}));
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-client-id": "browser-1", ...headers }, body: JSON.stringify(body) });

test("interview endpoint: refuses without consent, with a bad step, and when the assistant is off", async () => {
  const env = readEnv({ QUOTA_MODE: "memory" });
  const deps = { store: new MemoryStore(() => NOW.getTime()), provider: mockProvider(), now: () => NOW };
  const body = req("balance", { answer: "2200" });
  assert.equal((await handleIntake(post("/api/intake", { ...body, consent: { aiEnabled: false } }), env, deps)).status, 403);
  assert.equal((await handleIntake(post("/api/intake", { ...body, step: "anything" }), env, deps)).status, 400);
  assert.equal((await handleIntake(post("/api/intake", { ...body, answer: "" }), env, deps)).status, 400);
  assert.equal((await handleIntake(post("/api/intake", body), readEnv({ AI_ENABLED: "false" }), deps)).status, 503);
  assert.equal((await handleIntake(post("/api/intake", body), env, { ...deps, store: null })).status, 503);
  const ok = await handleIntake(post("/api/intake", body), env, deps);
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as IntakeResponse).balanceCents, 220_000);
});

test("interview endpoint: answers do not use up the free plan's assistant questions", async () => {
  const env = readEnv({ QUOTA_MODE: "memory", AI_FREE_PER_DAY: "1", AI_CLIENT_PER_DAY: "60" });
  const store = new MemoryStore(() => NOW.getTime());
  const deps = { store, provider: mockProvider(), now: () => NOW };
  for (let i = 0; i < 8; i++) {
    const r = await handleIntake(post("/api/intake", req("balance", { answer: "2200" })), env, deps);
    assert.equal(r.status, 200);
  }
  // The one free assistant question is still there after eight interview answers.
  const chat = {
    mode: "chat",
    message: "Explain my plan",
    baseVersion: 1,
    consent: { aiEnabled: true, policyVersion: 1 },
    context: {
      today: TODAY,
      plan: { balanceCents: 220_000, balanceAsOf: TODAY, startDate: TODAY, endDate: "2026-11-28", essentialRemainingCents: 35_000, reserveTargetCents: 25_000 },
      obligations: [],
    },
  };
  assert.equal((await handleAssistant(post("/api/assistant", chat), env, deps)).status, 200);
  assert.equal((await handleAssistant(post("/api/assistant", chat), env, deps)).status, 402);
  // The interview has its own daily ceiling.
  const tight = readEnv({ QUOTA_MODE: "memory", AI_CLIENT_PER_DAY: "2" });
  const s2 = new MemoryStore(() => NOW.getTime());
  const d2 = { store: s2, provider: mockProvider(), now: () => NOW };
  assert.equal((await handleIntake(post("/api/intake", req("balance", { answer: "1" })), tight, d2)).status, 200);
  assert.equal((await handleIntake(post("/api/intake", req("balance", { answer: "1" })), tight, d2)).status, 200);
  assert.equal((await handleIntake(post("/api/intake", req("balance", { answer: "1" })), tight, d2)).status, 429);
});

test("interview in the browser: answers fill a draft in order, and the draft opens as an unconfirmed plan to check", () => {
  let d = emptyDraft();
  assert.equal(nextStep(d), "balance");
  d = applyAnswer(d, { step: "balance", understood: false, message: "?" });
  assert.equal(nextStep(d), "balance");
  d = applyAnswer(d, { step: "balance", understood: true, message: "", balanceCents: 200_000 });
  d = applyAnswer(d, { step: "payday", understood: true, message: "", endDate: "2099-01-20" });
  assert.equal(nextStep(d), "bills");
  d = applyAnswer(d, { step: "bills", understood: true, message: "", bills: [{ name: "Rent", amountCents: 110_000, dueDate: "2099-01-17" }] });
  d = applyAnswer(d, { step: "bills", understood: true, message: "", bills: [{ name: "rent", amountCents: 1, dueDate: "2099-01-17" }] });
  assert.equal(d.bills.length, 1);
  assert.equal(nextStep(d), "bills");
  d = applyAnswer(d, { step: "bills", understood: true, message: "", done: true });
  d = applyAnswer(d, { step: "everyday", understood: true, message: "", everydayCents: 35_000 });
  assert.equal(nextStep(d), "reserve");
  d = applyAnswer(d, { step: "reserve", understood: true, message: "", reserveCents: 25_000 });
  assert.equal(nextStep(d), null);

  const before = { ...emptyState(), stateVersion: 4, aiConsent: true, importHashes: ["h"] };
  const s = draftToState(before, d);
  assert.equal(s.plan.confirmed, false);
  assert.equal(s.plan.balanceCents, 200_000);
  assert.equal(s.plan.horizonEndDate, "2099-01-20");
  assert.equal(s.plan.essentialsCents, 35_000);
  assert.equal(s.plan.reserveCents, 25_000);
  assert.equal(s.stateVersion, 5);
  assert.equal(s.aiConsent, true);
  assert.deepEqual(s.importHashes, []);
  assert.equal(s.transactions.length, 0);
  assert.equal(s.bills.length, 1);
  assert.equal(s.bills[0].status, "candidate");
  assert.equal(s.bills[0].note, INTERVIEW_NOTE);
});
