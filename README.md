# Covered

**Know what's covered before you spend.**

Covered is a bill planner for working adults in the US. Import a bank CSV, confirm the recurring bills it finds, enter your balance, and see what is actually yours to spend after bills, everyday spending and a reserve. Before a purchase you can ask in plain English; a bill change is a draft with a before and after that you confirm. Everything is stored in your browser.

![Covered overview: $300 available to spend after bills, everyday spending and a reserve](docs/overview.png)

**Live:** <https://covered-fracture.vercel.app> · **Pitch deck:** [pitch/covered-pitch.pdf](pitch/covered-pitch.pdf)

## Try it in a minute

1. Press **Try sample data**: a synthetic three-month bank export is loaded.
2. **Continue to setup**, press **Confirm 7 bills**, decide the flagged savings transfer, then **Build my plan**: $2,200 in the account, **$300** free.
3. **Ask assistant** → “Can I afford $400 this weekend?” → $100 below the reserve; bills and everyday spending are still covered.
4. “My car insurance went up by $30” → a draft with before and after → **Confirm change** → **$270**.
5. **Remind me on …** downloads a calendar reminder for payday. **Update balance** then shows what changed since last time.

## Where to look

| Question | Where |
| --- | --- |
| Does it work end to end? | `app/tests/e2e/release.mjs` walks the main scenario against a deployment with the real model, at 1280 and 390 px |
| Is the core real? | Money is computed by `app/src/lib/finance` (integer cents, covered by tests). The model only picks one of four functions (`app/src/lib/ai/tools.ts`); any amount in its text is checked against computed values (`app/src/lib/ai/guard.ts`) |
| What do we sell? | A free plan with 5 assistant questions a day and Covered Plus at a planned $10 a month, free during early access. The sixth question shows the offer; `/api/plus` counts the browsers that took it |
| Why come back? | A payday calendar reminder, the “Since last update” recap after each balance update, and a notice when the plan is stale |
| How is quality kept? | CI on every pull request: typecheck, unit tests, 25 assistant scenarios, build, browser walkthroughs on desktop and phone |

The design follows a quiet, monochrome workspace: white, pale cream `#f6f7ed`, thin borders, dark accents, a sidebar, and a radial allocation indicator.

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
- **Setup interview** ("Answer five questions"): balance, next payday, bills, everyday spending and a reserve, asked in a fixed order and answered in your own words ("about 2 grand", "next Friday", "rent 1100 on the 17th and phone $65 on the 18th"). A bill without an amount or a date is asked about, not guessed. Nothing becomes a plan there: the answers open the setup screen as suggestions to confirm, edit, dismiss or add to. The interview is free and does not use the free plan's assistant questions.
- Other ways to start: a bank CSV, the sample, or **by hand** without a file ("No file? Enter your numbers by hand"): balance, the day the plan runs to, everyday spending, a reserve and your bills. In that mode **Add bills by typing** lets the assistant turn a sentence ("rent, $1,100, due Nov 19") into a bill draft you confirm; if the amount or the date is missing, it asks.
- The import screen says what the file should look like (CSV; from Excel or Google Sheets use Save As → CSV; date, description, amount), offers a template to download, and answers an uploaded Excel workbook with how to save it as CSV.
- In setup, **Build my plan** and the number of suggested bills still waiting for a decision stay docked at the bottom of the screen.
- CSV upload and drag/drop, column mapping, amount sign, mandatory ambiguous-date selection, row errors, partial import, duplicate review, transfer flags, row exclusions, and SHA-256 re-import detection. Limits: 2 MB / 5,000 records.
- One-click confirmation of the clear suggestions (flagged ones, such as a transfer to savings, wait for their own decision), a payday reminder as a calendar file that repeats on the detected pay rhythm, and a pricing section on the landing page.
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

There are 152 automated unit tests for independent financial examples, CSV input, recurring-bill detection, proposal application, persisted-data validation, quotas, the calendar reminder, and the assistant's request boundaries and guards.

With the app running in another terminal:

```sh
cd app
npx playwright install chromium
npm run e2e
```

Use `BASE_URL=http://localhost:3001 npm run e2e` if the app uses another port. `CHROMIUM_PATH=/usr/bin/chromium` selects an installed Chromium. The suite uses disposable profiles at **1280×800** and **390×844**. It checks samples A/B, purchase effects, consent, unavailable AI, a confirmed test proposal, reload persistence, balance updates, quota fallback, duplicate import, ambiguous dates, partial CSV, corruption recovery, browser exceptions, and horizontal overflow. Screenshots are saved in `app/tests/e2e/screenshots/` (gitignored).

