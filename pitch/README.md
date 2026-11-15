# Pitch deck

`covered-pitch.pdf` is the submitted deck (10 slides); `covered-pitch.pptx` has the speaker notes with timings for the 5-minute pitch. Every number in it is traced to its source or to a reproducible run in [docs/evidence.md](../docs/evidence.md).

The deck is generated from code, so the screenshots always come from the product as it is:

```sh
# 1. Screenshots of the live product's elements (needs a running app with AI_PROVIDER=own QUOTA_MODE=memory)
node build/capture.mjs ../app http://localhost:3000 build/shots
# 2. The deck (npm install pptxgenjs sharp react react-dom react-icons jszip in a scratch folder first)
PROD_URL=https://covered-fracture.vercel.app APPLY_THEME=./build/apply_theme.js node build/build.js build/shots covered-pitch.pptx
soffice --headless --convert-to pdf covered-pitch.pptx
```

## The live demo: one story

One person, one pay period. Each step ends with the decision that person can now make. The numbers are the sample's and are the same on any date.

| Time | Step | Say and show | The decision |
| --- | --- | --- | --- |
| 0:45 | Balance → what is yours | **Try sample data**, confirm the bills (point at the savings transfer it flagged), **Build my plan**. "$2,200 in the account. $300 is mine." | How much I can spend until payday without touching rent, groceries or the reserve |
| 1:25 | A purchase | Check **$400**: "$100 below your $250 reserve; bills and everyday spending are still covered." | Buy and dip into the reserve, spend $300 instead, or wait for payday |
| 1:45 | A late paycheck | **What if payday is late?** → **3 days**: covered, using $35.46 of the reserve; the savings transfer and the gym land before the money | Which payment to move or skip, decided before the paycheck slips |
| 2:05 | A bill is paid | Rent goes out. **Update balance** → 1100 → tick **Oakwood Apartments** → **Confirm update**. Still $300 | Keep spending as planned: the rent was set aside, nothing is counted twice |
| 2:25 | Payday, and the paywall | **Demo: skip to payday** (sample plan only). "Payday has passed": **Update now**, 2900, tick the bills, **Start next period**. The paywall opens: $10 a month, **Continue to checkout**, **Pay $10.00 (test)** | Keep the plan going for $10 a month, or build a new one for free |

If there is time: "My car insurance went up by $30" in the assistant (a draft, **Confirm change**, $270). Use a fresh browser profile: a browser that already has Plus on never shows the paywall.

## If asked about the $10

- **What does a subscriber get?** The plan carried from paycheck to paycheck, what changed since last time and why, saved what-ifs that are recalculated on every change, a payday reminder and a recap of the period.
- **Why every pay period?** The number is right for one balance and one set of bills. Each paycheck changes the balance, which bills fall before the next payday and what is already paid. Someone paid every two weeks redoes this 26 times a year. Free gives the number once; Plus keeps it right.
- **How do you know people will pay $10?** We do not know yet. The paywall is live with a checkout in test mode, and every completed checkout is counted, but that is interest. The proof is a paid pilot with a real $10 charge, watching who pays and who returns after the next paycheck. If the free purchase check is enough for people, we change the model.
- **And the revenue numbers?** Scenarios with assumptions, not forecasts. The margin ($9.38 of $10) is a fact from list prices and measured AI cost. The 4 paid months, LTV $38 and the CAC ceiling of $13 assume 55% renewal after month one and 82% a month after that. The pilot replaces those assumptions with measurements.
