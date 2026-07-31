/**
 * ============================================================================
 *  💰  PERSONAL FINANCE TRACKER  —  PART 2: RENDERING ENGINE
 * ============================================================================
 *  Turns the declarative specs in Budget.gs into an actual workbook: tabs,
 *  banners, headers, formats, validation, conditional formatting, the Setup
 *  tab's named ranges, the Dashboard, the Projections model and the charts.
 *
 *  EVERYTHING HERE IS IDEMPOTENT. initWorkbook() may be run on a brand-new
 *  spreadsheet or on one with three years of data in it, and in the second
 *  case it must not change a single value the user typed. That constraint is
 *  what dictates the shape of this file:
 *    - Sheets are fetched-or-created, never deleted and recreated.
 *    - Formula columns are rewritten wholesale (they are script-owned, so
 *      clobbering them is the *point* — it is how a broken formula heals).
 *    - Manual columns are never written to except when explicitly seeding a
 *      brand-new, empty tab.
 *    - Formats, validation and conditional-format rules are reapplied every
 *      run, because those genuinely do drift as people paste data in.
 * ============================================================================
 */


// ============================================================================
//  7. MENU
// ============================================================================

function onOpen() {
  buildMenu();
}

function onInstall() {
  onOpen();
}

function buildMenu() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('💰 Finance')
    .addItem('▶️  Initialize / Repair Workbook', 'initWorkbook')
    .addSeparator()
    .addItem('🔄  Rebuild Budget Months', 'rebuildBudgetMonths')
    .addItem('⚙️  Apply Categorization Rules', 'applyRules')
    .addItem('📥  Import Staged Rows', 'importStagedRows')
    .addItem('🔁  Detect Recurring Bills', 'detectRecurring')
    .addItem('📸  Snapshot Net Worth (this month)', 'snapshotNetWorth')
    .addSeparator()
    .addSubMenu(buildBankSyncMenu(ui))
    .addSeparator()
    .addSubMenu(ui.createMenu('🧪  Sample Data')
      .addItem('Load Sample Data', 'seedSampleData')
      .addItem('Clear ALL Data', 'clearAllData'))
    .addSeparator()
    .addItem('❓  About / Help', 'showAbout')
    .addToUi();
}


// ============================================================================
//  8. INITIALIZE / REPAIR
// ============================================================================

/**
 * The one entry point. Builds every tab from the specs, in dependency order.
 *
 * Order matters and is not arbitrary: Accounts and Categories must exist
 * before Transactions, because Transactions' dropdowns are range-validations
 * pointing INTO them, and requireValueInRange against a missing sheet throws.
 * Recurring must exist before Rules for the same reason. Budget_Monthly is
 * populated last because its formulas read every other tab.
 */
function initWorkbook() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const started = Date.now();
  blog('initWorkbook: starting');

  ss.toast('Building workbook structure…', '💰 Finance', -1);

  // 1. Setup first — every other tab's formulas reference its named ranges.
  buildSetupSheet(ss);

  // 2. Create every tab EMPTY before building any of them.
  //    This is not premature tidiness, it fixes two real first-run bugs:
  //      - a range-validation dropdown pointing at a sheet that does not exist
  //        yet is silently dropped, so Transactions would come up with no
  //        Recurring dropdown until you ran Repair a second time;
  //      - a formula referencing a missing sheet parses to a permanent #REF!
  //        that does NOT heal when the sheet appears later.
  //    Both vanish if every name resolves before any content is written.
  TABULAR_SPECS.forEach(spec => ensureSheet(ss, spec.name));
  ensureSheet(ss, SHEET_NAMES.PROJECTIONS);
  ensureSheet(ss, SHEET_NAMES.DASHBOARD);

  // 3. Tabular tabs.
  TABULAR_SPECS.forEach(spec => {
    ss.toast(`Building ${spec.name}…`, '💰 Finance', -1);
    buildTabularSheet(ss, spec);
  });

  // 4. Seed the chart of accounts on a genuinely empty Categories tab. A
  //    budgeting workbook with no categories cannot demonstrate anything, and
  //    an empty first-run is where most self-built budgets die.
  seedDefaultCategoriesIfEmpty(ss);

  // 5. Derived/laid-out tabs.
  ss.toast('Building Projections…', '💰 Finance', -1);
  buildProjectionsSheet(ss);
  ss.toast('Building Dashboard…', '💰 Finance', -1);
  buildDashboardSheet(ss);

  // 6. Populate the envelope grid now that categories exist.
  rebuildBudgetMonths(true);

  // 7. Cosmetics that must come after every sheet exists.
  orderAndColorTabs(ss);
  removeDefaultSheet(ss);

  PropertiesService.getDocumentProperties()
    .setProperty(WORKBOOK_VERSION_PROP_KEY, String(WORKBOOK_VERSION));

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  ss.setActiveSheet(ss.getSheetByName(SHEET_NAMES.DASHBOARD));
  ss.toast(`Workbook ready in ${secs}s. Start on the Setup tab.`, '💰 Finance', 8);
  blog(`initWorkbook: done in ${secs}s`);
}

/** Fetch a sheet by name, creating it if absent. Never destructive. */
function ensureSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    blog(`created sheet ${name}`);
  }
  return sheet;
}

function orderAndColorTabs(ss) {
  SHEET_ORDER.forEach((name, i) => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(i + 1);
    if (TAB_COLORS[name]) sheet.setTabColor(TAB_COLORS[name]);
  });
}

/**
 * Google creates every new spreadsheet with a "Sheet1". Removing it is safe
 * only if it is untouched — someone may have started typing there.
 */
function removeDefaultSheet(ss) {
  const sheet = ss.getSheetByName('Sheet1');
  if (!sheet) return;
  const used = sheet.getDataRange();
  const empty = used.getNumRows() <= 1 && used.getNumColumns() <= 1 &&
                String(used.getValue()).trim() === '';
  if (empty && ss.getSheets().length > 1) {
    ss.deleteSheet(sheet);
    blog('removed empty default Sheet1');
  }
}


// ============================================================================
//  9. GENERIC TABULAR SHEET BUILDER
// ============================================================================

/**
 * Renders one spec. Row 1 is a title banner, row 2 the headers, rows 3+ data.
 *
 * A note on the banner: the sibling Calendar project learned the hard way
 * that a MERGED banner row makes setFrozenColumns() throw ("cannot freeze
 * across a merge"). So this banner is NOT merged — it is a single styled cell
 * with the rest of the row given the same fill. Same look, no merge, columns
 * stay freezable.
 */
