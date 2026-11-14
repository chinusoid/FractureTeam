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
| Rent / car insurance / internet                    |            $1,100 / $120 / $80 |
| Everyday spending                                  |                           $350 |
| Reserve                                            |                           $250 |
| Available                                          |                       **$300** |
| Hypothetical purchase of $400                      | **−$100**, against the reserve |
| Insurance increased by $30                         |                       **$270** |
| Balance $950 after rent and $150 everyday spending |                       **$270** |

Sample B independently produces **$780** from a $3,100 balance, $1,605 bills, $465 everyday spending, and a $250 reserve.

## CSV format

```csv
Date,Description,Amount
2026-11-01,Rent,-1100.00
2026-11-05,Payroll,2500.00
2026-11-06,Groceries,-65.40
```

Comma or semicolon delimiters are supported. Dates can use ISO, US month/day/year, or day/month/year after an explicit selection. Quotes protect descriptions containing commas. Separate debit/credit columns must first be combined into one signed amount column. Possible duplicates are kept by default. Transfer rows are retained and flagged; they do not drive recurring-bill or everyday-spending estimates. The estimate uses a 14-day historical window and excludes nonrecurring purchases of $200 or more, showing the excluded items. Review all estimates before confirming.

## Assistant integration status

**The shared `covered-base.zip` was not available and the repository was initially empty.** This implementation therefore keeps a standalone, tested client adapter in `app/src/lib/client/model.ts`. It creates no files in the other participant's `finance`, `import`, `demo`, `schemas`, `ai`, `limits`, or `app/api` directories. When the shared base arrives, map this adapter to its exports and reconcile its state schema before merging that package.

**There is no AI server in this repository yet.** The assistant UI sends requests only after consent to `POST /api/assistant`, with `x-client-id`, validates the response with Zod, computes proposal previews locally, and rejects stale, duplicate, or invalid confirmations. An absent endpoint and quota/service failures have actionable fallbacks. All manual flows work without AI. No API key is needed for the client.

The provisional request/response contract is in `app/src/lib/client/assistant.ts`. It must be reconciled with the shared `schemas/assistant.ts` by the backend participant. The request contains `mode`, `message`, `consent`, `stateVersion`, and `context` (`plan`, limited `bills`, and setup-only recurring evidence). Accepted response kinds: `answer`, `question`, `simulation`, `change_proposal`, `setup`. A change proposal contains `id`, `stateVersion`, `billId`, and `amountCents`. Server-side quota enforcement and the real model connection belong to that integration.

The e2e suite intercepts the assistant request **inside its disposable browser context** to verify the insurance confirmation. This is a test fixture, not a deployed mock or a real AI integration.

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
