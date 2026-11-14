# What Covered does, in full

The [README](../README.md) has the short version. This is every feature in the live product, with the files that implement the less obvious ones.

## Implemented

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

## The pay-period loop

- **Update first.** The overview always shows how old the balance is ("Balance as of Nov 15, today"). After 7 days, or once payday has passed, it holds the number back and asks for the update; "Show the plan anyway" is one click away.
- **Update in a few fields.** New balance, tick what was paid, confirm. Paid bills are closed and repeating ones get their next date.
- **The next pay period.** Tick "My paycheck is in this balance" (or come back after payday): choose the next payday (suggested from your pay rhythm) and everyday spending for the period. Bills, the reserve, settings and what-ifs carry over. No CSV is imported again.
- **Saved what-ifs (Covered Plus).** Save a purchase check, a late paycheck or a bill that might appear. They sit side by side with the plan, each with what is left to spend and what it would touch (nothing, the reserve, everyday spending, bills), and are recalculated whenever the plan changes. They never change the plan.

## Only in Covered

- **Private mode** (assistant → "Private, on this device", or "Use private mode" on the consent screen, or Settings): our own Covered model answers inside the browser (`app/src/lib/client/onDevice.ts`). The request is built exactly as for the server but never sent: no network, no quota, no cost, no daily limit, and it works offline. Without private mode, the assistant still falls back to the device when the server can't be reached, and offers private mode when the free cloud questions are used up. Turns answered in private mode are never sent to the cloud later as chat history.
- **What was shared**: under every cloud answer, a list of exactly what that request sent and what stayed on the device, built from the request body itself (`describeShared`).
- **What if payday is late?** (overview): a stress test for a paycheck 1, 3 or 7 days late. It names the bills that would land before the money (including the next date of repeating bills), adds everyday spending for the extra days, and says how many days the plan can take (`app/src/lib/client/stress.ts`). It never changes the plan.
- **Lower it / Cancel or pause** (Bills, and the subscriptions card): what to try and what to say for each bill, picked by the bill's category from the Covered model and filled in with the user's own numbers: price, yearly cost, payments seen in the import, and a due date moved to just after payday (`app/src/lib/client/lowerBill.ts`). Copy the script, then update the bill with the new price. Covered never calls anyone or takes a cut.

## Not included in this version

Bank connections, login and sync across devices, credit-card interest, payments, investment features, and restoring a JSON export. The plan lives in one browser until accounts arrive in the pilot.