function buildTabularSheet(ss, spec) {
  const sheet = ensureSheet(ss, spec.name);
  const nCols = spec.columns.length;
  const lastRow = DATA_START_ROW + DATA_ROWS - 1;

  // --- Ensure the grid is big enough, and trim runaway extra columns.
  if (sheet.getMaxColumns() < nCols) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), nCols - sheet.getMaxColumns());
  }
  if (sheet.getMaxColumns() > nCols) {
    sheet.deleteColumns(nCols + 1, sheet.getMaxColumns() - nCols);
  }
  if (sheet.getMaxRows() < lastRow) {
    sheet.insertRowsAfter(sheet.getMaxRows(), lastRow - sheet.getMaxRows());
  }

  // --- Banner.
  writeBanner(sheet, spec, nCols);

  // --- Headers. Computed columns get a bare label; hand-entry columns carry
  //     the ✍️ prefix, so the contract is legible without hovering a note.
  const headers = spec.columns.map(c =>
    c.computed ? c.label : `${MANUAL_ENTRY_PREFIX} ${c.label}`);
  sheet.getRange(HEADER_ROW, 1, 1, nCols).setValues([headers]);

  // --- Header styling: navy base, then per-column manual/computed tint.
  const headerRange = sheet.getRange(HEADER_ROW, 1, 1, nCols);
  headerRange
    .setFontWeight('bold')
    .setFontSize(10)
    .setVerticalAlignment('middle')
    .setWrap(true)
    .setBorder(true, true, true, true, true, false, GRID_LINE_COLOR, SpreadsheetApp.BorderStyle.SOLID);

  spec.columns.forEach((c, i) => {
    const cell = sheet.getRange(HEADER_ROW, i + 1);
    if (c.computed) {
      cell.setBackground(COMPUTED_HEADER_COLOR).setFontColor(COMPUTED_HEADER_FG);
    } else {
      cell.setBackground(MANUAL_ENTRY_HEADER_COLOR).setFontColor(MANUAL_ENTRY_HEADER_FG);
    }
    cell.setNote(buildHeaderNote(c));
  });

  // --- Per-column body: width, format, tint, validation, formulas.
  spec.columns.forEach((c, i) => {
    const col = i + 1;
    const body = sheet.getRange(DATA_START_ROW, col, DATA_ROWS, 1);

    sheet.setColumnWidth(col, clampWidth(c.width || 120));
    if (c.format) body.setNumberFormat(c.format);
    body.setBackground(c.computed ? COMPUTED_CELL_TINT : MANUAL_ENTRY_CELL_TINT);
    if (c.manualOverride) body.setBackground(MANUAL_ENTRY_CELL_TINT);

    // Validation is rebuilt every run; ranges it points at may have moved.
    body.clearDataValidations();
    if (c.validation) {
      const rule = c.validation();
      if (rule) body.setDataValidation(rule);
    }

    // Formula columns are script-owned: rewrite unconditionally. This is what
    // makes "Initialize / Repair" actually repair anything.
    if (c.formula) {
      writeFormulaColumn(sheet, col, c.formula);
    }

    if (c.hidden) sheet.hideColumns(col);
    else sheet.showColumns(col);
  });

  // --- Frame.
  sheet.setFrozenRows(HEADER_ROW);
  if (spec.frozenColumns) sheet.setFrozenColumns(spec.frozenColumns);
  applyFilter(sheet, nCols, lastRow);
  applyBanding(sheet, nCols, lastRow);
  applyConditionalFormats(sheet, spec, lastRow);

  blog(`built ${spec.name} (${nCols} cols)`);
  return sheet;
}

/** Title + subtitle banner across row 1, unmerged so columns stay freezable. */
function writeBanner(sheet, spec, nCols) {
  const row = sheet.getRange(BANNER_ROW, 1, 1, nCols);
  row.setBackground(BANNER_BG);
  sheet.setRowHeight(BANNER_ROW, 34);
  const cell = sheet.getRange(BANNER_ROW, 1);
  cell.setValue(spec.title)
    .setFontColor(BANNER_FG)
    .setFontSize(12)
    .setFontWeight('bold')
    .setVerticalAlignment('middle');
  if (spec.subtitle) cell.setNote(spec.subtitle);
  // The subtitle rides in column 2 so it is readable without hovering.
  if (spec.subtitle && nCols > 1) {
    sheet.getRange(BANNER_ROW, 2)
      .setValue(spec.subtitle)
      .setFontColor('#D6E0F5')
      .setFontSize(9)
      .setFontStyle('italic')
      .setVerticalAlignment('middle');
  }
}

function buildHeaderNote(col) {
  const kind = col.computed
    ? '🔒 COMPUTED — this column is a formula. Typing here overwrites it; run Initialize / Repair to restore.'
    : '✍️ HAND ENTRY — type here. The script never overwrites this column.';
  return col.note ? `${kind}\n\n${col.note}` : kind;
}

/**
 * Writes a formula into the first data row and fills it down.
 *
 * {r} → current row, {prev} → previous row. The {prev} token exists for
 * running-total columns (Net_Worth month-over-month) that legitimately need to
 * reach backwards one row.
 */
function writeFormulaColumn(sheet, col, template) {
  const first = template
    .replace(/\{r\}/g, String(DATA_START_ROW))
    .replace(/\{prev\}/g, String(DATA_START_ROW - 1));
  const target = sheet.getRange(DATA_START_ROW, col, DATA_ROWS, 1);
  target.clearContent();
  sheet.getRange(DATA_START_ROW, col).setFormula(first);
  if (DATA_ROWS > 1) {
    sheet.getRange(DATA_START_ROW, col)
      .copyTo(sheet.getRange(DATA_START_ROW + 1, col, DATA_ROWS - 1, 1));
  }
}

function clampWidth(px) {
  return Math.max(MIN_COLUMN_WIDTH_PX,
    Math.min(MAX_COLUMN_WIDTH_PX, Math.round(px * COLUMN_WIDTH_BUFFER_MULTIPLIER)));
}

/** One filter per sheet; recreate it so it spans the current column count. */
function applyFilter(sheet, nCols, lastRow) {
  try {
    const existing = sheet.getFilter();
    if (existing) existing.remove();
    sheet.getRange(HEADER_ROW, 1, lastRow - HEADER_ROW + 1, nCols).createFilter();
  } catch (err) {
    blog(`filter skipped on ${sheet.getName()}: ${err}`);
  }
}

function applyBanding(sheet, nCols, lastRow) {
  try {
    sheet.getBandings().forEach(b => b.remove());
    sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, nCols)
      .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  } catch (err) {
    blog(`banding skipped on ${sheet.getName()}: ${err}`);
  }
}


// ============================================================================
//  10. CONDITIONAL FORMATTING
// ============================================================================

/**
 * Color is the fastest read in a spreadsheet, so it is spent only where a
 * number implies an action: an overspent envelope, a debt that will never
 * amortize, a bill due this week, a goal falling behind. Everything else
 * stays neutral — a sheet where everything is colored says nothing.
 */
