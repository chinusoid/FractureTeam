/**
 * How long the two things a user does take, and how much they have to do.
 *
 *   1. The first plan, from a bank CSV: the synthetic sample file uploaded as a file, the balance typed by hand.
 *   2. Coming back: an update after paying a bill, and the payday update that starts the next period.
 *
 * Two modes. Neither is a study with users; each prints exactly what it measured.
 *
 *   npm run measure                 a script does the steps. It counts what a person has to do (clicks, ticks,
 *                                   typed characters, files) and times the product's own share: page work only,
 *                                   no reading and no thinking.
 *   npm run measure -- --person     a person does the steps in the window that opens; the script only keeps
 *                                   time, from their first click or key to the new number on the screen.
 *
 * BASE_URL picks the site (default http://localhost:3000). /api/plus is answered locally, so a run never
 * touches the deployment's Plus counter.
 */
import { chromium, expect, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateSampleCsv } from "../../src/lib/client/model";

const baseURL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const person = process.argv.includes("--person");
const RUNS = Number(process.env.RUNS ?? (person ? 1 : 7));
/** How long to wait for the new number: a person may take minutes, a script should not. */
const WAIT = person ? 600_000 : 20_000;

type Counts = { clicks: number; ticks: number; keys: number; fields: number; files: number };
const zero = (): Counts => ({ clicks: 0, ticks: 0, keys: 0, fields: 0, files: 0 });

/** Every action goes through here, so the count is what a person would have to do. */
function hands(counts: Counts) {
  return {
    click: async (target: Locator) => {
      counts.clicks += 1;
      await target.click();
    },
    tick: async (target: Locator) => {
      counts.ticks += 1;
      await target.check();
    },
    type: async (target: Locator, text: string) => {
      counts.fields += 1;
      counts.keys += text.length;
      await target.fill(text);
    },
    file: async (target: Locator, file: string) => {
      counts.files += 1;
      await target.setInputFiles(file);
    },
  };
}

const back = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const seconds = (ms: number) => (ms / 1000).toFixed(1);

/** A built sample plan in this page, without counting or timing anything. */
async function seedPlan(page: Page) {
  await page.goto(baseURL);
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => localStorage.setItem("covered:plus", "early-access"));
  await page.reload();
  await page.getByRole("button", { name: "Try sample data", exact: true }).click();
  await page.getByRole("button", { name: "Continue to setup" }).click();
  const confirms = page.getByRole("button", { name: "Confirm", exact: true });
  await expect(confirms.first()).toBeVisible();
  while (await confirms.count()) await confirms.first().click();
  await page.getByRole("button", { name: "Build my plan", exact: true }).click();
  await expect(page.getByTestId("plan-remainder")).toHaveText("$300");
}

/** Payday has passed: every date in the saved plan moves back, as if the plan were 11 days older. */
async function paydayPassed(page: Page) {
  const s = JSON.parse(await page.evaluate(() => localStorage.getItem("covered:v1")!));
  s.plan.balanceDate = back(s.plan.balanceDate, 11);
  if (s.plan.periodStartDate) s.plan.periodStartDate = back(s.plan.periodStartDate, 11);
  s.plan.horizonEndDate = back(s.plan.horizonEndDate, 11);
  for (const b of s.bills) b.dueDate = back(b.dueDate, 11);
  await page.evaluate((json) => localStorage.setItem("covered:v1", json), JSON.stringify(s));
  await page.reload();
  await expect(page.getByTestId("update-first")).toContainText("Payday has passed");
}

type Scenario = {
  key: string;
  title: string;
  /** What the person is told to do in --person mode. */
  ask: (csv: string) => string;
  prepare: (page: Page) => Promise<void>;
  steps: (page: Page, h: ReturnType<typeof hands>, csv: string) => Promise<void>;
  done: (page: Page) => Promise<void>;
};

