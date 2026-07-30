# 💰 Personal Finance Tracker — User Guide

A complete budgeting, cashflow and net-worth workbook built entirely in Google Apps
Script. One menu click builds every tab, formula, dropdown, colour rule and chart.

There is no bank connection, no subscription and no account to create. Transactions
arrive by CSV paste or by hand, and everything else is derived from them.

---

## Install (about 2 minutes)

1. Create a new Google Sheet.
2. **Extensions ▸ Apps Script**.
3. Create three script files and paste one of these into each:
   - `Budget.gs` — constants and the declarative sheet specs
   - `Budget_Build.gs` — the rendering engine, Dashboard and Projections
   - `Budget_Actions.gs` — the menu actions
4. Save, then reload the spreadsheet. A **💰 Finance** menu appears.
5. **💰 Finance ▸ Initialize / Repair Workbook**. Authorize when prompted (the script
   only ever touches this one spreadsheet).
6. Optional: **💰 Finance ▸ Sample Data ▸ Load Sample Data** to see everything populated,
   then **Clear ALL Data** when you're ready for your own numbers.

No triggers, no advanced services, no external APIs.

> **Why three files?** Apps Script concatenates every `.gs` in a project into one
> global scope, so the split is purely for navigation — spec, rendering, actions.
> Order doesn't matter.

---

## The one rule that makes everything work

**Money leaving is negative. Money arriving is positive. On every account type,
including credit cards.**

There are no per-account sign exceptions. A credit card balance is negative because
you owe it; a payment to that card is positive on the card and negative on the
checking account it came from. Because the rule has no exceptions, every account
balance in the workbook is a plain `SUM`, and no reconciliation logic is needed
anywhere.

---

## Colour is a contract

| Look | Meaning |
|---|---|
| ✍️ **Yellow header, cream cells** | You type here. The script never overwrites it. |
| 🔒 **Grey header, grey cells** | Computed. Typing there destroys a formula — *Initialize / Repair* restores it. |

One deliberate exception: **`Budget_Monthly ▸ Budget_Override`** is yellow and sits
directly beside the grey auto-budget it overrides. "This month is different" is the
most common budgeting action and it should never require editing a formula. Blank
means "use the auto number".

---

## The tabs

| Tab | What it's for |
|---|---|
| **Dashboard** | KPI tiles, alerts, budget status, upcoming bills, goal progress, 12-month trend |
| **Budget_Monthly** | The envelope budget — one row per month per category |
| **Transactions** | The ledger everything is derived from |
| **Projections** | 120-month forward model with an FI number |
| **Accounts** | One row per account; balances are derived from the ledger |
| **Categories** | Chart of accounts. The `Kind` column is load-bearing |
| **Recurring** | Subscription and bill manager with annualized cost |
| **Goals** | Sinking funds with a required-monthly back-solve |
| **Debts** | Avalanche/snowball ranking and NPER payoff dates |
| **Net_Worth** | Frozen month-end snapshots |
| **Rules** | Auto-categorization by payee text |
| **Import** | CSV staging with duplicate detection |
| **Setup** | Every assumption, published as named ranges |

---

## Setup: the assumptions

Every value on the Setup tab becomes a **named range** (`CFG_INCOME`, `CFG_INFLATION`,
…), so formulas across the workbook read them by name rather than by cell address.
Moving a row on Setup breaks nothing.

The two that matter most:

- **Planned monthly net income** — *take-home* pay, after tax and deductions. Entering
  gross income here inflates every downstream number and is the most common setup
  mistake.
- **Expected investment return** — nominal, before inflation. 7% nominal against 3%
  inflation is roughly 4% real, the conventional long-run planning pair.

Defaults are chosen to be defensible rather than optimistic: 6-month emergency fund
(the upper end of the standard 3–6 range), 20% savings rate, 4% safe withdrawal rate,
3% income growth (i.e. flat in real terms).

---

## Categories: `Kind` is the important column

| Kind | Meaning |
|---|---|
| **Income** | Money in |
| **Essential** | You would still pay it after losing your job |
| **Lifestyle** | Discretionary |
| **Savings** | Paying yourself |
| **Debt** | Payments toward balances |

