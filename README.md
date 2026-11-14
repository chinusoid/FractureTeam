# Covered

**Know what's covered before you spend.**

A browser-local financial planner for one USD account. Import a CSV, review recurring bills, enter an available balance, and see what remains after bills, everyday spending, and your reserve. The design follows a quiet, monochrome workspace: white, pale cream `#f6f7ed`, thin borders, dark accents, a sidebar, and a radial allocation indicator.

## Run

Requires Node.js 20.9+ and npm. Dependencies are pinned by `app/package-lock.json`.

```sh
cd app
npm ci
npm run dev
```

Open the URL printed by Next.js (normally `http://localhost:3000`). For production, run `npm run build` and `npm start` from `app/`. Root scripts also forward `dev`, `build`, `test`, and `e2e` to the app.

## What's implemented

- English landing page, downloadable synthetic CSVs A and B, and sample onboarding through the real import screen.
- CSV upload and drag/drop, column mapping, amount sign, mandatory ambiguous-date selection, row errors, partial import, duplicate review, transfer flags, row exclusions, and SHA-256 re-import detection. Limits: 2 MB / 5,000 records.
- Suggested recurring bills, expected-paycheck period, an editable everyday-spending estimate, selectable/custom reserve, and explicit confirmation of bills and plan.
- Overview with available money, period, balance age, status, an expandable calculation, payment cards, allocation breakdown, recent transactions, and a purchase simulator.
- Bill creation, editing, deletion, and marking paid with an explicit question about whether the payment is already reflected in the entered balance.
- Balance-update preview, paid-bill checklist, optional everyday-spending allocation, overspending/income notices, and “Since last update”.
- Settings, new-period review, optional assistant consent, JSON export, confirmed data clearing, and versioned/validated local storage with corruption backup and visible failures.
- Responsive navigation, keyboard-accessible dialogs with focus trapping, reduced-motion support, and mobile layout at 390 px.

## Financial behavior

All money is stored as integer cents. Calendar dates use `YYYY-MM-DD`, displayed in en-US without timezone shifts.

```text
available = entered bank balance
          − unpaid confirmed bills due through the period end
          − remaining everyday spending
          − reserve
```

Overdue unpaid bills remain included. Bills beyond the period end are displayed separately. Past imported transactions and predicted income do not change the entered bank balance. Purchase checks are hypothetical. Bills, everyday-spending shortfalls, and reserve shortfalls have different explanations.

Sample A, generated relative to the browser's current date:

| Item                                               |                         Amount |
| -------------------------------------------------- | -----------------------------: |
| Entered balance                                    |                         $2,200 |
| Rent / car insurance / internet                    |            $1,100 / $150 / $50 |
| Everyday spending                                  |                           $350 |
| Reserve                                            |                           $250 |
| Available                                          |                       **$300** |
| Hypothetical purchase of $400                      | **−$100**, against the reserve |
| Insurance increased by $30                         |                       **$270** |
| Balance $950 after rent and $150 everyday spending |                       **$270** |

Sample A also contains later bills (outside the period) and a monthly transfer to savings that is flagged for review. Sample B comes from a different bank format (separate Debit/Credit columns, quoted amounts, a running balance) with a twice-a-month paycheck, so its period ends at the next payday and its result depends on the day. Both samples are synthetic and generated relative to today.

## CSV format

```csv
Date,Description,Amount
11/01/2026,OAKWOOD APARTMENTS ONLINE PMT,-1100.00
11/05/2026,ACME LOGISTICS PAYROLL PPD,2100.00
11/06/2026,GREENLEAF MARKET #0412,-65.40
```

or, with separate columns:

```csv
"Posting Date","Description","Debit","Credit","Balance"
11/05/2026,"RIVERBANK AUTO LOAN PMT","310.00",,"2,914.20"
10/31/2026,"NORTHSTAR HEALTH DIR DEP",,"1,850.00","3,224.20"
```

- Delimiters: comma, semicolon, tab or pipe. Quotes protect commas; a UTF-8 BOM is ignored.
- Columns are guessed from the header and can be changed: one signed amount column (you choose whether spending is negative or positive), or separate debit and credit columns.
- Dates: `YYYY-MM-DD`, `MM/DD/YYYY`, `M/D/YY`, `DD/MM/YYYY`. If both month-first and day-first fit every row, you must choose.
- Amounts: `-12.34`, `$1,234.56`, `(45.00)`, `45.00-`.
- Rows that cannot be read are listed with their row number and skipped. Same date + amount + description is flagged as a possible duplicate and kept unless you exclude it. Transfers (Zelle, Venmo, card payments, "transfer to savings") are flagged.
- Recurring bills are grouped by merchant (card numbers and reference codes are ignored), need at least two payments with a monthly, two-week or weekly rhythm, and keep the day of the month (Jan 31 → Feb 28 → Mar 31). Varying amounts, transfers and payments that probably happened after the file ends are called out on the bill card.
- The period ends at your next detected payday (weekly, every two weeks, twice a month or monthly), otherwise in two weeks. Everyday spending is estimated from the last 28 days of the file, without detected bills, transfers and one-off purchases of $400 or more, scaled to the period and rounded to $10. Review all estimates before confirming.