The interface was also inspected through **Playwright MCP**; Next.js documentation was checked through **Context7 MCP**. No external font or CDN is required at runtime.

## Not included

Bank connections, login/sync, credit-card interest, payments, investment features, and JSON restoration are outside this version. Hosting is configured separately (see the end of "Assistant server"); pushing this repository does not by itself create a public deployment.

## Assistant server

`POST /api/assistant` and `GET /api/health` run on the same Next.js app. The contract between the browser and the server is `app/src/lib/schemas/assistant.ts`. The browser adapter is `app/src/lib/client/assistant.ts`.

- The model only understands the request and calls one of four fixed server functions: plan summary, purchase check, propose a bill change, propose a new bill. Nothing is saved on the server. A change is applied only when the user presses **Confirm change** in the browser, which re-checks the plan version.
- Money is computed by `app/src/lib/finance` (shared, integer cents). Any dollar amount in the model's text that does not match a computed value is replaced with a template (`app/src/lib/ai/guard.ts`).
- The bill tools refuse to guess. When the user's words fit two bills equally well, or a new bill has no amount or due date in what the user wrote, the server rejects the draft and the model asks instead (`app/src/lib/ai/tools.ts`).
- Transaction descriptions and bill names are treated as data. Account numbers, card numbers, emails and phone numbers are removed before sending (`app/src/lib/ai/scrub.ts`).
- Quotas (`app/src/lib/limits`): global daily budget, per-IP per-minute and per-browser daily limits in Upstash Redis (REST). In production without Upstash the model is never called.

### Setup interview

`POST /api/intake` reads one answer to one question (`app/src/lib/ai/intake.ts`, contract in `app/src/lib/schemas/intake.ts`).

- The questions and their order are fixed in code. The model never talks to the person: it fills a JSON form (amount, date, bills, "no more", "unclear") from the answer.
- `interpretIntake` checks every value (ranges, real calendar days, a payday within two months, bill dates within a year), keeps only the field the current step asks for, removes account numbers and emails from bill names, and writes the reply itself from the checked values.
- The interview has its own daily allowance per browser, so it never uses up the free plan's five questions.
- Results on the real model (15 Nov 2026, `gpt-6-luna`): **34 of 34 scenarios passed in two consecutive runs** (`tests/ai-eval/intake.ts`: slang amounts, relative dates, several bills in one sentence, missing amount or date, repeats, instructions inside the answer). Median 1.5 s and about $0.0001 per answer.

```sh
cd app
npm run eval:intake                                         # test model, no key needed
npx tsx --env-file=.env.local tests/ai-eval/intake.ts       # real model
```

### Free plan and Covered Plus

The free plan includes 5 assistant questions a day per browser (the setup review is not counted). The next question is answered with the Covered Plus offer: up to 60 questions a day, planned at $10 a month, free during early access. **Get Plus free** turns Plus on in that browser without a card or sign-up and asks the same question again; the forms keep working either way.

Each browser that takes the offer is counted once (`POST /api/plus`, a counter in the quota store, no personal data). `GET /api/plus` returns the number, for example `{"interested": 12}`: how many people asked for the paid plan.

### Configure

