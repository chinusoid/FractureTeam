import { chromium } from "@playwright/test";
import path from "node:path";
import { runScenario } from "./scenario.mjs";

async function main() {
  const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
  });
  try {
    for (const [width, height] of [
      [1280, 800],
      [390, 844],
    ]) {
      const context = await browser.newContext();
      try {
        console.log(
          JSON.stringify(
            await runScenario(
              await context.newPage(),
              baseURL,
              width,
              height,
              path.resolve("tests/e2e/screenshots"),
            ),
          ),
        );
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
