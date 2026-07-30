/**
 * ============================================================================
 *  💰  PERSONAL FINANCE TRACKER  —  PART 3: ACTIONS
 * ============================================================================
 *  The operations behind the 💰 Finance menu. Everything here reads and writes
 *  in BULK (getValues / setValues over a whole range), never cell-by-cell —
 *  Apps Script pays a round trip per range call, and a per-cell loop over a
 *  few thousand transactions is the difference between 2 seconds and a
 *  timeout.
 *
 *  Every mutating action takes a document lock. Two of these running at once
 *  (a menu click while a previous run is still going) would interleave writes
 *  into the same ranges, and the failure mode is silent duplicate rows rather
 *  than an error — the worst kind of bug to have in a ledger.
 * ============================================================================
 */

const ACTION_LOCK_WAIT_MS = 30 * 1000;

/** Wrap a mutating action in a document lock and a toast. */
function withLock(label, fn) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(ACTION_LOCK_WAIT_MS)) {
    SpreadsheetApp.getUi().alert(
      'Another Finance operation is already running. Wait for it to finish and try again.');
    return null;
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** First row on a sheet with nothing in the given column, at or after DATA_START_ROW. */
function firstEmptyRow(sheet, col) {
  const values = sheet.getRange(DATA_START_ROW, col, DATA_ROWS, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === '' || values[i][0] === null) return DATA_START_ROW + i;
  }
  return DATA_START_ROW + DATA_ROWS;
}

/** Count of populated rows in a column. */
function countRows(sheet, col) {
  return firstEmptyRow(sheet, col) - DATA_START_ROW;
}

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  const s = ss_().getSheetByName(name);
  if (!s) throw new Error(`Missing sheet "${name}". Run 💰 Finance ▸ Initialize / Repair Workbook.`);
  return s;
}

/** First of the month, local time. */
function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthKey(date) {
  const m = date.getMonth() + 1;
  return `${date.getFullYear()}-${m < 10 ? '0' : ''}${m}`;
}

/** Read a CFG_* named range's value. */
function cfg(name, fallback) {
  try {
    const range = ss_().getRangeByName(name);
    if (!range) return fallback;
    const v = range.getValue();
    return (v === '' || v === null) ? fallback : v;
  } catch (err) {
    return fallback;
  }
}


// ============================================================================
//  14. REBUILD BUDGET MONTHS
// ============================================================================

/**
 * Regenerates the Month/Category skeleton on Budget_Monthly. Every other
 * column on that tab is a fill-down formula already in place, so this only
 * writes columns A–C and then restores the manual overrides.
 *
 * PRESERVING OVERRIDES IS THE ENTIRE DIFFICULTY HERE. A user's "December is
 * different, budget $600 for gifts" must survive a rebuild, and rows move
 * whenever a category is added — so overrides are keyed by month|category and
 * re-placed by key, never by row position.
 */
function rebuildBudgetMonths(silent) {
  return withLock('rebuild', () => {
    const budget = sheet_(SHEET_NAMES.BUDGET);
    const cats = sheet_(SHEET_NAMES.CATEGORIES);

    // --- Active categories, in a stable display order.
    const catRows = cats.getRange(DATA_START_ROW, 1, DATA_ROWS, 8).getValues()
      .filter(r => String(r[0]).trim() !== '');
    const active = catRows.filter(r => r[7] === true || r[7] === 'TRUE');
    if (!active.length) {
      if (!silent) SpreadsheetApp.getUi().alert(
        'No active categories. Add some on the Categories tab (or run Load Sample Data), then rebuild.');
      return 0;
    }

    const kindOrder = {};
    CATEGORY_KIND_OPTIONS.forEach((k, i) => { kindOrder[k] = i; });
    active.sort((a, b) => {
      const ka = kindOrder[a[2]] === undefined ? 99 : kindOrder[a[2]];
      const kb = kindOrder[b[2]] === undefined ? 99 : kindOrder[b[2]];
      if (ka !== kb) return ka - kb;
      if (a[1] !== b[1]) return String(a[1]).localeCompare(String(b[1]));
      return String(a[0]).localeCompare(String(b[0]));
    });

    // --- Month window.
    const hist = Math.max(0, Math.min(120, Number(cfg('CFG_HIST_MONTHS', 12)) || 12));
    const future = Math.max(0, Math.min(120, Number(cfg('CFG_FUTURE_MONTHS', 12)) || 12));
    const base = monthStart(new Date());
    const months = [];
    for (let i = -hist; i <= future; i++) {
      months.push(new Date(base.getFullYear(), base.getMonth() + i, 1));
    }

    const total = months.length * active.length;
    if (total > DATA_ROWS) {
      SpreadsheetApp.getUi().alert(
        `That window needs ${total} rows but the tab holds ${DATA_ROWS}. ` +
        `Reduce the history/future months on Setup, or deactivate unused categories.`);
      return 0;
    }

    // --- Capture existing overrides before anything moves.
    const overrideCol = colOf(BUDGET_SPEC, 'override');
    const existing = budget.getRange(DATA_START_ROW, 1, DATA_ROWS, overrideCol).getValues();
    const overrides = {};
    existing.forEach(row => {
      const key = `${row[0]}|${row[2]}`;
      const val = row[overrideCol - 1];
      if (row[0] !== '' && val !== '' && val !== null) overrides[key] = val;
    });

    // --- Build the new skeleton.
    const skeleton = [];
    const overrideCells = [];
    months.forEach(m => {
      const key = monthKey(m);
      active.forEach(c => {
        skeleton.push([key, m, c[0]]);
        overrideCells.push([overrides[`${key}|${c[0]}`] === undefined ? '' : overrides[`${key}|${c[0]}`]]);
      });
    });

    // --- Write. Clear the tail so a shrunk window leaves no orphan rows.
    budget.getRange(DATA_START_ROW, 1, DATA_ROWS, 3).clearContent();
    budget.getRange(DATA_START_ROW, overrideCol, DATA_ROWS, 1).clearContent();
    budget.getRange(DATA_START_ROW, 1, skeleton.length, 3).setValues(skeleton);
    budget.getRange(DATA_START_ROW, overrideCol, overrideCells.length, 1).setValues(overrideCells);
    budget.getRange(DATA_START_ROW, 2, skeleton.length, 1).setNumberFormat(MONTH_FORMAT);

    const restored = Object.keys(overrides).length;
    blog(`rebuildBudgetMonths: ${skeleton.length} rows, ${restored} overrides restored`);
    if (!silent) {
      ss_().toast(
        `${months.length} months × ${active.length} categories = ${skeleton.length} rows. ` +
        `${restored} override(s) preserved.`, '💰 Budget rebuilt', 6);
    }
    return skeleton.length;
  });
}


// ============================================================================
//  15. CATEGORIZATION RULES
// ============================================================================