## Assistant integration status

The assistant server is part of this app (see "Assistant server" below). The browser speaks the shared contract `app/src/lib/schemas/assistant.ts` through `app/src/lib/client/assistant.ts`, which maps it to the UI; previews and confirmations are computed on the device. CSV import, recurring-bill detection and sample data use the shared modules in `app/src/lib/import` and `app/src/lib/demo`.

Tests: `npm run e2e` checks the UI with the assistant request intercepted inside the browser (and the "assistant unavailable" state against a server without a key); `npm run e2e:assistant` drives the real `/api/assistant` path with the deterministic mock model (`AI_MOCK=1 QUOTA_MODE=memory npm run dev`). Both run in CI.

## Data and privacy

CSV parsing and storage are local to the browser. The active state is a single validated document at `covered:v1`; invalid documents are backed up locally before a fresh state is created. Every storage access is guarded. The assistant is off until explicit consent, and only receives the context listed in its notice. Raw CSVs are never sent. Clearing data removes Covered's local documents, backups, and client identifier.

## Verification

```sh
cd app
npm test
npm run typecheck
npm run build
```

There are 29 automated unit tests for independent financial examples, CSV input, proposal application, persisted-data validation, and assistant request boundaries.

With the app running in another terminal:

```sh
cd app
npx playwright install chromium
npm run e2e
```

Use `BASE_URL=http://localhost:3001 npm run e2e` if the app uses another port. `CHROMIUM_PATH=/usr/bin/chromium` selects an installed Chromium. The suite uses disposable profiles at **1280×800** and **390×844**. It checks samples A/B, purchase effects, consent, unavailable AI, a confirmed test proposal, reload persistence, balance updates, quota fallback, duplicate import, ambiguous dates, partial CSV, corruption recovery, browser exceptions, and horizontal overflow. Screenshots are saved in `app/tests/e2e/screenshots/` (gitignored).

The interface was also inspected through **Playwright MCP**; Next.js documentation was checked through **Context7 MCP**. No external font or CDN is required at runtime.

## Remaining integration work

- Supply the shared base and reconcile its exported types and function signatures with the client adapter.
- Add the real assistant endpoint and its shared schema, privacy handling, quota enforcement, and server tests.
- Configure hosting separately; pushing this repository does not by itself create a public deployment.

Bank connections, login/sync, credit-card interest, payments, investment features, and JSON restoration are outside this client version.

## Assistant server

`POST /api/assistant` and `GET /api/health` run on the same Next.js app. The contract between the browser and the server is `app/src/lib/schemas/assistant.ts`. The browser adapter is `app/src/lib/client/assistant.ts`.

- The model only understands the request and calls one of four fixed server functions: plan summary, purchase check, propose a bill change, propose a new bill. Nothing is saved on the server. A change is applied only when the user presses **Confirm change** in the browser, which re-checks the plan version.
- Money is computed by `app/src/lib/finance` (shared, integer cents). Any dollar amount in the model's text that does not match a computed value is replaced with a template (`app/src/lib/ai/guard.ts`).
- Transaction descriptions and bill names are treated as data. Account numbers, card numbers, emails and phone numbers are removed before sending (`app/src/lib/ai/scrub.ts`).
- Quotas (`app/src/lib/limits`): global daily budget, per-IP per-minute and per-browser daily limits in Upstash Redis (REST). In production without Upstash the model is never called.

### Configure

```sh
cd app
cp .env.example .env.local   # OPENAI_API_KEY, OPENAI_MODEL, prices, Upstash, budget
```

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-6.1-sol`) | Model access. No automatic fallback: switch the model manually if the key has no access. |
| `OPENAI_REASONING_EFFORT` | `low` by default; `none` for models without reasoning |
| `AI_ENABLED` | `false` turns the assistant off; manual forms keep working |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Shared quota storage, required in production |
| `AI_DAILY_BUDGET_USD`, `AI_MAX_COST_PER_REQUEST_USD`, `AI_INPUT_PRICE_PER_MTOK`, `AI_OUTPUT_PRICE_PER_MTOK` | Budget; set prices from the provider's price list |
| `AI_IP_PER_MINUTE`, `AI_CLIENT_PER_DAY` | Soft limits (the venue network is shared) |
| `AI_MOCK=1`, `QUOTA_MODE=memory` | Local development and tests only; refused in production |

### Evaluate the assistant

```sh
cd app
npm run eval:ai                                            # mock model, no key needed
npx tsx --env-file=.env.local tests/ai-eval/run.ts         # real model: pass/fail, tokens, cost per task
npx tsx --env-file=.env.local tests/ai-eval/run.ts --repeat 3
```

The 25 scenarios in `tests/ai-eval/scenarios.ts` cover purchase phrasings, bill changes, unknown dates, two similar bills, wrong names, requests without data, API failures, prompt injection in transaction text, and the setup review of sample A (the savings transfer must not be called a bill).

On Vercel set the Root Directory to `app`, add the variables above, deploy, then open `/api/health`: it should show `"aiConfigured": true` and `"quota": "upstash"`.
