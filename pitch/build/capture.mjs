// Captures the product screenshots the pitch deck uses, from a running copy of the app.
// Each image is one element or one region, so it stays legible on a slide.
//   node capture.mjs <app dir> <base url> <output dir>
// The server should answer with our own model and count quota in memory, as production does:
//   AI_PROVIDER=own AI_FALLBACK_TO_OPENAI=false QUOTA_MODE=memory npm start
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

const [appDir, baseURL, outDir] = process.argv.slice(2);
const require = createRequire(path.join(appDir, "package.json"));
const { chromium } = require("@playwright/test");
fs.mkdirSync(outDir, { recursive: true });
const out = (name) => path.join(outDir, `${name}.png`);

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(baseURL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const sample = page.getByRole("button", { name: "Try sample data", exact: true });
  await sample.waitFor();
  await page.waitForTimeout(500);
  await page.locator(".hero-side").screenshot({ path: out("cover") });
  await page.locator(".landing-math").screenshot({ path: out("math") });

  // Build the sample plan the way a visitor does.
  await sample.click();
  await page.getByRole("button", { name: "Continue to setup" }).click();
  const confirm = page.getByRole("button", { name: "Confirm", exact: true });
  await confirm.first().waitFor({ timeout: 20000 });
  await page.locator(".main-content").screenshot({ path: out("setup") });
  while (await confirm.count()) await confirm.first().click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  await page.getByTestId("plan-remainder").waitFor({ timeout: 20000 });
  await page.waitForTimeout(700);
  // The overview from its heading down to the end of the "Coming up" row.
  const main = await page.locator(".main-content").boundingBox();
  const below = await page.getByText(/bills? outside this period/).first().boundingBox();
  await page.screenshot({ path: out("plan"), clip: { x: main.x, y: main.y, width: main.width, height: below.y - main.y - 6 } });

  await page.getByTestId("late-pay").getByRole("button", { name: "A week" }).click();
  await page.waitForTimeout(300);
  await page.getByTestId("late-pay").screenshot({ path: out("late-pay") });

  // The assistant: a purchase check, a bill change, then the Plus offer once the free questions run out.
  await page.getByRole("button", { name: "Ask assistant", exact: true }).click();
  await page.getByRole("button", { name: "I agree, enable assistant" }).click();
  const groups = page.locator(".chat-messages > div");
  const ask = async (label) => {
    const before = await groups.count();
    await page.getByRole("button", { name: label, exact: true }).click();
    await groups.nth(before).waitFor({ timeout: 30000 });
    await page.locator(".thinking").waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(500);
    return groups.nth(before);
  };
  let group = await ask("Can I afford $400 this weekend?");
  await page.locator(".purchase-result").first().waitFor({ timeout: 30000 });
  await group.screenshot({ path: out("purchase") });
  group = await ask("My car insurance went up by $30");
  await page.locator(".proposal-card").first().waitFor({ timeout: 30000 });
  await group.screenshot({ path: out("proposal") });
  for (let i = 0; i < 6 && !(await page.locator(".plus-offer").count()); i++) await ask("Explain my plan");

  // Private mode: the same question, answered in the browser.
  await page.getByRole("button", { name: "Private, on this device" }).first().click();
  await page.waitForTimeout(300);
  group = await ask("Can I afford $400 this weekend?");
  await page.locator(".served-by.on-device").last().waitFor({ timeout: 30000 });
  await group.screenshot({ path: out("private") });
  await page.getByRole("button", { name: "Close dialog" }).click();

  // Saved what-ifs: the first save shows the Plus offer; accepting it saves. Then two more, side by side.
  await page.getByLabel("Purchase amount").fill("400");
  await page.getByRole("button", { name: "Check a purchase", exact: true }).click();
  await page.getByLabel("Name this purchase (optional)").fill("Sneakers");
  await page.locator(".purchase-result").getByRole("button", { name: "Save as a what-if" }).click();
  // The paywall names the price; its checkout runs in test mode.
  await page.getByTestId("plus-paywall").waitFor();
  await page.waitForTimeout(300);
  await page.getByTestId("plus-paywall").screenshot({ path: out("paywall") });
  await page.getByRole("dialog").getByRole("button", { name: "Continue to checkout", exact: true }).click();
  await page.getByTestId("plus-checkout").waitFor();
  await page.waitForTimeout(300);
  await page.getByTestId("plus-checkout").screenshot({ path: out("checkout") });
  await page.getByRole("dialog").getByRole("button", { name: "Pay $10.00 (test)", exact: true }).click();
  await page.getByTestId("whatif-row").first().waitFor();
  await page.getByTestId("late-pay").getByRole("button", { name: "Save as a what-if" }).click();
  await page.getByText("What if a new bill appears?").click();
  await page.getByPlaceholder("Vet visit").fill("Vet visit");
  await page.getByLabel("What-if bill amount").fill("120");
  await page.getByTestId("whatifs").getByRole("button", { name: "Save as a what-if" }).click();
  await page.getByTestId("whatif-row").nth(2).waitFor();
  await page.getByText("What if a new bill appears?").click();
  await page.getByRole("button", { name: "Dismiss notification" }).click().catch(() => {});
  await page.waitForTimeout(400);
  await page.getByTestId("whatifs").screenshot({ path: out("whatifs") });

  await page.goto(baseURL + "/app/bills");
  await page.getByRole("button", { name: "Lower it" }).first().click();
  await page.getByTestId("lower-bill").waitFor();
  await page.waitForTimeout(300);
  await page.getByTestId("lower-bill").screenshot({ path: out("lower-bill") });

  // The return on payday, seen at once on the sample plan: the demo skip, the update that starts the next
  // period, and the recap of the period that ended.
  await page.goto(baseURL + "/app");
  await page.getByTestId("demo-skip").click();
  await page.getByTestId("update-first").waitFor();
  await page.waitForTimeout(300);
  await page.getByTestId("update-first").screenshot({ path: out("payday") });
  await page.getByRole("button", { name: "Update now", exact: true }).click();
  await page.getByLabel("New available balance").fill("2900");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("covered:v1")));
  for (const b of saved.bills.filter((x) => x.status === "confirmed" && x.dueDate <= saved.plan.horizonEndDate))
    await page.locator(".payment-checklist label", { hasText: b.name }).first().locator("input").check();
  await page.waitForTimeout(300);
  await page.locator(".update-preview").screenshot({ path: out("next-period") });
  await page.getByRole("button", { name: "Start next period", exact: true }).click();
  await page.getByTestId("period-recap").waitFor();
  await page.waitForTimeout(400);
  await page.locator(".last-update").screenshot({ path: out("recap") });
  await context.close();
  console.log("captured to", outDir);
} finally {
  await browser.close();
}