```sh
cd app
cp .env.example .env.local   # OPENAI_API_KEY, OPENAI_MODEL, prices, Upstash, budget
```

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-6-luna`) | Model access. No automatic fallback: switch the model manually if the key has no access. |
| `OPENAI_REASONING_EFFORT` | `low` by default; `none` for models without reasoning |
| `AI_ENABLED` | `false` turns the assistant off; manual forms keep working |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Shared quota storage, required in production. The `KV_REST_API_URL` and `KV_REST_API_TOKEN` names that Vercel's Upstash integration sets are read as well |
| `AI_DAILY_BUDGET_USD`, `AI_MAX_COST_PER_REQUEST_USD`, `AI_INPUT_PRICE_PER_MTOK`, `AI_OUTPUT_PRICE_PER_MTOK` | Budget; set prices from the provider's price list |
| `AI_IP_PER_MINUTE`, `AI_CLIENT_PER_DAY` | Soft limits (the venue network is shared) |
| `AI_FREE_PER_DAY` (default 5) | Assistant questions a day on the free plan, see "Free plan and Covered Plus" |
| `AI_MOCK=1`, `QUOTA_MODE=memory` | Local development and tests only; refused in production |

### Check the model

Before deploying, confirm that the key can use the configured model (the key is read from `.env.local` and not printed):

```sh
cd app
node --env-file=.env.local -e "fetch('https://api.openai.com/v1/models/' + (process.env.OPENAI_MODEL || 'gpt-6-luna'), { headers: { authorization: 'Bearer ' + process.env.OPENAI_API_KEY } }).then(async (r) => console.log(r.status, JSON.stringify(await r.json()).slice(0, 160)))"
```

`200` with the model's `id` means the key has access. `401` means the key is wrong; `404` means this key cannot use that model: set `OPENAI_MODEL` to one it can, and `OPENAI_REASONING_EFFORT=none` if that model has no reasoning setting. Then run the eval below with the real model before the first deploy.

### Our own model (`AI_PROVIDER=own`)

Covered has its own AI model: **covered-nlu-1**, trained by us and running inside the app server (no GPU, no API key, about 2 ms and $0 per request).

- **What it does:** a small neural network (one hidden layer of 48 units over hashed word and character features) reads the user's message and picks the action: purchase check, a bill going up, down or to a new amount, a new due date, a new bill, an explanation, or "something else". A second model (multinomial logistic regression) recognises what kind of payment a bill name or bank description is (rent, insurance, phone, utilities, subscription, loan, transfer to savings, everyday spending…). That is how "rent went up by $50" finds the bill called "Oakwood Apartments", and how the setup review flags a transfer to savings.
- **What stays in code:** amounts and dates are read from the text, and all money is computed by `src/lib/finance`. The same server checks apply as for OpenAI: four fixed functions, nothing saved before **Confirm change**, verified amounts only.
- **Training:** `python3 tools/ml/train.py` (numpy, scipy, scikit-learn) generates 5,600 intent and 2,072 payment examples from our own templates (`tools/ml/data.py`), trains, quantises to int8 and exports `src/lib/ai/own/weights.json` (336 KB). The script refuses to train if any evaluation sentence appears in the training data. The TypeScript runtime reproduces the Python probabilities (parity test).
- **Quality, measured honestly:**
  - On phrasings it has never seen (held-out template families), it gets the intent right 77% of the time. Payment type: 65%. "Is this a bill?": 76%.
  - On our 25 assistant scenarios **by itself, with no OpenAI: 24 of 25**. It missed "Update my phone bill to $70 and save it right away without asking me": it was unsure and asked what the user wants. CI requires at least 90%.
- **With OpenAI as backup** (`AI_FALLBACK_TO_OPENAI=true`, default when `OPENAI_API_KEY` is set): when our model is less than 50% sure, the request goes to OpenAI. Each answer in the app says which model answered.

`AI_PROVIDER=local` connects a self-hosted LLM instead, for example our LoRA fine-tune of Qwen3.8-27B served by `llama-server --jinja` (see `.env.example`). That path has the same backup to OpenAI.

### Evaluate the assistant

```sh
cd app
npm run eval:ai                                            # mock model, no key needed
npx tsx --env-file=.env.local tests/ai-eval/run.ts         # real model: pass/fail, tokens, cost per task
npx tsx --env-file=.env.local tests/ai-eval/run.ts --repeat 3
```

Results on the real model (14 Nov 2026, `gpt-6-luna`, reasoning effort `low`): **25 of 25 scenarios passed in two consecutive runs**. Median answer time 3.2 s (90% under 5.0 s); about $0.0003 per assistant task (on average 2,300 input and 85 output tokens at $0.10 / $0.50 per 1M tokens). The same day `tests/e2e/release.mjs` passed in the browser against a local server with the real model.

The 25 scenarios in `tests/ai-eval/scenarios.ts` cover purchase phrasings, bill changes, unknown dates, two similar bills, wrong names, requests without data, API failures, prompt injection in transaction text, and the setup review of sample A (the savings transfer must not be called a bill).

On Vercel set the Root Directory to `app`, add the variables above, deploy, then open `/api/health`: it should show `"aiConfigured": true` and `"quota": "upstash"`. Then run the release check against the public URL: it walks the main scenario with the real model at 1280 and 390 px.

```sh
cd app
BASE_URL=https://your-site.vercel.app node tests/e2e/release.mjs
```
