/**
 * ============================================================================
 *  💰  PERSONAL FINANCE TRACKER  —  PART 4: BANK SYNC (SimpleFIN Bridge)
 * ============================================================================
 *
 *  ── READ THIS BEFORE USING IT ─────────────────────────────────────────────
 *
 *  THIS CODE NEVER ASKS FOR, STORES, OR TRANSMITS YOUR BANK CREDENTIALS.
 *  It cannot: it has no field for them and no code path that would accept
 *  them. If any version of this workbook ever prompts you for a bank username
 *  or password, it has been tampered with — do not type them.
 *
 *  Banks do not offer consumer API access. Every product that "connects to
 *  your bank" — YNAB, Monarch, Copilot — routes through a regulated
 *  aggregator. You authenticate with your bank directly, on the bank's or
 *  aggregator's own domain, and the aggregator hands back a REVOCABLE,
 *  READ-ONLY token. That token is the only secret this script ever holds.
 *
 *  Why SimpleFIN Bridge rather than Plaid:
 *    - Plaid Link is a browser widget that needs a server to mint link_tokens.
 *      Apps Script can host the widget but the flow wants a real backend, and
 *      production Plaid access requires company approval.
 *    - Teller needs mTLS client certificates. UrlFetchApp cannot present a
 *      client certificate, so Teller is impossible here, not merely awkward.
 *    - SimpleFIN is a single bearer credential over HTTPS Basic auth, is
 *      read-only by construction (the protocol has no write verbs at all),
 *      and costs about $1.50/month. It fits Apps Script exactly.
 *
 *  ── WHERE THE TOKEN LIVES, AND WHO CAN READ IT ────────────────────────────
 *
 *  The access URL is kept in SCRIPT PROPERTIES, never in a cell. That means
 *  it is not visible to someone with read access to the spreadsheet, it is
 *  not in the file's revision history, and it is not exported when you
 *  download the sheet.
 *
 *  BUT — and this is the real limit of what Apps Script can protect —
 *  ANYONE WITH EDIT ACCESS TO THIS SPREADSHEET CAN OPEN THE SCRIPT EDITOR
 *  AND READ SCRIPT PROPERTIES. There is no way around this in a
 *  container-bound script. So:
 *    - Do not use bank sync in a spreadsheet you share with edit rights.
 *    - Share read-only, or keep the synced copy private and share a copy.
 *  Disconnect() erases the stored credential, and you can revoke it at the
 *  Bridge at any time, which is the real kill switch.
 *
 *  ── WHAT IT CAN AND CANNOT DO ─────────────────────────────────────────────
 *  Can:    read account balances and transaction history.
 *  Cannot: move money, initiate payments, or change anything at your bank.
 *          The SimpleFIN protocol defines no such operation.
 * ============================================================================
 */


// ============================================================================
//  22. CONFIGURATION & STORED STATE
// ============================================================================

const SF_ACCESS_URL_KEY = 'SIMPLEFIN_ACCESS_URL';
const SF_LAST_SYNC_KEY = 'SIMPLEFIN_LAST_SYNC';
const SF_ACCOUNT_CACHE_KEY = 'SIMPLEFIN_ACCOUNT_CACHE';

/** How far back the first sync reaches, in days. */
const SF_INITIAL_LOOKBACK_DAYS = 90;

/**
 * Overlap re-fetched on every subsequent sync, in days.
 *
 * Transactions do not appear instantly — a card charge can post days after it
 * happened, and it lands with its ORIGINAL date, behind the last sync
 * timestamp. Syncing strictly forward from the last run would skip those
 * permanently. Re-fetching a window and relying on ID-based dedupe is the
 * correct trade: cheap, and it cannot lose a transaction.
 */
const SF_OVERLAP_DAYS = 10;

function sfProps() {
  return PropertiesService.getScriptProperties();
}

function sfAccessUrl() {
  return sfProps().getProperty(SF_ACCESS_URL_KEY) || '';
}

function sfIsConnected() {
  return sfAccessUrl() !== '';
}


// ============================================================================
//  23. MENU
// ============================================================================

/**
 * Called by buildMenu() in Budget_Build.gs. Kept separate so the bank-sync
 * feature can be removed wholesale by deleting this one file.
 */
