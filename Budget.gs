/**
 * ============================================================================
 *  💰  PERSONAL FINANCE TRACKER  —  Budget, Cashflow & Net-Worth Projections
 * ============================================================================
 *  A single-file Apps Script that builds and maintains a complete budgeting
 *  workbook. One menu click (💰 Finance ▸ Initialize / Repair Workbook) creates
 *  every tab, formula, dropdown, format rule and chart from scratch, and the
 *  same click is safe to run again later — it repairs structure without ever
 *  touching data you typed.
 *
 *  ── THE ONE ARCHITECTURAL DECISION THAT EXPLAINS EVERYTHING ───────────────
 *  Computed cells are LIVE SPREADSHEET FORMULAS, not values the script writes.
 *  The script owns *structure* (tabs, headers, formats, validation, charts);
 *  the spreadsheet owns *arithmetic* (SUMIFS / QUERY / LET / NPER). This is
 *  deliberate and it is the difference between a dashboard and a report:
 *    - Add a transaction and every KPI, budget line, projection row and chart
 *      updates instantly. Nothing to re-run, no stale numbers, ever.
 *    - The workbook keeps working if the script is removed, the owner leaves,
 *      or Apps Script quotas are exhausted. Formulas have no quota.
 *    - You can audit any number by clicking the cell. A script-written value
 *      is unfalsifiable; a formula shows its own work.
 *  The cost is that formulas are verbose and must be written defensively
 *  (every one is IFERROR-wrapped and blank-row guarded). That cost is paid
 *  once, here, in this file.
 *
 *  ── TABS ──────────────────────────────────────────────────────────────────
 *    Setup            Key/value configuration. Every value is published as a
 *                     NAMED RANGE (CFG_*) so formulas elsewhere read
 *                     CFG_INFLATION rather than 'Setup'!B12 — assumptions stay
 *                     legible in the formulas that depend on them, and moving
 *                     a Setup row never breaks a projection.
 *    Accounts         One row per account. Current_Balance is derived
 *                     (opening balance + every transaction), so a balance can
 *                     never silently disagree with the ledger behind it.
 *    Transactions     The ledger. THE SIGN CONVENTION IS THE WHOLE CONTRACT:
 *                     money leaving is NEGATIVE, money arriving is POSITIVE,
 *                     on every account type including credit cards. One rule,
 *                     no per-account special cases, and account balances are
 *                     a plain SUM. Category tabs flip the sign for display.
 *    Categories       The chart of accounts, each tagged with a Kind
 *                     (Income / Essential / Lifestyle / Savings / Debt) and a
 *                     Target_Method. Kind is what makes 50/30/20, savings
 *                     rate, emergency-fund sizing and the projection model
 *                     possible — it is the most load-bearing column here.
 *    Budget_Monthly   One row per month per category — the envelope budget.
 *                     Long format, not a month-across-the-top matrix: adding
 *                     a month appends rows instead of rewriting formulas, and
 *                     every downstream QUERY/SUMIFS stays trivial.
 *    Recurring        Subscription & bill manager. Annualized cost is the
 *                     column that changes behavior — $14.99/mo reads as
 *                     $179.88/yr, which is how you actually decide to cancel.
 *    Goals            Sinking funds and savings goals with a required-monthly
 *                     back-solve and an on-track verdict.
 *    Debts            Balances with APR, plus avalanche/snowball ranking and
 *                     an NPER payoff date. Switching strategy in Setup
 *                     re-ranks every debt live.
 *    Net_Worth        Month-end snapshots. Deliberately FROZEN VALUES, not
 *                     formulas — history must not silently rewrite itself
 *                     when you correct an old transaction.
 *    Rules            Auto-categorization: match text on a payee, set the
 *                     category. This is the rule-based core of what paid apps
 *                     market as ML categorization, and for a single household
 *                     it converges to the same place within a few weeks.
 *    Import           Paste-and-map staging area for bank CSV exports, with
 *                     hash-based dedupe so re-importing an overlapping export
 *                     is a no-op instead of a mess.
 *    Dashboard        KPI tiles, budget status, upcoming bills, goal progress,
 *                     alerts, and a rolling 12-month cashflow trend.
 *    Projections      A 120-month forward model: income growth, inflation,
 *                     compounding returns, debt paydown, net worth in both
 *                     nominal and real dollars, and an FI number at your
 *                     chosen safe withdrawal rate.
 *
 *  ── WHAT THE COLORS MEAN (same convention as the Calendar & Form Manager) ──
 *    ✍️ Yellow header / cream cells   You type here. The script never
 *                                     overwrites these.
 *    Gray header / gray cells         Computed. Typing here destroys a
 *                                     formula; the script restores it on the
 *                                     next Initialize / Repair run.
 *  There is exactly one column that breaks this rule on purpose:
 *  Budget_Monthly ▸ Budget_Override. It is yellow and sits directly beside the
 *  gray auto-budget it overrides, because "this month is different" is the
 *  single most common budgeting action and it must not require editing a
 *  formula. Blank means "use the auto number".
 *
 *  ── FINANCE PRACTICE ENCODED HERE (and why) ───────────────────────────────
 *    Zero-based / envelope budgeting (YNAB's method). Every dollar of income
 *      is assigned to a category. Budget_Monthly ▸ Available is the envelope
 *      balance, and Rollover carries an unspent envelope forward so an
 *      underspent month funds next month instead of vanishing.
 *    50/30/20 as a diagnostic, not a cage. The Dashboard reports the actual
 *      Essential/Lifestyle/Savings split against the 50/30/20 reference so
 *      you see drift, but nothing is enforced.
 *    Savings rate is the headline metric. It is the one number that
 *      determines time-to-independence; absolute spend does not. Computed as
 *      (income − spend) / income on cash flows, transfers excluded.
 *    Emergency fund sized in MONTHS OF ESSENTIAL SPEND, not months of income
 *      or a round number. A layoff cuts income, not rent — essentials are the
 *      correct denominator, which is why Categories ▸ Kind exists.
 *    Avalanche by default (highest APR first) because it minimizes total
 *      interest; snowball (smallest balance first) is one Setup cell away
 *      because adherence beats optimality for many people.
 *    Real vs. nominal. Projections show both. A 40-year nominal net worth
 *      figure is a number that feels good and means little; the real column
 *      is the one to plan against.
 *    Trailing 3-month averages for variable categories, because a single
 *      month of groceries is noise and budgeting against noise produces
 *      budgets nobody keeps.
 *    Transfers are excluded from income and spend everywhere. Moving $500
 *      from checking to savings is not $500 of spending, and counting it as
 *      such is the most common way a homemade budget quietly lies.
 *
 *  ── SETUP ─────────────────────────────────────────────────────────────────
 *    1. Extensions ▸ Apps Script, paste this file, save.
 *    2. Reload the spreadsheet. A 💰 Finance menu appears.
 *    3. 💰 Finance ▸ Initialize / Repair Workbook. Authorize when asked.
 *    4. Optionally 💰 Finance ▸ Load Sample Data to see it populated, then
 *       💰 Finance ▸ Clear All Data when you're ready for your own numbers.
 *    5. Fill in Setup and Accounts, then import or type transactions.
 *  No triggers, no advanced services, no external APIs. It runs entirely on
 *  data you put in it.
 * ============================================================================
 */


