import assert from "node:assert/strict";
import { expect } from "@playwright/test";

const plusDays = (date, days) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Extra frontend acceptance checks; response fixtures use the team's shared wire contract. */
export async function runStage2Scenario(page, baseURL, width, height, directory) {
  await page.setViewportSize({ width, height });
  const issues = [];
  const onError = (error) => issues.push(error.message);
  page.on("pageerror", onError);
  const shot = async (name) => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: horizontal overflow`);
    const dialog = page.getByRole("dialog");
    const inDialog = await dialog.isVisible();
    if (inDialog) {
      const card = dialog.locator(".proposal-card").last();
      await (await card.count() ? card : dialog.locator(".assistant-message").last()).scrollIntoViewIfNeeded();
    }
    await page.screenshot({ path: `${directory}/${width}-stage2-${name}.png`, fullPage: !inDialog });
  };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("covered:v1")));
  const load = async (s) => {
    await page.evaluate((value) => localStorage.setItem("covered:v1", JSON.stringify(value)), s);
    await page.goto(`${baseURL}/app`);
    await expect(page.getByTestId("plan-remainder")).toBeVisible();
  };
  const open = async () => page.getByRole("button", { name: "Ask assistant", exact: true }).click();
  const send = async (text) => {
    await page.getByLabel("Message your assistant").fill(text);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
  };
  let sequence = 0;
  const proposalReply = async (payload) => {
    await page.route("**/api/assistant", async (route) => {
      const request = route.request().postDataJSON();
      await route.fulfill({
        json: { kind: "change_proposal", baseVersion: request.baseVersion, message: "Review this change before saving.", factRefs: [], requiresConfirmation: true,
          proposal: { id: `stage2_${width}_${sequence++}`, baseVersion: request.baseVersion, factRefs: [], payload: payload(request) } },
      });
    });
  };

  // The server-rendered loading state remains usable while JavaScript is unavailable.
  const loadingContext = await page.context().browser().newContext({ javaScriptEnabled: false, viewport: { width, height } });
  try {
    const loading = await loadingContext.newPage();
    await loading.goto(baseURL);
    await expect(loading.getByRole("link", { name: "Taking too long? Reload Covered" })).toBeVisible();
    await loading.screenshot({ path: `${directory}/${width}-stage2-loading.png`, fullPage: true });
  } finally { await loadingContext.close(); }

  await page.goto(baseURL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${baseURL}/app`);
  await expect(page.getByRole("button", { name: "Try sample data", exact: true })).toBeVisible();
  await shot("empty-data");
  await page.getByRole("button", { name: "Try sample data", exact: true }).click();
  await page.getByRole("button", { name: "Continue to setup" }).click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Confirm or dismiss");
  await shot("unconfirmed-plan");
  while (await page.getByRole("button", { name: "Confirm", exact: true }).count()) {
    await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
  }
  await page.getByRole("button", { name: "Build my plan" }).click();
  await expect(page.getByTestId("plan-remainder")).toHaveText("$300");
  const baseline = await stored();
  baseline.aiConsent = true;
  const insurance = baseline.bills.find((b) => /insurance/i.test(b.name));

  // Combined name / amount / date update has a stable before-and-after card.
  await load(baseline);
  await proposalReply((r) => {
    const bill = r.context.obligations.find((b) => /insurance/i.test(b.name));
    return { type: "update_obligation", targetId: bill.id,
      changes: { name: "Auto insurance", amountCents: bill.amountCents + 3000, dueDate: plusDays(r.context.today, 10) } };
  });
  await open(); await send("Rename insurance, change its amount and due date");
  await expect(page.getByRole("table", { name: "Bill change preview" })).toContainText("Auto insurance");
  await expect(page.locator(".proposal-card")).toContainText("$270");
  await expect(page.getByTestId("plan-remainder")).toHaveText("$300");
  await shot("proposal-before-after");
  await page.getByRole("button", { name: "Confirm change", exact: true }).click();
  await expect(page.getByRole("button", { name: "Applied", exact: true })).toBeDisabled();
  await expect(page.locator(".proposal-comparison")).toContainText(insurance.name);
  assert.equal((await stored()).bills.find((b) => b.name === "Auto insurance").dueDate, plusDays(baseline.plan.balanceDate, 10));
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await expect(page.getByTestId("plan-remainder")).toHaveText("$270");
  await page.unroute("**/api/assistant");

  // Moving the insurance beyond the horizon removes it from this period's commitments.
  await load(baseline);
  await proposalReply((r) => ({ type: "update_obligation", targetId: r.context.obligations.find((b) => /insurance/i.test(b.name)).id,
    changes: { dueDate: plusDays(r.context.plan.endDate, 1) } }));
  await open(); await send("Move insurance to after this period");
  const withoutInsurance = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format((30000 + insurance.amountCents) / 100);
  await expect(page.locator(".proposal-card")).toContainText(withoutInsurance);
  await page.getByRole("button", { name: "Confirm change", exact: true }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByTestId("plan-remainder")).toHaveText(withoutInsurance);
  await page.unroute("**/api/assistant");

  // A new bill is absent until confirmation, then survives reload exactly once.
  await load(baseline);
  await proposalReply((r) => ({ type: "add_obligation", obligation: { name: "Dentist", amountCents: 9000, dueDate: r.context.plan.endDate } }));
  await open(); await send("Add a dentist bill for $90 on the final day");
  await expect(page.locator(".proposal-card")).toContainText("No bill yet");
  assert.equal((await stored()).bills.length, baseline.bills.length);
  await shot("new-bill-proposal");
  await page.getByRole("button", { name: "Confirm change", exact: true }).click();
  await expect(page.getByRole("button", { name: "Applied", exact: true })).toBeDisabled();
  assert.equal((await stored()).bills.filter((b) => b.name === "Dentist" && b.status === "confirmed").length, 1);
  await page.getByRole("button", { name: "Close dialog" }).click(); await page.reload();
  await expect(page.getByTestId("plan-remainder")).toHaveText("$210");
  await page.unroute("**/api/assistant");

  // Two proposals based on one version: applying one makes the other stale.
  await load(baseline);
  await proposalReply((r) => {
    const bill = r.context.obligations.find((b) => /insurance/i.test(b.name));
    return { type: "update_obligation", targetId: bill.id, changes: { amountCents: bill.amountCents + 3000 } };
  });
  await open(); await send("Change insurance");
  await expect(page.locator(".proposal-card")).toHaveCount(1);
  await send("Another insurance suggestion");
  await expect(page.locator(".proposal-card")).toHaveCount(2);
  await page.locator(".proposal-card").first().getByRole("button", { name: "Confirm change", exact: true }).click();
  await expect(page.locator(".proposal-card").nth(1).getByRole("button", { name: "Confirm change", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh suggestion", exact: true })).toBeVisible();
  await shot("stale-proposal");
  await page.getByRole("button", { name: "Refresh suggestion", exact: true }).click();
  await expect(page.locator(".proposal-card").last().getByRole("button", { name: "Confirm change", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.unroute("**/api/assistant");

  for (const [code, text] of [
    ["ai_disabled", "turned off"], ["rate_limited", "Wait a minute"],
    ["budget_exhausted", "budget has been reached"], ["quota_unavailable", "limit service is unavailable"], ["timeout", "took too long"],
  ]) {
    await load(baseline);
    await page.route("**/api/assistant", (route) => route.fulfill({ status: 503, json: { error: { code, message: "Test fixture" } } }));
    await open(); await send("Explain my plan");
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(text);
    await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeEnabled();
    await shot(code);
    await page.getByRole("button", { name: "Use the form instead", exact: true }).click();
    await expect(page.getByRole("heading", { name: "The things you’ve got covered." })).toBeVisible();
    await page.unroute("**/api/assistant");
  }

  await load(baseline);
  await page.goto(`${baseURL}/app/bills`);
  await page.locator(".bill-list-row").filter({ hasText: insurance.name }).getByRole("button", { name: "Mark paid", exact: true }).click();
  await page.getByRole("button", { name: "No, deduct it now", exact: true }).click();
  const afterPayment = await stored();
  assert.equal(afterPayment.plan.balanceCents, baseline.plan.balanceCents - insurance.amountCents);
  assert.equal(afterPayment.bills.filter((b) => b.name === insurance.name && b.status === "paid").length, 1);
  assert.equal(afterPayment.bills.filter((b) => b.name === insurance.name && b.status === "confirmed").length, 1);
  await expect(page.locator(".bill-list-row").filter({ hasText: insurance.name })).toContainText("Outside this period");
  await shot("next-recurring-bill");
  await page.goto(`${baseURL}/app`);
  await expect(page.getByTestId("plan-remainder")).toHaveText("$300");

  const short = structuredClone(baseline); short.plan.balanceCents = 100000;
  await load(short);
  await expect(page.getByTestId("plan-remainder")).toHaveText("-$900");
  await shot("insufficient-money");
  const stale = structuredClone(baseline); stale.plan.balanceDate = plusDays(baseline.plan.balanceDate, -8);
  await load(stale);
  await expect(page.getByRole("button", { name: "Update now", exact: true })).toBeVisible();
  await shot("stale-data");

  // A storage write failure keeps the in-memory plan and can be retried.
  await load(baseline);
  await page.evaluate(() => {
    window.__coveredSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "covered:v1") throw new DOMException("Test: storage full", "QuotaExceededError");
      return window.__coveredSetItem.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "Update balance", exact: true }).click();
  await page.getByLabel("New available balance").fill("2200");
  await page.getByRole("button", { name: "Confirm update", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
  await shot("save-error");
  await page.evaluate(() => { Storage.prototype.setItem = window.__coveredSetItem; delete window.__coveredSetItem; });
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toHaveCount(0);

  await page.goto(`${baseURL}/setup/import`);
  const upload = async (text) => page.getByLabel("Upload transactions CSV").setInputFiles({ name: "test-bank.csv", mimeType: "text/csv", buffer: Buffer.from(text) });
  await upload('Date,Description,Amount\n2026-11-01,"Unclosed,-10');
  await expect(page.locator("main").getByRole("alert")).toContainText("not closed");
  await shot("invalid-csv");
  await upload("Date,Description,Amount\n01/02/2026,Store,-10\n01/03/2026,Bus,-20\nnot-a-date,Unknown,-15");
  await expect(page.locator("main").getByRole("alert")).toContainText("Choose a date format");
  await shot("unknown-date");
  await page.getByLabel("Date format").selectOption("MDY");
  await expect(page.getByText("2 transactions ready", { exact: true })).toBeVisible();
  await shot("partial-import");

  assert.deepEqual(issues, [], "stage 2: no uncaught browser errors");
  page.off("pageerror", onError);
  return { viewport: `${width}×${height}`, stage2: "passed", checks: ["before/after amount, name and date", "date outside horizon", "confirmed new bill and persistence", "stale proposal and refresh", "next recurring payment", "five AI error codes and manual forms", "loading", "empty data", "unconfirmed plan", "insufficient money", "stale data", "save failure and retry", "invalid CSV", "unknown date", "partial import"] };
}