function buildBankSyncMenu(ui) {
  return ui.createMenu('🏦 Bank Sync')
    .addItem('🔗  Connect to your bank…', 'connectBank')
    .addItem('🧩  Link accounts to this workbook', 'linkBankAccounts')
    .addSeparator()
    .addItem('⬇️  Sync transactions now', 'syncBank')
    .addItem('💵  Refresh balances only', 'syncBalancesOnly')
    .addSeparator()
    .addItem('ℹ️  Connection status', 'showBankStatus')
    .addItem('🔒  Security notes', 'showBankSecurityNotes')
    .addItem('❌  Disconnect and erase token', 'disconnectBank');
}


// ============================================================================
//  24. CONNECT
// ============================================================================

/**
 * Exchanges a one-time SimpleFIN setup token for a long-lived access URL.
 *
 * The setup token is a base64-encoded claim URL. It is single-use: POSTing to
 * it returns the access URL and burns the token. That is a deliberate property
 * of the protocol — a leaked setup token is useless once claimed, and if the
 * claim fails the user simply generates another.
 */
function connectBank() {
  const ui = SpreadsheetApp.getUi();

  if (sfIsConnected()) {
    const ans = ui.alert('Already connected',
      'This workbook already holds a bank access token.\n\n' +
      'Reconnecting replaces it. Continue?', ui.ButtonSet.YES_NO);
    if (ans !== ui.Button.YES) return;
  }

  const intro = ui.alert('Connect to your bank',
    'You will NOT enter your bank password here. This script has no field for it.\n\n' +
    'Steps:\n' +
    '  1. Go to  https://bridge.simplefin.org\n' +
    '  2. Create an account and connect your banks THERE (you authenticate\n' +
    '     with your bank on their site, not in this spreadsheet).\n' +
    '  3. Create a new App, and copy the SETUP TOKEN it gives you.\n' +
    '  4. Come back here and paste that token.\n\n' +
    'The token grants READ-ONLY access and you can revoke it at the Bridge\n' +
    'at any time.\n\n' +
    'Ready to paste your setup token?', ui.ButtonSet.OK_CANCEL);
  if (intro !== ui.Button.OK) return;

  const resp = ui.prompt('Paste your SimpleFIN setup token',
    'This is a long base64 string from bridge.simplefin.org.\n' +
    'It is NOT your bank password.', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  const token = resp.getResponseText().trim();
  if (!token) { ui.alert('No token entered.'); return; }

  // Guard against the most dangerous possible user error.
  if (token.indexOf('@') !== -1 && token.length < 100) {
    ui.alert('That does not look like a setup token',
      'It looks like an email address or a password.\n\n' +
      'NEVER type your bank credentials here. Go to bridge.simplefin.org, ' +
      'create an App, and copy the long setup token it displays.', ui.ButtonSet.OK);
    return;
  }

  let claimUrl;
  try {
    claimUrl = Utilities.newBlob(Utilities.base64Decode(token)).getDataAsString().trim();
  } catch (err) {
    ui.alert('Could not read that token',
      'It should be a base64 string copied from the Bridge. Copy it again, whole.',
      ui.ButtonSet.OK);
    return;
  }
  if (claimUrl.indexOf('https://') !== 0) {
    ui.alert('That token did not decode to a valid claim URL. Generate a new one at the Bridge.');
    return;
  }

  let accessUrl;
  try {
    const res = UrlFetchApp.fetch(claimUrl, {
      method: 'post',
      muteHttpExceptions: true,
      payload: '',
    });
    const code = res.getResponseCode();
    accessUrl = res.getContentText().trim();
    if (code !== 200 || accessUrl.indexOf('https://') !== 0) {
      ui.alert('The Bridge rejected that token',
        `HTTP ${code}\n\n${accessUrl.substring(0, 300)}\n\n` +
        'Setup tokens are SINGLE USE — if you already claimed this one, ' +
        'generate a fresh App at the Bridge and try again.', ui.ButtonSet.OK);
      return;
    }
  } catch (err) {
    ui.alert('Could not reach the Bridge', String(err), ui.ButtonSet.OK);
    return;
  }

  sfProps().setProperty(SF_ACCESS_URL_KEY, accessUrl);
  sfProps().deleteProperty(SF_LAST_SYNC_KEY);
  blog('bank: connected');

  ui.alert('Connected',
    'The access token is stored in Script Properties — not in any cell, not in ' +
    'the file\'s revision history, and not included if you download this sheet.\n\n' +
    'Note: anyone with EDIT access to this spreadsheet can open the script editor ' +
    'and read it. Do not share this file with edit rights while sync is connected.\n\n' +
    'Next: 🏦 Bank Sync ▸ Link accounts to this workbook.', ui.ButtonSet.OK);

  linkBankAccounts();
}

function disconnectBank() {
  const ui = SpreadsheetApp.getUi();
  if (!sfIsConnected()) { ui.alert('Not connected.'); return; }

  const ans = ui.alert('Disconnect',
    'This erases the stored access token from this workbook.\n\n' +
    'Your transactions stay. Syncing stops until you reconnect.\n\n' +
    'To fully revoke access, ALSO delete the App at bridge.simplefin.org — ' +
    'erasing it here only removes this copy of the credential.',
    ui.ButtonSet.YES_NO);
  if (ans !== ui.Button.YES) return;

  sfProps().deleteProperty(SF_ACCESS_URL_KEY);
  sfProps().deleteProperty(SF_LAST_SYNC_KEY);
  sfProps().deleteProperty(SF_ACCOUNT_CACHE_KEY);
  blog('bank: disconnected');
  ui.alert('Token erased. Remember to delete the App at the Bridge to revoke it fully.');
}


// ============================================================================
//  25. HTTP
// ============================================================================

/**
 * SimpleFIN hands back credentials embedded in the URL
 * (https://user:pass@host/path). UrlFetchApp does not reliably honour those,
 * so they are split out and sent as a proper Authorization header — which is
 * also what keeps them out of any logged request line.
 */
function sfFetch(path, params) {
  const accessUrl = sfAccessUrl();
  if (!accessUrl) throw new Error('Not connected. Run 🏦 Bank Sync ▸ Connect to your bank.');

  const m = accessUrl.match(/^https:\/\/([^:]+):([^@]+)@(.+)$/);
  if (!m) throw new Error('Stored access URL is malformed. Reconnect.');
  const user = m[1], pass = m[2], base = 'https://' + m[3];

  let url = base + path;
  if (params) {
    const q = Object.keys(params)
      .filter(k => params[k] !== undefined && params[k] !== null)
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join('&');
    if (q) url += (url.indexOf('?') === -1 ? '?' : '&') + q;
  }

  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Basic ' + Utilities.base64Encode(`${user}:${pass}`),
      Accept: 'application/json',
    },
  });

  const code = res.getResponseCode();
  const body = res.getContentText();

  if (code === 401 || code === 403) {
    throw new Error('The bank access token was rejected (HTTP ' + code + '). ' +
      'It may have been revoked at the Bridge. Reconnect to fix.');
  }
  if (code === 402) {
    throw new Error('SimpleFIN reports the subscription is inactive (HTTP 402). ' +
      'Check your account at bridge.simplefin.org.');
  }
  if (code !== 200) {
    throw new Error(`Bank request failed: HTTP ${code}\n${body.substring(0, 300)}`);
  }

  try {
    return JSON.parse(body);
  } catch (err) {
    throw new Error('The Bridge returned something that is not JSON:\n' + body.substring(0, 300));
  }
}