That layoff test is the whole distinction, and it's what makes the emergency-fund
target meaningful — a layoff cuts your income, not your rent, so **essentials** are the
correct denominator for months of runway.

`Kind` also drives the savings rate, the 50/30/20 check and the entire projection model.

### Target methods

| Method | Use for |
|---|---|
| **Fixed** | Rent, insurance — a constant you set |
| **Percent_of_Income** | Savings, giving — scales automatically with a raise |
| **Rolling_3mo_Avg** | Groceries, fuel — budgets against actual behaviour |
| **None** | Tracked but not budgeted |

Rolling averages use the **trailing three complete months**, excluding the current
partial one. One month of groceries is noise; three is a signal, and budgeting against
noise produces budgets nobody keeps.

---

## Budget_Monthly: the envelope budget

```
Available = Budgeted + Rollover_In − Actual
```

That's your envelope balance: what's genuinely left to spend, not what the calendar
says you should have left.

**Rollover** carries an unspent envelope into next month. Turn it on for categories
where underspending should bank (groceries, car repair, gifts) and off where the
envelope should reset (rent).

The tab is stored in **long format** — one row per month per category, rather than
months across the top. Adding a month appends rows instead of rewriting formulas, and
every downstream `QUERY`/`SUMIFS` stays trivial. Rollover looks itself up by a
`month|category` key, so **sorting or filtering the tab never breaks it**.

Run **Rebuild Budget Months** after adding or deactivating categories. Your manual
overrides are preserved across a rebuild — they're re-placed by key, never by row
position.

---

## Importing transactions

1. Export CSV from your bank.
2. Paste onto the **Import** tab. Only Date, Payee and Amount are required.
3. **💰 Finance ▸ Import Staged Rows**.

The importer asks **once per batch** — not per row — for the account, and checks the
sign convention. If most staged amounts are positive it offers to flip them, because
many banks export debits as positive numbers and importing those as-is would invert
every balance in the workbook.

**Duplicate detection** is by `date + account + amount + payee`, not by a bank
transaction ID — CSV exports from different institutions share no ID scheme, and
re-exporting an overlapping date range is the normal way people use this. The
tradeoff is real: two genuinely distinct identical charges on the same day at the same
merchant will collide, and the second is reported as a duplicate. The importer says so
per row rather than dropping anything silently, so you can override by nudging one
payee string.

---

## Rules: auto-categorization

Match text on a payee, set the category. Two invariants:

1. **A rule only ever fills a blank category.** It can never overwrite one you set by
   hand. Auto-categorization that second-guesses a correction is worse than none,
   because it destroys trust in every other number.
2. **First match by priority wins**, so specific rules sit above general ones —
   "Amazon Prime → Subscriptions" at priority 40, "Amazon → Shopping" at 50.

Match types: Contains, Starts With, Ends With, Exact, Regex. All case-insensitive.
The `Hits` column counts applications; a rule with zero hits after a few runs is either
wrong or unnecessary.

This is the rule-based core of what paid apps market as ML categorization. For a single
household it converges to the same place within a few weeks, and unlike a model, you
can read exactly why a transaction landed where it did.

---

## Recurring: the subscription manager

**Annualized** is the column that changes behaviour. $14.99/mo is easy to keep;
$179.88/yr is a decision. Sort by it before reviewing anything else.

**Price_Drift** compares the most recent charge to the amount you recorded. Non-zero
means the price changed and you probably didn't notice — which is exactly how
subscription creep works.

