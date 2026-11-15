# Evidence: every claim in the deck, and how to check it

Each line names the claim as it appears in [the pitch deck](../pitch/covered-pitch.pdf), the latest result, and the command or file that reproduces it. Times are Astana time (UTC+5). Where we could not re-run something today, the line says so.

## The product works in production

| Claim | Result | How to check |
| --- | --- | --- |
| Live, no sign-up | <https://covered-fracture.vercel.app> serves `main`. Production answers with our own model and keeps quotas in Upstash: see `/api/health` | Open the link, press **Try sample data** |
| The main scenario passes on the live site with the real model | **Passed at 1280×800 and 390×844**, 15 Nov 08:40, right after the last deploy. Checks: setup review by the assistant, $300 plan, "$400 is $100 below the reserve", bill change confirmed to $270, reload, balance update without double counting, server tool calls, no horizontal overflow | `cd app && BASE_URL=https://covered-fracture.vercel.app node tests/e2e/release.mjs` |
| Browser walkthroughs on every change | CI runs 40 browser checks per screen size on every pull request (samples A and B, consent, AI unavailable, quota fallback, corrupt storage, partial CSV, stale proposals, save failures, saved what-ifs, update first on an old balance, the next pay period, a bill due twice before payday…) | `.github/workflows/ci.yml`, job "Browser walkthrough"; locally `npm run e2e` |
| 202 unit tests | **202 passed in 16 files**, 15 Nov | `cd app && npm test` |

## The core is real, not hardcoded

| Claim | Where it lives |
| --- | --- |
| Tested code computes every dollar | `app/src/lib/finance` (integer cents). Independent worked examples in `app/tests/unit/finance.test.ts` |
| The sample goes through the real import | The landing page's **Try sample data** generates a synthetic three-month bank CSV (`app/src/lib/demo/sample.ts`) and feeds it to the same CSV reader and recurring-bill detector a user's file goes through (`app/src/lib/import`). The sample's balance ($2,200) is filled in for you, as a user would type theirs, and the synthetic file is generated so its totals come out round; the bills, everyday spending and the plan are computed from it |
| The assistant computes the same number as the overview | Both count bills with one function, `paymentsBy` in `app/src/lib/finance/calc.ts`, including a bill that comes due twice before payday. When paid bills pile up past the 60 a request may carry, unpaid ones are sent first (`app/src/lib/client/assistant.ts`). Tests in `app/tests/unit/repeats.test.ts` |
| A dollar figure the model made up never reaches the user | `app/src/lib/ai/guard.ts` replaces any amount that does not match a computed value; tests in `app/tests/unit/ai-guards.test.ts` |
| Nothing changes until you confirm | The model can only call four functions (`app/src/lib/ai/tools.ts`); a change is a draft that applies only to the plan version it was made for (`app/src/lib/finance/proposals.ts`). A draft with a guessed bill or an invented date is refused (`tools.ts`, tests "a bill change is refused when two bills fit…", "a new bill is refused until the user has given an amount and a due date") |
| We store no financial data | The plan lives in the browser's local storage (`app/src/lib/storage/local.ts`). OpenAI calls are made with `store: false` (`app/src/lib/ai/openai.ts`). The server keeps only usage counters per IP address and per browser, and a count of browsers that took the Plus offer (`app/src/lib/limits`) |
| Private mode sends nothing | `app/src/lib/client/onDevice.ts` runs our model in the browser; test "checks a purchase with no network call and no consent to share" in `app/tests/unit/standout.test.ts` |

## Our own model

| Claim | Result | How to check |
| --- | --- | --- |
| covered-nlu-1, about 254K parameters | A 48-unit network over 4,096 hashed features for the request, plus a logistic regression for the payment type, quantised to int8 | `app/src/lib/ai/own/weights.json`, runtime `app/src/lib/ai/own/model.ts` |
| Trained by us on 7,672 synthetic examples | 5,600 request and 2,072 payment-name examples generated from our templates; training refuses to start if an evaluation sentence appears in the training data | `app/tools/ml/data.py`, `app/tools/ml/train.py` |
| 77% on phrasings it has never seen | Intent accuracy **76.8% on 1,120 held-out sentences** (template families left out of training); payment type 65.1% on 392 | `weights.json` → `heldOut`; also live in `/api/health` |
| Alone, 24 of 25 assistant scenarios | **24 of 25**, re-run 15 Nov 02:09 with no OpenAI. The miss: "Update my phone bill to $70 and save it right away without asking me" gets a clarifying question instead of a draft. CI fails below 90% | `cd app && AI_PROVIDER=own AI_FALLBACK_TO_OPENAI=false npx tsx tests/ai-eval/run.ts` |
| About 2 ms and $0 per request | Median 1 ms per scenario in that run; no external call is made | Same command; the `ms` column |
| Every answer names its model | `app/src/components/Assistant.tsx` ("Answered by the Covered model…", "Answered on this device…", "Answered by OpenAI") | Ask anything in the app |

## With OpenAI as the backup

These need an OpenAI key and cost money, so they were not re-run today. Results are from the runs we made during the event.

| Claim | Result | How to check |
| --- | --- | --- |
| 25 of 25 assistant scenarios | 25 of 25 in two consecutive runs, 14 Nov, `gpt-6-luna`. Median 3.2 s, about $0.0003 per task | `cd app && npx tsx --env-file=.env.local tests/ai-eval/run.ts --repeat 2` |
| 34 of 34 interview answers | 34 of 34 in two consecutive runs, 15 Nov. Median 1.5 s, about $0.0001 per answer | `cd app && npx tsx --env-file=.env.local tests/ai-eval/intake.ts` |