/** Fetch accounts, optionally with transactions in a date window. */
function sfGetAccounts(startDate, endDate, withTransactions) {
  // version=2 pins the current protocol. Without it the Bridge may answer in
  // the legacy shape, where the fields below are named differently.
  const params = { version: 2 };
  if (withTransactions) {
    params['start-date'] = Math.floor(startDate.getTime() / 1000);
    if (endDate) params['end-date'] = Math.floor(endDate.getTime() / 1000);
    // NOT requesting pending. Pending rows are excluded by default and that is
    // what we want — they change amount and description before settling, so a
    // pending row would contradict its own settled version a day later.
  } else {
    params['balances-only'] = 1;
  }
  const data = sfFetch('/accounts', params);

  // Per-institution problems come back alongside a 200 with whatever else
  // succeeded. Surfacing them matters: a silently stale account looks exactly
  // like one with no activity. v2 calls this errlist; `errors` is the
  // deprecated v1 name, kept as a fallback.
  const errs = data.errlist || data.errors || [];
  if (errs.length) blog('bank: provider errors: ' + JSON.stringify(errs));
  data.__errors = errs;

  // v2 moved institution identity out of each account and into a top-level
  // connections array, keyed by conn_id. Older payloads still inline `org`.
  const connById = {};
  (data.connections || []).forEach(c => {
    if (c && c.id) connById[String(c.id)] = c;
  });
  data.__connById = connById;

  return data;
}

