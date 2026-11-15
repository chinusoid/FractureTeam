# The money math and the CSV import

Everything here runs in the browser. The code is `app/src/lib/finance` (the plan) and `app/src/lib/import` (CSV reading and recurring-bill detection), both covered by unit tests in `app/tests/unit`.

## The plan

All money is stored as integer cents. Calendar dates use `YYYY-MM-DD`, displayed in en-US without timezone shifts.

```text
available = entered bank balance
          − unpaid confirmed bills due through the period end
          − remaining everyday spending
          − reserve
```

Overdue unpaid bills remain included. A bill that comes due more than once before the period end is set aside each time: a weekly $50 bill with two payments before payday counts as $100 (`paymentsBy` in `app/src/lib/finance/calc.ts`, used by both the browser and the server, so the overview and the assistant count the same way). Bills beyond the period end are displayed separately. Past imported transactions and predicted income do not change the entered bank balance. Purchase checks are hypothetical. Bills, everyday-spending shortfalls, and reserve shortfalls have different explanations.

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

## Known limits

Found in two code reviews on 15 Nov and not fixed yet. None of them affects the sample data.

- **Paid twice a month.** The suggested payday is right for "15th and last day" only; other twice-a-month schedules (1st and 15th, 5th and 20th) get a payday that is too late, and the next period is suggested 15 days on. Check the date on the setup and update screens. Every-two-weeks, weekly and monthly pay are detected correctly.
- **Bills and paydays on the 29th–31st.** A bill first seen in a short month keeps that month's day (the 28th or 30th) afterwards, and a monthly payday can drift the same way. The monthly calendar reminder for such a day is skipped by some calendar apps in shorter months.
- **Dismissing a suggested bill.** Its past payments are left out of the everyday-spending estimate too, so the estimate can be low. Raise everyday spending by hand if you dismiss a regular charge.
- **A bill paid twice within one period.** When the period ends, the update screen lists the bill once. Tick it, then mark the second payment paid on the bills page.
- **Answering the five questions when a plan already exists** replaces that plan without the warning the CSV import shows.
- **The Plus offer** is shown when the plan is carried over and when the first what-if is saved; the reminder and "Since last update" carry the Plus tag but work without it.
