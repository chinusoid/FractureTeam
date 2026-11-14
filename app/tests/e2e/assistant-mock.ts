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

/** A calendar day `days` from now in the browser's own time zone, as YYYY-MM-DD. */
const dayFromNow = (page: Page, days: number) =>
  page.evaluate((n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, days);

async function overflowing(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

/**
 * Starting without a file: the import help, the interview (UI -> /api/intake -> checks) with the review
 * that follows it, and the by-hand form with a bill typed to the assistant.
 */
async function startWithoutFile(page: Page, checks: string[]) {
  const answer = async (text: string) => {
    await page.locator("#interview-answer").fill(text);
    await page.getByRole("button", { name: "Send answer" }).click();
    await page.locator(".thinking").waitFor({ state: "detached", timeout: 20000 });
  };
  const payday = await dayFromNow(page, 10);
  const soon = await dayFromNow(page, 3);
  const later = await dayFromNow(page, 5);

  // Import screen: what the file should look like, and a plain answer to an Excel workbook.
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${baseURL}/setup/import`);
  await page.getByRole("heading", { name: "What the file should look like" }).waitFor();
  await page.getByRole("button", { name: "Download a template" }).waitFor();
  await page.getByLabel("Upload transactions CSV").setInputFiles({ name: "bank.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("PK not a csv") });
  await waitForText(page, "main [role=alert]", "Save As");
  assert.equal(await overflowing(page), false, "import: no horizontal overflow");
  checks.push("file format help and Excel answer");

  // Interview: five fixed questions, answered in words.
  await page.goto(baseURL);
  await page.getByRole("button", { name: "Answer five questions" }).click();
  await page.getByRole("button", { name: "I agree, start the interview" }).click();
  await page.getByText("Question 1 of 5").waitFor();
  await answer("no idea");
  await page.getByText("Question 1 of 5").waitFor();
  assert.equal(await textOf(page, '[data-testid="iv-balance"]'), "—");
  await answer("2200");
  assert.equal(await textOf(page, '[data-testid="iv-balance"]'), "$2,200");
  await answer(payday);
  await page.getByText("Question 3 of 5").waitFor();
  await answer(`rent $1,100 on ${soon}; phone $65 on ${soon}`);
  await waitForText(page, ".interview-summary", "Phone");
  await answer("internet $50");
  await waitForText(page, ".interview-chat", "the due date for Internet");
  assert.equal(await page.locator(".interview-bills li").count(), 2, "an incomplete bill is not added");
  await answer(later);
  await waitForText(page, ".interview-summary", "Internet");
  await answer("that's all");
  await page.getByText("Question 4 of 5").waitFor();
  await answer("350");
  await answer("250");
  await page.getByText("All five answered").waitFor();
  assert.equal(await textOf(page, '[data-testid="iv-everyday"]'), "$350");
  assert.equal(await textOf(page, '[data-testid="iv-reserve"]'), "$250");
  assert.equal(await overflowing(page), false, "interview: no horizontal overflow");
  checks.push("interview fills the draft");

  // Review: nothing counts until the person has checked it.
  await page.getByRole("button", { name: "Check my answers" }).click();
  await page.getByText("came from your answers").waitFor();
  assert.equal(await page.locator("#balance").inputValue(), "2200");
  await page.getByRole("button", { name: "Build my plan" }).click();
  await waitForText(page, "main [role=alert]", "Confirm or dismiss each suggested bill");
  assert.ok(page.url().endsWith("/setup/plan"), "unreviewed bills block the plan");
  await page.locator("[data-pending]").filter({ hasText: "Phone" }).getByRole("button", { name: "Dismiss" }).click();
  await page.getByRole("button", { name: "Confirm 2 bills" }).click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  assert.equal(await textOf(page, '[data-testid="plan-remainder"]'), "$450");
  checks.push("review then plan $450");

  // By hand: the form, plus one bill typed to the assistant.
  await page.evaluate(() => localStorage.clear());
  await page.goto(baseURL);
  await page.getByRole("button", { name: "enter your numbers by hand" }).click();
  await page.getByRole("heading", { name: "Your bills" }).waitFor();
  await page.getByRole("button", { name: "Add bills by typing" }).click();
  await waitForText(page, "main [role=alert]", "Enter your current balance first");
  await page.locator("#balance").fill("2200");
  await page.getByLabel("Everyday spending").fill("350");
  await page.getByRole("button", { name: "Add bills by typing" }).click();
  await page.getByRole("button", { name: "I agree, enable assistant", exact: true }).click();
  await page.locator(".suggestions button").first().click();
  await page.getByRole("button", { name: "Confirm change", exact: true }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  assert.equal(await textOf(page, '[data-testid="plan-remainder"]'), "$500");
  assert.equal(await overflowing(page), false, "by hand: no horizontal overflow");
  checks.push("by hand with a typed bill $500");
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
  await startWithoutFile(page, checks);
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