/** Institution label for an account, across both protocol shapes. */
function sfOrgName(acct, connById) {
  if (acct.org) return String(acct.org.name || acct.org.domain || '');
  const c = connById && acct.conn_id ? connById[String(acct.conn_id)] : null;
  if (c) return String(c.name || c.org || c.domain || '');
  return '';
}


// ============================================================================
//  26. ACCOUNT LINKING
// ============================================================================

/**
 * Maps each bank-side account to a row on the Accounts tab, writing the
 * provider's account id into Bank_Sync_ID.
 *
 * Matching is by name, case-insensitive, and only ever FILLS A BLANK — an
 * existing mapping is left alone so a deliberate manual pairing survives.
 * Unmatched bank accounts are appended as new rows rather than guessed at,
 * because mapping the wrong account to the wrong row would corrupt balances
 * in a way that is tedious to unpick.
 */
function linkBankAccounts() {
  const ui = SpreadsheetApp.getUi();
  if (!sfIsConnected()) {
    ui.alert('Not connected yet. Run 🏦 Bank Sync ▸ Connect to your bank first.');
    return 0;
  }

  return withLock('bank-link', () => {
    let data;
    try {
      data = sfGetAccounts(null, null, false);
    } catch (err) {
      ui.alert('Could not reach your bank', String(err.message || err), ui.ButtonSet.OK);
      return 0;
    }

    const bankAccounts = data.accounts || [];
    if (!bankAccounts.length) {
      ui.alert('The Bridge returned no accounts.\n\n' +
        'Connect at least one bank at bridge.simplefin.org, then try again.');
      return 0;
    }

    const sheet = sheet_(SHEET_NAMES.ACCOUNTS);
    const nCols = ACCOUNTS_SPEC.columns.length;
    const cName = colOf(ACCOUNTS_SPEC, 'account');
    const cSync = colOf(ACCOUNTS_SPEC, 'syncid');
    const rows = sheet.getRange(DATA_START_ROW, 1, DATA_ROWS, nCols).getValues();

    const byName = {};
    const alreadyMapped = {};
    rows.forEach((r, i) => {
      const name = String(r[cName - 1]).trim();
      if (name) byName[name.toLowerCase()] = i;
      const sid = String(r[cSync - 1]).trim();
      if (sid) alreadyMapped[sid] = true;
    });

    let linked = 0, added = 0, skipped = 0;
    const report = [];

    bankAccounts.forEach(acct => {
      const id = String(acct.id || '');
      if (!id) return;
      if (alreadyMapped[id]) { skipped++; return; }

      const org = sfOrgName(acct, data.__connById);
      const label = String(acct.name || 'Account');
      const idx = byName[label.toLowerCase()];

      if (idx !== undefined && !String(rows[idx][cSync - 1]).trim()) {
        rows[idx][cSync - 1] = id;
        linked++;
        report.push(`  linked  ${label}  →  existing row`);
      } else if (idx === undefined) {
        const blank = rows.findIndex(r => String(r[cName - 1]).trim() === '');
        if (blank === -1) { skipped++; return; }
        rows[blank][cName - 1] = label;
        rows[blank][colOf(ACCOUNTS_SPEC, 'type') - 1] = guessAccountType(acct);
        rows[blank][colOf(ACCOUNTS_SPEC, 'institution') - 1] = org;
        rows[blank][colOf(ACCOUNTS_SPEC, 'opening') - 1] = 0;
        rows[blank][colOf(ACCOUNTS_SPEC, 'asof') - 1] = new Date();
        rows[blank][colOf(ACCOUNTS_SPEC, 'innw') - 1] = true;
        rows[blank][colOf(ACCOUNTS_SPEC, 'status') - 1] = 'Active';
        rows[blank][cSync - 1] = id;
        byName[label.toLowerCase()] = blank;
        added++;
        report.push(`  added   ${label}  (${org})`);
      } else {
        skipped++;
      }
    });

    // Write back only the hand-entry columns, so the computed ones keep their
    // formulas rather than being overwritten with the values we just read.
    ACCOUNTS_SPEC.columns.forEach((c, i) => {
      if (c.computed) return;
      sheet.getRange(DATA_START_ROW, i + 1, DATA_ROWS, 1)
        .setValues(rows.map(r => [r[i]]));
    });
    sheet.getRange(DATA_START_ROW, colOf(ACCOUNTS_SPEC, 'asof'), DATA_ROWS, 1)
      .setNumberFormat(DATE_FORMAT);

    ui.alert('Accounts linked',
      `Linked to existing rows: ${linked}\n` +
      `Added as new rows:       ${added}\n` +
      `Already linked/skipped:  ${skipped}\n\n` +
      (report.length ? report.join('\n') + '\n\n' : '') +
      'IMPORTANT: set the Opening_Balance and As_Of_Date on any newly added row ' +
      'before syncing, or its balance will be wrong. Sync only ever ADDS ' +
      'transactions — it never sets a starting balance for you.',
      ui.ButtonSet.OK);

    blog(`bank: linked ${linked}, added ${added}, skipped ${skipped}`);
    return linked + added;
  });
}

