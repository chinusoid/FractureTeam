# Covered — know what's covered before you spend

Covered turns your recent bank transactions into a checkable plan for the current pay period: which required bills are covered, how much is left after bills, everyday spending and a reserve you choose, and what a purchase would change **before** you make it. An optional AI assistant helps you set things up, checks purchases and drafts bill changes. Nothing changes until you confirm.

Built for Business Cup 2.0, Money track. Working adults in the US, web, B2C.

> Demo data is synthetic. Covered is not financial advice and does not move money.

## Try it

1. Open the site and choose **Try sample data**. No sign-up.
2. Confirm the import. Confirm the suggested bills, keep the sample balance ($2,200) and the $250 reserve, then **Build my plan**.
3. The home screen shows **$300 left** for the period. Check a $400 purchase: the plan shows −$100, which is $100 below your reserve, while bills and everyday spending are still covered.
4. Tell the assistant "My car insurance went up by $30". Review the before/after card and confirm. The remainder becomes $270.
5. **Update balance**: enter $950, mark rent as paid and confirm $150 as everyday spending. The remainder stays $270, and the "Since last update" card shows what changed.

The landing page also offers two downloadable sample CSVs from different "banks" (amount column vs. debit/credit columns) to test the import with other data.

## Run locally

Requires Node.js 20.9 or newer.

```bash
npm install
cp .env.example .env.local   # fill in the values, see below
npm run dev                  # http://localhost:3000
```

Without an OpenAI key the whole manual flow works. The assistant shows a clear "AI unavailable" state and the forms stay usable.

| Command | What it does |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Next.js dev server / production build / production server |
| `npm test` | Unit tests: money rules, import, recurring detection, assistant server, quotas |
| `npm run typecheck` | TypeScript check |
| `npm run eval:ai` | Assistant evaluation scenarios. Uses the real model when `OPENAI_API_KEY` is set and prints pass/fail, tokens and estimated cost per task. |
| `npm run e2e` | Browser walkthrough at 390 px and desktop (Playwright, needs `npx playwright install chromium` once) |

## Environment

See `.env.example`. Server-only values, never prefixed with `NEXT_PUBLIC_`, never committed.

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Model access (server only) |
| `OPENAI_MODEL` | Model id, default `gpt-6.1-sol`. If the account has no access, set another model you have verified. There is no automatic fallback. |
| `OPENAI_REASONING_EFFORT` | `low` by default; empty or `none` for models without reasoning |
| `AI_ENABLED` | `false` turns the assistant off (redeploy needed). Manual flow keeps working. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Shared quota storage. Required in production: without it the assistant does not call the model. |
| `AI_DAILY_BUDGET_USD`, `AI_MAX_COST_PER_REQUEST_USD` | Global daily budget; each request reserves the maximum cost first, then settles with real token usage |
| `AI_INPUT_PRICE_PER_MTOK`, `AI_OUTPUT_PRICE_PER_MTOK` | Model prices in USD per 1M tokens. Set them from the provider's current price list. |
| `AI_IP_PER_MINUTE`, `AI_CLIENT_PER_DAY` | Soft limits per network address and per browser |
| `ALLOWED_ORIGINS` | Optional comma-separated extra origins allowed to call the API |
| `QUOTA_MODE=memory` | Local development only, refused in production |
| `AI_MOCK=1` | Deterministic fake model for tests, refused in production |

Also set a spending limit for the OpenAI project in the provider dashboard if your account supports a hard cap.

## Deploy (Vercel)

1. Push the repository to GitHub.
2. In Vercel, import the repository and set **Root Directory** to `app`.
3. Add the environment variables above in Production, then deploy.
4. Open `/api/health` on the deployed URL. It shows only booleans: AI configured, quota storage, model set.
5. Walk through the demo on a phone and on a laptop.

## CSV format