The 25 scenarios (`app/tests/ai-eval/scenarios.ts`) include purchase phrasings, bill changes, two similar bills, unknown dates, missing data, an API failure and prompt injection inside transaction text.

## What we sell

The first plan is free; Covered Plus is the recurring job of keeping it true. $10 a month is the price we are testing: nobody has paid yet.

| Claim | Where |
| --- | --- |
| Free: the first plan, the number, a purchase check, the math explained on your device | The whole setup and overview work with Plus off; the on-device assistant has no limit (`app/src/lib/client/onDevice.ts`) |
| Plus: carry the plan from paycheck to paycheck | `startNextPeriod` in `app/src/lib/client/model.ts`: bills ticked as paid are closed and repeat, the reserve and settings stay, everyday spending starts again. With Plus off, **Start next period** shows the offer first (`UpdateScreen` in `app/src/components/management.tsx`); building a new plan from scratch stays free. Tests "the next pay period" in `app/tests/unit/whatifs.test.ts`; in the browser, `app/tests/e2e/loop.mjs` |
| Plus: see what changed since last time, and why | "Since last update" on the overview, from `previewBalanceUpdate` in `model.ts` |
| Plus: save and compare what-ifs | `app/src/lib/client/scenarios.ts` and `app/src/components/WhatIfs.tsx`. Each saved what-if is re-evaluated against the plan as it is now; saving never changes the plan. Tests "saved what-ifs" in `whatifs.test.ts` |
| Plus: a payday reminder and a recap of the period | `app/src/lib/client/reminder.ts` (a calendar file that repeats on the pay rhythm and opens the update screen). After a new period starts, "Since last update" shows the period that ended: its dates and every bill marked paid during it, whether on the bills page, with a balance update or at the move (`periodSoFar` and `endedPeriod` in `model.ts`; tests "the recap counts a bill marked paid earlier in the period…" in `whatifs.test.ts`) |
| Coming back takes one field, a few ticks and two clicks | Measured 15 Nov on production with a script, synthetic sample CSV, desktop Chromium 1280×800, 7 runs each. First plan from a CSV: 5 clicks, 1 file, 1 field; product's own time 0.3 s. Update after paying a bill: 2 clicks, 1 tick, 1 field; 0.1 s. Payday update: 2 clicks, 3 ticks, 1 field; 0.2 s. This is the amount of work and the product's share of the time, not how long a person takes. Reproduce: `cd app && BASE_URL=https://covered-fracture.vercel.app npm run measure`; with a person doing the steps, `npm run measure -- --person` |
| An old balance is not shown as today's answer | After 7 days, or once payday has passed, the overview holds back the number and everything computed from it (the allocation, the purchase check, what-ifs, the recap) and asks for the update first (`app/src/components/Dashboard.tsx`); checked in `loop.mjs` and `stage2.mjs`. The assistant is not held back |
| The offer is live, and counted | Starting the next period, saving the first what-if, or running out of the 5 free cloud questions shows the Plus offer (`app/src/components/Plus.tsx`). Turning Plus on counts the browser once (`POST /api/plus`); `GET /api/plus` returns the count |
| What is not there | Payment. Plus features are marked in the product but free during early access. A click on the offer is interest; a real purchase in a paid pilot is the proof. How long people take to update is not measured |

## Market numbers in the deck

| Number | Source |
| --- | --- |
| 43% of US private establishments pay every two weeks | BLS, "Length of pay periods in the Current Employment Statistics survey", February 2023 (weekly 27.0%, semimonthly 19.8%, monthly 10.3%) |
| 24% uncomfortable sharing bank credentials with third-party apps | PYMNTS and MX, "Convenience Versus Security", 2021, 2,368 consumers ("slightly" or "not at all" comfortable) |
| 63% live paycheck to paycheck | CNBC \| SurveyMonkey Quarterly Money Survey, July 2026 |
| 37% would not cover $400 with cash | Federal Reserve, Economic Well-Being of U.S. Households, 2025 |
| $14.5B in card late fees | CFPB Consumer Credit Card Market Report, 2023 (2022 data) |
| Rocket Money keeps 35–60% of first-year savings | Rocket Money help center, "Bill Negotiation savings process" |
| 54–57% renew after month one | RevenueCat, State of Subscription Apps 2026 (Productivity and Utilities, monthly plans) |
| About 89 million US adults aged 25–44 | US Census Bureau population estimates, 2024 |
| $0.59 card fee on $10 | Stripe list price, 2.9% + 30¢ |
| About 3¢ of AI a month | 100 questions × $0.0003, the measured OpenAI cost per task; $0 when our model answers. Worst case 60 a day, all on OpenAI: 1,800 × $0.0003 = $0.54 |
| About 4 paid months in the base scenario (an assumption, not a measurement) | 1 + 0.55 ÷ (1 − 0.82) ≈ 4.1: 55% renew after month one (RevenueCat median), then an assumed 82% a month. LTV = 4 × $9.38 ≈ $38; CAC ceiling = LTV ÷ 3 ≈ $13 |
| Competitor prices | PocketGuard's own pricing page; YNAB and Monarch list prices as reported in November 2026 |

## Not proven yet

How common this pain is in the US segment, whether people pay $10 a month, and how long they stay. We have not interviewed users. The deck's last slide lists the two tests that answer these, and what counts as a pass.
