import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "@playwright/test";

/** @param {import('@playwright/test').Page} page */
export async function runScenario(page, baseURL, width, height, directory) {
  await mkdir(directory, { recursive: true });
  const issues = [];
  page.on("pageerror", (error) => issues.push(error.message));
  await page.setViewportSize({ width, height });
  await page.goto(baseURL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page
    .getByRole("button", { name: "Try sample data", exact: true })
    .waitFor();
  const shot = async (name) => {
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `${name}: horizontal overflow`,
    );
    await page.screenshot({
      path: `${directory}/${width}-${name}.png`,
      fullPage: true,
    });
  };
  await shot("landing");
  await expect(
    page.getByRole("heading", { name: /\$10 a month to keep it right/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Try sample data", exact: true })
    .click();
  await expect(
    page.getByText("covered-sample-A.csv", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue to setup" }).click();
  await expect(page.getByLabel("Current available balance")).toHaveValue(
    "2200",
  );
  await expect(
    page.getByRole("button", { name: "Confirm", exact: true }),
  ).toHaveCount(8); // 3 bills in the period, 4 later bills and a savings transfer to dismiss or keep
  await expect(
    page.getByRole("button", { name: "$250", exact: true }),
  ).toHaveClass(/selected/);
  await page.getByRole("button", { name: "Build my plan" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Confirm or dismiss",
  );
  await shot("setup");
  // One click confirms the clear suggestions; the flagged savings transfer waits for its own decision.
  await page
    .getByRole("button", { name: "Confirm 7 bills", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm", exact: true }),
  ).toHaveCount(1);
  while (
    await page.getByRole("button", { name: "Confirm", exact: true }).count()
  )
    await page
      .getByRole("button", { name: "Confirm", exact: true })
      .first()
      .click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  await expect(page.getByTestId("plan-remainder")).toHaveText("$300");
  // The payday reminder is a calendar file built in the browser.
  const [reminder] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Remind me on / }).click(),
  ]);
  assert.equal(reminder.suggestedFilename(), "covered-reminder.ics");
  await expect(page.locator(".toast")).toContainText("repeating every two weeks");
  await page
    .getByRole("button", { name: "Dismiss notification", exact: true })
    .click();
  await page.getByLabel("Purchase amount").fill("400");
  await page
    .getByRole("button", { name: "Check a purchase", exact: true })
    .click();
  await expect(page.getByTestId("scenario-remainder")).toHaveText("-$100");
  await expect(page.getByRole("status")).toContainText(
    "$100 below your $250 reserve",
  );
  await shot("overview");

  // A real unavailable endpoint is checked before adding test-only interception.
  let requests = 0;
  const count = (request) => {
    if (request.url().endsWith("/api/assistant")) requests++;
  };
  page.on("request", count);
  await page
    .getByRole("button", { name: "Ask assistant", exact: true })
    .click();
  await expect(page.getByText("Your plan. Your permission.")).toBeVisible();
  assert.equal(requests, 0, "no financial context is sent before consent");
  await page.getByRole("button", { name: "I agree, enable assistant" }).click();
  await page
    .getByRole("button", { name: "Explain my plan", exact: true })
    .click();
  // Without OPENAI_API_KEY (and without AI_MOCK=1) the server answers "ai_disabled".
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    /isn’t connected yet|turned off/,
  );
  await shot("assistant-unavailable");
  await page.getByRole("button", { name: "Close dialog" }).click();
  page.off("request", count);

  // A mock belongs to the test harness only. There is no deployed mock server.
  await page.route("**/api/assistant", async (route) => {
    const payload = route.request().postDataJSON();
    assert.ok(route.request().headers()["x-client-id"]);
    // Shared contract: src/lib/schemas/assistant.ts
    const insurance = payload.context.obligations.find((b) =>
      /insurance/i.test(b.name),
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "change_proposal",
        baseVersion: payload.baseVersion,
        message: "Review the insurance change before applying it.",
        factRefs: [insurance.id],
        requiresConfirmation: true,
        proposal: {
          id: `insurance-${width}`,
          baseVersion: payload.baseVersion,
          factRefs: [insurance.id],
          payload: {
            type: "update_obligation",
            targetId: insurance.id,
            changes: { amountCents: insurance.amountCents + 3000 },
          },
        },
      }),
    });
  });
  await page
    .getByRole("button", { name: "Ask assistant", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "My car insurance went up by $30",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm change", exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId("plan-remainder")).toHaveText("$300");
  await expect(page.locator(".proposal-card")).toContainText("$270");
  await page
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Applied", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.unroute("**/api/assistant");
  await expect(page.getByTestId("plan-remainder")).toHaveText("$270");
  await page.reload();
  await expect(page.getByTestId("plan-remainder")).toHaveText("$270");

  await page
    .getByRole("button", { name: "Update balance", exact: true })
    .click();
  await page.getByLabel("New available balance").fill("950");
  await page.getByRole("checkbox", { name: /Oakwood Apartments/ }).check();
  await expect(page.locator(".preview-money")).toContainText("$270");
  await page
    .getByRole("button", { name: "Confirm update", exact: true })
    .click();
  await expect(page.getByTestId("plan-remainder")).toHaveText("$270");
  await expect(
    page.getByText("Since last update", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".last-update")).toContainText(
    "Oakwood Apartments marked paid.",
  );
  await shot("updated");

  await page.route("**/api/assistant", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "QUOTA_EXCEEDED" } }),
    }),
  );
  await page
    .getByRole("button", { name: "Ask assistant", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Explain my plan", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "quota has been reached",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.unroute("**/api/assistant");

  // The second CSV really runs through import and inference again.
  await page.goto(baseURL);
  await page.getByRole("button", { name: "Try sample B", exact: true }).click();
  await page.getByRole("button", { name: "Continue to setup" }).click();
  await expect(page.getByLabel("Current available balance")).toHaveValue(
    "3100",
  );
  while (
    await page.getByRole("button", { name: "Confirm", exact: true }).count()
  )
    await page
      .getByRole("button", { name: "Confirm", exact: true })
      .first()
      .click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  // Sample B is dated relative to today (debit/credit columns, paid twice a month): its own result.
  await expect(page.getByTestId("plan-remainder")).toHaveText(
    /^-?\$[\d,]+(\.\d{2})?$/,
  );
  await expect(page.getByTestId("plan-remainder")).not.toHaveText("$300");
  await page.goto(baseURL);
  await page.getByRole("button", { name: "Try sample B", exact: true }).click();
  await page.getByRole("button", { name: "Continue to setup" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "already imported this exact file",
  );

  // External CSV: explicit ambiguous-date choice, then partial import.
  await page.goto(`${baseURL}/setup/import`);
  await page
    .getByLabel("Upload transactions CSV")
    .setInputFiles({
      name: "my-bank.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Date,Description,Amount\n01/02/2026,Store,-10\n01/03/2026,Transit,-20\nnot-a-date,Unknown,-15",
      ),
    });
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Choose a date format",
  );
  await page.getByLabel("Date format").selectOption("MDY");
  await expect(page.locator("main").getByRole("alert")).toContainText("Row 4");
  await expect(
    page.getByText("2 transactions ready", { exact: true }),
  ).toBeVisible();
  await shot("csv-review");

  // Corrupted persistence is backed up and does not break rendering.
  await page.evaluate(() => localStorage.setItem("covered:v1", "{broken-json"));
  await page.reload();
  await expect(page.getByRole("status")).toContainText(
    "Saved data was damaged",
  );
  assert.equal(
    await page.evaluate(() =>
      Object.keys(localStorage).some((k) => k.startsWith("covered:v1:backup:")),
    ),
    true,
  );
  assert.deepEqual(issues, [], "no uncaught browser errors");
  return {
    viewport: `${width}×${height}`,
    status: "passed",
    checks: [
      "sample A",
      "purchase and reserve",
      "consent",
      "unavailable AI",
      "confirmed test proposal",
      "persistence",
      "balance update",
      "quota fallback",
      "sample B",
      "duplicate import",
      "ambiguous dates",
      "partial CSV",
      "corrupt storage",
      "no horizontal overflow",
      "no browser exceptions",
    ],
  };
}