- Must have a date, a description and either one amount column or separate debit and credit columns. The app guesses the columns, and you can change them.
- Dates: `MM/DD/YYYY`, `M/D/YY`, `YYYY-MM-DD`. If both month-first and day-first fit every row, you must choose the format.
- Amounts: `-12.34`, `$1,234.56`, `(45.00)`, `45.00-`. For a single amount column you choose whether negative means money out (default) or the opposite.
- Limits: 2 MB, 5,000 rows, USD only, one account.
- Rows that cannot be read are listed with their row number. Same date + amount + description is flagged as a possible duplicate and kept unless you exclude it. Transfers (Zelle, Venmo, "transfer to savings", card payments) are flagged.

## How the numbers work

```text
left for the period = current available balance
                    − unpaid confirmed bills due on or before the period end
                    − remaining everyday spending for the period
                    − the reserve you chose
purchase check      = left for the period − purchase amount   (nothing is saved)
```

- Money is stored as integer cents. The period includes today and the end date (by default your next detected payday). Expected pay is never added before it arrives.
- Status is decided in order: short for bills → short for everyday spending → below your reserve → on track. If money is short for bills, the app shows the shortfall and does not pick which bill to skip.
- Negative results are shown as they are, never rounded up to zero.
- Imported history is used only to find patterns. It is never subtracted from the balance you enter.
- Marking a bill paid asks whether the payment is already reflected in the balance you entered, so it is never counted twice. Recurring bills get their next occurrence automatically.
- Updating the balance: bills you mark paid are closed. The unexplained decrease is offered as everyday spending, and anything above the everyday budget is shown separately. A higher-than-expected balance prompts a question and a new period.
- Pre-filled values (period end, everyday spending, reserve) are marked as estimates until you confirm them. Everyday spending is estimated from the last 28 days of the file, excluding detected bills, transfers and one-off purchases of $400 or more.

All of this lives in `src/lib/finance` and is shared by the browser and the server.

## Assistant and your data

- The CSV is parsed in your browser. Transactions, bills and your plan are stored in this browser only (`localStorage`). **Settings → Clear local data** removes them. Use **Export** to move a plan.
- The assistant is off until you agree. Before the first request you see what is sent:
  - **Setup review:** up to 30 detected recurring payments, with up to 3 example descriptions each. Account numbers, card numbers, emails and phone numbers are removed first. This is best-effort, not full anonymity.
  - **Chat:** today's date, your plan values (balance, period, everyday budget, reserve), your bills (name, amount, due date, status) and the last few messages.
- The model can only call four fixed functions: plan summary, purchase check, propose a bill change, propose a new bill. None of them saves anything. Saving happens only when you press **Confirm**, which re-checks the plan version, so a repeated or outdated confirmation cannot change your data twice.
- Dollar amounts shown in cards come from the calculation module. Any amount in the assistant's text that does not match a computed value is replaced with a templated message.
- Text from transactions and bill names is treated as data, never as instructions.
- The app server does not store statements or conversations. Quota counters in Redis keep only technical identifiers with short expiry. The model provider processes what is sent under its own terms.

## Project layout

```text
app/
  src/app/                 Next.js routes: one client app page + /api/assistant + /api/health
  src/components/          screens and cards
  src/lib/finance/         money rules, plan calculation, proposals, balance updates
  src/lib/import/          CSV reader, column mapping, recurring bills, pay day, estimates
  src/lib/ai/              assistant server: prompts, tools, model client, guards
  src/lib/limits/          quotas and daily budget
  src/lib/storage/         versioned localStorage document
  src/lib/schemas/         request/response contract (zod)
  src/lib/demo/            synthetic sample data
  tests/unit, tests/e2e, tests/ai-eval
  tools/harness/           tiny server used by the browser tests
```

## Known limits

One cash account, USD, English UI. No credit-card balances, interest or bank connections yet. Data does not sync between devices. Results are only as good as the balance and bills you confirm.