function applyConditionalFormats(sheet, spec, lastRow) {
  const rules = [];
  const n = spec.columns.length;
  const all = r => sheet.getRange(DATA_START_ROW, 1, DATA_ROWS, n);
  const colRange = key => sheet.getRange(DATA_START_ROW, colOf(spec, key), DATA_ROWS, 1);

  switch (spec.name) {

    case SHEET_NAMES.BUDGET: {
      const pct = colL(spec, 'pct');
      const avail = colL(spec, 'available');
      // Overspent envelope: the whole row goes red. This is the single most
      // important signal on the tab and it should be visible peripherally.
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=AND($C${DATA_START_ROW}<>"",$E${DATA_START_ROW}<>"${CATEGORY_KINDS.INCOME}",$${avail}${DATA_START_ROW}<0)`)
        .setBackground(BAD_BG).setFontColor(BAD_COLOR)
        .setRanges([all()]).build());
      // Approaching the limit (threshold..100%): amber, on the % cell only.
      // The threshold is read from the same-sheet mirror cell, not from the
      // CFG_ALERT_PCT named range — see the Cfg_Alert_Pct column's note.
      const alertRef = `$${colL(spec, 'cfgalert')}$${DATA_START_ROW}`;
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=AND($${pct}${DATA_START_ROW}<>"",$E${DATA_START_ROW}<>"${CATEGORY_KINDS.INCOME}",$${pct}${DATA_START_ROW}>=${alertRef},$${pct}${DATA_START_ROW}<=1)`)
        .setBackground(WARN_BG).setFontColor(WARN_COLOR)
        .setRanges([colRange('pct')]).build());
      // A manual override is a fact worth seeing at a glance.
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=$G${DATA_START_ROW}<>""`)
        .setBackground('#FFF2CC').setBold(true)
        .setRanges([colRange('override'), colRange('budgeted')]).build());
      // Kind tinting makes the long-format grid scannable.
      Object.keys(CATEGORY_KIND_COLORS).forEach(kind => {
        rules.push(SpreadsheetApp.newConditionalFormatRule()
          .whenTextEqualTo(kind)
          .setBackground(CATEGORY_KIND_COLORS[kind])
          .setRanges([colRange('kind')]).build());
      });
      break;
    }

    case SHEET_NAMES.CATEGORIES: {
      Object.keys(CATEGORY_KIND_COLORS).forEach(kind => {
        rules.push(SpreadsheetApp.newConditionalFormatRule()
          .whenTextEqualTo(kind)
          .setBackground(CATEGORY_KIND_COLORS[kind])
          .setRanges([colRange('kind')]).build());
      });
      // Inactive categories fade out rather than disappear.
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=AND($A${DATA_START_ROW}<>"",$H${DATA_START_ROW}=FALSE)`)
        .setFontColor('#999999').setItalic(true)
        .setRanges([all()]).build());
      break;
    }

    case SHEET_NAMES.TRANSACTIONS: {
      const amt = colL(spec, 'amount');
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenNumberLessThan(0).setFontColor('#B00020')
        .setRanges([colRange('amount')]).build());
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenNumberGreaterThan(0).setFontColor(GOOD_COLOR)
        .setRanges([colRange('amount')]).build());
      // Uncategorized rows are the workbook's only real data-quality debt.
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=AND($A${DATA_START_ROW}<>"",$D${DATA_START_ROW}="")`)
        .setBackground(WARN_BG)
        .setRanges([colRange('category')]).build());
      // Transfers are visually muted: they are excluded from every aggregate,
      // and they should look excluded.
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo(TXN_TYPES.TRANSFER)
        .setBackground('#EDEDED').setFontColor('#777777')
        .setRanges([colRange('type')]).build());
      break;
    }

    case SHEET_NAMES.ACCOUNTS: {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenNumberLessThan(0).setFontColor('#B00020')
        .setRanges([colRange('balance')]).build());
      // 30% utilization is the conventional credit-scoring threshold.
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenNumberGreaterThan(0.5).setBackground(BAD_BG).setFontColor(BAD_COLOR)
        .setRanges([colRange('util')]).build());
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenNumberBetween(0.3, 0.5).setBackground(WARN_BG).setFontColor(WARN_COLOR)
        .setRanges([colRange('util')]).build());
      break;
    }

    case SHEET_NAMES.RECURRING: {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenNumberBetween(0, 7).setBackground(WARN_BG).setFontColor(WARN_COLOR)
        .setRanges([colRange('daysuntil')]).build());
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenNumberLessThan(0).setBackground(BAD_BG).setFontColor(BAD_COLOR)
        .setRanges([colRange('daysuntil')]).build());
      // A price that drifted upward without you noticing.
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenNumberGreaterThan(0.01).setBackground(WARN_BG).setFontColor(WARN_COLOR)
        .setRanges([colRange('drift')]).build());
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Watch').setBackground(WARN_BG)
        .setRanges([colRange('status')]).build());
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Cancelled').setFontColor('#999999')
        .setRanges([all()]).build());
      break;
    }

    case SHEET_NAMES.GOALS: {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextStartsWith('⚠️').setBackground(WARN_BG).setFontColor(WARN_COLOR)
        .setRanges([colRange('ontrack')]).build());
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextStartsWith('✅').setBackground(GOOD_BG).setFontColor(GOOD_COLOR)
        .setRanges([colRange('ontrack')]).build());
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .setGradientMaxpointWithValue('#B7E1CD', SpreadsheetApp.InterpolationType.NUMBER, '1')
        .setGradientMinpointWithValue('#FFFFFF', SpreadsheetApp.InterpolationType.NUMBER, '0')
        .setRanges([colRange('funded')]).build());
      break;
    }

    case SHEET_NAMES.DEBTS: {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenNumberEqualTo(1).setBackground(GOOD_BG).setBold(true)
        .setRanges([colRange('rank')]).build());
      // "never" — the payment does not cover the interest.
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextContains('never').setBackground(BAD_BG).setFontColor(BAD_COLOR)
        .setRanges([colRange('months')]).build());
      break;
    }

    case SHEET_NAMES.NET_WORTH: {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenNumberGreaterThan(0).setFontColor(GOOD_COLOR)
        .setRanges([colRange('change')]).build());
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenNumberLessThan(0).setFontColor(BAD_COLOR)
        .setRanges([colRange('change')]).build());
      break;
    }

    case SHEET_NAMES.IMPORT: {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextStartsWith('Imported').setBackground(GOOD_BG).setFontColor(GOOD_COLOR)
        .setRanges([colRange('status')]).build());
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextStartsWith('Duplicate').setBackground('#EDEDED').setFontColor('#777777')
        .setRanges([colRange('status')]).build());
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextStartsWith('⚠️').setBackground(BAD_BG).setFontColor(BAD_COLOR)
        .setRanges([colRange('status')]).build());
      break;
    }
  }

  sheet.setConditionalFormatRules(rules);
}


// ============================================================================
//  11. SETUP TAB
// ============================================================================

/**
 * Renders the key/value config block and publishes every value as a workbook
 * named range.
 *
 * Existing values are PRESERVED on a repair run — this tab is nothing but user
 * input, and silently resetting someone's inflation assumption to the default
 * because they clicked Repair would be a genuine data-loss bug.
 */
function buildSetupSheet(ss) {
  const sheet = ensureSheet(ss, SHEET_NAMES.SETUP);
  const rowsNeeded = SETUP_START_ROW + SETUP_FIELDS.length + 4;

  if (sheet.getMaxRows() < rowsNeeded) {
    sheet.insertRowsAfter(sheet.getMaxRows(), rowsNeeded - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < 5) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), 5 - sheet.getMaxColumns());
  }

  sheet.getRange(BANNER_ROW, 1, 1, 5).setBackground(BANNER_BG);
  sheet.setRowHeight(BANNER_ROW, 34);
  sheet.getRange(BANNER_ROW, SETUP_LABEL_COL)
    .setValue('⚙️ Setup — every assumption the workbook runs on')
    .setFontColor(BANNER_FG).setFontSize(12).setFontWeight('bold')
    .setVerticalAlignment('middle');

  sheet.setColumnWidth(1, 30);
  sheet.setColumnWidth(SETUP_LABEL_COL, 300);
  sheet.setColumnWidth(SETUP_VALUE_COL, 150);
  sheet.setColumnWidth(SETUP_NOTE_COL, 620);

  let row = SETUP_START_ROW;
  SETUP_FIELDS.forEach(field => {
    if (field.section) {
      sheet.getRange(row, SETUP_LABEL_COL, 1, 3).setBackground('#E8EEF7');
      sheet.getRange(row, SETUP_LABEL_COL)
        .setValue(field.section.toUpperCase())
        .setFontWeight('bold').setFontSize(9).setFontColor('#1F3864');
      row++;
      return;
    }

    sheet.getRange(row, SETUP_LABEL_COL)
      .setValue(field.label).setFontWeight('bold').setFontSize(10);

    const valueCell = sheet.getRange(row, SETUP_VALUE_COL);
    valueCell
      .setBackground(MANUAL_ENTRY_CELL_TINT)
      .setNumberFormat(field.format)
      .setHorizontalAlignment('right')
      .setBorder(true, true, true, true, false, false, '#BBBBBB', SpreadsheetApp.BorderStyle.SOLID);

    // Preserve whatever is already there; only seed a genuinely empty cell.
    if (valueCell.getValue() === '' || valueCell.getValue() === null) {
      let v = field.value;
      if (field.name === 'CFG_START_MONTH' && v === null) {
        const d = new Date();
        v = new Date(d.getFullYear(), d.getMonth() - 12, 1);
      }
      valueCell.setValue(v);
    }

    if (field.name === 'CFG_DEBT_STRATEGY') {
      valueCell.setDataValidation(listValidation(DEBT_STRATEGY_OPTIONS));
    }

    if (field.note) {
      sheet.getRange(row, SETUP_NOTE_COL)
        .setValue(field.note).setFontSize(9).setFontColor(KPI_LABEL_COLOR)
        .setWrap(true).setVerticalAlignment('middle');
    }

    // The named range is the contract the rest of the workbook depends on.
    try {
      ss.setNamedRange(field.name, valueCell);
    } catch (err) {
      blog(`named range ${field.name} failed: ${err}`);
    }

    row++;
  });

  sheet.setFrozenRows(HEADER_ROW);
  sheet.getRange(row + 1, SETUP_LABEL_COL)
    .setValue('These names (CFG_*) are live named ranges. Formulas across the workbook read them by name, so moving a row here breaks nothing.')
    .setFontSize(9).setFontStyle('italic').setFontColor(KPI_LABEL_COLOR);

  blog('built Setup');
  return sheet;
}


// ============================================================================
//  12. DASHBOARD
// ============================================================================

const DASH_COLS = 12;
const DASH_TILE_WIDTH = 2;

/**
 * The Dashboard answers, in order: am I solvent, am I on plan this month, what
 * needs attention, and where is this heading. Anything that does not serve one
 * of those four questions belongs on a detail tab, not here.
 */
function buildDashboardSheet(ss) {
  const sheet = ensureSheet(ss, SHEET_NAMES.DASHBOARD);
  sheet.clear();
  sheet.clearConditionalFormatRules();
  sheet.getCharts().forEach(c => sheet.removeChart(c));

  // sheet.clear() does NOT break merges, and the KPI tiles are merged cells.
  // If the layout ever shifts between versions — as it did when the zero-based
  // check was added — a stale merge from the old layout can straddle a cell the
  // new layout wants to merge, and Sheets throws rather than resolving it.
  // Breaking every merge first makes a repair run layout-version independent.
  sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 90), Math.max(sheet.getMaxColumns(), DASH_COLS))
    .breakApart();

  // 14, not DASH_COLS: columns M–N hold the hidden config mirror cells that
  // the conditional formats read (see below).
  if (sheet.getMaxColumns() < 14) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), 14 - sheet.getMaxColumns());
  }
  if (sheet.getMaxRows() < 90) {
    sheet.insertRowsAfter(sheet.getMaxRows(), 90 - sheet.getMaxRows());
  }

  for (let c = 1; c <= DASH_COLS; c++) sheet.setColumnWidth(c, 105);
  sheet.setHiddenGridlines(true);

  const B = SHEET_NAMES.BUDGET;
  const T = SHEET_NAMES.TRANSACTIONS;
  const A = SHEET_NAMES.ACCOUNTS;
  const R = SHEET_NAMES.RECURRING;
  const G = SHEET_NAMES.GOALS;
  const D = SHEET_NAMES.DEBTS;

  // Current month key, used by nearly every tile below.
  const MK = `TEXT(TODAY(),"yyyy-mm")`;

  // --- Title -----------------------------------------------------------
  sheet.getRange(1, 1, 1, DASH_COLS).setBackground(BANNER_BG);
  sheet.setRowHeight(1, 46);
  sheet.getRange(1, 1)
    .setFormula(`=CFG_HOUSEHOLD&" — Financial Dashboard"`)
    .setFontColor(BANNER_FG).setFontSize(16).setFontWeight('bold')
    .setVerticalAlignment('middle');
  sheet.getRange(2, 1)
    .setFormula(`=TEXT(TODAY(),"dddd, mmmm d, yyyy")&"  ·  budget month "&TEXT(TODAY(),"mmmm yyyy")`)
    .setFontColor(KPI_LABEL_COLOR).setFontSize(10);

  // --- KPI row 1 -------------------------------------------------------
  dashSectionHeader(sheet, 4, 'WHERE YOU STAND');

  const netWorthF =
    `=IFERROR(SUMIFS('${A}'!$J:$J,'${A}'!$H:$H,TRUE,'${A}'!$I:$I,"Active"),0)`;
  const incomeF =
    `=IFERROR(SUMIFS('${B}'!$I:$I,'${B}'!$A:$A,${MK},'${B}'!$E:$E,"${CATEGORY_KINDS.INCOME}"),0)`;
  const spendF =
    `=IFERROR(SUMIFS('${B}'!$I:$I,'${B}'!$A:$A,${MK},'${B}'!$E:$E,"${CATEGORY_KINDS.ESSENTIAL}")+SUMIFS('${B}'!$I:$I,'${B}'!$A:$A,${MK},'${B}'!$E:$E,"${CATEGORY_KINDS.LIFESTYLE}")+SUMIFS('${B}'!$I:$I,'${B}'!$A:$A,${MK},'${B}'!$E:$E,"${CATEGORY_KINDS.DEBT}"),0)`;

  dashTile(sheet, 5, 1, 'NET WORTH', netWorthF, CURRENCY_FORMAT_WHOLE,
    `=IFERROR("assets "&TEXT(SUMIFS('${A}'!$J:$J,'${A}'!$H:$H,TRUE)+0,"${CURRENCY_FORMAT_WHOLE}"),"")`);
  dashTile(sheet, 5, 3, 'INCOME (MTD)', incomeF, CURRENCY_FORMAT_WHOLE,
    `=IFERROR("plan "&TEXT(CFG_INCOME,"${CURRENCY_FORMAT_WHOLE}"),"")`);
  dashTile(sheet, 5, 5, 'SPEND (MTD)', spendF, CURRENCY_FORMAT_WHOLE,
    `=IFERROR("budget "&TEXT(SUMIFS('${B}'!$H:$H,'${B}'!$A:$A,${MK},'${B}'!$E:$E,"<>${CATEGORY_KINDS.INCOME}"),"${CURRENCY_FORMAT_WHOLE}"),"")`);
  dashTile(sheet, 5, 7, 'NET CASHFLOW', `=C6-E6`, CURRENCY_FORMAT_WHOLE,
    `="income less spending"`);
  dashTile(sheet, 5, 9, 'SAVINGS RATE', `=IFERROR(IF(C6=0,"",(C6-E6)/C6),"")`, PCT_FORMAT,
    `=IFERROR("target "&TEXT(CFG_SAVINGS_TARGET,"0%"),"")`);
  // Liquid cash ÷ average monthly essential spend = months of runway.
  dashTile(sheet, 5, 11, 'EMERGENCY FUND',
    `=IFERROR(IF(PRJ_BASE_ESSENTIAL=0,"",PRJ_START_CASH/PRJ_BASE_ESSENTIAL),"")`,
    NUMBER_FORMAT,
    `=IFERROR("target "&TEXT(CFG_EF_MONTHS,"0")&" months","")`);

  // --- KPI row 2 -------------------------------------------------------
  const debtF = `=IFERROR(SUM('${D}'!$C:$C),0)`;
  const budgetUsedF =
    `=IFERROR(IF(SUMIFS('${B}'!$H:$H,'${B}'!$A:$A,${MK},'${B}'!$E:$E,"<>${CATEGORY_KINDS.INCOME}")=0,"",E6/SUMIFS('${B}'!$H:$H,'${B}'!$A:$A,${MK},'${B}'!$E:$E,"<>${CATEGORY_KINDS.INCOME}")),"")`;
  const overCatsF =
    `=IFERROR(COUNTIFS('${B}'!$A:$A,${MK},'${B}'!$E:$E,"<>${CATEGORY_KINDS.INCOME}",'${B}'!$M:$M,"<0"),0)`;
  const bills30F =
    `=IFERROR(SUMIFS('${R}'!$C:$C,'${R}'!$K:$K,">=0",'${R}'!$K:$K,"<=30",'${R}'!$H:$H,"Active"),0)`;
  const subsF =
    `=IFERROR(SUMIFS('${R}'!$J:$J,'${R}'!$H:$H,"Active"),0)`;
  const goalsF =
    `=IFERROR(COUNTIF('${G}'!$M:$M,"✅*")&" / "&COUNTA('${G}'!$A${DATA_START_ROW}:$A),"")`;

  dashTile(sheet, 9, 1, 'TOTAL DEBT', debtF, CURRENCY_FORMAT_WHOLE,
    `=IFERROR(IF(COUNTA('${D}'!$A${DATA_START_ROW}:$A)=0,"none tracked",CFG_DEBT_STRATEGY&" order"),"")`);
  dashTile(sheet, 9, 3, 'BUDGET USED', budgetUsedF, PCT_FORMAT,
    `=IFERROR("day "&DAY(TODAY())&" of "&DAY(EOMONTH(TODAY(),0)),"")`);
  dashTile(sheet, 9, 5, 'OVER BUDGET', overCatsF, '0',
    `="categories overspent"`);
  dashTile(sheet, 9, 7, 'BILLS DUE 30d', bills30F, CURRENCY_FORMAT_WHOLE,
    `="recurring, next 30 days"`);
  dashTile(sheet, 9, 9, 'SUBSCRIPTIONS', subsF, CURRENCY_FORMAT_WHOLE,
    `="per year, active"`);
  dashTile(sheet, 9, 11, 'GOALS ON TRACK', goalsF, '@',
    `="on track / total"`);

  // --- To Assign: the zero-based budget's single most important number ------
  // Planned income minus everything assigned to a category. Zero is the goal:
  // positive means dollars have no job yet, negative means the plan promises
  // money that is not there. A plan can look reasonable line by line and still
  // be over-committed in total — that total is only visible here.
  dashSectionHeader(sheet, 12, '🧾 ZERO-BASED CHECK');
  const assignedF =
    `=IFERROR(SUMIFS('${B}'!$H:$H,'${B}'!$A:$A,${MK},'${B}'!$E:$E,"<>${CATEGORY_KINDS.INCOME}"),0)`;
  sheet.getRange(12, 5)
    .setFormula(`=IFERROR("Planned income "&TEXT(CFG_INCOME,"${CURRENCY_FORMAT_WHOLE}")&"   ·   assigned "&TEXT(${assignedF.substring(1)},"${CURRENCY_FORMAT_WHOLE}")&"   ·   to assign ","")`)
    .setFontColor('#FFFFFF').setFontSize(10).setVerticalAlignment('middle')
    .setHorizontalAlignment('right');
  sheet.getRange(12, 11)
    .setFormula(`=IFERROR(CFG_INCOME-${assignedF.substring(1)},"")`)
    .setNumberFormat(CURRENCY_FORMAT)
    .setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(11)
    .setVerticalAlignment('middle')
    .setNote('Zero is the target. Positive = dollars with no job yet. ' +
      'Negative = the plan assigns more than you earn, and something will have to give.');

  // --- Alerts ----------------------------------------------------------
  const ALERT_HEADER_ROW = 14;   // row 13 stays blank: two stacked header
  const ALERT_FIRST_ROW = 15;    // bars read as one bar and hide the divide
  dashSectionHeader(sheet, ALERT_HEADER_ROW, '⚠️ NEEDS ATTENTION');
  // Each alert returns either "" (stay silent) or one sentence naming the
  // problem and the fix. An alert that fires constantly stops being read, so
  // every one of these is conditional on a threshold actually being crossed.
  const uncategorized = `COUNTIFS('${T}'!$A${DATA_START_ROW}:$A,"<>",'${T}'!$D${DATA_START_ROW}:$D,"")`;
  const neverAmortize = `COUNTIF('${D}'!$I:$I,"*never*")`;
  const drifted = `COUNTIF('${R}'!$N:$N,">0.01")`;
  const alerts = [
    `=IFERROR(IF(N($K$12)>=0,"","• Over-assigned by "&TEXT(-$K$12,"${CURRENCY_FORMAT}")&" this month — the plan plans to spend money that is not there. Cut a category or raise planned income."),"")`,
    `=IFERROR(IF(OR($K$12<=0,$K$12<25),"","• "&TEXT($K$12,"${CURRENCY_FORMAT}")&" of income has no job yet. Assign it before the month starts, or it will be spent by default."),"")`,
    `=IF(${uncategorized}=0,"","• "&${uncategorized}&" transaction(s) have no category. Run 💰 Finance ▸ Apply Categorization Rules.")`,
    `=IF(N($E$10)=0,"","• "&$E$10&" categor"&IF($E$10=1,"y is","ies are")&" over budget this month — see the table below.")`,
    `=IFERROR(IF($K$6="","",IF($K$6>=CFG_EF_MONTHS,"","• Emergency fund covers "&TEXT($K$6,"0.0")&" months of essentials, short of your "&TEXT(CFG_EF_MONTHS,"0")&"-month target.")),"")`,
    `=IFERROR(IF($I$6="","",IF($I$6>=CFG_SAVINGS_TARGET,"","• Savings rate is "&TEXT($I$6,"0.0%")&" against a "&TEXT(CFG_SAVINGS_TARGET,"0%")&" target.")),"")`,
    `=IFERROR(IF(${neverAmortize}=0,"","• "&${neverAmortize}&" debt(s) will never amortize at the current payment — the payment does not cover the interest."),"")`,
    `=IFERROR(IF(${drifted}=0,"","• "&${drifted}&" subscription(s) charged more than the amount on record — check Price_Drift."),"")`,
    `=IF(COUNTA('${A}'!$A${DATA_START_ROW}:$A)>0,"","• No accounts yet. Add them on the Accounts tab — nothing else can compute until you do.")`,
    `=IF(COUNTA('${T}'!$A${DATA_START_ROW}:$A)>0,"","• No transactions yet. Paste a bank export on the Import tab, or try 💰 Finance ▸ Load Sample Data.")`,
  ];
  alerts.forEach((f, i) => {
    sheet.getRange(ALERT_FIRST_ROW + i, 1).setFormula(f.replace(/\s*\n\s*/g, ' '))
      .setFontSize(10).setFontColor('#7A4F01');
  });
  sheet.getRange(ALERT_FIRST_ROW, 1, alerts.length, DASH_COLS).setBackground('#FFFBF0');

  // --- Budget table + upcoming bills -----------------------------------
  const tableTop = ALERT_FIRST_ROW + alerts.length + 2;
  dashSectionHeader(sheet, tableTop, '📊 THIS MONTH BY CATEGORY', 1, 6);
  dashSectionHeader(sheet, tableTop, '🔁 DUE IN THE NEXT 30 DAYS', 7, 6);

  // QUERY keeps this live and sorted by worst variance without any script.
  sheet.getRange(tableTop + 1, 1).setFormula(
    `=IFERROR(QUERY('${B}'!$A${DATA_START_ROW}:$N,
      "select C, H, I, M where A = '"&TEXT(TODAY(),"yyyy-mm")&"' and E <> '${CATEGORY_KINDS.INCOME}' and C is not null and (H > 0 or I > 0) order by M asc limit 14
       label C 'Category', H 'Budget', I 'Actual', M 'Left'",0),"No budget rows for this month yet — run 💰 Finance ▸ Rebuild Budget Months.")`
      .replace(/\s*\n\s*/g, ' '));

  sheet.getRange(tableTop + 1, 7).setFormula(
    `=IFERROR(QUERY('${R}'!$A${DATA_START_ROW}:$N,
      "select A, C, E, K where H = 'Active' and K >= 0 and K <= 30 order by K asc limit 14
       label A 'Bill', C 'Amount', E 'Due', K 'Days'",0),"Nothing due in the next 30 days.")`
      .replace(/\s*\n\s*/g, ' '));

  // --- Goals + 50/30/20 -------------------------------------------------
  const goalsTop = tableTop + 17;
  dashSectionHeader(sheet, goalsTop, '🎯 GOAL PROGRESS', 1, 6);
  dashSectionHeader(sheet, goalsTop, '⚖️ 50 / 30 / 20 CHECK', 7, 6);

  sheet.getRange(goalsTop + 1, 1).setFormula(
    `=IFERROR(QUERY('${G}'!$A${DATA_START_ROW}:$M,
      "select A, H, K, M where A is not null order by G asc limit 10
       label A 'Goal', H 'Funded', K 'Needs/mo', M 'Status'",0),"No goals yet.")`
      .replace(/\s*\n\s*/g, ' '));

  // The 50/30/20 block is written as a small literal table so the reference
  // percentages sit beside the actuals — a ratio alone means nothing.
  const s = goalsTop + 1;
  sheet.getRange(s, 7, 1, 4).setValues([['Bucket', 'Actual', 'Share', 'Guide']])
    .setFontWeight('bold').setBackground('#E8EEF7');
  const buckets = [
    ['Essentials', CATEGORY_KINDS.ESSENTIAL, '50%'],
    ['Lifestyle', CATEGORY_KINDS.LIFESTYLE, '30%'],
    ['Saving & debt', null, '20%'],
  ];
  buckets.forEach((b, i) => {
    const r = s + 1 + i;
    sheet.getRange(r, 7).setValue(b[0]);
    if (b[1]) {
      sheet.getRange(r, 8).setFormula(
        `=IFERROR(SUMIFS('${B}'!$I:$I,'${B}'!$A:$A,${MK},'${B}'!$E:$E,"${b[1]}"),0)`)
        .setNumberFormat(CURRENCY_FORMAT_WHOLE);
    } else {
      sheet.getRange(r, 8).setFormula(`=MAX(0,$C$6-$H$${s + 1}-$H$${s + 2})`)
        .setNumberFormat(CURRENCY_FORMAT_WHOLE);
    }
    sheet.getRange(r, 9).setFormula(`=IFERROR(IF($C$6=0,"",H${r}/$C$6),"")`)
      .setNumberFormat(PCT_FORMAT);
    sheet.getRange(r, 10).setValue(b[2]).setFontColor(KPI_LABEL_COLOR);
  });
  sheet.getRange(s + 4, 7)
    .setValue('A guide, not a rule. Drift matters more than the exact split.')
    .setFontSize(9).setFontStyle('italic').setFontColor(KPI_LABEL_COLOR);

  // --- 12-month trend (also the chart source) ---------------------------
  const trendTop = goalsTop + 14;
  dashSectionHeader(sheet, trendTop, '📈 ROLLING 12-MONTH CASHFLOW');
  sheet.getRange(trendTop + 1, 1, 1, 5)
    .setValues([['Month', 'Income', 'Spend', 'Net', 'Savings Rate']])
    .setFontWeight('bold').setBackground('#E8EEF7');

  for (let i = 0; i < 12; i++) {
    const r = trendTop + 2 + i;
    const off = i - 11; // oldest first
    sheet.getRange(r, 1).setFormula(`=EOMONTH(TODAY(),${off})+1-DAY(EOMONTH(TODAY(),${off})+1)+1`)
      .setNumberFormat(MONTH_FORMAT);
    const key = `TEXT(A${r},"yyyy-mm")`;
    sheet.getRange(r, 2).setFormula(
      `=IFERROR(SUMIFS('${B}'!$I:$I,'${B}'!$A:$A,${key},'${B}'!$E:$E,"${CATEGORY_KINDS.INCOME}"),0)`)
      .setNumberFormat(CURRENCY_FORMAT_WHOLE);
    sheet.getRange(r, 3).setFormula(
      `=IFERROR(SUMIFS('${B}'!$I:$I,'${B}'!$A:$A,${key},'${B}'!$E:$E,"${CATEGORY_KINDS.ESSENTIAL}")+SUMIFS('${B}'!$I:$I,'${B}'!$A:$A,${key},'${B}'!$E:$E,"${CATEGORY_KINDS.LIFESTYLE}")+SUMIFS('${B}'!$I:$I,'${B}'!$A:$A,${key},'${B}'!$E:$E,"${CATEGORY_KINDS.DEBT}"),0)`)
      .setNumberFormat(CURRENCY_FORMAT_WHOLE);
    sheet.getRange(r, 4).setFormula(`=B${r}-C${r}`).setNumberFormat(CURRENCY_FORMAT_WHOLE);
    sheet.getRange(r, 5).setFormula(`=IFERROR(IF(B${r}=0,"",(B${r}-C${r})/B${r}),"")`)
      .setNumberFormat(PCT_FORMAT);
  }

  // --- Charts ----------------------------------------------------------
  const trendData = sheet.getRange(trendTop + 1, 1, 13, 4);
  sheet.insertChart(sheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(trendData)
    .setPosition(trendTop + 1, 7, 0, 0)
    .setOption('title', 'Income vs. spend, last 12 months')
    .setOption('legend', { position: 'top' })
    .setOption('colors', ['#38761D', '#CC0000', '#1F3864'])
    .setOption('width', 640)
    .setOption('height', 300)
    .setNumHeaders(1)
    .build());

  // Same-sheet mirrors of the two Setup targets the conditional formats below
  // compare against. Conditional formatting cannot reach another sheet, so
  // these cells sit off to the right of the visible dashboard and are hidden.
  sheet.getRange(1, 14).setFormula('=IFERROR(CFG_SAVINGS_TARGET,0.2)');
  sheet.getRange(2, 14).setFormula('=IFERROR(CFG_EF_MONTHS,6)');
  sheet.hideColumns(14);

  sheet.setFrozenRows(2);
  applyDashboardConditionalFormats(sheet, trendTop);
  blog('built Dashboard');
  return sheet;
}

