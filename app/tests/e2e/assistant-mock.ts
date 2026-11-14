/**
 * Integration walkthrough of the REAL assistant path: browser UI -> client adapter -> /api/assistant
 * (handler, quotas, tool loop, guards) with the deterministic mock model.
 *
 * Run against `AI_MOCK=1 QUOTA_MODE=memory npm run dev` (the mock is refused in production):
 *   BASE_URL=http://localhost:3000 npx tsx tests/e2e/assistant-mock.ts
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
const shots = path.resolve("tests/e2e/screenshots");

async function textOf(page: Page, selector: string) {
  const el = page.locator(selector).first();
  await el.waitFor({ timeout: 20000 });
  return ((await el.textContent()) ?? "").replace(/\s+/g, " ").trim();
}

async function waitForText(page: Page, selector: string, expected: string) {
  const deadline = Date.now() + 20000;
  let last = "";
  while (Date.now() < deadline) {
    last = ((await page.locator(selector).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
    if (last.includes(expected)) return last;
    await page.waitForTimeout(200);
  }
  throw new Error(`${selector}: expected "${expected}", got "${last}"`);
}

async function run(page: Page, width: number, height: number) {
  const checks: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width, height });
  await page.goto(baseURL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Try sample data", exact: true }).click();
  await page.getByRole("button", { name: "Continue to setup" }).click();
  const confirmButtons = page.getByRole("button", { name: "Confirm", exact: true });
  await confirmButtons.first().waitFor({ timeout: 20000 });
  const pending = await confirmButtons.count();

  // Setup review: the assistant annotates suggestions but confirms nothing by itself.
  await page.getByRole("button", { name: "Review with assistant", exact: true }).click();
  await page.getByRole("button", { name: "I agree, enable assistant" }).click();
  await page.getByRole("button", { name: "Review the recurring bills in my import", exact: true }).click();
  await page.locator(".setup-review").first().waitFor({ timeout: 20000 });
  assert.ok((await page.locator(".setup-review").count()) >= 1, "setup review items");
  await page.getByRole("button", { name: "Close dialog" }).click();
  assert.equal(await confirmButtons.count(), pending, "setup review must not confirm bills");
  checks.push("setup review confirms nothing");

  while (await confirmButtons.count()) await confirmButtons.first().click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  assert.equal(await textOf(page, '[data-testid="plan-remainder"]'), "$300");
  checks.push("sample plan $300");

  await page.getByRole("button", { name: "Ask assistant", exact: true }).click();
  await page.getByRole("button", { name: "Can I afford $400 this weekend?", exact: true }).click();
  const sim = await waitForText(page, ".purchase-result", "-$100");
  assert.ok(sim.includes("$100 below your $250 reserve"), sim);
  checks.push("purchase check via server tool");

  await page.getByRole("button", { name: "My car insurance went up by $30", exact: true }).click();
  const card = await waitForText(page, ".proposal-card", "$270");
  assert.ok(card.includes("$300"), card);
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/${width}-assistant-mock.png` });
  await page.getByRole("button", { name: "Confirm change", exact: true }).click();
  await page.getByRole("button", { name: "Applied", exact: true }).waitFor({ timeout: 20000 });
  checks.push("proposal confirmed once");

  await page.getByRole("button", { name: "Explain my plan", exact: true }).click();
  const deadline = Date.now() + 20000;
  let explained = "";
  while (Date.now() < deadline && !explained.includes("$270")) {
    explained = (await page.locator(".assistant-message p").allTextContents()).join(" ");
    await page.waitForTimeout(200);
  }
  assert.ok(explained.includes("$270"), `explain mentions $270: ${explained}`);
  checks.push("explanation uses verified amounts");

  await page.getByRole("button", { name: "Close dialog" }).click();
  assert.equal(await textOf(page, '[data-testid="plan-remainder"]'), "$270");
  await page.reload();
  assert.equal(await textOf(page, '[data-testid="plan-remainder"]'), "$270");
  checks.push("persisted $270");
  assert.deepEqual(errors, [], "no browser exceptions");
  return { viewport: `${width}×${height}`, status: "passed", checks };
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  try {
    for (const [width, height] of [
      [1280, 800],
      [390, 844],
    ]) {
      const context = await browser.newContext();
      try {
        console.log(JSON.stringify(await run(await context.newPage(), width, height)));
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