/** Best-effort mapping from the provider's hints to our account types. */
function guessAccountType(acct) {
  const name = String(acct.name || '').toLowerCase();
  const bal = parseFloat(acct.balance);
  if (/credit|card|visa|mastercard|amex/.test(name)) return 'Credit Card';
  if (/save|saving|hysa|marcus|money market/.test(name)) return 'Savings';
  if (/check|chequing|current/.test(name)) return 'Checking';
  if (/401|ira|roth|retire/.test(name)) return 'Retirement';
  if (/broker|invest|fidelity|vanguard|schwab/.test(name)) return 'Investment';
  if (/loan|mortgage|student/.test(name)) return 'Loan';
  // A persistently negative balance is a liability more often than not.
  if (!isNaN(bal) && bal < 0) return 'Credit Card';
  return 'Checking';
}


// ============================================================================
//  27. SYNC
// ============================================================================

/**
 * Pulls transactions and appends the ones we have not seen.
 *
 * Dedupe is on the PROVIDER'S transaction id, which is strictly better than
 * the content hash used for CSV import: the bank assigns it, so two identical
 * charges on the same day at the same merchant remain distinguishable. The
 * hash path still exists for CSV rows, which have no stable id.
 *
 * Pending transactions are skipped. They change amount and description before
 * settling and a pending row would either duplicate or contradict its own
 * settled version a day later.
 */
