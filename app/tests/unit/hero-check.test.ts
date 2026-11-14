import { test } from "vitest";
import assert from "node:assert/strict";
import { HERO_PRESETS, checkHeroPurchase, heroPlanSummary, parseHeroAmount } from "../../src/lib/demo/heroPlan";

test("landing card numbers come from the sample plan: $2,200 − $1,300 − $350 − $250 = $300", () => {
  assert.deepEqual(heroPlanSummary(), {
    balanceCents: 220_000,
    billsCents: 130_000,
    everydayCents: 35_000,
    reserveCents: 25_000,
    availableCents: 30_000,
    allocatedPercent: 86,
  });
});

test("landing purchase check: $80 fits, $400 dips into the reserve, $1,500 takes bill money", () => {
  const [dinner, sneakers, laptop] = HERO_PRESETS.map((p) => checkHeroPurchase(p.amountCents));
  assert.ok(dinner.ok && sneakers.ok && laptop.ok);
  if (!(dinner.ok && sneakers.ok && laptop.ok)) return;

  assert.equal(dinner.status, "ok");
  assert.equal(dinner.label, "On track");
  assert.equal(dinner.remainderCents, 22_000);
  assert.equal(dinner.message, "$220 would remain. Bills, everyday spending and your reserve stay covered.");

  assert.equal(sneakers.status, "reserve_short");
  assert.equal(sneakers.label, "Below your reserve");
  assert.equal(sneakers.remainderCents, -10_000);
  assert.equal(sneakers.message, "$100 below your $250 reserve. Bills and everyday spending stay covered.");

  assert.equal(laptop.status, "bills_short");
  assert.equal(laptop.label, "Short for bills");
  assert.match(laptop.message, /^\$600 short for your bills\./);
});

test("landing purchase check: the layer between the reserve and bills is everyday spending", () => {
  const r = checkHeroPurchase(70_000); // $2,200 − $700 = $1,500: bills covered, $150 short for everyday spending
  assert.ok(r.ok && r.status === "essentials_short");
  if (r.ok) assert.equal(r.message, "Bills stay covered, but everyday spending would be $150 short.");
  const edge = checkHeroPurchase(30_000); // exactly what is available
  assert.ok(edge.ok && edge.status === "ok" && edge.remainderCents === 0);
});

test("landing purchase check: odd input gets a plain message, never a crash", () => {
  assert.equal(parseHeroAmount(""), null);
  assert.equal(parseHeroAmount("abc"), null);
  assert.equal(parseHeroAmount("$1,500"), 150_000);
  assert.equal(parseHeroAmount("79.99"), 7_999);
  assert.equal(parseHeroAmount("-5"), -500);
  for (const [input, expected] of [
    ["", "Enter an amount in dollars, like 400."],
    ["0", "Purchase amount must be greater than $0."],
    ["-5", "Purchase amount must be greater than $0."],
    ["10000000", "Purchase amount is too large for this plan."],
    ["1e9", "Enter an amount in dollars, like 400."],
  ] as const) {
    const r = checkHeroPurchase(parseHeroAmount(input));
    assert.equal(r.ok, false);
    assert.equal(r.message, expected);
  }
});
