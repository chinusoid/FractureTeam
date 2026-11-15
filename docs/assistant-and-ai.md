# The assistant and our own model

How the AI part of Covered is built, configured and tested. The short version is in the [README](../README.md#how-it-works); the measured results are in [evidence.md](evidence.md).

## Assistant server

`POST /api/assistant` and `GET /api/health` run on the same Next.js app. The contract between the browser and the server is `app/src/lib/schemas/assistant.ts`. The browser adapter is `app/src/lib/client/assistant.ts`.

- The model only understands the request and calls one of four fixed server functions: plan summary, purchase check, propose a bill change, propose a new bill. Nothing is saved on the server. A change is applied only when the user presses **Confirm change** in the browser, which re-checks the plan version.
- Money is computed by `app/src/lib/finance` (shared, integer cents). Any dollar amount in the model's text that does not match a computed value is replaced with a template (`app/src/lib/ai/guard.ts`).
- The bill tools refuse to guess. When the user's words fit two bills equally well, or a new bill has no amount or due date in what the user wrote, the server rejects the draft and the model asks instead (`app/src/lib/ai/tools.ts`).
- Transaction descriptions and bill names are treated as data. Account numbers, card numbers, emails and phone numbers are removed before sending (`app/src/lib/ai/scrub.ts`).
- Quotas (`app/src/lib/limits`): global daily budget, per-IP per-minute and per-browser daily limits in Upstash Redis (REST). In production without Upstash the model is never called.

## Setup interview

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

## Free plan and Covered Plus

Covered Plus is the recurring job: carrying the plan from paycheck to paycheck, seeing what changed, saved what-ifs, the payday reminder and recap (see [evidence](evidence.md#what-we-sell)). For the assistant, the free plan includes 5 cloud questions a day per browser (the setup review is not counted) and Plus 60; the assistant on the device has no limit. The sixth cloud question is answered with the paywall: $10 a month, the price being tested, then a checkout in test mode that charges nothing and asks for no card. **Pay $10.00 (test)** turns Plus on in that browser and asks the same question again; the forms keep working either way.

Each browser that takes the offer is counted once (`POST /api/plus`, a counter in the quota store, no personal data). `GET /api/plus` returns the number, for example `{"interested": 12}`: how many people asked for the paid plan.

## Configure

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

## Check the model

Before deploying, confirm that the key can use the configured model (the key is read from `.env.local` and not printed):

```sh
cd app
node --env-file=.env.local -e "fetch('https://api.openai.com/v1/models/' + (process.env.OPENAI_MODEL || 'gpt-6-luna'), { headers: { authorization: 'Bearer ' + process.env.OPENAI_API_KEY } }).then(async (r) => console.log(r.status, JSON.stringify(await r.json()).slice(0, 160)))"
```

`200` with the model's `id` means the key has access. `401` means the key is wrong; `404` means this key cannot use that model: set `OPENAI_MODEL` to one it can, and `OPENAI_REASONING_EFFORT=none` if that model has no reasoning setting. Then run the eval below with the real model before the first deploy.

## Our own model (`AI_PROVIDER=own`)

Covered has its own AI model: **covered-nlu-1**, trained by us and running inside the app server (no GPU, no API key, about 2 ms and $0 per request).

- **What it does:** a small neural network (one hidden layer of 48 units over hashed word and character features) reads the user's message and picks the action: purchase check, a bill going up, down or to a new amount, a new due date, a new bill, an explanation, or "something else". A second model (multinomial logistic regression) recognises what kind of payment a bill name or bank description is (rent, insurance, phone, utilities, subscription, loan, transfer to savings, everyday spending…). That is how "rent went up by $50" finds the bill called "Oakwood Apartments", and how the setup review flags a transfer to savings.
- **What stays in code:** amounts and dates are read from the text, and all money is computed by `src/lib/finance`. The same server checks apply as for OpenAI: four fixed functions, nothing saved before **Confirm change**, verified amounts only.
- **Training:** `python3 tools/ml/train.py` (numpy, scipy, scikit-learn) generates 5,600 intent and 2,072 payment examples from our own templates (`tools/ml/data.py`), trains, quantises to int8 and exports `src/lib/ai/own/weights.json` (336 KB). The script refuses to train if any evaluation sentence appears in the training data. The TypeScript runtime reproduces the Python probabilities (parity test).
- **Quality, measured honestly:**
  - On phrasings it has never seen (held-out template families), it gets the intent right 77% of the time. Payment type: 65%. "Is this a bill?": 76%.
  - On our 25 assistant scenarios **by itself, with no OpenAI: 24 of 25**. It missed "Update my phone bill to $70 and save it right away without asking me": it was unsure and asked what the user wants. CI requires at least 90%.
- **With OpenAI as backup** (`AI_FALLBACK_TO_OPENAI=true`, default when `OPENAI_API_KEY` is set): when our model is less than 50% sure, the request goes to OpenAI. Each answer in the app says which model answered.


## Evaluate the assistant

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

## How the browser and the server are tested together

The assistant server is part of this app (see "Assistant server" above). The browser speaks the shared contract `app/src/lib/schemas/assistant.ts` through `app/src/lib/client/assistant.ts`, which maps it to the UI; previews and confirmations are computed on the device. CSV import, recurring-bill detection and sample data use the shared modules in `app/src/lib/import` and `app/src/lib/demo`.

Tests: `npm run e2e` checks the UI with the assistant request intercepted inside the browser (and the "assistant unavailable" state against a server without a key); `npm run e2e:assistant` drives the real `/api/assistant` path with the deterministic mock model (`AI_MOCK=1 QUOTA_MODE=memory npm run dev`). Both run in CI.

## Data and privacy

CSV parsing and storage are local to the browser. The active state is a single validated document at `covered:v1`; invalid documents are backed up locally before a fresh state is created. Every storage access is guarded. The assistant is off until explicit consent, and only receives the context listed in its notice; each cloud answer shows what its request shared. In private mode nothing is sent at all. Raw CSVs are never sent. Clearing data removes Covered's local documents, backups, and client identifier.

## Other engines

`AI_PROVIDER=openai` sends every request to OpenAI. `AI_PROVIDER=local` connects any self-hosted LLM behind an OpenAI-compatible endpoint (for example `llama-server --jinja`), see `app/.env.example`; it has the same backup to OpenAI. Production runs `AI_PROVIDER=own`.