function syncBank() {
  const ui = SpreadsheetApp.getUi();
  if (!sfIsConnected()) {
    ui.alert('Not connected. Run 🏦 Bank Sync ▸ Connect to your bank first.');
    return 0;
  }

  return withLock('bank-sync', () => {
    const txns = sheet_(SHEET_NAMES.TRANSACTIONS);
    const accounts = sheet_(SHEET_NAMES.ACCOUNTS);

    // --- Which bank accounts map to which workbook rows.
    const aCols = ACCOUNTS_SPEC.columns.length;
    const aRows = accounts.getRange(DATA_START_ROW, 1, DATA_ROWS, aCols).getValues();
    const cName = colOf(ACCOUNTS_SPEC, 'account') - 1;
    const cSync = colOf(ACCOUNTS_SPEC, 'syncid') - 1;
    const idToName = {};
    aRows.forEach(r => {
      const sid = String(r[cSync]).trim();
      const name = String(r[cName]).trim();
      if (sid && name) idToName[sid] = name;
    });

    if (!Object.keys(idToName).length) {
      ui.alert('No accounts are linked yet.\n\nRun 🏦 Bank Sync ▸ Link accounts to this workbook.');
      return 0;
    }

    // --- Window. Overlap on every run but the first; see SF_OVERLAP_DAYS.
    const lastSync = sfProps().getProperty(SF_LAST_SYNC_KEY);
    const start = new Date();
    if (lastSync) {
      start.setTime(Number(lastSync));
      start.setDate(start.getDate() - SF_OVERLAP_DAYS);
    } else {
      start.setDate(start.getDate() - SF_INITIAL_LOOKBACK_DAYS);
    }

    ss_().toast('Contacting your bank…', '🏦 Bank Sync', -1);
    let data;
    try {
      data = sfGetAccounts(start, null, true);
    } catch (err) {
      ui.alert('Sync failed', String(err.message || err), ui.ButtonSet.OK);
      return 0;
    }

    // --- Existing provider ids.
    const cBankId = colOf(TRANSACTIONS_SPEC, 'bankid');
    const seen = {};
    txns.getRange(DATA_START_ROW, cBankId, DATA_ROWS, 1).getValues()
      .forEach(r => { if (r[0]) seen[String(r[0])] = true; });

    const nTxnCols = TRANSACTIONS_SPEC.columns.length;
    const toAppend = [];
    let pendingSkipped = 0, unmapped = 0;

    (data.accounts || []).forEach(acct => {
      const name = idToName[String(acct.id)];
      if (!name) { unmapped++; return; }

      (acct.transactions || []).forEach(t => {
        if (t.pending === true) { pendingSkipped++; return; }
        const id = String(t.id || '');
        if (!id || seen[id]) return;
        seen[id] = true;

        const amount = parseFloat(t.amount);
        if (isNaN(amount)) return;
        const posted = new Date(Number(t.posted) * 1000);
        if (isNaN(posted.getTime())) return;

        // `description` is the only text field the protocol guarantees.
        // `payee` and `memo` are Bridge extensions that may be absent — used
        // when present because a cleaned merchant name makes far better rule
        // material than a raw statement line, with description as the
        // fallback and also kept in Notes when it differs.
        const desc = String(t.description || '').trim();
        const payee = String(t.payee || desc).trim();
        const memo = String(t.memo || '').trim();

        const row = new Array(nTxnCols).fill('');
        row[colOf(TRANSACTIONS_SPEC, 'date') - 1] = posted;
        row[colOf(TRANSACTIONS_SPEC, 'account') - 1] = name;
        row[colOf(TRANSACTIONS_SPEC, 'payee') - 1] = payee;
        row[colOf(TRANSACTIONS_SPEC, 'amount') - 1] = amount;
        row[colOf(TRANSACTIONS_SPEC, 'type') - 1] =
          amount >= 0 ? TXN_TYPES.INCOME : TXN_TYPES.EXPENSE;
        row[colOf(TRANSACTIONS_SPEC, 'cleared') - 1] = true;
        row[colOf(TRANSACTIONS_SPEC, 'notes') - 1] =
          (desc && desc !== payee) ? (memo ? `${desc} · ${memo}` : desc) : memo;
        row[colOf(TRANSACTIONS_SPEC, 'source') - 1] = 'Bank Sync';
        row[cBankId - 1] = id;
        toAppend.push(row);
      });
    });

    // --- Append. Oldest first, so the ledger reads chronologically.
    let imported = 0;
    if (toAppend.length) {
      toAppend.sort((a, b) =>
        a[colOf(TRANSACTIONS_SPEC, 'date') - 1] - b[colOf(TRANSACTIONS_SPEC, 'date') - 1]);

      const startRow = firstEmptyRow(txns, colOf(TRANSACTIONS_SPEC, 'date'));
      if (startRow + toAppend.length > DATA_START_ROW + DATA_ROWS) {
        ui.alert(`The ledger holds ${DATA_ROWS} rows and this sync would exceed it. ` +
          `Archive older transactions first.`);
        return 0;
      }
      TRANSACTIONS_SPEC.columns.forEach((c, i) => {
        if (c.computed) return;
        txns.getRange(startRow, i + 1, toAppend.length, 1)
          .setValues(toAppend.map(r => [r[i]]));
      });
      txns.getRange(startRow, colOf(TRANSACTIONS_SPEC, 'date'), toAppend.length, 1)
        .setNumberFormat(DATE_FORMAT);
      imported = toAppend.length;
    }

    sfProps().setProperty(SF_LAST_SYNC_KEY, String(Date.now()));
    if (imported) applyRules();

    const errs = (data.__errors || []).length;
    ui.alert('Sync complete',
      `New transactions:  ${imported}\n` +
      `Pending (skipped): ${pendingSkipped}\n` +
      `Unlinked accounts: ${unmapped}\n` +
      (errs ? `\n⚠️ The Bridge reported ${errs} institution error(s). Some accounts may be stale — ` +
              `check bridge.simplefin.org.\n` : '') +
      (imported ? '\nCategorization rules were applied to the new rows.' : '') +
      '\n\nBalances on the Accounts tab are derived from Opening_Balance plus these ' +
      'transactions. If one disagrees with your bank, the opening balance or its ' +
      'as-of date is wrong — not the ledger.',
      ui.ButtonSet.OK);

    blog(`bank: synced ${imported}, pending ${pendingSkipped}, unmapped ${unmapped}`);
    return imported;
  });
}