// ============================================================================
//  1. LOGGING
// ============================================================================

const ENABLE_LOGGING = true;

function blog(msg) {
  if (ENABLE_LOGGING) Logger.log(msg);
}


// ============================================================================
//  2. WORKBOOK-WIDE CONSTANTS
// ============================================================================

/**
 * Bumped whenever the structural spec below changes in a way that requires a
 * repair run. Stored on the document so initWorkbook() can report drift.
 */
const WORKBOOK_VERSION = 1;
const WORKBOOK_VERSION_PROP_KEY = 'FINANCE_WORKBOOK_VERSION';

/** Rows of formula-backed capacity built into each tabular sheet. */
const DATA_ROWS = 2000;

/** Row 1 is the tab's title banner, row 2 the headers, row 3 the first datum. */
const BANNER_ROW = 1;
const HEADER_ROW = 2;
const DATA_START_ROW = 3;

const CURRENCY_FORMAT = '$#,##0.00';
const CURRENCY_FORMAT_WHOLE = '$#,##0';
const PCT_FORMAT = '0.0%';
const PCT_FORMAT_WHOLE = '0%';
const DATE_FORMAT = 'yyyy-mm-dd';
const MONTH_FORMAT = 'mmm yyyy';
const NUMBER_FORMAT = '#,##0.0';

// --- Palette. Mirrors the Calendar & Form Manager's manual-vs-computed idiom.
const HEADER_BG = '#1F3864';
const HEADER_FG = '#FFFFFF';
const BANNER_BG = '#2F5597';
const BANNER_FG = '#FFFFFF';
const MANUAL_ENTRY_HEADER_COLOR = '#FFF2CC';
const MANUAL_ENTRY_HEADER_FG = '#5C4500';
const MANUAL_ENTRY_CELL_TINT = '#FFFCF0';
const COMPUTED_HEADER_COLOR = '#D9D9D9';
const COMPUTED_HEADER_FG = '#3C3C3C';
const COMPUTED_CELL_TINT = '#F5F5F5';
const GOOD_COLOR = '#38761D';
const WARN_COLOR = '#BF9000';
const BAD_COLOR = '#CC0000';
const GOOD_BG = '#E6F4EA';
const WARN_BG = '#FFF4E5';
const BAD_BG = '#FCE8E6';
const KPI_LABEL_COLOR = '#5F6368';
const GRID_LINE_COLOR = '#D0D7E2';

/** The ✍️ prefix marks a header as hand-entry, exactly as the sibling project does. */
const MANUAL_ENTRY_PREFIX = '✍️';

const COLUMN_WIDTH_BUFFER_MULTIPLIER = 1.25;
const MIN_COLUMN_WIDTH_PX = 70;
const MAX_COLUMN_WIDTH_PX = 320;

const SHEET_NAMES = {
  DASHBOARD: 'Dashboard',
  PROJECTIONS: 'Projections',
  BUDGET: 'Budget_Monthly',
  TRANSACTIONS: 'Transactions',
  ACCOUNTS: 'Accounts',
  CATEGORIES: 'Categories',
  RECURRING: 'Recurring',
  GOALS: 'Goals',
  DEBTS: 'Debts',
  NET_WORTH: 'Net_Worth',
  RULES: 'Rules',
  IMPORT: 'Import',
  SETUP: 'Setup',
};

/** Tab order, left to right. Dashboard first — it is what you open the file for. */
const SHEET_ORDER = [
  SHEET_NAMES.DASHBOARD,
  SHEET_NAMES.BUDGET,
  SHEET_NAMES.TRANSACTIONS,
  SHEET_NAMES.PROJECTIONS,
  SHEET_NAMES.ACCOUNTS,
  SHEET_NAMES.CATEGORIES,
  SHEET_NAMES.RECURRING,
  SHEET_NAMES.GOALS,
  SHEET_NAMES.DEBTS,
  SHEET_NAMES.NET_WORTH,
  SHEET_NAMES.RULES,
  SHEET_NAMES.IMPORT,
  SHEET_NAMES.SETUP,
];

const TAB_COLORS = {
  [SHEET_NAMES.DASHBOARD]: '#1F3864',
  [SHEET_NAMES.BUDGET]: '#2F5597',
  [SHEET_NAMES.TRANSACTIONS]: '#2F5597',
  [SHEET_NAMES.PROJECTIONS]: '#1F3864',
  [SHEET_NAMES.ACCOUNTS]: '#548235',
  [SHEET_NAMES.CATEGORIES]: '#548235',
  [SHEET_NAMES.RECURRING]: '#BF8F00',
  [SHEET_NAMES.GOALS]: '#BF8F00',
  [SHEET_NAMES.DEBTS]: '#C00000',
  [SHEET_NAMES.NET_WORTH]: '#548235',
  [SHEET_NAMES.RULES]: '#7F7F7F',
  [SHEET_NAMES.IMPORT]: '#7F7F7F',
  [SHEET_NAMES.SETUP]: '#7F7F7F',
};


// ============================================================================
//  3. ENUMERATIONS
// ============================================================================

/**
 * Kind drives every aggregate in the workbook, so it is a closed list.
 *   Income     money in (salary, side income, interest, gifts)
 *   Essential  you would still pay it after losing your job — the emergency
 *              fund denominator, and the "50" of 50/30/20
 *   Lifestyle  discretionary; the "30"
 *   Savings    transfers to investment/savings treated as *paying yourself*
 *   Debt       principal + interest payments toward balances on Debts
 */
const CATEGORY_KINDS = {
  INCOME: 'Income',
  ESSENTIAL: 'Essential',
  LIFESTYLE: 'Lifestyle',
  SAVINGS: 'Savings',
  DEBT: 'Debt',
};
const CATEGORY_KIND_OPTIONS = Object.values(CATEGORY_KINDS);

const CATEGORY_KIND_COLORS = {
  [CATEGORY_KINDS.INCOME]: '#D9EAD3',
  [CATEGORY_KINDS.ESSENTIAL]: '#D0E0E3',
  [CATEGORY_KINDS.LIFESTYLE]: '#FFF2CC',
  [CATEGORY_KINDS.SAVINGS]: '#D9D2E9',
  [CATEGORY_KINDS.DEBT]: '#F4CCCC',
};

/**
 * How a category's monthly budget number is derived.
 *   Fixed             a constant you set (rent, insurance)
 *   Percent_of_Income a share of planned income (savings, giving) — scales
 *                     automatically with a raise, which is the whole point
 *   Rolling_3mo_Avg   trailing 3-month actual (groceries, fuel) — budgets
 *                     against your real behavior rather than an aspiration
 *   None              tracked but not budgeted
 */
const TARGET_METHODS = {
  FIXED: 'Fixed',
  PERCENT: 'Percent_of_Income',
  ROLLING: 'Rolling_3mo_Avg',
  NONE: 'None',
};
const TARGET_METHOD_OPTIONS = Object.values(TARGET_METHODS);

/**
 * Transfer is not a spending type — it is the marker that says "exclude me
 * from every income and expense aggregate". Both legs of a move between your
 * own accounts carry it.
 */
