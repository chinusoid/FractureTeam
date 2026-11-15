/**
 * The pay-period loop in the browser: saved what-ifs (Covered Plus), "update first" on an old balance,
 * and the move to the next pay period with bills, reserve and settings carried over.
 */
import assert from "node:assert/strict";
import { expect } from "@playwright/test";

const back = (iso, days) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

export async function runLoopScenario(page, baseURL, width, height, shots) {
  await page.setViewportSize({ width, height });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = (name) => page.screenshot({ path: `${shots}/${width}-loop-${name}.png`, fullPage: true });
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("covered:v1")));
  const rewrite = async (fn) => {
    const state = await stored();
    fn(state);
    await page.evaluate((s) => localStorage.setItem("covered:v1", JSON.stringify(s)), state);
    await page.reload();
  };

  await page.goto(baseURL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Try sample data", exact: true }).click();
  await page.getByRole("button", { name: "Continue to setup" }).click();
  const confirms = page.getByRole("button", { name: "Confirm", exact: true });
  await expect(confirms.first()).toBeVisible();
  while (await confirms.count()) await confirms.first().click();
  await page.getByRole("button", { name: "Build my plan", exact: true }).click();
  await expect(page.getByTestId("plan-remainder")).toHaveText("$300");
  await expect(page.getByTestId("balance-age")).toContainText("today");

  // Saving a what-if belongs to Plus: the first save shows the offer, accepting it saves.
  await page.getByLabel("Purchase amount").fill("400");
  await page.getByRole("button", { name: "Check a purchase", exact: true }).click();
  await page.getByLabel("Name this purchase (optional)").fill("Sneakers");
  await page.locator(".purchase-result").getByRole("button", { name: "Save as a what-if" }).click();
  const offer = page.getByRole("dialog");
  await expect(offer).toContainText("Save and compare what-ifs");
  await expect(page.getByTestId("whatif-row")).toHaveCount(0);
  await offer.getByRole("button", { name: "Get Plus free", exact: true }).click();
  const rows = page.getByTestId("whatif-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Sneakers, $400");
  await expect(rows.first()).toContainText("-$100");
  await expect(rows.first()).toContainText("Uses your reserve");

  // With Plus on, the next ones save at once: a late paycheck and a bill that might appear.
  await page.getByTestId("late-pay").getByRole("button", { name: "A week", exact: true }).click();
  await page.getByTestId("late-pay").getByRole("button", { name: "Save as a what-if" }).click();
  await page.getByText("What if a new bill appears?").click();
  await page.getByPlaceholder("Vet visit").fill("Vet visit");
  await page.getByLabel("What-if bill amount").fill("120");
  await page.getByTestId("whatifs").getByRole("button", { name: "Save as a what-if" }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText("$180");
  // The plan itself has not moved, and the what-ifs survive a reload.
  await expect(page.getByTestId("plan-remainder")).toHaveText("$300");
  await page.reload();
  await expect(rows).toHaveCount(3);
  await shot("what-ifs");

  // They follow the plan: a lower balance changes every answer.
  await page.getByRole("button", { name: "Update balance", exact: true }).click();
  await page.getByLabel("New available balance").fill("2100");
  await page.getByRole("button", { name: "Confirm update", exact: true }).click();
  await expect(page.getByTestId("plan-remainder")).toHaveText("$300");
  await expect(rows.first()).toContainText("-$100");
  await rewrite((s) => { s.plan.balanceCents -= 10000; });
  await expect(page.getByTestId("plan-remainder")).toHaveText("$200");
  await expect(rows.first()).toContainText("-$200");

  // An old balance: the number is held back until the update, or until the person asks for it.
  await rewrite((s) => { s.plan.balanceDate = back(s.plan.balanceDate, 8); });
  await expect(page.getByTestId("update-first")).toContainText("8 days ago");
  await expect(page.getByTestId("plan-remainder")).toHaveCount(0);
  await expect(page.getByTestId("whatifs")).toHaveCount(0);
  // Nothing else on the page is computed from the old balance either.
  await expect(page.locator(".spending-panel")).toHaveCount(0);
  await expect(page.locator(".purchase-panel")).toHaveCount(0);
  await expect(page.getByText("Since last update", { exact: true })).toHaveCount(0);
  await shot("update-first");
  await page.getByRole("button", { name: /plan anyway$/ }).click();
  await expect(page.getByTestId("plan-remainder")).toHaveText("$200");

  // Payday has passed: the update starts the next period and carries everything over.
  await rewrite((s) => {
    s.plan.balanceDate = back(s.plan.balanceDate, 6);
    s.plan.horizonEndDate = back(s.plan.horizonEndDate, 11);
    for (const b of s.bills) b.dueDate = back(b.dueDate, 11);
  });
  await expect(page.getByTestId("update-first")).toContainText("Payday has passed");
  await page.getByRole("button", { name: "Update now", exact: true }).click();
  await page.getByLabel("New available balance").fill("2900");
  const before = await stored();
  for (const b of before.bills.filter((x) => x.status === "confirmed" && x.dueDate <= before.plan.horizonEndDate))
    await page.locator(".payment-checklist label", { hasText: b.name }).first().locator("input").check();
  await expect(page.getByLabel("Everyday spending for the new period")).toHaveValue("350");
  const payday = await page.getByLabel("Next payday").inputValue();
  assert.ok(payday > new Date().toISOString().slice(0, 10), "the suggested payday is in the future");
  await shot("next-period");
  // Carrying the plan over is the paid job: a browser without Plus gets the offer first.
  await page.evaluate(() => localStorage.removeItem("covered:plus"));
  await page.evaluate(() => window.dispatchEvent(new Event("covered:plus-change")));
  await page.getByRole("button", { name: "Start next period", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Carry your plan from paycheck to paycheck");
  assert.equal((await stored()).plan.horizonEndDate, before.plan.horizonEndDate, "nothing moves before the offer is answered");
  await page.getByRole("dialog").getByRole("button", { name: "Get Plus free", exact: true }).click();
  await expect(page.getByTestId("balance-age")).toContainText("today");
  const after = await stored();
  assert.equal(after.plan.horizonEndDate, payday);
  assert.equal(after.plan.reserveCents, before.plan.reserveCents);
  assert.equal(after.plan.essentialsCents, 35000);
  assert.equal(after.plan.confirmed, true);
  assert.equal(after.scenarios.length, 3, "what-ifs carry over");
  assert.equal(after.lastUpdate.newPeriod, true);
  // Each paid monthly bill has its next date in the plan already; nothing was imported again.
  const paidNames = after.bills.filter((b) => b.status === "paid").map((b) => b.name);
  assert.ok(paidNames.length >= 3);
  for (const name of paidNames) assert.ok(after.bills.some((b) => b.name === name && b.status === "confirmed"), `${name} repeats`);
  assert.equal(after.transactions.length, before.transactions.length);
  await expect(page.getByText("Since last update", { exact: true })).toBeVisible();
  await expect(page.getByTestId("period-recap")).toContainText("of bills paid");
  await expect(page.getByRole("button", { name: "Remove what-if: Sneakers, $400" })).toBeVisible();
  await page.getByRole("button", { name: "Remove what-if: Sneakers, $400" }).click();
  await expect(rows).toHaveCount(2);

  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "no horizontal overflow");
  assert.deepEqual(errors, [], "no browser exceptions");
  return {
    viewport: `${width}×${height}`,
    loop: "passed",
    checks: ["Plus offer before the first save", "three what-ifs saved and kept", "what-ifs follow the plan", "update first on an old balance", "Plus offer before the plan is carried over", "next period carries bills, reserve, settings and what-ifs", "period recap", "no overflow", "no browser exceptions"],
  };
}