/**
 * Applies the Rules tab to uncategorized transactions.
 *
 * TWO INVARIANTS, both non-negotiable:
 *   1. A rule only ever fills a BLANK category. It cannot overwrite a category
 *      a human set. Auto-categorization that second-guesses a correction is
 *      worse than none, because it destroys trust in every other number.
 *   2. First match by priority wins, so specific rules can be ordered above
 *      general ones ("Amazon Prime" → Subscriptions before "Amazon" → Shopping).
 */
function applyRules() {
  return withLock('rules', () => {
    const txns = sheet_(SHEET_NAMES.TRANSACTIONS);
    const rulesSheet = sheet_(SHEET_NAMES.RULES);

    const rules = rulesSheet.getRange(DATA_START_ROW, 1, DATA_ROWS, 9).getValues()
      .map((r, i) => ({
        row: DATA_START_ROW + i,
        priority: Number(r[0]) || 999,
        matchType: String(r[1] || 'Contains'),
        matchText: String(r[2] || '').trim(),
        category: r[3],
        type: r[4],
        recurring: r[5],
        active: r[6] === true || r[6] === 'TRUE',
        hits: Number(r[7]) || 0,
      }))
      .filter(r => r.active && r.matchText !== '' && r.category !== '');

    if (!rules.length) {
      SpreadsheetApp.getUi().alert(
        'No active rules yet.\n\nAdd them on the Rules tab: match text from a payee, the category to set, ' +
        'and tick Active. Rules run in Priority order and only fill blank categories.');
      return 0;
    }
    rules.sort((a, b) => a.priority - b.priority);

    const cPayee = colOf(TRANSACTIONS_SPEC, 'payee');
    const cCat = colOf(TRANSACTIONS_SPEC, 'category');
    const cType = colOf(TRANSACTIONS_SPEC, 'type');
    const cRec = colOf(TRANSACTIONS_SPEC, 'recurring');
    const width = cRec - cPayee + 1;

    const range = txns.getRange(DATA_START_ROW, cPayee, DATA_ROWS, width);
    const data = range.getValues();

    const iPayee = 0;
    const iCat = cCat - cPayee;
    const iType = cType - cPayee;
    const iRec = cRec - cPayee;

    let applied = 0;
    const hitCounts = {};

    data.forEach(row => {
      const payee = String(row[iPayee] || '').trim();
      if (!payee) return;
      if (row[iCat] !== '' && row[iCat] !== null) return;   // invariant 1

      const rule = rules.find(r => matchesRule(payee, r));
      if (!rule) return;

      row[iCat] = rule.category;
      if ((row[iType] === '' || row[iType] === null) && rule.type) row[iType] = rule.type;
      if ((row[iRec] === '' || row[iRec] === null) && rule.recurring) row[iRec] = rule.recurring;
      applied++;
      hitCounts[rule.row] = (hitCounts[rule.row] || 0) + 1;
    });

    if (applied) range.setValues(data);

    // Fold new hits into the running totals on the Rules tab.
    const hitsCol = colOf(RULES_SPEC, 'hits');
    const hitsRange = rulesSheet.getRange(DATA_START_ROW, hitsCol, DATA_ROWS, 1);
    const hitsVals = hitsRange.getValues();
    Object.keys(hitCounts).forEach(rowStr => {
      const idx = Number(rowStr) - DATA_START_ROW;
      hitsVals[idx][0] = (Number(hitsVals[idx][0]) || 0) + hitCounts[rowStr];
    });
    hitsRange.setValues(hitsVals);

    const remaining = countUncategorized(txns);
    ss_().toast(
      `${applied} transaction(s) categorized. ${remaining} still uncategorized.`,
      '⚙️ Rules applied', 6);
    blog(`applyRules: ${applied} applied, ${remaining} remaining`);
    return applied;
  });
}

/** Case-insensitive matching. Regex failures are swallowed — a bad pattern
 *  should not abort a run over thousands of good rows. */
function matchesRule(payee, rule) {
  const p = payee.toLowerCase();
  const m = rule.matchText.toLowerCase();
  switch (rule.matchType) {
    case 'Exact': return p === m;
    case 'Starts With': return p.indexOf(m) === 0;
    case 'Ends With': return p.length >= m.length && p.lastIndexOf(m) === p.length - m.length;
    case 'Regex':
      try { return new RegExp(rule.matchText, 'i').test(payee); }
      catch (err) { blog(`bad regex "${rule.matchText}": ${err}`); return false; }
    case 'Contains':
    default: return p.indexOf(m) !== -1;
  }
}

function countUncategorized(txns) {
  const cDate = colOf(TRANSACTIONS_SPEC, 'date');
  const cCat = colOf(TRANSACTIONS_SPEC, 'category');
  const data = txns.getRange(DATA_START_ROW, cDate, DATA_ROWS, cCat - cDate + 1).getValues();
  return data.filter(r => r[0] !== '' && r[0] !== null &&
    (r[cCat - cDate] === '' || r[cCat - cDate] === null)).length;
}


// ============================================================================
//  16. CSV IMPORT
// ============================================================================

/**
 * Moves rows from the Import staging tab into the ledger.
 *
 * Dedupe is by date + account + amount + payee. That is deliberately a
 * CONTENT hash rather than a bank-supplied transaction ID, because CSV
 * exports from different institutions share no ID scheme and re-exporting an
 * overlapping date range is the normal way people use this. The tradeoff is
 * real: two genuinely distinct identical charges on the same day at the same
 * merchant collide, and the second is reported as a duplicate. The importer
 * says so per row rather than dropping anything silently, so you can override
 * by nudging one payee string.
 */
