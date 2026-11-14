/**
 * Release check against a configured deployment. No /api/assistant interception.
 * BASE_URL=https://your-site.vercel.app node tests/e2e/release.mjs
 * Local server test: AI_MOCK=1 QUOTA_MODE=memory npm run dev
 * BASE_URL=http://localhost:3100 EXPECTED_MOCK=1 EXPECTED_QUOTA=memory node tests/e2e/release.mjs
 * Screenshots use disposable browser profiles and synthetic sample data only.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const baseURL = process.env.BASE_URL?.replace(/\/$/, "");
assert.ok(baseURL, "Set BASE_URL to the deployment to check.");
const healthResponse = await fetch(`${baseURL}/api/health`);
assert.equal(healthResponse.status, 200, "public /api/health must be accessible");
const health = await healthResponse.json();
assert.equal(health.aiConfigured, true, "configure AI environment variables before the release check");
assert.equal(health.mock, process.env.EXPECTED_MOCK === "1", "production must use the real model");
assert.equal(health.quota, process.env.EXPECTED_QUOTA ?? "upstash", "production quota must use Upstash");
const shots = path.resolve("tests/e2e/screenshots");
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  for (const [width, height] of [[1280, 800], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    try {
      const page = await context.newPage();
      const errors = [], tools = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => { if (r.url().endsWith("/api/assistant") && r.ok()) tools.push(r.headers()["x-ai-tools"] ?? ""); });
      await page.goto(baseURL);
      await page.getByRole("button", { name: "Try sample data", exact: true }).click();
      await page.getByRole("button", { name: "Continue to setup" }).click();
      const confirms = page.getByRole("button", { name: "Confirm", exact: true });
      await expect(confirms.first()).toBeVisible();
      const pending = await confirms.count();
      await page.getByRole("button", { name: "Review with assistant", exact: true }).click();
      await page.getByRole("button", { name: "I agree, enable assistant", exact: true }).click();
      await page.getByRole("button", { name: "Review the recurring bills in my import", exact: true }).click();
      await expect(page.locator(".setup-review").first()).toBeVisible({ timeout: 35000 });
      await page.getByRole("button", { name: "Close dialog", exact: true }).click();
      await expect(confirms).toHaveCount(pending);
      while (await confirms.count()) await confirms.first().click();
      await page.getByRole("button", { name: "Build my plan", exact: true }).click();
      await expect(page.getByTestId("plan-remainder")).toHaveText("$300");
      const rentName = await page.evaluate(() => JSON.parse(localStorage.getItem("covered:v1")).bills.find((b) => b.amountCents === 110000).name);
      await page.getByRole("button", { name: "Ask assistant", exact: true }).click();
      await page.getByRole("button", { name: "Can I afford $400 this weekend?", exact: true }).click();
      await expect(page.locator(".purchase-result")).toContainText("-$100", { timeout: 35000 });
      await expect(page.locator(".purchase-result")).toContainText("$100 below your $250 reserve");
      await page.getByRole("button", { name: "My car insurance went up by $30", exact: true }).click();
      const card = page.locator(".proposal-card");
      await expect(card).toContainText("$270", { timeout: 35000 });
      await expect(card).toContainText("$300");
      await expect(page.getByTestId("plan-remainder")).toHaveText("$300");
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${shots}/${width}-release-proposal.png` });
      await page.getByRole("button", { name: "Confirm change", exact: true }).click();
      await expect(page.getByRole("button", { name: "Applied", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Close dialog", exact: true }).click();
      await page.reload();
      await expect(page.getByTestId("plan-remainder")).toHaveText("$270");
      await page.getByRole("button", { name: "Update balance", exact: true }).click();
      await page.getByLabel("New available balance").fill("950");
      await page.getByRole("checkbox", { name: new RegExp(rentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).check();
      await page.getByRole("button", { name: "Confirm update", exact: true }).click();
      await expect(page.getByTestId("plan-remainder")).toHaveText("$270");
      await expect(page.locator(".last-update")).toContainText(`${rentName} marked paid`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "no horizontal overflow");
      await page.screenshot({ path: `${shots}/${width}-release-updated.png`, fullPage: true });
      assert.ok(tools.some((t) => t.includes("simulate_purchase")), "purchase must use the server simulation tool");
      assert.ok(tools.some((t) => t.includes("propose_bill_change")), "bill must use the server proposal tool");
      assert.deepEqual(errors, [], "no uncaught browser errors");
      console.log(JSON.stringify({ viewport: `${width}×${height}`, status: "passed", mock: health.mock, quota: health.quota, checks: ["setup review", "$300 plan", "-$100 reserve check", "confirmed $270", "reload", "balance update without double counting", "server tools", "no overflow"] }));
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