const TXN_TYPES = {
  EXPENSE: 'Expense',
  INCOME: 'Income',
  TRANSFER: 'Transfer',
  REFUND: 'Refund',
};
const TXN_TYPE_OPTIONS = Object.values(TXN_TYPES);

const ACCOUNT_TYPES = [
  'Checking', 'Savings', 'Credit Card', 'Investment',
  'Retirement', 'Loan', 'Cash', 'Property', 'Other',
];

/** Liability-side account types: their balances subtract from net worth. */
const LIABILITY_ACCOUNT_TYPES = ['Credit Card', 'Loan'];

const ACCOUNT_STATUS_OPTIONS = ['Active', 'Closed'];

const CADENCES = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Biweekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  SEMIANNUAL: 'Semiannual',
  ANNUAL: 'Annual',
};
const CADENCE_OPTIONS = Object.values(CADENCES);

/** Payments per year, used to annualize a recurring charge. */
const CADENCE_PER_YEAR = {
  [CADENCES.WEEKLY]: 52,
  [CADENCES.BIWEEKLY]: 26,
  [CADENCES.MONTHLY]: 12,
  [CADENCES.QUARTERLY]: 4,
  [CADENCES.SEMIANNUAL]: 2,
  [CADENCES.ANNUAL]: 1,
};

const RECURRING_STATUS_OPTIONS = ['Active', 'Paused', 'Cancelled', 'Watch'];

const GOAL_TYPE_OPTIONS = [
  'Emergency Fund', 'Sinking Fund', 'Investment', 'Purchase', 'Debt Payoff', 'Other',
];

const DEBT_STRATEGIES = { AVALANCHE: 'Avalanche', SNOWBALL: 'Snowball' };
const DEBT_STRATEGY_OPTIONS = Object.values(DEBT_STRATEGIES);

const RULE_MATCH_TYPES = ['Contains', 'Starts With', 'Ends With', 'Exact', 'Regex'];


// ============================================================================
//  4. SETUP TAB — configuration, published as named ranges
// ============================================================================

/**
 * Every row of the Setup tab. `name` becomes a workbook-level named range, so
 * a projection formula reads `CFG_INFLATION * ...` instead of a cell address
 * nobody can interpret six months from now.
 *
 * Defaults are chosen to be defensible rather than optimistic:
 *   7% nominal equity return and 3% inflation ≈ 4% real, the conventional
 *   long-run planning pair; 4% safe withdrawal rate (Trinity study); 6 months
 *   of essentials for an emergency fund (the upper end of the standard 3–6
 *   range, because the lower end assumes a fast job market); 20% savings rate
 *   as the 50/30/20 floor.
 */
const SETUP_FIELDS = [
  { section: 'Household' },
  { name: 'CFG_HOUSEHOLD', label: 'Household name', value: 'My Household', format: '@',
    note: 'Shown in the Dashboard title. Cosmetic only.' },
  { name: 'CFG_START_MONTH', label: 'Budget start month', value: null, format: MONTH_FORMAT,
    note: 'First month the budget covers. Defaults to 12 months ago so you have history to average against.' },

  { section: 'Income' },
  { name: 'CFG_INCOME', label: 'Planned monthly net income', value: 3395, format: CURRENCY_FORMAT,
    note: 'TAKE-HOME pay, after tax and payroll deductions. Using gross income here inflates every downstream number and is the most common setup mistake.' },
  { name: 'CFG_GROSS_SALARY', label: 'Gross annual salary', value: 48000, format: CURRENCY_FORMAT_WHOLE,
    note: 'Used only by the salary-scenario table on Projections. Your actual budget always runs on the take-home figure above.' },
  { name: 'CFG_TAKEHOME_RATE', label: 'Take-home rate (net ÷ gross)', value: 0.845, format: PCT_FORMAT,
    note: 'What fraction of gross salary actually reaches your account after tax, FICA and payroll deductions. Derive it from a real payslip rather than guessing — 0.845 matches $48,000 gross against $3,395/month net.' },
  { name: 'CFG_INCOME_GROWTH', label: 'Annual income growth %', value: 0.03, format: PCT_FORMAT,
    note: 'Long-run raise rate. 3% roughly tracks inflation, i.e. flat real income — a deliberately unambitious default.' },

  { section: 'Economic assumptions' },
  { name: 'CFG_INFLATION', label: 'Expected inflation %', value: 0.03, format: PCT_FORMAT,
    note: 'Inflates future spending and deflates the real-dollar projection columns.' },
  { name: 'CFG_RETURN', label: 'Expected investment return % (nominal)', value: 0.07, format: PCT_FORMAT,
    note: 'NOMINAL annual return before inflation. 7% nominal with 3% inflation is ~4% real. Compounded monthly in Projections.' },
  { name: 'CFG_SWR', label: 'Safe withdrawal rate %', value: 0.04, format: PCT_FORMAT,
    note: 'Used for the FI number: annual essential+lifestyle spend divided by this rate.' },

  { section: 'Targets' },
  { name: 'CFG_SAVINGS_TARGET', label: 'Target savings rate %', value: 0.20, format: PCT_FORMAT,
    note: 'The 20 of 50/30/20. The Dashboard grades your actual rate against it.' },
  { name: 'CFG_EF_MONTHS', label: 'Emergency fund target (months)', value: 6, format: '0.0',
    note: 'Months of ESSENTIAL spend, not months of income. Standard guidance is 3–6; 6 assumes a slow job search.' },
  { name: 'CFG_ALERT_PCT', label: 'Budget alert threshold %', value: 0.90, format: PCT_FORMAT,
    note: 'A category flags amber past this share of its envelope, red past 100%.' },

  { section: 'Debt' },
  { name: 'CFG_DEBT_STRATEGY', label: 'Debt payoff strategy', value: DEBT_STRATEGIES.AVALANCHE, format: '@',
    note: 'Avalanche = highest APR first (cheapest). Snowball = smallest balance first (most motivating). Changing this re-ranks the Debts tab live.' },

  { section: 'Model horizon' },
  { name: 'CFG_HIST_MONTHS', label: 'History months to budget', value: 12, format: '0',
    note: 'How many past months Budget_Monthly builds rows for.' },
  { name: 'CFG_FUTURE_MONTHS', label: 'Future months to budget', value: 12, format: '0',
    note: 'How many future months Budget_Monthly builds rows for.' },
  { name: 'CFG_PROJ_MONTHS', label: 'Projection horizon (months)', value: 120, format: '0',
    note: 'Length of the Projections model. 120 = 10 years. Max 600.' },

  { section: 'Starting balances (for projections)' },
  { name: 'CFG_INVEST_BAL', label: 'Current invested balance', value: 0, format: CURRENCY_FORMAT,
    note: 'Leave 0 to have this derived from Investment/Retirement accounts instead.' },
  { name: 'CFG_CASH_BAL', label: 'Current cash balance', value: 0, format: CURRENCY_FORMAT,
    note: 'Leave 0 to have this derived from Checking/Savings/Cash accounts instead.' },
];

const SETUP_LABEL_COL = 2;   // B
const SETUP_VALUE_COL = 3;   // C
const SETUP_NOTE_COL = 4;    // D
const SETUP_START_ROW = 3;