function importStagedRows() {
  return withLock('import', () => {
    const ui = SpreadsheetApp.getUi();
    const staging = sheet_(SHEET_NAMES.IMPORT);
    const txns = sheet_(SHEET_NAMES.TRANSACTIONS);

    const width = IMPORT_SPEC.columns.length;
    const stageRange = staging.getRange(DATA_START_ROW, 1, DATA_ROWS, width);
    const rows = stageRange.getValues();
    const populated = rows.filter(r => r[0] !== '' && r[0] !== null);

    if (!populated.length) {
      ui.alert('Nothing to import.\n\nPaste your bank export onto the Import tab first — ' +
        'Date, Payee and Amount are the only required columns.');
      return 0;
    }

    // --- One question for the whole batch, not one per row.
    const accounts = readColumn(sheet_(SHEET_NAMES.ACCOUNTS), 1);
    if (!accounts.length) {
      ui.alert('Add at least one account on the Accounts tab before importing.');
      return 0;
    }
    const missingAccount = populated.some(r => String(r[3] || '').trim() === '');
    let defaultAccount = '';
    if (missingAccount) {
      const resp = ui.prompt('Import — which account?',
        `${populated.length} row(s) staged. Some have no Account set.\n\n` +
        `Type the account for those rows:\n  ${accounts.join('\n  ')}`,
        ui.ButtonSet.OK_CANCEL);
      if (resp.getSelectedButton() !== ui.Button.OK) return 0;
      defaultAccount = resp.getResponseText().trim();
      if (accounts.indexOf(defaultAccount) === -1) {
        ui.alert(`"${defaultAccount}" is not on the Accounts tab. Add it first, or fix the spelling.`);
        return 0;
      }
    }

    // --- Sign convention check. Many banks export debits as positive numbers,
    //     which would invert every balance in the workbook if imported as-is.
    const positives = populated.filter(r => Number(r[2]) > 0).length;
    let flip = false;
    if (positives > populated.length * 0.8) {
      const ans = ui.alert('Check the sign convention',
        `${positives} of ${populated.length} staged rows have a POSITIVE amount.\n\n` +
        `This workbook expects money leaving an account to be NEGATIVE. If your bank ` +
        `exported debits as positive numbers, flip them now.\n\n` +
        `Flip the sign on all staged rows?`, ui.ButtonSet.YES_NO_CANCEL);
      if (ans === ui.Button.CANCEL) return 0;
      flip = (ans === ui.Button.YES);
    }

    // --- Existing hashes.
    const cHash = colOf(TRANSACTIONS_SPEC, 'hash');
    const existingHashes = {};
    txns.getRange(DATA_START_ROW, cHash, DATA_ROWS, 1).getValues()
      .forEach(r => { if (r[0]) existingHashes[String(r[0])] = true; });

    // --- Build the rows to append.
    const nTxnCols = TRANSACTIONS_SPEC.columns.length;
    const toAppend = [];
    const statuses = [];
    let imported = 0, dupes = 0, errors = 0;

    rows.forEach(r => {
      if (r[0] === '' || r[0] === null) { statuses.push(['']); return; }

      const date = coerceDate(r[0]);
      const payee = String(r[1] || '').trim();
      let amount = Number(r[2]);
      const account = String(r[3] || '').trim() || defaultAccount;
      const category = r[4] || '';
      const notes = r[5] || '';

      if (!date) { statuses.push(['⚠️ Unreadable date']); errors++; return; }
      if (isNaN(amount)) { statuses.push(['⚠️ Amount is not a number']); errors++; return; }
      if (!account) { statuses.push(['⚠️ No account']); errors++; return; }
      if (flip) amount = -amount;

      const hash = txnHash(date, account, amount, payee);
      if (existingHashes[hash]) {
        statuses.push(['Duplicate — already in the ledger']);
        dupes++;
        return;
      }
      existingHashes[hash] = true;   // guards duplicates *within* one batch too

      const row = new Array(nTxnCols).fill('');
      row[colOf(TRANSACTIONS_SPEC, 'date') - 1] = date;
      row[colOf(TRANSACTIONS_SPEC, 'account') - 1] = account;
      row[colOf(TRANSACTIONS_SPEC, 'payee') - 1] = payee;
      row[colOf(TRANSACTIONS_SPEC, 'category') - 1] = category;
      row[colOf(TRANSACTIONS_SPEC, 'amount') - 1] = amount;
      row[colOf(TRANSACTIONS_SPEC, 'type') - 1] = amount >= 0 ? TXN_TYPES.INCOME : TXN_TYPES.EXPENSE;
      row[colOf(TRANSACTIONS_SPEC, 'notes') - 1] = notes;
      row[colOf(TRANSACTIONS_SPEC, 'source') - 1] = 'Import';
      toAppend.push(row);
      statuses.push([`Imported ${Utilities.formatDate(date, ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd')}`]);
      imported++;
    });

    // --- Append, writing only the manual columns so the formula columns
    //     (Month_Key, Tx_Hash) keep their fill-down formulas intact.
    if (toAppend.length) {
      const start = firstEmptyRow(txns, colOf(TRANSACTIONS_SPEC, 'date'));
      if (start + toAppend.length > DATA_START_ROW + DATA_ROWS) {
        ui.alert(`Not enough room: the ledger holds ${DATA_ROWS} rows and this import would exceed it.`);
        return 0;
      }
      const manualCols = TRANSACTIONS_SPEC.columns
        .map((c, i) => ({ c, i }))
        .filter(x => !x.c.computed);
      manualCols.forEach(({ i }) => {
        const colVals = toAppend.map(r => [r[i]]);
        txns.getRange(start, i + 1, colVals.length, 1).setValues(colVals);
      });
      txns.getRange(start, colOf(TRANSACTIONS_SPEC, 'date'), toAppend.length, 1)
        .setNumberFormat(DATE_FORMAT);
    }

    // --- Report per row on the staging tab.
    const statusCol = colOf(IMPORT_SPEC, 'status');
    while (statuses.length < DATA_ROWS) statuses.push(['']);
    staging.getRange(DATA_START_ROW, statusCol, DATA_ROWS, 1).setValues(statuses);

    if (imported) applyRules();

    ui.alert('Import complete',
      `Imported:   ${imported}\n` +
      `Duplicates: ${dupes}\n` +
      `Errors:     ${errors}\n\n` +
      (imported ? 'Categorization rules were applied to the new rows.\n\n' : '') +
      'Per-row detail is in the Status column. Clear the staging rows when you are happy with them.',
      ui.ButtonSet.OK);

    blog(`import: ${imported} in, ${dupes} dupes, ${errors} errors`);
    return imported;
  });
}

/** Mirrors the Tx_Hash formula on the Transactions tab. Both must agree. */
function txnHash(date, account, amount, payee) {
  const d = Utilities.formatDate(date, ss_().getSpreadsheetTimeZone(), 'yyyyMMdd');
  return `${d}|${account}|${Number(amount).toFixed(2)}|${String(payee).trim().toLowerCase()}`;
}

