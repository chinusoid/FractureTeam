# Evidence: every claim in the deck, and how to check it

Each line names the claim as it appears in [the pitch deck](../pitch/covered-pitch.pdf), the latest result, and the command or file that reproduces it. Times are Astana time (UTC+5). Where we could not re-run something today, the line says so.

## The product works in production

| Claim | Result | How to check |
| --- | --- | --- |
| Live, no sign-up | <https://covered-fracture.vercel.app> serves `main`. Production answers with our own model and keeps quotas in Upstash: see `/api/health` | Open the link, press **Try sample data** |
| The main scenario passes on the live site with the real model | **Passed at 1280×800 and 390×844**, 15 Nov 02:05, right after the last deploy. Checks: setup review by the assistant, $300 plan, "$400 is $100 below the reserve", bill change confirmed to $270, reload, balance update without double counting, server tool calls, no horizontal overflow | `cd app && BASE_URL=https://covered-fracture.vercel.app node tests/e2e/release.mjs` |
| Browser walkthroughs on every change | CI runs 30 browser checks per screen size on every pull request (samples A and B, consent, AI unavailable, quota fallback, corrupt storage, partial CSV, stale proposals, save failures…) | `.github/workflows/ci.yml`, job "Browser walkthrough"; locally `npm run e2e` |
| 171 unit tests | **171 passed in 14 files**, 15 Nov 02:10 | `cd app && npm test` |

## The core is real, not hardcoded

| Claim | Where it lives |
| --- | --- |
| Tested code computes every dollar | `app/src/lib/finance` (integer cents). Independent worked examples in `app/tests/unit/finance.test.ts` |
| The sample goes through the real import | The landing page's **Try sample data** generates a synthetic three-month bank CSV (`app/src/lib/demo/sample.ts`) and feeds it to the same CSV reader and recurring-bill detector a user's file goes through (`app/src/lib/import`). Nothing on the overview is a fixed number |
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

| Claim | Where |
| --- | --- |
| 5 free cloud questions a day, then the Plus offer | `AI_FREE_PER_DAY` (default 5) in `app/src/lib/ai/env.ts`; the offer is in `app/src/components/Assistant.tsx` |
| We count who takes the offer | `POST /api/plus` counts each browser once; `GET /api/plus` returns the count. Payment is not connected yet: the offer turns Plus on for free during early access |

## Market numbers in the deck

| Number | Source |
| --- | --- |
| 63% live paycheck to paycheck | CNBC \| SurveyMonkey Quarterly Money Survey, July 2026 |
| 37% would not cover $400 with cash | Federal Reserve, Economic Well-Being of U.S. Households, 2025 |
| $14.5B in card late fees | CFPB Consumer Credit Card Market Report, 2023 (2022 data) |
| Rocket Money keeps 35–60% of first-year savings | Rocket Money help center, "Bill Negotiation savings process" |
| 54–57% renew after month one | RevenueCat, State of Subscription Apps 2026 (Productivity and Utilities, monthly plans) |
| About 89 million US adults aged 25–44 | US Census Bureau population estimates, 2024 |
| $0.59 card fee on $10 | Stripe list price, 2.9% + 30¢ |
| Competitor prices | PocketGuard's own pricing page; YNAB and Monarch list prices as reported in November 2026 |

## Not proven yet

How common this pain is in the US segment, whether people pay $10 a month, and how long they stay. We have not interviewed users. The deck's last slide lists the two tests that answer these, and what counts as a pass.