// ============================================================================
//  5. SHEET SPECS
// ============================================================================
//  Each tabular tab is declared as data, then rendered by one generic builder
//  (buildTabularSheet). Adding a column is a one-line edit here, not a
//  scattering of range arithmetic — which is the only reason a file this size
//  stays maintainable.
//
//  Column fields:
//    key        stable identifier used by the import/rules engines
//    label      header text (✍️-prefixed automatically when computed !== true)
//    width      pixels
//    format     number format
//    computed   true → gray, formula-filled, script-owned
//    formula    A1 formula written at DATA_START_ROW and filled down; the
//               token {r} is replaced with the row number
//    validation () => DataValidation, evaluated at build time
//    hidden     true → column hidden (internal keys)
//    note       cell note attached to the header
// ============================================================================

/** Column letter for a 1-based index. */
function colLetter(index) {
  let s = '';
  let n = index;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Find a column's 1-based position within a spec by key. */
function colOf(spec, key) {
  const i = spec.columns.findIndex(c => c.key === key);
  if (i < 0) throw new Error(`Unknown column "${key}" on ${spec.name}`);
  return i + 1;
}

/** Column letter for a key within a spec. */
function colL(spec, key) {
  return colLetter(colOf(spec, key));
}


// ---------------------------------------------------------------------------
//  5a. Accounts
// ---------------------------------------------------------------------------

const ACCOUNTS_SPEC = {
  name: SHEET_NAMES.ACCOUNTS,
  title: '🏦 Accounts — every place your money lives',
  subtitle: 'Current_Balance is derived from Opening_Balance plus every transaction on the ledger, so it can never quietly disagree with the Transactions tab.',
  frozenColumns: 1,
  columns: [
    { key: 'account', label: 'Account', width: 180,
      note: 'Must be unique. This exact text is what the Transactions dropdown offers.' },
    { key: 'type', label: 'Type', width: 120,
      validation: () => listValidation(ACCOUNT_TYPES),
      note: 'Credit Card and Loan are treated as liabilities and subtract from net worth.' },
    { key: 'institution', label: 'Institution', width: 140 },
    { key: 'opening', label: 'Opening_Balance', width: 130, format: CURRENCY_FORMAT,
      note: 'Balance as of the As_Of_Date below. For a credit card, enter what you OWE as a negative number — the sign convention is universal here.' },
    { key: 'asof', label: 'As_Of_Date', width: 110, format: DATE_FORMAT,
      note: 'Only import transactions dated on or after this date, or you will double-count.' },
    { key: 'rate', label: 'APR_APY_%', width: 100, format: PCT_FORMAT,
      note: 'Interest earned (savings) or charged (credit/loan). Informational here; the Debts tab is what models payoff.' },
    { key: 'limit', label: 'Credit_Limit', width: 110, format: CURRENCY_FORMAT,
      note: 'Credit cards only. Drives the utilization column — keeping this under 30% is the single largest revolving-credit factor in a credit score.' },
    { key: 'innw', label: 'In_Net_Worth', width: 100,
      validation: () => checkboxValidation(),
      note: 'Uncheck for accounts you track but do not own (a shared or business account).' },
    { key: 'status', label: 'Status', width: 90,
      validation: () => listValidation(ACCOUNT_STATUS_OPTIONS) },
    { key: 'balance', label: 'Current_Balance', width: 130, format: CURRENCY_FORMAT, computed: true,
      formula: `=IF($A{r}="","",$D{r}+IFERROR(SUMIFS('${SHEET_NAMES.TRANSACTIONS}'!$E:$E,'${SHEET_NAMES.TRANSACTIONS}'!$B:$B,$A{r}),0))` },
    { key: 'util', label: 'Utilization', width: 100, format: PCT_FORMAT, computed: true,
      formula: `=IF(OR($A{r}="",N($G{r})=0),"",MIN(1,ABS(MIN(0,$J{r}))/$G{r}))`,
      note: 'Balance owed ÷ credit limit. Amber over 30%, red over 50%.' },
    { key: 'notes', label: 'Notes', width: 220 },
    // Appended deliberately at the END of the spec: every formula in this
    // workbook addresses Accounts by column letter, so inserting a column
    // anywhere earlier would silently repoint ~15 SUMIFS at the wrong data.
    { key: 'syncid', label: 'Bank_Sync_ID', width: 200,
      note: 'Filled in by 🏦 Bank Sync ▸ Link Accounts. Maps this row to an account at your bank aggregator. Clear it to stop syncing this account.' },
  ],
};


// ---------------------------------------------------------------------------
//  5b. Categories
// ---------------------------------------------------------------------------

const CATEGORIES_SPEC = {
  name: SHEET_NAMES.CATEGORIES,
  title: '🗂️ Categories — your chart of accounts',
  subtitle: 'Kind is the most load-bearing column in the workbook: it drives 50/30/20, savings rate, emergency-fund sizing and the entire projection model. Set it deliberately.',
  frozenColumns: 1,
  columns: [
    { key: 'category', label: 'Category', width: 170,
      note: 'Must be unique. This exact text is what the Transactions dropdown offers.' },
    { key: 'group', label: 'Group', width: 130,
      note: 'A display grouping (Housing, Food, Transport…). Cosmetic — Kind is what the math uses.' },
    { key: 'kind', label: 'Kind', width: 110,
      validation: () => listValidation(CATEGORY_KIND_OPTIONS),
      note: 'Essential = you would still pay it after a layoff. That test is the whole distinction, and it is what makes the emergency-fund target meaningful.' },
    { key: 'method', label: 'Target_Method', width: 150,
      validation: () => listValidation(TARGET_METHOD_OPTIONS),
      note: 'Fixed = constant. Percent_of_Income = scales with raises. Rolling_3mo_Avg = budget against actual behavior. None = tracked, not budgeted.' },
    { key: 'amount', label: 'Target_Amount', width: 120, format: CURRENCY_FORMAT,
      note: 'Used when Target_Method is Fixed.' },
    { key: 'percent', label: 'Target_%', width: 90, format: PCT_FORMAT,
      note: 'Used when Target_Method is Percent_of_Income. Applied to CFG_INCOME.' },
    { key: 'rollover', label: 'Rollover', width: 90,
      validation: () => checkboxValidation(),
      note: 'On: an unspent envelope carries into next month (right for groceries, gifts, car repair). Off: the envelope resets monthly (right for rent).' },
    { key: 'active', label: 'Active', width: 80,
      validation: () => checkboxValidation(),
      note: 'Only active categories get Budget_Monthly rows.' },
    { key: 'avg3', label: 'Avg_3mo', width: 110, format: CURRENCY_FORMAT, computed: true,
      formula: `=IF($A{r}="","",IFERROR(ABS(SUMIFS('${SHEET_NAMES.TRANSACTIONS}'!$E:$E,'${SHEET_NAMES.TRANSACTIONS}'!$D:$D,$A{r},'${SHEET_NAMES.TRANSACTIONS}'!$F:$F,"<>${TXN_TYPES.TRANSFER}",'${SHEET_NAMES.TRANSACTIONS}'!$A:$A,">="&EOMONTH(TODAY(),-4)+1,'${SHEET_NAMES.TRANSACTIONS}'!$A:$A,"<="&EOMONTH(TODAY(),-1)))/3,0))`,
      note: 'Trailing 3 complete months, excluding the current partial month. One month of groceries is noise; three is a signal.' },
    { key: 'last', label: 'Last_Month', width: 110, format: CURRENCY_FORMAT, computed: true,
      formula: `=IF($A{r}="","",IFERROR(ABS(SUMIFS('${SHEET_NAMES.TRANSACTIONS}'!$E:$E,'${SHEET_NAMES.TRANSACTIONS}'!$D:$D,$A{r},'${SHEET_NAMES.TRANSACTIONS}'!$F:$F,"<>${TXN_TYPES.TRANSFER}",'${SHEET_NAMES.TRANSACTIONS}'!$A:$A,">="&EOMONTH(TODAY(),-2)+1,'${SHEET_NAMES.TRANSACTIONS}'!$A:$A,"<="&EOMONTH(TODAY(),-1))),0))` },
    { key: 'ytd', label: 'YTD', width: 110, format: CURRENCY_FORMAT, computed: true,
      formula: `=IF($A{r}="","",IFERROR(ABS(SUMIFS('${SHEET_NAMES.TRANSACTIONS}'!$E:$E,'${SHEET_NAMES.TRANSACTIONS}'!$D:$D,$A{r},'${SHEET_NAMES.TRANSACTIONS}'!$F:$F,"<>${TXN_TYPES.TRANSFER}",'${SHEET_NAMES.TRANSACTIONS}'!$A:$A,">="&DATE(YEAR(TODAY()),1,1))),0))` },
    { key: 'notes', label: 'Notes', width: 200 },
  ],
};


// ---------------------------------------------------------------------------
//  5c. Transactions
// ---------------------------------------------------------------------------

const TRANSACTIONS_SPEC = {
  name: SHEET_NAMES.TRANSACTIONS,
  title: '📒 Transactions — the ledger everything else is derived from',
  subtitle: 'SIGN CONVENTION: money out is NEGATIVE, money in is POSITIVE, on every account type including credit cards. One rule, no exceptions — which is why account balances are a plain SUM.',
  frozenColumns: 3,
  columns: [
    { key: 'date', label: 'Date', width: 100, format: DATE_FORMAT },
    { key: 'account', label: 'Account', width: 150,
      validation: () => rangeValidation(SHEET_NAMES.ACCOUNTS, 'A') },
    { key: 'payee', label: 'Payee', width: 200,
      note: 'What the merchant is called on your statement. The Rules tab matches on this text.' },
    { key: 'category', label: 'Category', width: 150,
      validation: () => rangeValidation(SHEET_NAMES.CATEGORIES, 'A') },
    { key: 'amount', label: 'Amount', width: 110, format: CURRENCY_FORMAT,
      note: 'Negative = money left. Positive = money arrived.' },
    { key: 'type', label: 'Type', width: 100,
      validation: () => listValidation(TXN_TYPE_OPTIONS),
      note: 'Transfer excludes the row from every income and spend aggregate. Tag BOTH legs of a move between your own accounts.' },
    { key: 'cleared', label: 'Cleared', width: 80,
      validation: () => checkboxValidation(),
      note: 'Checked once the transaction has posted at the bank. Uncleared rows still count — this is for reconciliation, not filtering.' },
    { key: 'recurring', label: 'Recurring', width: 140,
      validation: () => rangeValidation(SHEET_NAMES.RECURRING, 'A'),
      note: 'Links this row to a Recurring entry so Last_Seen and occurrence counts work. Detect Recurring Bills fills this in.' },
    { key: 'notes', label: 'Notes', width: 220 },
    { key: 'monthkey', label: 'Month_Key', width: 90, computed: true,
      formula: `=IF($A{r}="","",TEXT($A{r},"yyyy-mm"))`,
      note: 'The join key for Budget_Monthly. Text, sortable, unambiguous.' },
    { key: 'hash', label: 'Tx_Hash', width: 200, computed: true, hidden: true,
      formula: `=IF($A{r}="","",TEXT($A{r},"yyyymmdd")&"|"&$B{r}&"|"&TEXT($E{r},"0.00")&"|"&LOWER(TRIM($C{r})))`,
      note: 'Dedupe key for CSV import: date + account + amount + payee. Two genuinely identical charges on one day at one merchant WILL collide — the importer reports these rather than dropping them silently.' },
    { key: 'source', label: 'Source', width: 110, hidden: true,
      note: 'Manual, Import, Sample, or Bank Sync.' },
    // Appended at the END for the same reason as Accounts.Bank_Sync_ID.
    // This is a far better dedupe key than Tx_Hash: the bank assigns it, so
    // two identical charges on the same day at the same merchant are still
    // distinguishable. Bank-synced rows dedupe on this; CSV rows fall back to
    // the hash, because a CSV export has no stable ID.
    { key: 'bankid', label: 'Bank_Txn_ID', width: 200, hidden: true,
      note: 'Provider-assigned transaction ID. Present only on bank-synced rows. Do not edit — clearing it can cause a duplicate on the next sync.' },
  ],
};


// ---------------------------------------------------------------------------
//  5d. Budget_Monthly (the envelope budget)
// ---------------------------------------------------------------------------

const BUDGET_SPEC = {
  name: SHEET_NAMES.BUDGET,
  title: '🧮 Budget_Monthly — the envelope budget, one row per month per category',
  subtitle: 'Available = Budgeted + Rollover_In − Actual. That is your envelope balance: what is genuinely left to spend, not what the calendar says you should have left.',
  frozenColumns: 3,
  rebuildable: true,
  columns: [
    { key: 'monthkey', label: 'Month_Key', width: 90, computed: true },
    { key: 'month', label: 'Month', width: 100, format: MONTH_FORMAT, computed: true },
    { key: 'category', label: 'Category', width: 160, computed: true },
    { key: 'group', label: 'Group', width: 120, computed: true,
      formula: `=IF($C{r}="","",IFERROR(INDEX('${SHEET_NAMES.CATEGORIES}'!$B:$B,MATCH($C{r},'${SHEET_NAMES.CATEGORIES}'!$A:$A,0)),""))` },
    { key: 'kind', label: 'Kind', width: 100, computed: true,
      formula: `=IF($C{r}="","",IFERROR(INDEX('${SHEET_NAMES.CATEGORIES}'!$C:$C,MATCH($C{r},'${SHEET_NAMES.CATEGORIES}'!$A:$A,0)),""))` },
    { key: 'auto', label: 'Budgeted_Auto', width: 120, format: CURRENCY_FORMAT, computed: true,
      note: 'Derived from the category Target_Method. Never edit this — edit the override beside it.',
      // LET keeps the three MATCH lookups to one evaluation each.
      formula: `=IF($C{r}="","",IFERROR(LET(cr,MATCH($C{r},'${SHEET_NAMES.CATEGORIES}'!$A:$A,0),m,INDEX('${SHEET_NAMES.CATEGORIES}'!$D:$D,cr),IFS(m="${TARGET_METHODS.PERCENT}",N(INDEX('${SHEET_NAMES.CATEGORIES}'!$F:$F,cr))*CFG_INCOME,m="${TARGET_METHODS.ROLLING}",IFERROR(ABS(SUMIFS('${SHEET_NAMES.TRANSACTIONS}'!$E:$E,'${SHEET_NAMES.TRANSACTIONS}'!$D:$D,$C{r},'${SHEET_NAMES.TRANSACTIONS}'!$F:$F,"<>${TXN_TYPES.TRANSFER}",'${SHEET_NAMES.TRANSACTIONS}'!$A:$A,">="&EOMONTH($B{r},-4)+1,'${SHEET_NAMES.TRANSACTIONS}'!$A:$A,"<="&EOMONTH($B{r},-1)))/3,0),m="${TARGET_METHODS.NONE}",0,TRUE,N(INDEX('${SHEET_NAMES.CATEGORIES}'!$E:$E,cr)))),0))` },
    { key: 'override', label: 'Budget_Override', width: 130, format: CURRENCY_FORMAT,
      manualOverride: true,
      note: 'THE ONE YELLOW COLUMN ON A COMPUTED TAB. Blank = use the auto number. Type here when this month is genuinely different (a holiday, a repair) instead of distorting the category target.' },
    { key: 'budgeted', label: 'Budgeted', width: 110, format: CURRENCY_FORMAT, computed: true,
      formula: `=IF($C{r}="","",IF($G{r}="",N($F{r}),N($G{r})))` },
    { key: 'actual', label: 'Actual', width: 110, format: CURRENCY_FORMAT, computed: true,
      note: 'Sign-flipped for non-income kinds so spending reads positive. Transfers excluded.',
      formula: `=IF($C{r}="","",IFERROR(SUMIFS('${SHEET_NAMES.TRANSACTIONS}'!$E:$E,'${SHEET_NAMES.TRANSACTIONS}'!$J:$J,$A{r},'${SHEET_NAMES.TRANSACTIONS}'!$D:$D,$C{r},'${SHEET_NAMES.TRANSACTIONS}'!$F:$F,"<>${TXN_TYPES.TRANSFER}"),0)*IF($E{r}="${CATEGORY_KINDS.INCOME}",1,-1))` },
    { key: 'variance', label: 'Variance', width: 110, format: CURRENCY_FORMAT, computed: true,
      note: 'Budgeted − Actual. Positive = under budget (or, for income, short of plan).',
      formula: `=IF($C{r}="","",$H{r}-$I{r})` },
    { key: 'pct', label: '%_Used', width: 90, format: PCT_FORMAT, computed: true,
      formula: `=IF(OR($C{r}="",N($H{r})=0),"",$I{r}/$H{r})` },
    { key: 'rollin', label: 'Rollover_In', width: 110, format: CURRENCY_FORMAT, computed: true,
      note: 'Prior month Available, but only for categories with Rollover checked. Looks itself up by Row_Key.',
      formula: `=IF($C{r}="","",IF(IFERROR(INDEX('${SHEET_NAMES.CATEGORIES}'!$G:$G,MATCH($C{r},'${SHEET_NAMES.CATEGORIES}'!$A:$A,0)),FALSE)=TRUE,IFERROR(MAX(0,INDEX($M:$M,MATCH(TEXT(EDATE($B{r},-1),"yyyy-mm")&"|"&$C{r},$N:$N,0))),0),0))` },
    { key: 'available', label: 'Available', width: 110, format: CURRENCY_FORMAT, computed: true,
      note: 'Budgeted + Rollover_In − Actual. The envelope balance.',
      formula: `=IF($C{r}="","",$H{r}+$L{r}-$I{r})` },
    { key: 'rowkey', label: 'Row_Key', width: 160, computed: true, hidden: true,
      formula: `=IF($C{r}="","",$A{r}&"|"&$C{r})` },
    // A conditional format rule may not reference another sheet — not even
    // through a named range — but a CELL formula may. So the alert threshold
    // is mirrored into one cell on this tab (the first data row) and the rule
    // reads that cell locally. Without this the whole tab fails to build.
    { key: 'cfgalert', label: 'Cfg_Alert_Pct', width: 90, computed: true, hidden: true,
      formula: `=IF(ROW()=${DATA_START_ROW},IFERROR(CFG_ALERT_PCT,0.9),"")`,
      note: 'Local mirror of CFG_ALERT_PCT from Setup. Exists only because conditional formatting cannot read across sheets.' },
  ],
};


// ---------------------------------------------------------------------------
//  5e. Recurring (subscription manager)
// ---------------------------------------------------------------------------

const RECURRING_SPEC = {
  name: SHEET_NAMES.RECURRING,
  title: '🔁 Recurring — bills and subscriptions',
  subtitle: 'Annualized is the column that changes behavior. $14.99/mo is easy to keep; $179.88/yr is a decision. Sort by it before you review anything else.',
  frozenColumns: 1,
  columns: [
    { key: 'name', label: 'Name', width: 170,
      note: 'Must be unique. This is what the Transactions ▸ Recurring dropdown offers.' },
    { key: 'match', label: 'Match_Text', width: 170,
      note: 'Payee text that identifies this charge on a statement. Used by Detect Recurring Bills and the rules engine.' },
    { key: 'amount', label: 'Amount', width: 110, format: CURRENCY_FORMAT,
      note: 'Per-occurrence cost, entered POSITIVE here (this is a plan, not a ledger row).' },
    { key: 'cadence', label: 'Cadence', width: 110,
      validation: () => listValidation(CADENCE_OPTIONS) },
    { key: 'nextdue', label: 'Next_Due', width: 110, format: DATE_FORMAT },
    { key: 'account', label: 'Account', width: 140,
      validation: () => rangeValidation(SHEET_NAMES.ACCOUNTS, 'A') },
    { key: 'category', label: 'Category', width: 140,
      validation: () => rangeValidation(SHEET_NAMES.CATEGORIES, 'A') },
    { key: 'status', label: 'Status', width: 100,
      validation: () => listValidation(RECURRING_STATUS_OPTIONS),
      note: 'Watch = a candidate for cancellation. Cancelled entries stop counting toward the annualized total.' },
    { key: 'monthly', label: 'Monthly_Equiv', width: 120, format: CURRENCY_FORMAT, computed: true,
      formula: `=IF($A{r}="","",IFERROR(N($C{r})*SWITCH($D{r},${cadenceSwitchArgs()})/12,0))`,
      note: 'Annualized ÷ 12. This is the number to compare against a monthly budget line — an annual $600 insurance bill is $50/mo of real obligation.' },
    { key: 'annual', label: 'Annualized', width: 120, format: CURRENCY_FORMAT, computed: true,
      formula: `=IF($A{r}="","",IFERROR(N($C{r})*SWITCH($D{r},${cadenceSwitchArgs()}),0))` },
    { key: 'daysuntil', label: 'Days_Until', width: 100, format: '0', computed: true,
      formula: `=IF(OR($A{r}="",$E{r}=""),"",INT($E{r})-TODAY())` },
    { key: 'lastseen', label: 'Last_Seen', width: 110, format: DATE_FORMAT, computed: true,
      formula: `=IF($A{r}="","",IFERROR(IF(MAXIFS('${SHEET_NAMES.TRANSACTIONS}'!$A:$A,'${SHEET_NAMES.TRANSACTIONS}'!$H:$H,$A{r})=0,"",MAXIFS('${SHEET_NAMES.TRANSACTIONS}'!$A:$A,'${SHEET_NAMES.TRANSACTIONS}'!$H:$H,$A{r})),""))` },
    { key: 'count12', label: 'Hits_12mo', width: 100, format: '0', computed: true,
      formula: `=IF($A{r}="","",IFERROR(COUNTIFS('${SHEET_NAMES.TRANSACTIONS}'!$H:$H,$A{r},'${SHEET_NAMES.TRANSACTIONS}'!$A:$A,">="&EDATE(TODAY(),-12)),0))` },
    { key: 'drift', label: 'Price_Drift', width: 110, format: CURRENCY_FORMAT, computed: true,
      note: 'Most recent charge minus the amount you recorded. Non-zero means the price changed and you may not have noticed — the reason subscription creep works.',
      formula: `=IF(OR($A{r}="",$L{r}=""),"",IFERROR(ABS(SUMIFS('${SHEET_NAMES.TRANSACTIONS}'!$E:$E,'${SHEET_NAMES.TRANSACTIONS}'!$H:$H,$A{r},'${SHEET_NAMES.TRANSACTIONS}'!$A:$A,$L{r}))-N($C{r}),""))` },
    { key: 'notes', label: 'Notes', width: 200 },
  ],
};

/** SWITCH() argument list mapping a cadence to payments per year. */
function cadenceSwitchArgs() {
  const parts = Object.keys(CADENCE_PER_YEAR).map(k => `"${k}",${CADENCE_PER_YEAR[k]}`);
  parts.push('12'); // default
  return parts.join(',');
}


// ---------------------------------------------------------------------------
//  5f. Goals
// ---------------------------------------------------------------------------

const GOALS_SPEC = {
  name: SHEET_NAMES.GOALS,
  title: '🎯 Goals — sinking funds and savings targets',
  subtitle: 'Required_Monthly back-solves what the goal actually demands. On_Track compares that to what you are actually contributing — the gap is the only honest signal here.',
  frozenColumns: 1,
  columns: [
    { key: 'goal', label: 'Goal', width: 180 },
    { key: 'type', label: 'Type', width: 130,
      validation: () => listValidation(GOAL_TYPE_OPTIONS) },
    { key: 'target', label: 'Target_Amount', width: 130, format: CURRENCY_FORMAT },
    { key: 'targetdate', label: 'Target_Date', width: 110, format: DATE_FORMAT },
    { key: 'saved', label: 'Current_Saved', width: 130, format: CURRENCY_FORMAT },
    { key: 'monthly', label: 'Monthly_Contribution', width: 150, format: CURRENCY_FORMAT,
      note: 'What you are actually putting in each month.' },
    { key: 'priority', label: 'Priority', width: 80, format: '0',
      note: '1 = fund first. Emergency fund before investing before discretionary goals is the conventional order.' },
    { key: 'funded', label: 'Funded_%', width: 90, format: PCT_FORMAT, computed: true,
      formula: `=IF(OR($A{r}="",N($C{r})=0),"",MIN(1,N($E{r})/$C{r}))` },
    { key: 'remaining', label: 'Remaining', width: 110, format: CURRENCY_FORMAT, computed: true,
      formula: `=IF($A{r}="","",MAX(0,N($C{r})-N($E{r})))` },
    { key: 'monthsleft', label: 'Months_Left', width: 100, format: '0', computed: true,
      formula: `=IF(OR($A{r}="",$D{r}=""),"",MAX(0,DATEDIF(TODAY(),$D{r},"M")))` },
    { key: 'required', label: 'Required_Monthly', width: 140, format: CURRENCY_FORMAT, computed: true,
      note: 'Remaining ÷ months left. If this exceeds what you can contribute, the target date is the thing to move — not the savings rate.',
      formula: `=IF(OR($A{r}="",$J{r}=""),"",IF($J{r}=0,$I{r},$I{r}/$J{r}))` },
    { key: 'projdate', label: 'Projected_Date', width: 120, format: DATE_FORMAT, computed: true,
      formula: `=IF(OR($A{r}="",N($F{r})=0),"",EDATE(TODAY(),CEILING($I{r}/$F{r})))` },
    { key: 'ontrack', label: 'On_Track', width: 110, computed: true,
      formula: `=IF($A{r}="","",IF($I{r}=0,"✅ Funded",IF($K{r}="","—",IF(N($F{r})>=$K{r},"✅ On track","⚠️ Short "&TEXT($K{r}-N($F{r}),"${CURRENCY_FORMAT}")&"/mo"))))` },
    { key: 'notes', label: 'Notes', width: 200 },
  ],
};


// ---------------------------------------------------------------------------
//  5g. Debts
// ---------------------------------------------------------------------------

const DEBTS_SPEC = {
  name: SHEET_NAMES.DEBTS,
  title: '💳 Debts — balances, payoff order and true interest cost',
  subtitle: 'Strategy_Rank follows CFG_DEBT_STRATEGY on the Setup tab. Avalanche minimizes interest paid; snowball clears small balances first for momentum. Both are defensible — pick the one you will actually follow.',
  frozenColumns: 1,
  columns: [
    { key: 'debt', label: 'Debt', width: 170 },
    { key: 'account', label: 'Account', width: 140,
      validation: () => rangeValidation(SHEET_NAMES.ACCOUNTS, 'A') },
    { key: 'balance', label: 'Balance', width: 120, format: CURRENCY_FORMAT,
      note: 'What you owe, entered POSITIVE here.' },
    { key: 'apr', label: 'APR_%', width: 90, format: PCT_FORMAT },
    { key: 'minpay', label: 'Min_Payment', width: 110, format: CURRENCY_FORMAT },
    { key: 'extra', label: 'Extra_Payment', width: 120, format: CURRENCY_FORMAT,
      note: 'Anything above the minimum. Put every spare dollar on the rank-1 debt only; splitting extra payments across debts is strictly worse under either strategy.' },
    { key: 'rank', label: 'Strategy_Rank', width: 120, format: '0', computed: true,
      formula: `=IF($A{r}="","",IF(CFG_DEBT_STRATEGY="${DEBT_STRATEGIES.SNOWBALL}",RANK($C{r},$C$${DATA_START_ROW}:$C$${DATA_START_ROW + DATA_ROWS - 1},1),RANK($D{r},$D$${DATA_START_ROW}:$D$${DATA_START_ROW + DATA_ROWS - 1},0)))` },
    { key: 'totalpay', label: 'Total_Payment', width: 120, format: CURRENCY_FORMAT, computed: true,
      formula: `=IF($A{r}="","",N($E{r})+N($F{r}))` },
    { key: 'months', label: 'Months_To_Payoff', width: 130, format: '0', computed: true,
      note: 'NPER at the current payment. Blank means the payment does not cover the interest — the balance grows forever, which is exactly what that blank is telling you.',
      formula: `=IF(OR($A{r}="",N($H{r})=0),"",IFERROR(CEILING(NPER($D{r}/12,-$H{r},$C{r})),"⚠️ never"))` },
    { key: 'payoff', label: 'Payoff_Date', width: 110, format: DATE_FORMAT, computed: true,
      formula: `=IF(OR($A{r}="",NOT(ISNUMBER($I{r}))),"",EDATE(TODAY(),$I{r}))` },
    { key: 'interest', label: 'Total_Interest', width: 120, format: CURRENCY_FORMAT, computed: true,
      note: 'What the borrowing costs in total. Often the number that makes an avalanche worth starting.',
      formula: `=IF(OR($A{r}="",NOT(ISNUMBER($I{r}))),"",MAX(0,$H{r}*$I{r}-$C{r}))` },
    { key: 'notes', label: 'Notes', width: 200 },
  ],
};


// ---------------------------------------------------------------------------
//  5h. Net_Worth (frozen monthly snapshots)
// ---------------------------------------------------------------------------

const NET_WORTH_SPEC = {
  name: SHEET_NAMES.NET_WORTH,
  title: '📈 Net_Worth — month-end snapshots',
  subtitle: 'These are FROZEN VALUES, not formulas. History must not rewrite itself when you correct an old transaction — a net worth series that changes retroactively is not a record of anything.',
  frozenColumns: 1,
  appendOnly: true,
  columns: [
    { key: 'month', label: 'Month', width: 110, format: MONTH_FORMAT },
    { key: 'assets', label: 'Assets', width: 130, format: CURRENCY_FORMAT },
    { key: 'liabilities', label: 'Liabilities', width: 130, format: CURRENCY_FORMAT },
    { key: 'networth', label: 'Net_Worth', width: 130, format: CURRENCY_FORMAT, computed: true,
      formula: `=IF($A{r}="","",N($B{r})-N($C{r}))` },
    { key: 'change', label: 'MoM_Change', width: 120, format: CURRENCY_FORMAT, computed: true,
      formula: `=IF(OR($A{r}="",{r}<=${DATA_START_ROW},$A${DATA_START_ROW}=""),"",IF($A{prev}="","",$D{r}-$D{prev}))` },
    { key: 'changepct', label: 'MoM_%', width: 90, format: PCT_FORMAT, computed: true,
      formula: `=IF(OR($A{r}="",{r}<=${DATA_START_ROW}),"",IFERROR($E{r}/ABS($D{prev}),""))` },
    { key: 'income', label: 'Income', width: 120, format: CURRENCY_FORMAT },
    { key: 'spend', label: 'Spend', width: 120, format: CURRENCY_FORMAT },
    { key: 'rate', label: 'Savings_Rate', width: 110, format: PCT_FORMAT, computed: true,
      formula: `=IF(OR($A{r}="",N($G{r})=0),"",($G{r}-N($H{r}))/$G{r})` },
    { key: 'notes', label: 'Notes', width: 240 },
  ],
};


// ---------------------------------------------------------------------------
//  5i. Rules (auto-categorization)
// ---------------------------------------------------------------------------

const RULES_SPEC = {
  name: SHEET_NAMES.RULES,
  title: '⚙️ Rules — automatic categorization',
  subtitle: 'Rules run in Priority order, first match wins, and only ever touch rows with a BLANK category. A rule can never overwrite a category you set by hand.',
  frozenColumns: 1,
  columns: [
    { key: 'priority', label: 'Priority', width: 80, format: '0',
      note: 'Lower runs first. Put specific rules above general ones ("Amazon Prime" before "Amazon").' },
    { key: 'matchtype', label: 'Match_Type', width: 110,
      validation: () => listValidation(RULE_MATCH_TYPES) },
    { key: 'matchtext', label: 'Match_Text', width: 200,
      note: 'Case-insensitive. For Regex, standard JavaScript syntax.' },
    { key: 'category', label: 'Set_Category', width: 150,
      validation: () => rangeValidation(SHEET_NAMES.CATEGORIES, 'A') },
    { key: 'type', label: 'Set_Type', width: 110,
      validation: () => listValidation(TXN_TYPE_OPTIONS) },
    { key: 'recurring', label: 'Set_Recurring', width: 140,
      validation: () => rangeValidation(SHEET_NAMES.RECURRING, 'A') },
    { key: 'active', label: 'Active', width: 80,
      validation: () => checkboxValidation() },
    { key: 'hits', label: 'Hits', width: 80, format: '0',
      note: 'Incremented by Apply Rules. A rule with 0 hits after a few runs is either wrong or unnecessary.' },
    { key: 'notes', label: 'Notes', width: 200 },
  ],
};


// ---------------------------------------------------------------------------
//  5j. Import (CSV staging)
// ---------------------------------------------------------------------------

const IMPORT_SPEC = {
  name: SHEET_NAMES.IMPORT,
  title: '📥 Import — paste a bank CSV export here',
  subtitle: 'Paste rows below (headers optional), set the Account, then 💰 Finance ▸ Import Staged Rows. Duplicates are detected by date + account + amount + payee, so re-importing an overlapping export is safe.',
  frozenColumns: 1,
  columns: [
    { key: 'date', label: 'Date', width: 110, format: DATE_FORMAT },
    { key: 'payee', label: 'Payee', width: 240 },
    { key: 'amount', label: 'Amount', width: 120, format: CURRENCY_FORMAT,
      note: 'Negative = money out. If your bank exports positive debits, use Flip Sign On Import when prompted.' },
    { key: 'account', label: 'Account', width: 150,
      validation: () => rangeValidation(SHEET_NAMES.ACCOUNTS, 'A'),
      note: 'Leave blank to be asked once for the whole batch.' },
    { key: 'category', label: 'Category', width: 150,
      validation: () => rangeValidation(SHEET_NAMES.CATEGORIES, 'A'),
      note: 'Optional. Blank categories get filled by the Rules engine on import.' },
    { key: 'notes', label: 'Notes', width: 200 },
    { key: 'status', label: 'Status', width: 200, computed: true,
      note: 'Filled in by the importer: Imported, Duplicate, or an error.' },
  ],
};


/** Every tabular spec, in build order. */
const TABULAR_SPECS = [
  ACCOUNTS_SPEC,
  CATEGORIES_SPEC,
  TRANSACTIONS_SPEC,
  BUDGET_SPEC,
  RECURRING_SPEC,
  GOALS_SPEC,
  DEBTS_SPEC,
  NET_WORTH_SPEC,
  RULES_SPEC,
  IMPORT_SPEC,
];


// ============================================================================
//  6. VALIDATION HELPERS
// ============================================================================

function listValidation(options) {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(options, true)
    .setAllowInvalid(false)
    .build();
}

function checkboxValidation() {
  return SpreadsheetApp.newDataValidation().requireCheckbox().build();
}

/**
 * A dropdown sourced from another tab's column, so adding an account or
 * category immediately offers it everywhere without a script run.
 * setAllowInvalid(true): a typo should be a warning, not a hard block, or an
 * import of otherwise-good rows fails on one unknown payee.
 */
function rangeValidation(sheetName, columnLetter) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return null;
  const range = sheet.getRange(`${columnLetter}${DATA_START_ROW}:${columnLetter}${DATA_START_ROW + DATA_ROWS - 1}`);
  return SpreadsheetApp.newDataValidation()
    .requireValueInRange(range, true)
    .setAllowInvalid(true)
    .build();
}