/** Accepts a Date, or the common textual forms banks export. */
function coerceDate(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  const s = String(v || '').trim();
  if (!s) return null;
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed;
  // dd/mm/yyyy — Date() reads this as US mm/dd, so handle it explicitly.
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const d = new Date(y, Number(m[1]) - 1, Number(m[2]));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function readColumn(sheet, col) {
  return sheet.getRange(DATA_START_ROW, col, DATA_ROWS, 1).getValues()
    .map(r => String(r[0]).trim())
    .filter(v => v !== '');
}


// ============================================================================
//  17. RECURRING DETECTION
// ============================================================================

/**
 * Finds repeating charges in the ledger and proposes Recurring entries.
 *
 * The heuristic: same payee, at least 3 charges in the last 12 months, and a
 * MEDIAN gap between them that lands near a known cadence. Median rather than
 * mean because one skipped or double-billed month should not drag the estimate
 * — that is exactly the noise this is meant to see through.
 *
 * It proposes; it does not decide. New entries land with status Watch so they
 * are visibly unreviewed, and nothing already on the tab is modified.
 */
function detectRecurring() {
  return withLock('detect', () => {
    const ui = SpreadsheetApp.getUi();
    const txns = sheet_(SHEET_NAMES.TRANSACTIONS);
    const rec = sheet_(SHEET_NAMES.RECURRING);

    const nCols = TRANSACTIONS_SPEC.columns.length;
    const data = txns.getRange(DATA_START_ROW, 1, DATA_ROWS, nCols).getValues();
    const iDate = colOf(TRANSACTIONS_SPEC, 'date') - 1;
    const iPayee = colOf(TRANSACTIONS_SPEC, 'payee') - 1;
    const iAmt = colOf(TRANSACTIONS_SPEC, 'amount') - 1;
    const iCat = colOf(TRANSACTIONS_SPEC, 'category') - 1;
    const iAcct = colOf(TRANSACTIONS_SPEC, 'account') - 1;
    const iType = colOf(TRANSACTIONS_SPEC, 'type') - 1;

    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);

    const groups = {};
    data.forEach(r => {
      const d = r[iDate];
      if (!(d instanceof Date) || d < cutoff) return;
      if (Number(r[iAmt]) >= 0) return;                       // outflows only
      if (r[iType] === TXN_TYPES.TRANSFER) return;
      const payee = String(r[iPayee] || '').trim();
      if (!payee) return;
      const key = normalizePayee(payee);
      if (!groups[key]) groups[key] = { payee, rows: [] };
      groups[key].rows.push({
        date: d, amount: Math.abs(Number(r[iAmt])),
        category: r[iCat], account: r[iAcct],
      });
    });

    const existing = {};
    readColumn(rec, colOf(RECURRING_SPEC, 'name')).forEach(n => { existing[normalizePayee(n)] = true; });
    readColumn(rec, colOf(RECURRING_SPEC, 'match')).forEach(n => { existing[normalizePayee(n)] = true; });

    const proposals = [];
    Object.keys(groups).forEach(key => {
      if (existing[key]) return;
      const g = groups[key];
      if (g.rows.length < 3) return;

      g.rows.sort((a, b) => a.date - b.date);
      const gaps = [];
      for (let i = 1; i < g.rows.length; i++) {
        gaps.push(Math.round((g.rows[i].date - g.rows[i - 1].date) / 86400000));
      }
      const gap = median(gaps);
      const cadence = cadenceForGap(gap);
      if (!cadence) return;

      // Amounts must be roughly stable, or this is just a frequented merchant
      // (a grocery store) rather than a subscription.
      const amounts = g.rows.map(r => r.amount);
      const amt = median(amounts);
      const spread = (Math.max.apply(null, amounts) - Math.min.apply(null, amounts)) / (amt || 1);
      if (spread > 0.35) return;

      const last = g.rows[g.rows.length - 1];
      const next = new Date(last.date.getTime() + gap * 86400000);

      proposals.push({
        name: g.payee, match: g.payee, amount: round2(amt), cadence, next,
        account: last.account, category: last.category, count: g.rows.length,
      });
    });

    if (!proposals.length) {
      ui.alert('No new recurring charges found',
        'Detection needs at least 3 charges from the same payee in the last 12 months, ' +
        'spaced at a regular cadence, with amounts within ±35%.\n\n' +
        'Anything already on the Recurring tab is skipped.', ui.ButtonSet.OK);
      return 0;
    }

    proposals.sort((a, b) => b.amount * CADENCE_PER_YEAR[b.cadence] - a.amount * CADENCE_PER_YEAR[a.cadence]);
    const preview = proposals.slice(0, 15)
      .map(p => `  ${p.name} — ${p.cadence} ${formatMoney(p.amount)} ` +
                `(${formatMoney(p.amount * CADENCE_PER_YEAR[p.cadence])}/yr, ${p.count} charges)`)
      .join('\n');

    const ans = ui.alert(`Found ${proposals.length} recurring charge(s)`,
      `${preview}${proposals.length > 15 ? `\n  …and ${proposals.length - 15} more` : ''}\n\n` +
      `Add these to the Recurring tab with status "Watch"?\n` +
      `Nothing already on that tab will be changed.`, ui.ButtonSet.YES_NO);
    if (ans !== ui.Button.YES) return 0;

    const start = firstEmptyRow(rec, colOf(RECURRING_SPEC, 'name'));
    const block = proposals.map(p => [
      p.name, p.match, p.amount, p.cadence, p.next, p.account, p.category, 'Watch',
    ]);
    rec.getRange(start, 1, block.length, 8).setValues(block);
    rec.getRange(start, colOf(RECURRING_SPEC, 'nextdue'), block.length, 1).setNumberFormat(DATE_FORMAT);
    rec.getRange(start, colOf(RECURRING_SPEC, 'notes'), block.length, 1)
      .setValue('Auto-detected — review the amount and cadence, then set the status.');

    ss_().toast(`${proposals.length} recurring charge(s) added with status "Watch".`,
      '🔁 Detection complete', 6);
    blog(`detectRecurring: ${proposals.length} proposed`);
    return proposals.length;
  });
}

