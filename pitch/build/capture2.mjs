// Tall-viewport captures of the assistant panel, so whole answers fit.
//   node capture2.mjs <app dir> <base url> <output dir>
import { createRequire } from "node:module";
import path from "node:path";

const [appDir, baseURL, outDir] = process.argv.slice(2);
const require = createRequire(path.join(appDir, "package.json"));
const { chromium } = require("@playwright/test");

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1250 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(baseURL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Try sample data", exact: true }).click();
  await page.getByRole("button", { name: "Continue to setup" }).click();
  const confirm = page.getByRole("button", { name: "Confirm", exact: true });
  await confirm.first().waitFor({ timeout: 20000 });
  while (await confirm.count()) await confirm.first().click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  await page.getByTestId("plan-remainder").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Ask assistant", exact: true }).click();
  await page.getByRole("button", { name: "I agree, enable assistant" }).click();
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Can I afford $400 this weekend?", exact: true }).click();
  await page.locator(".purchase-result").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  await dialog.screenshot({ path: path.join(outDir, "dlg-purchase.png") });
  const box = async (sel) => JSON.stringify(await page.locator(sel).first().boundingBox());
  console.log("dialog", JSON.stringify(await dialog.boundingBox()), "purchase-result", await box(".purchase-result"));
  await page.getByRole("button", { name: "My car insurance went up by $30", exact: true }).click();
  await page.locator(".proposal-card").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  await dialog.screenshot({ path: path.join(outDir, "dlg-proposal.png") });
  console.log("dialog", JSON.stringify(await dialog.boundingBox()), "proposal-card", await box(".proposal-card"));
  await context.close();
} finally {
  await browser.close();
}