/**
 * Balance-only refresh, written into Notes rather than into Current_Balance.
 *
 * Current_Balance is deliberately DERIVED (opening balance + ledger) and
 * overwriting it with the bank's figure would destroy the one check that
 * catches missing transactions: if the derived balance and the bank's balance
 * disagree, something is missing, and a workbook that silently overwrites the
 * derived value can never tell you that.
 */
function syncBalancesOnly() {
  const ui = SpreadsheetApp.getUi();
  if (!sfIsConnected()) { ui.alert('Not connected.'); return 0; }

  return withLock('bank-balances', () => {
    let data;
    try {
      data = sfGetAccounts(null, null, false);
    } catch (err) {
      ui.alert('Could not reach your bank', String(err.message || err), ui.ButtonSet.OK);
      return 0;
    }

    const sheet = sheet_(SHEET_NAMES.ACCOUNTS);
    const nCols = ACCOUNTS_SPEC.columns.length;
    const rows = sheet.getRange(DATA_START_ROW, 1, DATA_ROWS, nCols).getValues();
    const cSync = colOf(ACCOUNTS_SPEC, 'syncid') - 1;
    const cBal = colOf(ACCOUNTS_SPEC, 'balance') - 1;
    const cNotes = colOf(ACCOUNTS_SPEC, 'notes') - 1;

    const byId = {};
    (data.accounts || []).forEach(a => { byId[String(a.id)] = a; });

    const tz = ss_().getSpreadsheetTimeZone();
    const stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
    const notes = [];
    let checked = 0, mismatched = 0;

    rows.forEach(r => {
      const sid = String(r[cSync]).trim();
      const acct = sid ? byId[sid] : null;
      if (!acct) { notes.push([r[cNotes]]); return; }

      const bankBal = parseFloat(acct.balance);
      const ours = Number(r[cBal]) || 0;
      const diff = round2(bankBal - ours);
      checked++;
      if (Math.abs(diff) >= 0.01) mismatched++;

      notes.push([
        Math.abs(diff) < 0.01
          ? `✅ Matches bank ${formatMoney(bankBal)} · ${stamp}`
          : `⚠️ Bank says ${formatMoney(bankBal)}, ledger says ${formatMoney(ours)} ` +
            `(off by ${formatMoney(diff)}) · ${stamp}`,
      ]);
    });

    sheet.getRange(DATA_START_ROW, cNotes + 1, notes.length, 1).setValues(notes);

    ui.alert('Balances checked',
      `Accounts checked: ${checked}\n` +
      `Disagreements:    ${mismatched}\n\n` +
      (mismatched
        ? 'A mismatch usually means missing transactions (sync further back) or a ' +
          'wrong Opening_Balance / As_Of_Date on that row.\n\n'
        : '') +
      'Results are written to each account\'s Notes. Current_Balance stays derived ' +
      'from the ledger on purpose — that disagreement is the check, so overwriting ' +
      'it would hide the very problem it detects.',
      ui.ButtonSet.OK);

    blog(`bank: balances checked ${checked}, mismatched ${mismatched}`);
    return checked;
  });
}


// ============================================================================
//  28. STATUS & SECURITY
// ============================================================================