const SCENARIOS: Scenario[] = [
  {
    key: "first-plan",
    title: "First plan from a bank CSV",
    ask: (csv) =>
      `Build a plan from a file: Import transactions → choose ${csv} → Continue to setup → type the balance 2200 → Confirm 7 bills → Confirm the transfer that is left → Build my plan.`,
    prepare: async (page) => {
      await page.goto(baseURL);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await expect(page.getByRole("button", { name: "Import transactions" }).first()).toBeVisible();
    },
    steps: async (page, h, csv) => {
      await h.click(page.getByRole("button", { name: "Import transactions" }).first());
      await h.file(page.getByLabel("Upload transactions CSV"), csv);
      await h.click(page.getByRole("button", { name: "Continue to setup" }));
      await h.type(page.locator("#balance"), "2200");
      await h.click(page.getByRole("button", { name: /^Confirm \d+ bills$/ }));
      // A suggestion with a note (the transfer to savings) is left for the person: one more decision each.
      const left = page.getByRole("button", { name: "Confirm", exact: true });
      while (await left.count()) await h.click(left.first());
      await h.click(page.getByRole("button", { name: "Build my plan", exact: true }));
    },
    done: async (page) => {
      await expect(page.getByTestId("plan-remainder")).toBeVisible({ timeout: WAIT });
    },
  },
  {
    key: "update-after-bill",
    title: "Update after paying a bill (mid-period)",
    ask: () => "Rent has gone out. Update balance → type 1100 → tick Oakwood Apartments → Confirm update.",
    prepare: seedPlan,
    steps: async (page, h) => {
      await h.click(page.getByRole("button", { name: "Update balance", exact: true }));
      await h.type(page.getByLabel("New available balance"), "1100");
      await h.tick(page.locator(".payment-checklist label", { hasText: "Oakwood Apartments" }).first().locator("input"));
      await h.click(page.getByRole("button", { name: "Confirm update", exact: true }));
    },
    done: async (page) => {
      await expect(page.locator(".last-update")).toContainText("Oakwood Apartments marked paid", { timeout: WAIT });
      await expect(page.getByTestId("plan-remainder")).toBeVisible();
    },
  },
  {
    key: "payday-update",
    title: "Payday update: start the next period",
    ask: () =>
      "Payday. Update now → type 2900 → tick the three bills that were due (insurance, rent, internet) → Start next period. The next payday and everyday spending are already filled in.",
    prepare: async (page) => {
      await seedPlan(page);
      await paydayPassed(page);
    },
    steps: async (page, h) => {
      await h.click(page.getByRole("button", { name: "Update now", exact: true }));
      await h.type(page.getByLabel("New available balance"), "2900");
      const state = await page.evaluate(() => JSON.parse(localStorage.getItem("covered:v1")!));
      const due = state.bills.filter((b: { status: string; dueDate: string }) => b.status === "confirmed" && b.dueDate <= state.plan.horizonEndDate);
      for (const b of due) await h.tick(page.locator(".payment-checklist label", { hasText: b.name }).first().locator("input"));
      await h.click(page.getByRole("button", { name: "Start next period", exact: true }));
    },
    done: async (page) => {
      await expect(page.getByTestId("period-recap")).toBeVisible({ timeout: WAIT });
      await expect(page.getByTestId("plan-remainder")).toBeVisible();
    },
  },
];

async function main() {
  const dir = path.join(os.tmpdir(), "covered-measure");
  await mkdir(dir, { recursive: true });
  const csv = path.join(dir, "covered-sample.csv");
  await writeFile(csv, generateSampleCsv("A"));

  const browser = await chromium.launch({
    headless: !person,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  const results: Record<string, unknown>[] = [];
  try {
    for (const scenario of SCENARIOS) {
      const times: number[] = [];
      let counts = zero();
      for (let run = 0; run < RUNS; run++) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        await context.route("**/api/plus", (route) =>
          route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ interested: 0 }) }),
        );
        const page = await context.newPage();
        try {
          await scenario.prepare(page);
          if (person) {
            // The clock starts at the person's first click or key and stops when the new number is on the screen.
            // A plain string: nothing here is rewritten by the TypeScript runner before it reaches the page.
            await page.evaluate(
              "(() => { const mark = () => { if (window.__firstAction === undefined) window.__firstAction = Date.now(); };" +
                " addEventListener('pointerdown', mark, true); addEventListener('keydown', mark, true); })()",
            );
            console.log(`\n[${scenario.title}] run ${run + 1} of ${RUNS}\n  ${scenario.ask(csv)}\n  The clock starts at your first click.`);
            await scenario.done(page);
            const end = Date.now();
            const start = await page.evaluate(() => (window as unknown as { __firstAction?: number }).__firstAction);
            if (start === undefined) throw new Error("No click or key was seen before the plan appeared.");
            times.push(end - start);
            console.log(`  ${seconds(end - start)} s`);
          } else {
            counts = zero();
            const start = Date.now();
            await scenario.steps(page, hands(counts), csv);
            await scenario.done(page);
            times.push(Date.now() - start);
          }
        } finally {
          await context.close();
        }
      }
      results.push({
        scenario: scenario.title,
        mode: person ? "a person did the steps; the script kept time" : "a script did the steps: the product's own share of the time",
        runs: RUNS,
        medianSeconds: Number(seconds(median(times))),
        minSeconds: Number(seconds(Math.min(...times))),
        maxSeconds: Number(seconds(Math.max(...times))),
        ...(person ? {} : { whatAPersonDoes: counts }),
      });
    }
  } finally {
    await browser.close();
  }
  console.log(
    JSON.stringify(
      {
        site: baseURL,
        conditions: `synthetic sample CSV (${path.basename(csv)}), desktop Chromium 1280×800, ${person ? "one person who knows the product" : "no person"}`,
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