/** Strips card-statement noise: trailing digits, store numbers, punctuation. */
function normalizePayee(payee) {
  return String(payee).toLowerCase()
    .replace(/[#*]/g, ' ')
    .replace(/\b\d{3,}\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nearest known cadence, with tolerance bands wide enough for weekend drift. */
function cadenceForGap(days) {
  if (days >= 5 && days <= 9) return CADENCES.WEEKLY;
  if (days >= 12 && days <= 16) return CADENCES.BIWEEKLY;
  if (days >= 26 && days <= 35) return CADENCES.MONTHLY;
  if (days >= 85 && days <= 96) return CADENCES.QUARTERLY;
  if (days >= 175 && days <= 190) return CADENCES.SEMIANNUAL;
  if (days >= 355 && days <= 375) return CADENCES.ANNUAL;
  return null;
}

function median(nums) {
  if (!nums.length) return 0;
  const s = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function formatMoney(n) {
  return '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}


// ============================================================================
//  18. NET WORTH SNAPSHOT
// ============================================================================

/**
 * Freezes this month's balances onto Net_Worth.
 *
 * Values, not formulas — see the tab's own banner. Re-running in the same
 * month UPDATES that month's row rather than appending a second one, so a
 * mid-month snapshot can be refreshed at month end without polluting the
 * series.
 */
function snapshotNetWorth() {
  return withLock('snapshot', () => {
    const accounts = sheet_(SHEET_NAMES.ACCOUNTS);
    const nw = sheet_(SHEET_NAMES.NET_WORTH);
    const budget = sheet_(SHEET_NAMES.BUDGET);

    const nCols = ACCOUNTS_SPEC.columns.length;
    const rows = accounts.getRange(DATA_START_ROW, 1, DATA_ROWS, nCols).getValues();
    const iName = colOf(ACCOUNTS_SPEC, 'account') - 1;
    const iInNw = colOf(ACCOUNTS_SPEC, 'innw') - 1;
    const iStatus = colOf(ACCOUNTS_SPEC, 'status') - 1;
    const iBal = colOf(ACCOUNTS_SPEC, 'balance') - 1;

    let assets = 0, liabilities = 0, counted = 0;
    rows.forEach(r => {
      if (!String(r[iName]).trim()) return;
      if (r[iInNw] !== true && r[iInNw] !== 'TRUE') return;
      if (String(r[iStatus]) === 'Closed') return;
      const bal = Number(r[iBal]) || 0;
      if (bal >= 0) assets += bal; else liabilities += Math.abs(bal);
      counted++;
    });

    if (!counted) {
      SpreadsheetApp.getUi().alert(
        'No accounts are marked "In_Net_Worth" and Active. Nothing to snapshot.');
      return 0;
    }

    // This month's income and spend, from the envelope grid.
    const key = monthKey(new Date());
    const bCols = BUDGET_SPEC.columns.length;
    const bRows = budget.getRange(DATA_START_ROW, 1, DATA_ROWS, bCols).getValues();
    const iKey = colOf(BUDGET_SPEC, 'monthkey') - 1;
    const iKind = colOf(BUDGET_SPEC, 'kind') - 1;
    const iActual = colOf(BUDGET_SPEC, 'actual') - 1;
    let income = 0, spend = 0;
    bRows.forEach(r => {
      if (r[iKey] !== key) return;
      const v = Number(r[iActual]) || 0;
      if (r[iKind] === CATEGORY_KINDS.INCOME) income += v;
      else if (r[iKind] !== CATEGORY_KINDS.SAVINGS) spend += v;
    });

    const month = monthStart(new Date());
    const existing = nw.getRange(DATA_START_ROW, 1, DATA_ROWS, 1).getValues();
    let target = -1;
    for (let i = 0; i < existing.length; i++) {
      const d = existing[i][0];
      if (d instanceof Date && monthKey(d) === key) { target = DATA_START_ROW + i; break; }
    }
    const isUpdate = target > 0;
    if (!isUpdate) target = firstEmptyRow(nw, 1);

    // Only the value columns; the computed ones keep their formulas.
    nw.getRange(target, colOf(NET_WORTH_SPEC, 'month')).setValue(month).setNumberFormat(MONTH_FORMAT);
    nw.getRange(target, colOf(NET_WORTH_SPEC, 'assets')).setValue(round2(assets));
    nw.getRange(target, colOf(NET_WORTH_SPEC, 'liabilities')).setValue(round2(liabilities));
    nw.getRange(target, colOf(NET_WORTH_SPEC, 'income')).setValue(round2(income));
    nw.getRange(target, colOf(NET_WORTH_SPEC, 'spend')).setValue(round2(spend));
    nw.getRange(target, colOf(NET_WORTH_SPEC, 'notes'))
      .setValue(`Snapshot ${Utilities.formatDate(new Date(), ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd')} · ${counted} accounts`);

    ss_().toast(
      `${isUpdate ? 'Updated' : 'Recorded'} ${Utilities.formatDate(month, ss_().getSpreadsheetTimeZone(), 'MMMM yyyy')}: ` +
      `net worth ${formatMoney(assets - liabilities)}.`, '📸 Snapshot', 6);
    blog(`snapshotNetWorth: ${isUpdate ? 'updated' : 'appended'} row ${target}`);
    return assets - liabilities;
  });
}


// ============================================================================
//  19. DEFAULT CATEGORIES
// ============================================================================

/**
 * A starting chart of accounts, written only onto a genuinely empty tab.
 *
 * This is not filler. An empty categories tab means an empty budget, an empty
 * dashboard and a projection of zero, which is where most self-built budgets
 * are abandoned on day one. The defaults are also a worked example of the Kind
 * and Target_Method distinctions, which are easier to grasp from a filled-in
 * row than from a note.
 *
 * [category, group, kind, method, amount, percent, rollover]
 */
const DEFAULT_CATEGORIES = [
  ['Salary', 'Income', CATEGORY_KINDS.INCOME, TARGET_METHODS.FIXED, 3395, '', false],
  ['Family Support', 'Income', CATEGORY_KINDS.INCOME, TARGET_METHODS.FIXED, 100, '', false],
  ['Side Income', 'Income', CATEGORY_KINDS.INCOME, TARGET_METHODS.NONE, '', '', false],
  ['Interest & Dividends', 'Income', CATEGORY_KINDS.INCOME, TARGET_METHODS.NONE, '', '', false],

  // Essentials. Travel and Apple are Essential because that is how the source
  // budget classified them (they reconcile to its stated 52.84% needs share),
  // not because the labels suggest it.
  ['Rent', 'Housing', CATEGORY_KINDS.ESSENTIAL, TARGET_METHODS.FIXED, 650, '', false],
  ['Utilities', 'Housing', CATEGORY_KINDS.ESSENTIAL, TARGET_METHODS.FIXED, 100, '', true],
  ['Groceries', 'Food', CATEGORY_KINDS.ESSENTIAL, TARGET_METHODS.ROLLING, 300, '', true],
  ['Health', 'Health', CATEGORY_KINDS.ESSENTIAL, TARGET_METHODS.FIXED, 200, '', true],
  ['Travel', 'Transport', CATEGORY_KINDS.ESSENTIAL, TARGET_METHODS.FIXED, 540, '', true],
  ['Car Insurance', 'Insurance', CATEGORY_KINDS.ESSENTIAL, TARGET_METHODS.FIXED, 0, '', true],
  ['Phone', 'Utilities', CATEGORY_KINDS.ESSENTIAL, TARGET_METHODS.FIXED, 0, '', false],
  ['Apple', 'Services', CATEGORY_KINDS.ESSENTIAL, TARGET_METHODS.FIXED, 4, '', false],

  // Wants. Political giving is a standing budget line here, not an occasional
  // gift, so each recipient gets its own category rather than one Donations
  // bucket — you cannot notice a lapsed commitment inside an aggregate.
  ['Personal', 'Lifestyle', CATEGORY_KINDS.LIFESTYLE, TARGET_METHODS.FIXED, 500, '', true],
  ['System', 'Lifestyle', CATEGORY_KINDS.LIFESTYLE, TARGET_METHODS.FIXED, 300, '', true],
  ['DSA', 'Giving', CATEGORY_KINDS.LIFESTYLE, TARGET_METHODS.FIXED, 15, '', false],
  ['NEC', 'Giving', CATEGORY_KINDS.LIFESTYLE, TARGET_METHODS.FIXED, 10, '', false],
  ['Our Revolution', 'Giving', CATEGORY_KINDS.LIFESTYLE, TARGET_METHODS.FIXED, 5, '', false],
  ['Strong Towns', 'Giving', CATEGORY_KINDS.LIFESTYLE, TARGET_METHODS.FIXED, 3.5, '', false],
  ['Dropout', 'Subscriptions', CATEGORY_KINDS.LIFESTYLE, TARGET_METHODS.FIXED, 5, '', false],
  ['Music', 'Subscriptions', CATEGORY_KINDS.LIFESTYLE, TARGET_METHODS.FIXED, 0, '', false],

  ['Save', 'Savings', CATEGORY_KINDS.SAVINGS, TARGET_METHODS.FIXED, 650, '', true],
  ['Emergency Save', 'Savings', CATEGORY_KINDS.SAVINGS, TARGET_METHODS.FIXED, 200, '', true],
  ['Retirement', 'Savings', CATEGORY_KINDS.SAVINGS, TARGET_METHODS.NONE, '', '', false],

  ['Credit Card Payment', 'Debt', CATEGORY_KINDS.DEBT, TARGET_METHODS.FIXED, '', '', false],
  ['Student Loan', 'Debt', CATEGORY_KINDS.DEBT, TARGET_METHODS.FIXED, '', '', false],
];

function seedDefaultCategoriesIfEmpty(ss) {
  const cats = ss.getSheetByName(SHEET_NAMES.CATEGORIES);
  if (!cats) return 0;
  if (countRows(cats, 1) > 0) return 0;

  const block = DEFAULT_CATEGORIES.map(c => [c[0], c[1], c[2], c[3], c[4], c[5], c[6], true]);
  cats.getRange(DATA_START_ROW, 1, block.length, 8).setValues(block);
  blog(`seeded ${block.length} default categories`);
  return block.length;
}


// ============================================================================
//  20. SAMPLE DATA
// ============================================================================

/**
 * Populates a realistic four months of history so every dashboard tile,
 * rolling average and projection has something to show. Sample rows are
 * tagged Source = "Sample" so Clear ALL Data can find them, and so they are
 * never mistaken for real history.
 */
function seedSampleData() {
  return withLock('sample', () => {
    const ui = SpreadsheetApp.getUi();
    const txns = sheet_(SHEET_NAMES.TRANSACTIONS);

    if (countRows(txns, 1) > 0) {
      const ans = ui.alert('There are already transactions',
        'Sample data is meant for an empty workbook. Adding it now will mix invented ' +
        'rows into your real ledger.\n\nAdd sample data anyway?', ui.ButtonSet.YES_NO);
      if (ans !== ui.Button.YES) return 0;
    }

    // --- Accounts.
    const accounts = sheet_(SHEET_NAMES.ACCOUNTS);
    if (countRows(accounts, 1) === 0) {
      const asOf = new Date();
      asOf.setMonth(asOf.getMonth() - 4);
      accounts.getRange(DATA_START_ROW, 1, 5, 9).setValues([
        ['Everyday Checking', 'Checking', 'Sample Bank', 4200, monthStart(asOf), 0.001, '', true, 'Active'],
        ['High-Yield Savings', 'Savings', 'Sample Bank', 18000, monthStart(asOf), 0.042, '', true, 'Active'],
        ['Rewards Card', 'Credit Card', 'Sample Card Co', -1450, monthStart(asOf), 0.2249, 9000, true, 'Active'],
        ['Brokerage', 'Investment', 'Sample Brokerage', 46000, monthStart(asOf), '', '', true, 'Active'],
        ['401(k)', 'Retirement', 'Sample Retirement', 88000, monthStart(asOf), '', '', true, 'Active'],
      ]);
      accounts.getRange(DATA_START_ROW, colOf(ACCOUNTS_SPEC, 'asof'), 5, 1).setNumberFormat(DATE_FORMAT);
    }

    // --- Debts.
    const debts = sheet_(SHEET_NAMES.DEBTS);
    if (countRows(debts, 1) === 0) {
      debts.getRange(DATA_START_ROW, 1, 2, 6).setValues([
        ['Rewards Card', 'Rewards Card', 1450, 0.2249, 60, 140],
        ['Student Loan', '', 14200, 0.055, 180, 0],
      ]);
    }

    // --- Goals.
    const goals = sheet_(SHEET_NAMES.GOALS);
    if (countRows(goals, 1) === 0) {
      const inYear = new Date(); inYear.setFullYear(inYear.getFullYear() + 1);
      const inTwo = new Date(); inTwo.setFullYear(inTwo.getFullYear() + 2);
      goals.getRange(DATA_START_ROW, 1, 3, 7).setValues([
        ['6-month emergency fund', 'Emergency Fund', 21600, inYear, 18000, 300, 1],
        ['Car replacement', 'Sinking Fund', 12000, inTwo, 2400, 400, 2],
        ['Japan trip', 'Purchase', 5000, inYear, 900, 250, 3],
      ]);
      goals.getRange(DATA_START_ROW, colOf(GOALS_SPEC, 'targetdate'), 3, 1).setNumberFormat(DATE_FORMAT);
    }

    // --- Rules.
    const rules = sheet_(SHEET_NAMES.RULES);
    if (countRows(rules, 1) === 0) {
      rules.getRange(DATA_START_ROW, 1, 10, 7).setValues([
        [10, 'Contains', 'PAYROLL', 'Salary', TXN_TYPES.INCOME, '', true],
        [20, 'Contains', 'WHOLE FOODS', 'Groceries', TXN_TYPES.EXPENSE, '', true],
        [21, 'Contains', 'TRADER JOE', 'Groceries', TXN_TYPES.EXPENSE, '', true],
        [30, 'Contains', 'SHELL', 'Transport & Fuel', TXN_TYPES.EXPENSE, '', true],
        [31, 'Contains', 'UBER', 'Transport & Fuel', TXN_TYPES.EXPENSE, '', true],
        [40, 'Contains', 'NETFLIX', 'Subscriptions', TXN_TYPES.EXPENSE, '', true],
        [41, 'Contains', 'SPOTIFY', 'Subscriptions', TXN_TYPES.EXPENSE, '', true],
        [50, 'Contains', 'CHIPOTLE', 'Dining Out', TXN_TYPES.EXPENSE, '', true],
        [51, 'Contains', 'STARBUCKS', 'Dining Out', TXN_TYPES.EXPENSE, '', true],
        [60, 'Contains', 'RENT', 'Rent / Mortgage', TXN_TYPES.EXPENSE, '', true],
      ]);
    }

    // --- Transactions: four months of plausible activity.
    const rows = buildSampleTransactions();
    const start = firstEmptyRow(txns, 1);
    const nCols = TRANSACTIONS_SPEC.columns.length;
    const manualIdx = TRANSACTIONS_SPEC.columns
      .map((c, i) => ({ c, i })).filter(x => !x.c.computed).map(x => x.i);

    manualIdx.forEach(i => {
      txns.getRange(start, i + 1, rows.length, 1).setValues(rows.map(r => [r[i]]));
    });
    txns.getRange(start, 1, rows.length, 1).setNumberFormat(DATE_FORMAT);

    // --- Recurring.
    const rec = sheet_(SHEET_NAMES.RECURRING);
    if (countRows(rec, 1) === 0) {
      const next = new Date(); next.setDate(next.getDate() + 6);
      const next2 = new Date(); next2.setDate(next2.getDate() + 14);
      const next3 = new Date(); next3.setDate(next3.getDate() + 21);
      rec.getRange(DATA_START_ROW, 1, 4, 8).setValues([
        ['Netflix', 'NETFLIX', 15.49, CADENCES.MONTHLY, next, 'Rewards Card', 'Subscriptions', 'Active'],
        ['Spotify', 'SPOTIFY', 11.99, CADENCES.MONTHLY, next2, 'Rewards Card', 'Subscriptions', 'Active'],
        ['Gym', 'CITY FITNESS', 39.00, CADENCES.MONTHLY, next3, 'Rewards Card', 'Fitness', 'Watch'],
        ['Car insurance', 'SAMPLE INSURANCE', 642.00, CADENCES.SEMIANNUAL, next3, 'Everyday Checking', 'Insurance', 'Active'],
      ]);
      rec.getRange(DATA_START_ROW, colOf(RECURRING_SPEC, 'nextdue'), 4, 1).setNumberFormat(DATE_FORMAT);
    }

    rebuildBudgetMonths(true);
    snapshotNetWorth();

    ui.alert('Sample data loaded',
      `${rows.length} transactions across the last four months, plus accounts, debts, goals, ` +
      `rules and subscriptions.\n\nEverything on the Dashboard and Projections is now live against ` +
      `this data. When you are ready for your own numbers, use 💰 Finance ▸ Clear ALL Data.`,
      ui.ButtonSet.OK);
    blog(`seedSampleData: ${rows.length} transactions`);
    return rows.length;
  });
}

/** Four months of invented but plausible activity. */
function buildSampleTransactions() {
  const nCols = TRANSACTIONS_SPEC.columns.length;
  const iDate = colOf(TRANSACTIONS_SPEC, 'date') - 1;
  const iAcct = colOf(TRANSACTIONS_SPEC, 'account') - 1;
  const iPayee = colOf(TRANSACTIONS_SPEC, 'payee') - 1;
  const iCat = colOf(TRANSACTIONS_SPEC, 'category') - 1;
  const iAmt = colOf(TRANSACTIONS_SPEC, 'amount') - 1;
  const iType = colOf(TRANSACTIONS_SPEC, 'type') - 1;
  const iRec = colOf(TRANSACTIONS_SPEC, 'recurring') - 1;
  const iSrc = colOf(TRANSACTIONS_SPEC, 'source') - 1;

  const mk = (date, account, payee, category, amount, type, recurring) => {
    const r = new Array(nCols).fill('');
    r[iDate] = date; r[iAcct] = account; r[iPayee] = payee; r[iCat] = category;
    r[iAmt] = amount; r[iType] = type; r[iSrc] = 'Sample';
    if (recurring) r[iRec] = recurring;
    return r;
  };

  const CHK = 'Everyday Checking';
  const CARD = 'Rewards Card';
  const out = [];
  const today = new Date();

  // A little variation per month so rolling averages are not perfectly flat —
  // a sample where every month is identical hides exactly the drift these
  // dashboards exist to surface.
  const jitter = [1.0, 0.94, 1.08, 1.02];

  for (let m = 3; m >= 0; m--) {
    const base = new Date(today.getFullYear(), today.getMonth() - m, 1);
    const y = base.getFullYear(), mo = base.getMonth();
    const j = jitter[3 - m];
    const day = d => new Date(y, mo, Math.min(d, new Date(y, mo + 1, 0).getDate()));

    // Income — semi-monthly payroll.
    out.push(mk(day(15), CHK, 'ACME CORP PAYROLL', 'Salary', 3100, TXN_TYPES.INCOME));
    out.push(mk(day(30), CHK, 'ACME CORP PAYROLL', 'Salary', 3100, TXN_TYPES.INCOME));

    // Essentials.
    out.push(mk(day(1), CHK, 'GREENVIEW RENT', 'Rent / Mortgage', -1800, TXN_TYPES.EXPENSE));
    out.push(mk(day(5), CHK, 'CITY UTILITIES', 'Utilities', -round2(-(-142 * j)), TXN_TYPES.EXPENSE));
    out.push(mk(day(7), CHK, 'FIBERNET INTERNET', 'Internet & Phone', -79.99, TXN_TYPES.EXPENSE));
    out.push(mk(day(7), CHK, 'MOBILE CARRIER', 'Internet & Phone', -45.00, TXN_TYPES.EXPENSE));
    out.push(mk(day(12), CHK, 'SAMPLE INSURANCE', 'Insurance', -107.00, TXN_TYPES.EXPENSE, 'Car insurance'));

    // Groceries — weekly, jittered.
    [3, 10, 17, 24].forEach((d, i) => {
      const amt = -round2((i % 2 ? 118 : 96) * j);
      out.push(mk(day(d), CARD, i % 2 ? 'WHOLE FOODS MKT 1043' : 'TRADER JOE\'S #221', 'Groceries', amt, TXN_TYPES.EXPENSE));
    });

    // Transport.
    [6, 20].forEach(d => out.push(mk(day(d), CARD, 'SHELL OIL 45832', 'Transport & Fuel', -round2(52 * j), TXN_TYPES.EXPENSE)));
    out.push(mk(day(14), CARD, 'UBER TRIP', 'Transport & Fuel', -round2(23 * j), TXN_TYPES.EXPENSE));

    // Lifestyle.
    [4, 11, 19, 26].forEach((d, i) => {
      out.push(mk(day(d), CARD, i % 2 ? 'CHIPOTLE 2201' : 'STARBUCKS STORE 7781',
        'Dining Out', -round2((i % 2 ? 31 : 12) * j), TXN_TYPES.EXPENSE));
    });
    out.push(mk(day(9), CARD, 'NETFLIX.COM', 'Subscriptions', -15.49, TXN_TYPES.EXPENSE, 'Netflix'));
    out.push(mk(day(16), CARD, 'SPOTIFY USA', 'Subscriptions', -11.99, TXN_TYPES.EXPENSE, 'Spotify'));
    out.push(mk(day(2), CARD, 'CITY FITNESS CLUB', 'Fitness', -39.00, TXN_TYPES.EXPENSE, 'Gym'));
    out.push(mk(day(22), CARD, 'AMAZON MARKETPLACE', 'Shopping', -round2(87 * j), TXN_TYPES.EXPENSE));
    out.push(mk(day(27), CARD, 'CINEMA 12', 'Entertainment', -round2(34 * j), TXN_TYPES.EXPENSE));

    // Savings and debt — the savings moves are Transfers, so they are excluded
    // from spending and show up as unspent income, i.e. as saving.
    out.push(mk(day(16), CHK, 'TRANSFER TO SAVINGS', 'Emergency Fund', -300, TXN_TYPES.TRANSFER));
    out.push(mk(day(16), 'High-Yield Savings', 'TRANSFER FROM CHECKING', 'Emergency Fund', 300, TXN_TYPES.TRANSFER));
    out.push(mk(day(16), CHK, 'TRANSFER TO BROKERAGE', 'Brokerage', -400, TXN_TYPES.TRANSFER));
    out.push(mk(day(16), 'Brokerage', 'TRANSFER FROM CHECKING', 'Brokerage', 400, TXN_TYPES.TRANSFER));
    out.push(mk(day(25), CHK, 'CARD PAYMENT', 'Credit Card Payment', -200, TXN_TYPES.EXPENSE));
    out.push(mk(day(25), CARD, 'PAYMENT RECEIVED', 'Credit Card Payment', 200, TXN_TYPES.TRANSFER));
    out.push(mk(day(28), CHK, 'STUDENT LOAN SERVICER', 'Student Loan', -180, TXN_TYPES.EXPENSE));
  }

  return out;
}

/**
 * Wipes every hand-entered value from the data tabs, leaving structure,
 * formulas, categories and Setup intact.
 *
 * Guarded by a typed confirmation because it is the only irreversible thing in
 * this file — Apps Script has no undo, and a mis-clicked menu item should not
 * be able to delete a year of ledger.
 */
function clearAllData() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt('Clear ALL data',
    'This permanently deletes every transaction, account, recurring bill, goal, debt and ' +
    'net-worth snapshot in this workbook.\n\n' +
    'Categories, Rules and Setup are kept. THIS CANNOT BE UNDONE.\n\n' +
    'Type DELETE to confirm:', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return 0;
  if (resp.getResponseText().trim().toUpperCase() !== 'DELETE') {
    ui.alert('Not confirmed — nothing was deleted.');
    return 0;
  }

  return withLock('clear', () => {
    [SHEET_NAMES.TRANSACTIONS, SHEET_NAMES.ACCOUNTS, SHEET_NAMES.RECURRING,
     SHEET_NAMES.GOALS, SHEET_NAMES.DEBTS, SHEET_NAMES.NET_WORTH, SHEET_NAMES.IMPORT]
      .forEach(name => {
        const sheet = ss_().getSheetByName(name);
        if (!sheet) return;
        const spec = TABULAR_SPECS.filter(s => s.name === name)[0];
        if (!spec) return;
        // Clear only manual columns — formula columns must keep their formulas.
        spec.columns.forEach((c, i) => {
          if (c.computed) return;
          sheet.getRange(DATA_START_ROW, i + 1, DATA_ROWS, 1).clearContent();
        });
      });

    rebuildBudgetMonths(true);
    ss_().toast('All data cleared. Categories, Rules and Setup were kept.', '🧹 Cleared', 6);
    return 1;
  });
}


// ============================================================================
//  21. ABOUT
// ============================================================================

function showAbout() {
  const html = HtmlService.createHtmlOutput(`
    <style>
      body { font-family: -apple-system, Roboto, Arial, sans-serif; font-size: 13px;
             line-height: 1.55; color: #202124; padding: 4px 6px; }
      h2 { font-size: 15px; margin: 0 0 4px; color: #1F3864; }
      h3 { font-size: 12px; margin: 16px 0 4px; color: #1F3864;
           text-transform: uppercase; letter-spacing: .04em; }
      code { background: #F1F3F4; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
      ul { margin: 4px 0 0 18px; padding: 0; }
      li { margin-bottom: 5px; }
      .muted { color: #5F6368; font-size: 12px; }
    </style>
    <h2>💰 Personal Finance Tracker</h2>
    <div class="muted">Workbook spec v${WORKBOOK_VERSION} · everything computes from formulas, not scripts.</div>

    <h3>Getting started</h3>
    <ul>
      <li><b>Setup</b> — set your take-home income and assumptions. Every value there is a
          named range the rest of the workbook reads.</li>
      <li><b>Accounts</b> — one row per account, with the balance as of a date.</li>
      <li><b>Transactions</b> — paste history via the Import tab, or type it.
          <b>Money out is negative</b>, on every account type.</li>
      <li><b>Categories</b> — adjust the starter list. The <code>Kind</code> column drives
          the savings rate, the emergency-fund target and the projections.</li>
      <li>Run <b>Rebuild Budget Months</b> after changing categories.</li>
    </ul>

    <h3>The colour rule</h3>
    <ul>
      <li>✍️ <b>Yellow</b> headers and cream cells — you type here; the script never touches them.</li>
      <li>🔒 <b>Grey</b> headers and cells — computed. Typing there destroys a formula;
          <b>Initialize / Repair</b> restores it.</li>
      <li>The one exception is <code>Budget_Override</code>, deliberately editable so
          "this month is different" never means editing a formula.</li>
    </ul>

    <h3>Monthly routine</h3>
    <ul>
      <li>Import or enter the month's transactions.</li>
      <li><b>Apply Categorization Rules</b>, then fix whatever is left uncategorized —
          and add a rule for it so it categorizes itself next time.</li>
      <li><b>Snapshot Net Worth</b> at month end.</li>
      <li>Read the Dashboard alerts; look at Projections once a quarter, not weekly.</li>
    </ul>

    <h3>Where the numbers come from</h3>
    <ul>
      <li><b>Savings rate</b> = (income − spend) ÷ income. Transfers are excluded from both,
          so moving money to savings correctly reads as saving rather than spending.</li>
      <li><b>Emergency fund</b> is measured in months of <i>essential</i> spend — a layoff
          cuts income, not rent.</li>
      <li><b>FI number</b> = annual spending ÷ your safe withdrawal rate (25× at 4%).</li>
      <li><b>Projections</b> compound monthly and are shown in both nominal and real dollars.
          Plan against the real column.</li>
    </ul>

    <h3>What this is not</h3>
    <div class="muted">There is no bank connection — no Plaid, no automatic sync. Transactions
    arrive by CSV or by hand. The projection model ignores taxes, lumpy income, market sequence
    risk and life events, so treat it as a trajectory under stated assumptions, not a forecast.
    None of this is financial advice.</div>
  `).setWidth(560).setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, 'About this workbook');
}