function showBankStatus() {
  const ui = SpreadsheetApp.getUi();
  if (!sfIsConnected()) {
    ui.alert('Bank Sync', 'Not connected.\n\nRun 🏦 Bank Sync ▸ Connect to your bank.',
      ui.ButtonSet.OK);
    return;
  }

  const tz = ss_().getSpreadsheetTimeZone();
  const last = sfProps().getProperty(SF_LAST_SYNC_KEY);
  const lastText = last
    ? Utilities.formatDate(new Date(Number(last)), tz, 'yyyy-MM-dd HH:mm')
    : 'never';

  const accounts = sheet_(SHEET_NAMES.ACCOUNTS);
  const cSync = colOf(ACCOUNTS_SPEC, 'syncid');
  const cName = colOf(ACCOUNTS_SPEC, 'account');
  const rows = accounts.getRange(DATA_START_ROW, 1, DATA_ROWS,
    ACCOUNTS_SPEC.columns.length).getValues();
  const linked = rows
    .filter(r => String(r[cSync - 1]).trim() && String(r[cName - 1]).trim())
    .map(r => '  · ' + r[cName - 1]);

  let reachable = 'not checked';
  try {
    const d = sfGetAccounts(null, null, false);
    reachable = `✅ reachable — ${(d.accounts || []).length} account(s) at the Bridge` +
      ((d.__errors || []).length ? `, ${d.__errors.length} institution error(s)` : '');
  } catch (err) {
    reachable = '⚠️ ' + String(err.message || err);
  }

  ui.alert('Bank Sync status',
    `Connection:  ${reachable}\n` +
    `Last sync:   ${lastText}\n\n` +
    `Linked accounts (${linked.length}):\n` +
    (linked.length ? linked.join('\n') : '  none — run Link accounts') +
    `\n\nToken storage: Script Properties (not in any cell).`,
    ui.ButtonSet.OK);
}

function showBankSecurityNotes() {
  const html = HtmlService.createHtmlOutput(`
    <style>
      body { font-family: -apple-system, Roboto, Arial, sans-serif; font-size: 13px;
             line-height: 1.55; color: #202124; padding: 4px 6px; }
      h2 { font-size: 15px; margin: 0 0 8px; color: #1F3864; }
      h3 { font-size: 12px; margin: 16px 0 4px; color: #1F3864;
           text-transform: uppercase; letter-spacing: .04em; }
      ul { margin: 4px 0 0 18px; padding: 0; }
      li { margin-bottom: 6px; }
      .warn { background: #FCE8E6; border-left: 3px solid #CC0000;
              padding: 8px 10px; margin: 10px 0; }
      .ok { background: #E6F4EA; border-left: 3px solid #38761D;
            padding: 8px 10px; margin: 10px 0; }
    </style>
    <h2>🔒 How bank sync works here</h2>

    <div class="ok">
      <b>This script never sees your bank password.</b> It has no field for one and no
      code path that would accept one. You authenticate with your bank at
      bridge.simplefin.org — never in this spreadsheet.
    </div>

    <h3>What is stored</h3>
    <ul>
      <li>One <b>read-only access token</b>, in Script Properties.</li>
      <li>Not in a cell. Not in the file's revision history. Not included if you
          download or export the sheet.</li>
    </ul>

    <div class="warn">
      <b>The real limit:</b> anyone with <b>edit</b> access to this spreadsheet can open
      the Apps Script editor and read Script Properties. A container-bound script cannot
      prevent this. Do not share this file with edit rights while sync is connected —
      share read-only, or share a copy.
    </div>

    <h3>What the token can do</h3>
    <ul>
      <li><b>Can:</b> read balances and transaction history.</li>
      <li><b>Cannot:</b> move money, initiate payments, or change anything at your bank.
          The SimpleFIN protocol defines no write operation at all.</li>
    </ul>

    <h3>Revoking access</h3>
    <ul>
      <li><b>Disconnect</b> here erases this copy of the token.</li>
      <li>To revoke it everywhere, delete the App at <b>bridge.simplefin.org</b>.
          That is the real kill switch — do both.</li>
    </ul>

    <h3>If something looks wrong</h3>
    <ul>
      <li>If this workbook ever prompts for a bank username or password, it has been
          modified. Do not enter them.</li>
      <li>Check <b>Extensions ▸ Apps Script ▸ Executions</b> to see every run.</li>
      <li>Balances are derived from the ledger, never overwritten with the bank's
          figure — so a disagreement is a real signal that something is missing,
          not a display bug.</li>
    </ul>
  `).setWidth(580).setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, 'Bank Sync — security');
}
