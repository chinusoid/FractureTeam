# Covered

**Know what's covered before you spend.**

[![CI](https://github.com/chinusoid/FractureTeam/actions/workflows/ci.yml/badge.svg)](https://github.com/chinusoid/FractureTeam/actions/workflows/ci.yml)
[![Live](https://img.shields.io/badge/live-covered--fracture.vercel.app-1f1f1f)](https://covered-fracture.vercel.app)

You have $2,200 in your account and payday is ten days away. Rent, insurance and internet have not gone out yet. Can you spend $400?

Covered's answer: yes, but it puts you $100 below your $250 reserve. Rent, insurance and internet stay covered.

Covered is a bill planner for working adults in the US. It reads your bank's CSV, finds the bills that repeat, and turns your balance into one honest number: what is left after bills, everyday spending and a reserve ($300 here). Then you can ask it about any purchase, and it tells you what that purchase would touch.

![Covered overview: $300 available to spend after $1,300 of bills, $350 of everyday spending and a $250 reserve](docs/overview.png)

- **Live product, no sign-up:** <https://covered-fracture.vercel.app>
- **Pitch deck, 10 slides:** [pitch/covered-pitch.pdf](pitch/covered-pitch.pdf)
- **Every claim, with proof:** [docs/evidence.md](docs/evidence.md)
- **Team and track:** FractureTeam, Business Cup 2.0, track Money

## Try it in a minute

1. Open the live product and press **Try sample data**. A synthetic three-month bank export goes through the real import.
2. **Continue to setup**, **Confirm 7 bills**, **Build my plan**: $2,200 in the account, **$300** is yours. (Covered flags a transfer to savings and leaves that one to you.)
3. **Ask assistant**: "Can I afford $400 this weekend?" The answer: $100 below your reserve; bills and everyday spending are still covered.
4. "My car insurance went up by $30" arrives as a draft with a before and after. **Confirm change** and the plan moves to **$270**.
5. Try **What if payday is late?** on the overview, **Lower it** next to a bill, and **Private, on this device** in the assistant.

## How Covered answers the case

The case: a web product that closes a fundamental money pain for US adults aged 25–45, one they will pay for.

| Judging question | Short answer | Proof |
| --- | --- | --- |
| **Does it work?** (40%) | Yes: live, no sign-up, end to end; tested code computes every dollar | [Production checks](docs/evidence.md#the-product-works-in-production) |
| **What do we sell?** (20%) | Covered Plus, $10 a month: the assistant without the 5-a-day limit; bank sync next | [What Plus adds](docs/evidence.md#what-we-sell) |
| **Who do we sell to?** (15%) | Working adults paid on a schedule, with fixed bills, who gave up on budgeting apps | [Market numbers](docs/evidence.md#market-numbers-in-the-deck) |
| **Why does it make money?** (15%) | We keep $9.38 of $10; $100M ARR is 834,000 subscribers, 0.9% of the segment | [Unit economics](docs/evidence.md#market-numbers-in-the-deck) |
| **Is it new?** (10%) | It names what a purchase breaks; our own model runs on your device | [Only in Covered](docs/features.md#only-in-covered) |

### Does it work? (40%)

- **Live end to end, no sign-up:** CSV import, recurring-bill detection, a plan, purchase checks, bill changes in plain English, balance updates, private mode. Try it at <https://covered-fracture.vercel.app>.
- **The core is real code, not a mockup:** money is integer cents in `app/src/lib/finance`; the sample goes through the same CSV import as a real file (`app/src/lib/import`).
- **AI cannot make up money:** the model only picks one of four functions (`app/src/lib/ai/tools.ts`); any dollar figure in its text that does not match a computed value is replaced (`app/src/lib/ai/guard.ts`).
- **Tested:** 171 unit tests, 25 assistant scenarios, browser walkthroughs at desktop and phone size in CI on every pull request, and a release check against production with the real model.

### What do we sell? (20%)

- **Covered Plus, $10 a month:** up to 60 cloud assistant questions a day instead of 5, answered by our model with OpenAI behind it for anything it is unsure about. Next, with the pilot: bank sync instead of a CSV, so the plan updates itself.
- **Free:** the plan, purchase checks, payday reminders, 5 cloud questions a day, and private mode on our model alone.
- **Live today:** after 5 free questions the app offers Plus (`app/src/components/Assistant.tsx`) and counts who takes it (`app/src/app/api/plus/route.ts`). Payment is not connected yet.
- **Why people come back:** every payday (a calendar reminder, `app/src/lib/client/reminder.ts`, then a recap of what changed), when a bill changes, and before a purchase.

### Who do we sell to? (15%)

- A working adult in the US, 25–45, paid on a schedule, with several fixed bills, who tried a budgeting app and stopped keeping it up.
- The pain is measured: 63% of Americans live paycheck to paycheck; 37% could not cover a surprise $400 expense with cash; card issuers charged $14.5B in late fees in one year.

### Why does it make money? (15%)

- **Margin:** we keep about $9.38 of every $10 after the card fee ($0.59) and AI (about 3¢ for 100 questions; at most 54¢ at the 60-a-day cap).
- **Scale:** $100M ARR is 834,000 subscribers, about 0.9% of ~89 million US adults aged 25–44.
- **LTV and CAC:** 54–57% of monthly subscribers renew after month one; assuming 82% a month after that, a subscriber pays about 4 months, so LTV is $38 and winning one must cost under $13. That rules out paid ads at first: the free, no-sign-up purchase check is the first channel.

### Is it new? (10%)

- **It names what a purchase breaks** (your reserve, everyday spending or a bill), where PocketGuard shows a leftover and YNAB assigns money to targets.
- **Our own model, covered-nlu-1, runs in the browser** in private mode and sends nothing (`app/src/lib/client/onDevice.ts`).
- **What if payday is late?** shows which bills land before a delayed paycheck (`app/src/lib/client/stress.ts`).
- **Lower a bill yourself:** what to say, with your own numbers (`app/src/lib/client/lowerBill.ts`), where Rocket Money keeps 35–60% of the first year's savings.

What is **not** proven yet: how common the pain is in our segment, willingness to pay $10, and retention. We have not interviewed users. The deck's last slide gives the two tests that answer this and what counts as a pass.

## How it works

```mermaid
flowchart TD
  A["Bank CSV, five questions, or by hand"] --> B{"You confirm each bill"}
  B --> C["Your plan: balance − bills − everyday − reserve"]
  D["You ask: Can I afford $400?"] --> E["Our model picks 1 of 4 functions<br/>(OpenAI if it is unsure)"]
  E --> F["Tested money code computes the answer"]
  F --> G{"You confirm any change"}
  G --> C
```

- **Money** is integer cents in `app/src/lib/finance`, shared by the browser and the server.
- **The plan lives in your browser** (local storage). The server stores no financial data; it keeps usage counters for quotas.
- **The assistant** is off until you agree. It can only call four functions: plan summary, purchase check, propose a bill change, propose a new bill. A change applies only after **Confirm**, and only if the plan has not changed since.
- **Our own model, covered-nlu-1**, answers in production: about 254K parameters, trained by us on 7,672 synthetic examples, about 1–2 ms and $0 per request. When it is under 50% sure, OpenAI answers instead, and the app says which model replied. In private mode it runs in the browser and nothing is sent.

Details: [the assistant and our model](docs/assistant-and-ai.md) · [the money math and CSV import](docs/money-and-csv.md) · [every feature](docs/features.md)

## Code map

```text
app/                      Next.js 16 + TypeScript, deployed on Vercel
  src/app/api/            assistant, intake (five questions), plus (offer counter), health
  src/components/         screens: Landing, ImportScreen, SetupScreen, InterviewScreen, Dashboard, Assistant, management
  src/lib/finance/        the plan and proposals, integer cents          ← the core
  src/lib/import/         CSV reading, normalising, recurring-bill detection
  src/lib/ai/             server assistant: tools, guard, prompts, providers, quotas
  src/lib/ai/own/         our model's runtime and weights
  src/lib/client/         browser side: on-device model, stress test, lower-a-bill, reminders
  tests/unit/             171 unit tests (vitest)
  tests/ai-eval/          25 assistant scenarios and 34 interview scenarios
  tests/e2e/              browser walkthroughs (Playwright) and the production release check
  tools/ml/               training data generator and training script for covered-nlu-1
pitch/                    the deck (PDF, PPTX) and the script that builds it from product screenshots
docs/                     evidence, architecture details, feature list
```

## Quality

| Check | Result | Command (from `app/`) |
| --- | --- | --- |
| Unit tests | 171 passed | `npm test` |
| Typecheck | clean, `strict` | `npm run typecheck` |
| Our model alone, 25 assistant scenarios | 24 of 25 (CI requires 90%) | `AI_PROVIDER=own AI_FALLBACK_TO_OPENAI=false npx tsx tests/ai-eval/run.ts` |
| Browser walkthrough, 1280 and 390 px | passed | `npm run e2e` (with the app running) |
| Production release check, real model | passed on 15 Nov after the last deploy | `BASE_URL=https://covered-fracture.vercel.app node tests/e2e/release.mjs` |

CI runs typecheck, unit tests, the assistant scenarios on the test model and on our own model, the build, and two browser walkthroughs on every pull request.

## Run it

Requires Node.js 20.9+.

```sh
cd app
npm ci
npm run dev          # http://localhost:3000
```

The plan, import and purchase check work without any key. For the assistant, copy `app/.env.example` to `app/.env.local`: `AI_PROVIDER=own` runs our model with no key; `OPENAI_API_KEY` adds the backup. Configuration and deployment: [docs/assistant-and-ai.md](docs/assistant-and-ai.md#configure).

## How it was built

Built during the event, 14–15 Nov 2026, by FractureTeam. AI coding assistants (Claude Code and Codex) were used throughout, which the organisers confirmed is allowed; commits authored "Claude" come from Claude Code. The first working version was put together in a separate working repository, [Fraction_team](https://github.com/abilkhayrbigali-design/Fraction_team), and imported in the first commit at 19:15 Astana time on 14 Nov. From then on every change went through a pull request checked by CI (21 merged by the morning of 15 Nov), and production is deployed from `main`.

Design: a quiet workspace in white and pale cream `#f6f7ed`, set in Instrument Sans. Small text was raised to 11–13px and muted text meets WCAG AA contrast.