**💰 Finance ▸ Detect Recurring Bills** scans the ledger for repeating charges: same
payee, 3+ charges in the last 12 months, a regular cadence, and amounts within ±35%
(so a frequented grocery store doesn't get mistaken for a subscription). It uses the
**median** gap rather than the mean, so one skipped or double-billed month doesn't drag
the estimate.

It proposes; it doesn't decide. New entries arrive with status **Watch** so they're
visibly unreviewed, and nothing already on the tab is modified.

---

## Debts

**Avalanche** (highest APR first) minimizes total interest. **Snowball** (smallest
balance first) clears accounts faster for momentum. Switch in Setup and every debt
re-ranks live.

Both are defensible — pick the one you'll actually follow. Put every spare dollar on
the rank-1 debt only; splitting extra payments across debts is strictly worse under
either strategy.

If **Months_To_Payoff** shows `⚠️ never`, the payment doesn't cover the interest and the
balance grows forever. That blank isn't a bug — it's the most important thing the tab
can tell you.

---

## Projections

A month-by-month model: income grows at your growth rate, spending inflates, the
surplus compounds monthly at your expected return, debt amortizes at the blended APR.

**Starting conditions are derived from your actual accounts**, not typed in, so the
model can't silently go stale. Each has an override on Setup if you want one.

**Read the real-dollar column, not the nominal one.** A large nominal net worth 30
years out mostly reflects inflation, not progress.

**FI number** = annual spending ÷ safe withdrawal rate (25× at 4%) — the portfolio
size at which work becomes optional. Milestones fire on the *crossing*, so each appears
exactly once.

### What the model does not do

It ignores taxes, lumpy income, market sequence risk and life events. Those matter
enormously. Treat the output as a **trajectory under stated assumptions, not a
forecast** — the value is in comparing scenarios, not in any single number.

---

## Where the headline numbers come from

- **Savings rate** = `(income − spend) ÷ income`. Transfers are excluded from both, so
  moving $500 to savings correctly reads as *saving* rather than *spending*. Counting
  transfers as spending is the most common way a homemade budget quietly lies.
- **Emergency fund** = liquid cash ÷ average monthly *essential* spend.
- **50/30/20** is reported as a diagnostic, never enforced. Drift matters more than the
  exact split.

---

## Monthly routine

1. Import or enter the month's transactions.
2. **Apply Categorization Rules**, then fix whatever's left — and add a rule for it so
   it categorizes itself next time.
3. **Snapshot Net Worth** at month end.
4. Read the Dashboard alerts.
5. Look at Projections quarterly, not weekly.

---

## Design notes

**Computed cells are live spreadsheet formulas, not values the script writes.** The
script owns structure; the spreadsheet owns arithmetic. This is deliberate and it's the
difference between a dashboard and a report:

- Add a transaction and every KPI, budget line, projection row and chart updates
  instantly. Nothing to re-run, no stale numbers.
- The workbook keeps working if the script is deleted or Apps Script quotas are
  exhausted. Formulas have no quota.
- You can audit any number by clicking the cell. A script-written value is
  unfalsifiable; a formula shows its own work.

The cost is verbose, defensively-written formulas — every one is `IFERROR`-wrapped and
blank-row guarded. That cost is paid once.

**Initialize / Repair is idempotent.** Run it on a brand-new sheet or one with three
years of data; in the second case it won't change a single value you typed. Formula
columns are rewritten wholesale (that's how a broken formula heals), manual columns are
never touched, and formats and validation are reapplied because those genuinely drift
as people paste data in.

**Net_Worth stores frozen values, not formulas** — history must not silently rewrite
itself when you correct an old transaction. A net worth series that changes
retroactively isn't a record of anything.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `#REF!` or `#NAME?` everywhere | Run **Initialize / Repair Workbook** — a named range or formula was damaged |
| Budget rows missing for a month | **Rebuild Budget Months**; check the history/future window on Setup |
| A category has no budget row | It's probably unchecked as `Active` on Categories |
| Balances look inverted | Debits imported as positive — re-import and accept the sign flip |
| "Another Finance operation is already running" | A previous action is still going; wait a moment |
| Rebuild refuses, "needs N rows" | Reduce the month window on Setup or deactivate unused categories |
| Dropdowns are empty on first run | Run **Initialize / Repair** once more |

---

## Limits

- 2,000 rows per tab (`DATA_ROWS`) — roughly 4–5 years of household transactions.
- 600 projection months maximum.
- Single currency.
- No bank sync, by design.

---

*Not financial advice. The projection model is a trajectory under assumptions you set,
not a prediction.*
