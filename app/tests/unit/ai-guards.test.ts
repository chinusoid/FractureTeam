import { test } from "vitest";
import assert from "node:assert/strict";
import { userTextOf } from "../../src/lib/ai/assistant";
import { billsNamedBy, emptyEffects, executeTool, type ToolContext } from "../../src/lib/ai/tools";
import { handleAssistant } from "../../src/lib/ai/handler";
import { readEnv } from "../../src/lib/ai/env";
import { MemoryStore } from "../../src/lib/limits/store";
import type { ModelProvider, OutputItem } from "../../src/lib/ai/openai";
import type { AssistantRequest, AssistantResponse } from "../../src/lib/schemas/assistant";

console.info = () => {};

const TODAY = "2026-11-14";
const BILLS = [
  { id: "bill_car", name: "Car insurance", amountCents: 15000, dueDate: "2026-11-17", paymentStatus: "unpaid", confirmationStatus: "confirmed" },
  { id: "bill_renters", name: "Renters insurance", amountCents: 2000, dueDate: "2026-11-22", paymentStatus: "unpaid", confirmationStatus: "confirmed" },
  { id: "bill_rent", name: "Oakwood Apartments", amountCents: 110000, dueDate: "2026-11-20", paymentStatus: "unpaid", confirmationStatus: "confirmed" },
  { id: "bill_old", name: "Car loan", amountCents: 31000, dueDate: "2026-11-05", paymentStatus: "paid", confirmationStatus: "confirmed" },
] as const;

const ctx = (userText?: string): ToolContext => ({
  planInput: {
    today: TODAY,
    balanceCents: 220000,
    balanceAsOf: TODAY,
    startDate: TODAY,
    endDate: "2026-11-24",
    essentialRemainingCents: 35000,
    reserveTargetCents: 25000,
    obligations: BILLS.map((b) => ({ ...b })),
  } as ToolContext["planInput"],
  baseVersion: 7,
  ...(userText === undefined ? {} : { userText }),
});

const change = (billId: string, userText?: string) => {
  const effects = emptyEffects();
  const out = JSON.parse(executeTool("propose_bill_change", JSON.stringify({ bill_id: billId, new_amount_usd: 180, new_due_date: null, new_name: null }), ctx(userText), effects));
  return { out, effects };
};
const add = (userText?: string) => {
  const effects = emptyEffects();
  const out = JSON.parse(executeTool("propose_new_bill", JSON.stringify({ name: "Hulu", amount_usd: 20, due_date: "2026-11-21" }), ctx(userText), effects));
  return { out, effects };
};

test("which bills the user's words fit: best match wins, paid bills and generic words are ignored", () => {
  const names = (text: string) => billsNamedBy(text, BILLS).map((b) => b.id);
  assert.deepEqual(names("My insurance went up by $30"), ["bill_car", "bill_renters"]);
  assert.deepEqual(names("My car insurance went up by $30"), ["bill_car"]);
  assert.deepEqual(names("the renters one is now $25"), ["bill_renters"]);
  assert.deepEqual(names("My monthly bill payment changed"), [], "generic words name no bill");
  assert.deepEqual(names("My Hulu subscription went up"), []);
  assert.deepEqual(names("the car payment"), ["bill_car"], "the paid car loan is not a candidate");
});

test("a bill change is refused when two bills fit the user's words equally", () => {
  const { out, effects } = change("bill_car", "My insurance went up by $30");
  assert.equal(out.ok, false);
  assert.equal(out.error, "ambiguous_bill");
  assert.match(out.message, /Car insurance \(\$150, due 2026-11-17\); Renters insurance \(\$20, due 2026-11-22\)/);
  assert.equal(effects.proposal, undefined, "no draft is created");
});

test("a bill change goes through when the words single out one bill, or name none at all", () => {
  assert.equal(change("bill_car", "My car insurance went up by $30").out.ok, true);
  assert.equal(change("bill_car", "My insurance went up by $30 car").out.ok, true, "the answer to 'which one?' settles it");
  // "rent" is not in the bill's name: the model may infer it, and the before/after card shows which bill.
  const rent = change("bill_rent", "My rent went up to $180");
  assert.equal(rent.out.ok, true);
  assert.ok(rent.effects.proposal);
  assert.equal(change("bill_car").out.ok, true, "without the user's text the tool behaves as before");
});

