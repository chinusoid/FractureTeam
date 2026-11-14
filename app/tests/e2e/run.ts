/**
 * End-to-end check of the main scenario in Chromium, at phone (390x844) and desktop (1280x800) sizes.
 * Runs against the harness (same UI components, real /api handlers in mock mode when present).
 *
 *   tsx tests/e2e/run.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { startHarness } from "../../tools/harness/serve";
import { generateSampleCsvB } from "../../src/lib/demo/sample";
import { localToday } from "../../src/lib/finance";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "screenshots");
mkdirSync(shots, { recursive: true });

let failures = 0;
const log = (ok: boolean, msg: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
};

async function expectText(page: Page, testId: string, expected: string | RegExp, label: string) {
  const loc = page.getByTestId(testId).first();
  try {
    await loc.waitFor({ timeout: 8000 });
    const deadline = Date.now() + 5000;
    let text = "";
    while (Date.now() < deadline) {
      text = ((await loc.textContent()) ?? "").trim();
      if (typeof expected === "string" ? text.includes(expected) : expected.test(text)) break;
      await page.waitForTimeout(100);
    }
    const ok = typeof expected === "string" ? text.includes(expected) : expected.test(text);
    log(ok, `${label}: "${text.slice(0, 120)}"`);
  } catch (e) {
    log(false, `${label}: ${testId} not found (${(e as Error).message.split("\n")[0]})`);
  }
}

function watchErrors(page: Page, tag: string): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("503") && !m.text().includes("Failed to load resource")) {
      errors.push(`[${tag}] console: ${m.text()}`);
    }
  });
  return errors;
}

async function mainScenario(browser: Browser, base: string, size: { width: number; height: number }, tag: string) {
  const context = await browser.newContext({ viewport: size });
  const page = await context.newPage();
  const errors = watchErrors(page, tag);
  console.log(`\n=== main scenario @ ${tag} (${size.width}x${size.height}) ===`);

  await page.goto(base + "/");
  await page.screenshot({ path: path.join(shots, `${tag}-01-landing.png`), fullPage: true });
  await page.getByTestId("try-sample").click();
  await page.getByTestId("import-confirm").waitFor();
  await expectText(page, "import-summary", /transactions? from/, "import summary");
  await page.screenshot({ path: path.join(shots, `${tag}-02-import.png`), fullPage: true });
  await page.getByTestId("import-confirm").click();

  await page.getByTestId("build-plan").waitFor();
  const balance = await page.getByTestId("balance-input").inputValue();
  log(balance === "2200", `sample balance prefilled: ${balance}`);
  const ids = [
    "cand_saferoad_auto_insurance",
    "cand_oakwood_apartments",
    "cand_brightwave_internet",
    "cand_ironworks_gym_membership",
    "cand_skytalk_wireless",
    "cand_streamflix",
    "cand_tunebox_premium",
  ];
  for (const id of ids) {
    const btn = page.getByTestId(`confirm-${id}`);
    if (await btn.count()) await btn.click();
    else log(false, `missing suggestion ${id}`);
  }
  const transfer = page.locator('[data-testid^="dismiss-cand_transfer"]');
  if (await transfer.count()) await transfer.first().click();
  await expectText(page, "setup-preview", "$300", "setup preview before building");
  await page.screenshot({ path: path.join(shots, `${tag}-03-setup.png`), fullPage: true });
  await page.getByTestId("build-plan").click();

  await expectText(page, "remainder", "$300", "home remainder");
  await expectText(page, "verdict", "reserve are covered", "home verdict");
  await page.screenshot({ path: path.join(shots, `${tag}-04-home.png`), fullPage: true });

  await page.getByTestId("purchase-amount").fill("400");
  await page.getByTestId("purchase-check").click();
  await expectText(page, "sim-after", "-$100", "purchase $400 scenario");
  await expectText(page, "sim-verdict", "$100 below your $250 reserve; bills and everyday spending still covered.", "purchase wording");
  await expectText(page, "remainder", "$300", "plan unchanged by what-if");
  await page.getByTestId("purchase-result").screenshot({ path: path.join(shots, `${tag}-05-purchase.png`) });

  // Insurance +$30: through the assistant (mock mode) when available, otherwise through the bills screen.
  let viaAssistant = false;
  await page.getByTestId("assistant-toggle").click();
  await page.getByTestId("assistant-input").fill("My car insurance went up by $30");
  await page.getByTestId("assistant-send").click();
  const consent = page.getByTestId("consent-accept");
  await consent.waitFor({ timeout: 5000 });
  await page.screenshot({ path: path.join(shots, `${tag}-06-consent.png`) });
  await consent.click();
  const proposal = page.getByTestId("proposal-confirm");
  const aiError = page.getByTestId("assistant-error");
  await Promise.race([proposal.waitFor({ timeout: 15000 }), aiError.waitFor({ timeout: 15000 })]).catch(() => undefined);
  if (await proposal.count()) {
    viaAssistant = true;
    await expectText(page, "proposal-after", "$270", "proposal preview (computed locally)");
    await page.getByTestId("assistant-panel").screenshot({ path: path.join(shots, `${tag}-07-proposal.png`) });
    await proposal.click();
    log((await page.getByTestId("proposal-confirm").count()) === 0, "confirm button gone after applying (no double apply)");
    await page.getByTestId("assistant-panel").screenshot({ path: path.join(shots, `${tag}-08-proposal-saved.png`) });
  } else {
    log(true, `assistant unavailable (${(await aiError.count()) ? "error state shown" : "no answer"}), using the form`);
    await page.getByTestId("assistant-panel").screenshot({ path: path.join(shots, `${tag}-07-assistant-fallback.png`) });
  }
  await page.getByTestId("assistant-close").click();
  if (!viaAssistant) {
    await page.goto(base + "/app/bills");
    await page.getByTestId("edit-cand_saferoad_auto_insurance").click();
    await page.getByTestId("bill-amount").fill("180");
    await page.getByTestId("bill-save").click();
    await page.goto(base + "/app");
  }
  await expectText(page, "remainder", "$270", `remainder after +$30 (${viaAssistant ? "assistant" : "form"})`);

  await page.reload();
  await expectText(page, "remainder", "$270", "state kept after reload");

  await page.getByTestId("go-update").click();
  await page.getByTestId("new-balance").fill("950");
  await page.getByTestId("paid-cand_oakwood_apartments").check();
  await expectText(page, "update-after", "$270 → $270", "update preview");
  await page.screenshot({ path: path.join(shots, `${tag}-09-update.png`), fullPage: true });
  await page.getByTestId("save-update").click();
  await expectText(page, "remainder", "$270", "remainder after balance update");
  await expectText(page, "since-card", "Oakwood Apartments paid", "since-last-update card");
  await page.screenshot({ path: path.join(shots, `${tag}-10-after-update.png`), fullPage: true });

  // Mark paid dialog on the bills screen.
  await page.goto(base + "/app/bills");
  await page.getByTestId("pay-cand_brightwave_internet").click();
  await page.getByTestId("pay-modal").waitFor();
  await page.screenshot({ path: path.join(shots, `${tag}-11-mark-paid.png`) });
  await page.getByTestId("pay-not-reflected").click();
  await page.goto(base + "/app");
  await expectText(page, "remainder", "$270", "paying a bill not yet in the balance keeps the remainder");

  log(errors.length === 0, `no page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
  await context.close();
}

async function sampleB(browser: Browser, base: string) {
  console.log("\n=== second CSV (bank B) ===");
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = watchErrors(page, "bankB");
  const file = path.join(os.tmpdir(), "sample-bank-b.csv");
  writeFileSync(file, generateSampleCsvB(localToday()));
  await page.goto(base + "/");
  await page.getByTestId("import-own").click();
  await page.getByTestId("file-input").setInputFiles(file);
  await page.getByTestId("import-confirm").waitFor();
  await page.screenshot({ path: path.join(shots, `bankB-01-import.png`), fullPage: true });
  await page.getByTestId("import-confirm").click();
  await page.getByTestId("build-plan").waitFor();
  await page.getByTestId("balance-input").fill("3150");
  const confirms = page.locator('[data-testid^="confirm-cand_"]');
  const n = await confirms.count();
  log(n >= 4, `bank B suggestions found: ${n}`);
  for (let i = 0; i < n; i++) await page.locator('[data-testid^="confirm-cand_"]').first().click();
  await page.screenshot({ path: path.join(shots, `bankB-02-setup.png`), fullPage: true });
  await page.getByTestId("build-plan").click();
  const text = ((await page.getByTestId("remainder").textContent()) ?? "").trim();
  log(/^-?\$[\d,]+(\.\d\d)?$/.test(text) && text !== "$300", `bank B gives its own result: ${text}`);
  await page.screenshot({ path: path.join(shots, `bankB-03-home.png`), fullPage: true });
  log(errors.length === 0, `no page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
  await context.close();
}

async function setupReview(browser: Browser, base: string) {
  console.log("\n=== assistant review of suggested bills ===");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = watchErrors(page, "review");
  await page.goto(base + "/");
  await page.getByTestId("try-sample").click();
  await page.getByTestId("import-confirm").click();
  await page.getByTestId("review-with-ai").click();
  await page.getByTestId("consent-accept").click();
  await Promise.race([
    page.getByTestId("ai-review").first().waitFor({ timeout: 15000 }),
    page.getByTestId("review-error").waitFor({ timeout: 15000 }),
  ]).catch(() => undefined);
  const reviews = await page.getByTestId("ai-review").count();
  const errorShown = await page.getByTestId("review-error").count();
  log(reviews > 0 || errorShown > 0, `setup review: ${reviews} annotations${errorShown ? " (error state shown)" : ""}`);
  const confirmedBefore = await page.locator(".bill-row.is-confirmed").count();
  log(confirmedBefore === 0, "assistant review confirms nothing by itself");
  await page.screenshot({ path: path.join(shots, `review-01-setup.png`), fullPage: true });
  log(errors.length === 0, `no page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
  await context.close();
}

async function errorStates(browser: Browser, base: string) {
  console.log("\n=== error states ===");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const bad = path.join(os.tmpdir(), "bad.csv");
  writeFileSync(bad, "just some text without columns\n");
  await page.goto(base + "/setup/import");
  await page.getByTestId("file-input").setInputFiles(bad);
  await page.getByTestId("bad-csv").waitFor({ timeout: 5000 }).catch(() => undefined);
  log((await page.getByTestId("bad-csv").count()) === 1, "bad CSV shows a clear error");
  await page.screenshot({ path: path.join(shots, `error-01-bad-csv.png`), fullPage: true });

  const partial = path.join(os.tmpdir(), "partial.csv");
  writeFileSync(partial, "Date,Description,Amount\n11/14/2026,COFFEE,-4.50\n13/45/2026,BROKEN,-1\n11/15/2026,LUNCH,abc\n11/16/2026,GROCERY,-60\n");
  await page.goto(base + "/setup/import");
  await page.getByTestId("file-input").setInputFiles(partial);
  await page.getByTestId("row-errors").waitFor({ timeout: 5000 }).catch(() => undefined);
  log((await page.getByTestId("row-errors").count()) === 1, "partially parsed file lists skipped rows");

  const ambiguous = path.join(os.tmpdir(), "ambiguous.csv");
  writeFileSync(ambiguous, "Date,Description,Amount\n01/02/2026,COFFEE,-4.50\n03/04/2026,LUNCH,-12\n");
  await page.goto(base + "/setup/import");
  await page.getByTestId("file-input").setInputFiles(ambiguous);
  await page.getByTestId("date-format").waitFor({ timeout: 5000 }).catch(() => undefined);
  log((await page.getByTestId("date-format").count()) === 1 && (await page.getByTestId("import-confirm").count()) === 0, "ambiguous dates require a choice");
  await page.getByTestId("date-format").selectOption("MDY");
  await page.getByTestId("import-confirm").waitFor({ timeout: 5000 }).catch(() => undefined);
  log((await page.getByTestId("import-confirm").count()) === 1, "import possible after choosing the format");

  await page.goto(base + "/app");
  log((await page.getByText("No plan yet").count()) + (await page.getByText("isn't built yet").count()) > 0, "empty state on /app without a plan");

  // Corrupted storage is backed up and reported.
  await page.evaluate(() => localStorage.setItem("covered:v1", "{not json"));
  await page.goto(base + "/");
  log((await page.getByText("Saved data reset").count()) === 1, "corrupted storage shows a notice");
  await context.close();
}

const harness = await startHarness(0);
const browser = await chromium.launch();
try {
  await mainScenario(browser, harness.url, { width: 390, height: 844 }, "mobile");
  await mainScenario(browser, harness.url, { width: 1280, height: 800 }, "desktop");
  await sampleB(browser, harness.url);
  await setupReview(browser, harness.url);
  await errorStates(browser, harness.url);
} catch (e) {
  failures++;
  console.error("E2E crashed:", e);
} finally {
  await browser.close();
  await harness.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll e2e checks passed");
process.exit(failures ? 1 : 0);