/** A full-width (or partial) section header bar. */
function dashSectionHeader(sheet, row, text, startCol, width) {
  const c = startCol || 1;
  const w = width || DASH_COLS;
  sheet.getRange(row, c, 1, w).setBackground('#1F3864');
  sheet.setRowHeight(row, 24);
  sheet.getRange(row, c).setValue(text)
    .setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10)
    .setVerticalAlignment('middle');
}

/**
 * A KPI tile: small gray label, large value, small gray sublabel — three rows
 * in a 2-column block. Big number on top is the whole reason a dashboard beats
 * a table for the "where do I stand" question.
 */
function dashTile(sheet, row, col, label, valueFormula, format, subFormula) {
  sheet.getRange(row, col, 3, DASH_TILE_WIDTH)
    .setBackground('#F7F9FC')
    .setBorder(true, true, true, true, false, false, '#DDE3EC', SpreadsheetApp.BorderStyle.SOLID);

  sheet.getRange(row, col, 1, DASH_TILE_WIDTH).merge()
    .setValue(label)
    .setFontSize(8).setFontWeight('bold').setFontColor(KPI_LABEL_COLOR)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');

  const v = sheet.getRange(row + 1, col, 1, DASH_TILE_WIDTH).merge();
  v.setFormula(valueFormula)
    .setNumberFormat(format)
    .setFontSize(15).setFontWeight('bold').setFontColor('#1F3864')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(row + 1, 30);

  sheet.getRange(row + 2, col, 1, DASH_TILE_WIDTH).merge()
    .setFormula(subFormula || '=""')
    .setFontSize(8).setFontColor(KPI_LABEL_COLOR)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
}