test("a new bill is refused until the user has given an amount and a due date", () => {
  const noDate = add("My Hulu subscription went up to $20");
  assert.equal(noDate.out.error, "missing_due_date");
  assert.equal(noDate.effects.proposal, undefined);
  assert.equal(add("Add my Hulu subscription, due next week").out.error, "missing_amount");
  for (const text of [
    "Add Hulu, $20 due Nov 21",
    "Add Hulu for $20 on the 21st",
    "Hulu is $20, due 11/21",
    "Add Hulu $20 due on 21",
    "Add my Hulu bill, $20 the 21st", // the reply to "When is it due?" joined with the first message
    "Hulu $20 tomorrow",
    "Hulu, $20, due Friday",
    "Hulu $20 at the end of the month",
  ]) {
    assert.equal(add(text).out.ok, true, text);
  }
  assert.equal(add().out.ok, true, "without the user's text the tool behaves as before");
});

const request = (message: string, history: { role: "user" | "assistant"; text: string }[] = []) =>
  ({ mode: "chat", message, baseVersion: 7, consent: { aiEnabled: true, policyVersion: 1 }, context: { today: TODAY, plan: { balanceCents: 220000, balanceAsOf: TODAY, startDate: TODAY, endDate: "2026-11-24", essentialRemainingCents: 35000, reserveTargetCents: 25000 }, obligations: BILLS, ...(history.length ? { history } : {}) } }) as unknown as AssistantRequest;

test("the user's text is this message, plus the previous one when the assistant had asked a question", () => {
  assert.equal(userTextOf(request("My insurance went up by $30")), "My insurance went up by $30");
  assert.equal(
    userTextOf(request("the car one", [{ role: "user", text: "My insurance went up by $30" }, { role: "assistant", text: "Which one changed: Car insurance or Renters insurance?" }])),
    "My insurance went up by $30 the car one",
  );
  // An earlier, finished exchange about another bill must not leak into this request.
  assert.equal(
    userTextOf(request("Renters insurance is now $25", [{ role: "user", text: "My car insurance went up by $30" }, { role: "assistant", text: "Car insurance: $150 → $180. Review and confirm the change below." }])),
    "Renters insurance is now $25",
  );
});

const msg = (text: string): OutputItem => ({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
const call = (name: string, args: unknown): OutputItem => ({ type: "function_call", call_id: `c_${name}`, name, arguments: JSON.stringify(args) });

async function run(req: AssistantRequest, script: OutputItem[][]) {
  let i = 0;
  const provider: ModelProvider = async () => ({ status: "completed", output: script[Math.min(i++, script.length - 1)], usage: { inputTokens: 10, outputTokens: 5 }, incompleteReason: null });
  const res = await handleAssistant(
    new Request("http://localhost:3000/api/assistant", { method: "POST", headers: { origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify(req) }),
    readEnv({ NODE_ENV: "development", QUOTA_MODE: "memory", OPENAI_API_KEY: "k" }),
    { provider, store: new MemoryStore() },
  );
  return (await res.json()) as AssistantResponse;
}

test("a model that guesses between two bills ends up asking, and no draft reaches the user", async () => {
  const json = await run(request("My insurance went up by $30"), [
    [call("propose_bill_change", { bill_id: "bill_car", new_amount_usd: 180, new_due_date: null, new_name: null })],
    [msg("Which insurance went up: Car insurance or Renters insurance?")],
  ]);
  assert.equal(json.kind, "question");
  assert.equal(json.proposal, undefined);
  assert.equal(json.requiresConfirmation, false);
});

test("a draft on screen is described, not turned into a question", async () => {
  const json = await run(request("Add Hulu, $20 due Nov 21"), [
    [call("propose_new_bill", { name: "Hulu", amount_usd: 20, due_date: "2026-11-21" })],
    [msg("When is your Hulu subscription due?")],
  ]);
  assert.equal(json.kind, "change_proposal");
  assert.ok(json.proposal);
  assert.doesNotMatch(json.message, /\?\s*$/);
  assert.match(json.message, /Hulu/);
});
