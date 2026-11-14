// Captures product screenshots for the pitch deck from a locally running app (mock assistant).
//   node capture.mjs <app dir> <base url> <output dir>
import { createRequire } from "node:module";
import path from "node:path";

const [appDir, baseURL, outDir] = process.argv.slice(2);
const require = createRequire(path.join(appDir, "package.json"));
const { chromium } = require("@playwright/test");

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" });

async function toPlan(page) {
  await page.goto(baseURL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Try sample data", exact: true }).waitFor();
}

async function buildPlan(page, shot) {
  await page.getByRole("button", { name: "Try sample data", exact: true }).click();
  await page.getByText("covered-sample-A.csv", { exact: true }).waitFor();
  if (shot) await shot("import");
  await page.getByRole("button", { name: "Continue to setup" }).click();
  const confirm = page.getByRole("button", { name: "Confirm", exact: true });
  await confirm.first().waitFor({ timeout: 20000 });
  if (shot) await shot("setup");
  if (shot) await page.screenshot({ path: path.join(outDir, "setup-full.png"), fullPage: true });
  while (await confirm.count()) await confirm.first().click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  await page.getByTestId("plan-remainder").waitFor({ timeout: 20000 });
}

try {
  // Desktop
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await desktop.newPage();
  const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
  await toPlan(page);
  await shot("landing");
  await buildPlan(page, shot);
  await page.waitForTimeout(600);
  await shot("overview");
  await page.screenshot({ path: path.join(outDir, "overview-full.png"), fullPage: true });

  await page.getByLabel("Purchase amount").fill("400");
  await page.getByRole("button", { name: "Check a purchase", exact: true }).click();
  await page.getByTestId("scenario-remainder").waitFor();
  await page.getByTestId("scenario-remainder").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot("purchase-form");
  await page.screenshot({ path: path.join(outDir, "purchase-full.png"), fullPage: true });

  await page.getByRole("button", { name: "Ask assistant", exact: true }).click();
  await page.getByRole("button", { name: "I agree, enable assistant" }).click();
  await page.getByRole("button", { name: "Can I afford $400 this weekend?", exact: true }).click();
  await page.locator(".purchase-result").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  await shot("assistant-purchase");
  await page.getByRole("button", { name: "My car insurance went up by $30", exact: true }).click();
  await page.locator(".proposal-card").first().waitFor({ timeout: 20000 });
  await page.locator(".proposal-card").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await shot("assistant-proposal");
  await page.locator(".proposal-card").first().screenshot({ path: path.join(outDir, "proposal-card.png") });
  await page.locator(".purchase-result").first().screenshot({ path: path.join(outDir, "purchase-result.png") });
  await page.getByRole("button", { name: "Confirm change", exact: true }).click();
  await page.getByRole("button", { name: "Applied", exact: true }).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await shot("overview-270");
  await desktop.close();

  // Phone
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const mobile = await phone.newPage();
  await toPlan(mobile);
  await buildPlan(mobile, null);
  await mobile.waitForTimeout(600);
  await mobile.screenshot({ path: path.join(outDir, "mobile-overview.png") });
  await phone.close();
  console.log("captured");
} finally {
  await browser.close();
}