function applyDashboardConditionalFormats(sheet, trendTop) {
  const rules = [];
  // Net cashflow tile: green if positive, red if negative.
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberLessThan(0).setFontColor(BAD_COLOR)
    .setRanges([sheet.getRange(6, 7, 1, 2), sheet.getRange(trendTop + 2, 4, 12, 1)]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(0).setFontColor(GOOD_COLOR)
    .setRanges([sheet.getRange(6, 7, 1, 2), sheet.getRange(trendTop + 2, 4, 12, 1)]).build());
  // Savings rate and emergency fund against their targets, read from the
  // hidden same-sheet mirror cells in column N rather than from the CFG_*
  // named ranges, which conditional formatting cannot reach.
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($I$6<>"",$I$6<$N$1)')
    .setFontColor(WARN_COLOR)
    .setRanges([sheet.getRange(6, 9, 1, 2)]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($K$6<>"",$K$6<$N$2)')
    .setFontColor(WARN_COLOR)
    .setRanges([sheet.getRange(6, 11, 1, 2)]).build());
  // Over-budget count.
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(0).setFontColor(BAD_COLOR)
    .setRanges([sheet.getRange(10, 5, 1, 2)]).build());
  sheet.setConditionalFormatRules(rules);
}


// ============================================================================
//  13. PROJECTIONS
// ============================================================================

// Row 2 = helper labels, row 3 = helper values, rows 5–9 = the salary
// scenario block, row 11 = table headers, row 12 = first projected month.
const PROJ_HELPER_ROW = 2;
const PROJ_HEADER_ROW = 11;
const PROJ_DATA_ROW = 12;
const PROJ_MAX_MONTHS = 600;

/**
 * A month-by-month forward model. The assumptions live in named ranges on
 * Setup; the *starting conditions* are derived here from actual data (with a
 * manual override on Setup for each), because a projection seeded by hand from
 * numbers that already exist in the workbook is a projection that silently
 * goes stale.
 *
 * The model is deliberately simple and legible rather than clever:
 *   income grows at CFG_INCOME_GROWTH, spending inflates at CFG_INFLATION,
 *   the surplus is invested at CFG_RETURN compounded monthly, debt amortizes
 *   at the blended APR against the total payment on the Debts tab.
 * It does not model taxes, lumpy income, market sequence risk or life events.
 * Those matter enormously — which is why the real-dollar column exists and why
 * the tab says out loud that this is a trajectory, not a forecast.
 */
function buildProjectionsSheet(ss) {
  const sheet = ensureSheet(ss, SHEET_NAMES.PROJECTIONS);
  sheet.clear();
  sheet.getCharts().forEach(c => sheet.removeChart(c));

  const B = SHEET_NAMES.BUDGET;
  const C = SHEET_NAMES.CATEGORIES;
  const A = SHEET_NAMES.ACCOUNTS;
  const D = SHEET_NAMES.DEBTS;

  const months = PROJ_MAX_MONTHS;
  const lastRow = PROJ_DATA_ROW + months - 1;
  if (sheet.getMaxRows() < lastRow) {
    sheet.insertRowsAfter(sheet.getMaxRows(), lastRow - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < 14) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), 14 - sheet.getMaxColumns());
  }

  // --- Banner ----------------------------------------------------------
  sheet.getRange(1, 1, 1, 14).setBackground(BANNER_BG);
  sheet.setRowHeight(1, 34);
  sheet.getRange(1, 1)
    .setValue('🔮 Projections — a trajectory, not a forecast')
    .setFontColor(BANNER_FG).setFontSize(12).setFontWeight('bold')
    .setVerticalAlignment('middle');
  sheet.getRange(1, 3)
    .setValue('Assumptions come from Setup. Starting balances are derived from your actual accounts. Read the REAL column, not the nominal one.')
    .setFontColor('#D6E0F5').setFontSize(9).setFontStyle('italic')
    .setVerticalAlignment('middle');

  // --- Derived starting conditions, published as named ranges ----------
  // Each falls back to your category targets when there is no history yet, so
  // the model produces something sensible on day one instead of all zeros.
  const kindFallback = kind =>
    `(IFERROR(SUMIFS('${C}'!$E:$E,'${C}'!$C:$C,"${kind}",'${C}'!$H:$H,TRUE),0)+IFERROR(SUMIFS('${C}'!$F:$F,'${C}'!$C:$C,"${kind}",'${C}'!$H:$H,TRUE),0)*CFG_INCOME)`;
  const kindTrailing = kind =>
    `IFERROR(SUMIFS('${B}'!$I:$I,'${B}'!$E:$E,"${kind}",'${B}'!$B:$B,">="&EOMONTH(TODAY(),-4)+1,'${B}'!$B:$B,"<="&EOMONTH(TODAY(),-1))/3,0)`;

  const helpers = [
    { name: 'PRJ_BASE_ESSENTIAL', label: 'Base monthly essentials',
      formula: `=IF(${kindTrailing(CATEGORY_KINDS.ESSENTIAL)}=0,${kindFallback(CATEGORY_KINDS.ESSENTIAL)},${kindTrailing(CATEGORY_KINDS.ESSENTIAL)})`,
      format: CURRENCY_FORMAT,
      note: 'Trailing 3-month actual, falling back to your Essential category targets.' },
    { name: 'PRJ_BASE_LIFESTYLE', label: 'Base monthly lifestyle',
      formula: `=IF(${kindTrailing(CATEGORY_KINDS.LIFESTYLE)}=0,${kindFallback(CATEGORY_KINDS.LIFESTYLE)},${kindTrailing(CATEGORY_KINDS.LIFESTYLE)})`,
      format: CURRENCY_FORMAT },
    { name: 'PRJ_START_INVEST', label: 'Starting invested',
      formula: `=IF(N(CFG_INVEST_BAL)>0,CFG_INVEST_BAL,IFERROR(SUMIFS('${A}'!$J:$J,'${A}'!$B:$B,"Investment",'${A}'!$H:$H,TRUE),0)+IFERROR(SUMIFS('${A}'!$J:$J,'${A}'!$B:$B,"Retirement",'${A}'!$H:$H,TRUE),0))`,
      format: CURRENCY_FORMAT,
      note: 'Investment + Retirement account balances, unless you set an override on Setup.' },
    { name: 'PRJ_START_CASH', label: 'Starting cash',
      formula: `=IF(N(CFG_CASH_BAL)>0,CFG_CASH_BAL,IFERROR(SUMIFS('${A}'!$J:$J,'${A}'!$B:$B,"Checking",'${A}'!$H:$H,TRUE),0)+IFERROR(SUMIFS('${A}'!$J:$J,'${A}'!$B:$B,"Savings",'${A}'!$H:$H,TRUE),0)+IFERROR(SUMIFS('${A}'!$J:$J,'${A}'!$B:$B,"Cash",'${A}'!$H:$H,TRUE),0))`,
      format: CURRENCY_FORMAT,
      note: 'Liquid accounts only. This is also the emergency-fund numerator on the Dashboard.' },
    { name: 'PRJ_START_DEBT', label: 'Starting debt',
      formula: `=IFERROR(SUM('${D}'!$C:$C),0)`, format: CURRENCY_FORMAT },
    { name: 'PRJ_DEBT_PAYMENT', label: 'Monthly debt payment',
      formula: `=IFERROR(SUM('${D}'!$H:$H),0)`, format: CURRENCY_FORMAT },
    { name: 'PRJ_DEBT_APR', label: 'Blended debt APR',
      formula: `=IFERROR(IF(SUM('${D}'!$C:$C)=0,0,SUMPRODUCT('${D}'!$C${DATA_START_ROW}:$C,'${D}'!$D${DATA_START_ROW}:$D)/SUM('${D}'!$C:$C)),0)`,
      format: PCT_FORMAT,
      note: 'Balance-weighted average APR. A simplification: the model amortizes all debt as one blended loan rather than sequencing by strategy.' },
    { name: 'PRJ_FI_NUMBER', label: 'FI number',
      formula: `=IFERROR(IF(N(CFG_SWR)=0,"",(PRJ_BASE_ESSENTIAL+PRJ_BASE_LIFESTYLE)*12/CFG_SWR),"")`,
      format: CURRENCY_FORMAT_WHOLE,
      note: 'Annual spending ÷ safe withdrawal rate. At 4% this is 25× annual spend — the portfolio size at which work becomes optional.' },
  ];

  helpers.forEach((h, i) => {
    const col = 1 + i * 2;
    sheet.getRange(PROJ_HELPER_ROW, col)
      .setValue(h.label).setFontSize(8).setFontWeight('bold').setFontColor(KPI_LABEL_COLOR);
    const cell = sheet.getRange(PROJ_HELPER_ROW + 1, col);
    cell.setFormula(h.formula)
      .setNumberFormat(h.format)
      .setFontSize(11).setFontWeight('bold').setFontColor('#1F3864')
      .setBackground(COMPUTED_CELL_TINT);
    if (h.note) cell.setNote(h.note);
    try { ss.setNamedRange(h.name, cell); } catch (err) { blog(`named range ${h.name}: ${err}`); }
  });

  // --- Salary scenarios -------------------------------------------------
  // "What would this offer actually change?" answered in take-home terms.
  // A gross salary is not comparable to a budget; only net is, and the gap
  // between them is large enough that comparing offers on gross alone is how
  // people talk themselves into a raise that does not clear.
  const SCEN_ROW = PROJ_HELPER_ROW + 3;
  sheet.getRange(SCEN_ROW, 1, 1, 5)
    .setValues([['Salary scenario', 'Gross / yr', 'Net / mo', 'vs. plan', 'Verdict']])
    .setFontWeight('bold').setFontSize(9).setBackground('#E8EEF7');

  const assignedTotal =
    `IFERROR(SUMIFS('${SHEET_NAMES.BUDGET}'!$H:$H,'${SHEET_NAMES.BUDGET}'!$A:$A,TEXT(TODAY(),"yyyy-mm"),'${SHEET_NAMES.BUDGET}'!$E:$E,"<>${CATEGORY_KINDS.INCOME}"),0)`;

  // Three offsets around the current salary, so the table stays useful as the
  // salary itself changes rather than hard-coding the numbers of one moment.
  [['Current', 0], ['−$8k', -8000], ['+$7k', 7000]].forEach((s, i) => {
    const row = SCEN_ROW + 1 + i;
    sheet.getRange(row, 1).setValue(s[0]).setFontSize(9);
    sheet.getRange(row, 2).setFormula(`=CFG_GROSS_SALARY+${s[1]}`)
      .setNumberFormat(CURRENCY_FORMAT_WHOLE).setFontSize(9);
    sheet.getRange(row, 3).setFormula(`=B${row}*CFG_TAKEHOME_RATE/12`)
      .setNumberFormat(CURRENCY_FORMAT).setFontSize(9);
    sheet.getRange(row, 4).setFormula(`=IFERROR(C${row}-${assignedTotal},"")`)
      .setNumberFormat(CURRENCY_FORMAT).setFontSize(9);
    sheet.getRange(row, 5)
      .setFormula(`=IF(D${row}="","",IF(D${row}<0,"⚠️ short "&TEXT(-D${row},"${CURRENCY_FORMAT}")&"/mo","✅ clears by "&TEXT(D${row},"${CURRENCY_FORMAT}")&"/mo"))`)
      .setFontSize(9);
  });
  sheet.getRange(SCEN_ROW + 4, 1)
    .setValue('Net/mo uses your take-home rate from Setup. "vs. plan" compares it to everything currently assigned on Budget_Monthly.')
    .setFontSize(8).setFontStyle('italic').setFontColor(KPI_LABEL_COLOR);

  // --- Table -----------------------------------------------------------
  const headers = [
    'Month_#', 'Month', 'Income', 'Essentials', 'Lifestyle', 'Debt_Payment',
    'Surplus', 'Savings_Rate', 'Invested', 'Cash', 'Debt_Balance',
    'Net_Worth', 'Net_Worth_Real', 'Milestone',
  ];
  sheet.getRange(PROJ_HEADER_ROW, 1, 1, headers.length).setValues([headers])
    .setBackground(COMPUTED_HEADER_COLOR).setFontColor(COMPUTED_HEADER_FG)
    .setFontWeight('bold').setFontSize(10).setWrap(true);
  sheet.getRange(PROJ_HEADER_ROW, 13)
    .setNote('Nominal net worth deflated to today\'s dollars at CFG_INFLATION. THIS is the column to plan against — a large nominal number 30 years out mostly reflects inflation, not progress.');

  // Every column is generated per row as an explicit string rather than
  // copied down. Three of these columns are RECURRENCE RELATIONS — invested
  // balance, debt balance and the milestone flags each read the row above —
  // and letting copyTo shift relative references across a first row that has
  // different semantics (it reads the PRJ_START_* named ranges instead) is
  // exactly where that approach breaks. Generating the text is longer and
  // completely unambiguous. The whole block is written in one setFormulas
  // call, so 600 rows × 14 columns costs one round trip, not 8,400.
  const r = PROJ_DATA_ROW;   // first data row

  /** Column generators: (row, isFirst) → formula text. */
  const gen = [
    // A Month_#
    (row, first) => first
      ? `=IF(1>N(CFG_PROJ_MONTHS),"",1)`
      : `=IF($A${row - 1}="","",IF($A${row - 1}+1>N(CFG_PROJ_MONTHS),"",$A${row - 1}+1))`,
    // B Month — first of each future month
    row => `=IF($A${row}="","",EDATE(DATE(YEAR(TODAY()),MONTH(TODAY()),1),$A${row}))`,
    // C Income — compounds monthly at the annual growth rate
    row => `=IF($A${row}="","",CFG_INCOME*(1+CFG_INCOME_GROWTH)^(($A${row}-1)/12))`,
    // D Essentials — inflates
    row => `=IF($A${row}="","",PRJ_BASE_ESSENTIAL*(1+CFG_INFLATION)^(($A${row}-1)/12))`,
    // E Lifestyle — inflates
    row => `=IF($A${row}="","",PRJ_BASE_LIFESTYLE*(1+CFG_INFLATION)^(($A${row}-1)/12))`,
    // F Debt payment — never pays more than the balance owed, and stops at zero
    (row, first) => first
      ? `=IF($A${row}="","",IF(PRJ_START_DEBT<=0,0,MIN(PRJ_DEBT_PAYMENT,PRJ_START_DEBT*(1+PRJ_DEBT_APR/12))))`
      : `=IF($A${row}="","",IF(N($K${row - 1})<=0,0,MIN(PRJ_DEBT_PAYMENT,$K${row - 1}*(1+PRJ_DEBT_APR/12))))`,
    // G Surplus
    row => `=IF($A${row}="","",MAX(0,$C${row}-$D${row}-$E${row}-$F${row}))`,
    // H Savings rate
    row => `=IF(OR($A${row}="",N($C${row})=0),"",$G${row}/$C${row})`,
    // I Invested — prior balance compounds, then the surplus is added
    (row, first) => first
      ? `=IF($A${row}="","",PRJ_START_INVEST*(1+CFG_RETURN/12)+$G${row})`
      : `=IF($A${row}="","",N($I${row - 1})*(1+CFG_RETURN/12)+$G${row})`,
    // J Cash — held flat; the model routes all surplus to investments
    row => `=IF($A${row}="","",PRJ_START_CASH)`,
    // K Debt balance — accrues interest, then takes the payment
    (row, first) => first
      ? `=IF($A${row}="","",MAX(0,PRJ_START_DEBT*(1+PRJ_DEBT_APR/12)-$F${row}))`
      : `=IF($A${row}="","",MAX(0,N($K${row - 1})*(1+PRJ_DEBT_APR/12)-$F${row}))`,
    // L Net worth
    row => `=IF($A${row}="","",$I${row}+$J${row}-$K${row})`,
    // M Real net worth — deflated to today's dollars
    row => `=IF($A${row}="","",$L${row}/((1+CFG_INFLATION)^($A${row}/12)))`,
    // N Milestone — fires on the CROSSING, not on the condition, so each
    //   milestone appears exactly once instead of on every row thereafter
    (row, first) => first
      ? `=IF($A${row}="","",IFS(AND($K${row}<=0,PRJ_START_DEBT>0),"🎉 Debt free",AND($I${row}>=PRJ_FI_NUMBER,PRJ_START_INVEST<PRJ_FI_NUMBER),"🏁 Financially independent",TRUE,""))`
      : `=IF($A${row}="","",IFS(AND($K${row}<=0,N($K${row - 1})>0),"🎉 Debt free",AND($I${row}>=PRJ_FI_NUMBER,N($I${row - 1})<PRJ_FI_NUMBER),"🏁 Financially independent",AND($I${row}>=PRJ_FI_NUMBER/2,N($I${row - 1})<PRJ_FI_NUMBER/2),"◐ Halfway to FI",TRUE,""))`,
  ];

  const formulaBlock = [];
  for (let i = 0; i < months; i++) {
    const row = r + i;
    formulaBlock.push(gen.map(f => f(row, i === 0)));
  }
  sheet.getRange(r, 1, months, gen.length).setFormulas(formulaBlock);

  const projFormats = [
    '0', MONTH_FORMAT, CURRENCY_FORMAT_WHOLE, CURRENCY_FORMAT_WHOLE, CURRENCY_FORMAT_WHOLE,
    CURRENCY_FORMAT_WHOLE, CURRENCY_FORMAT_WHOLE, PCT_FORMAT, CURRENCY_FORMAT_WHOLE,
    CURRENCY_FORMAT_WHOLE, CURRENCY_FORMAT_WHOLE, CURRENCY_FORMAT_WHOLE,
    CURRENCY_FORMAT_WHOLE, '@',
  ];
  projFormats.forEach((fmt, i) => sheet.getRange(r, i + 1, months, 1).setNumberFormat(fmt));

  // Column widths and frame.
  const widths = [70, 95, 100, 100, 100, 110, 100, 90, 115, 100, 115, 115, 125, 200];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.setFrozenRows(PROJ_HEADER_ROW);
  sheet.setFrozenColumns(2);
  sheet.getRange(r, 1, months, 14).setBackground(COMPUTED_CELL_TINT);

  // Milestones should be findable without scrolling 120 rows.
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('🏁').setBackground(GOOD_BG).setFontColor(GOOD_COLOR).setBold(true)
      .setRanges([sheet.getRange(r, 1, months, 14)]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('🎉').setBackground('#E8F0FE').setFontColor('#1F3864')
      .setRanges([sheet.getRange(r, 14, months, 1)]).build(),
  ]);

  // --- Chart -----------------------------------------------------------
  // 120 rows keeps the default chart readable; the table itself runs longer.
  const chartRows = 120;
  sheet.insertChart(sheet.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(sheet.getRange(PROJ_HEADER_ROW, 2, chartRows + 1, 1))
    .addRange(sheet.getRange(PROJ_HEADER_ROW, 12, chartRows + 1, 2))
    .setPosition(2, 15, 0, 0)
    .setOption('title', 'Projected net worth — nominal vs. real')
    .setOption('legend', { position: 'top' })
    .setOption('colors', ['#1F3864', '#93A9D1'])
    .setOption('width', 720)
    .setOption('height', 360)
    .setNumHeaders(1)
    .build());

  blog('built Projections');
  return sheet;
}
