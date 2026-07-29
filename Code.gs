/**
 * ============================================================================
 *  🗓️  CALENDAR & FORM MANAGER  —  Program Registration + Lunch Ordering
 * ============================================================================
 *  Sheets:
 *    - Master_Program_Dashboard : "Today at Each Location" + participation
 *      metrics + the full per-session table, now split into an "Upcoming
 *      Sessions" sub-table and a "Past Sessions" sub-table (see section 7).
 *      The session table no longer carries a Manual_Override column — it's
 *      fully calendar-derived every render (Location/Type_Tag stay
 *      editable dropdowns, but nothing on this table is protected from a
 *      deleted-event triage sweep or a counts recompute anymore). Event_Date
 *      is the first column, and the old separate Month column has been
 *      replaced everywhere by simply color-tinting the Event_Date cell
 *      itself (see getMonthColor()/applyMonthColorTint()).
 *    - Master_Lunch_Dashboard   : "Today's Lunch Needs" (unchanged, always
 *      at the very top) + the full catering schedule, now likewise split
 *      into "Upcoming Lunch Schedule" / "Past Lunch Schedule" sub-tables.
 *      Every row is one date PER LOCATION, so the row itself is tinted by
 *      location (LOCATION_COLOR_MAP / buildLocationRowTintRules()) — except
 *      the month-tinted Event_Date cell and the yellow hand-entry columns,
 *      which keep their own meaning.
 *    - Lunch_and_Event_Registrants : one row per person per session, split
 *      into "Upcoming Registrants" / "Past Registrants" sub-tables. Leads
 *      with Event_Date (like every other date-bearing tab), then Location
 *      and Event so staff never scroll to see which program a row belongs
 *      to, keeps Manual_Override and Order_Ahead_Flag, and trails with
 *      Party_ID (an internal grouping key — see Party_ID/Party_Size below)
 *      as the very last column. Re-ordering a HEADERS array no longer
 *      scrambles data already on the tab: readAllSectionedRows() re-aligns
 *      each row by header NAME (see buildHeaderProjection()).
 *    - Lunch_Schedule           : the day-by-day catering menu, now broken
 *      down PER LOCATION (one row per Event_Date x Location), with a
 *      "Not Serving" Type option — when a form covers a date that's marked
 *      Not Serving for its location, that date is dropped from the lunch
 *      grid entirely (no lunch choice offered) and its label is annotated
 *      "No Lunch Served" wherever it's shown. Also split into
 *      Upcoming/Past sub-tables like every other date-bearing tab.
 *    - Config                   : Meal Buffer Amounts (Location x Hot/Cold
 *      only — "Not Serving" never gets a buffer row) + Order Ahead Time +
 *      an optional Admin Notification Email. Unaffected by the
 *      Upcoming/Past split (it's a settings tab, not a per-date log).
 *    - Deleted_Event_Triage     : same Upcoming/Past split + Event_Date
 *      first-column/month-tint treatment as Lunch_and_Event_Registrants.
 *
 *  Notable behaviors:
 *    - All-day calendar events are skipped entirely.
 *    - Calendar-edit triggers are still torn down for the duration of every
 *      FULL syncCalendars() run and rebuilt immediately after (that sync
 *      itself edits calendar descriptions and would otherwise risk
 *      re-triggering itself). The trigger handler itself, onCalendarChange(),
 *      no longer always runs a full syncCalendars() though — see below.
 *    - CALENDAR INCREMENTAL SYNC: onCalendarChange() now uses the Calendar
 *      API's incremental-sync-token pattern (Calendar.Events.list with a
 *      saved syncToken) to fetch ONLY what changed since the last check,
 *      and only escalates to a full syncCalendars() reconciliation pass
 *      when that cheap delta actually contains something relevant (a new/
 *      modified/cancelled timed event in our tracked window). This requires
 *      the "Calendar" Advanced Service to be enabled on this Apps Script
 *      project (Editor -> Services -> + Calendar API) — see SETUP below.
 *    - EVENT GRAMMAR — the TITLE is just the program name; every SETTING
 *      lives in the event DESCRIPTION, in brackets:
 *        Title "Yoga Basics"           + description "[Cap: 12]"  -> capped at 12
 *        Title "Yoga Basics"           + description "[Fixed]"    -> one continuous
 *          series with ONE form, instead of a separate form per month
 *        description "[Cap: 12, Fixed]" or "[Cap: 12] [Fixed]"    -> both
 *      A title is what attendees read on a shared calendar, so scheduling
 *      jargon does not belong there. Brackets left in a TITLE are still
 *      honored as a legacy fallback (and logged) so existing calendars keep
 *      their capacity; see parseSettingsBrackets()/resolveEventSettings().
 *        Title "*Yoga Basics"          -> TENTATIVE. A leading "*" means the
 *          session isn't confirmed: no form is generated and no registry
 *          row is written, until the asterisk comes off. parseEventTitle()
 *          strips the asterisk from cleanTitle, and since computeEventId()
 *          keys off cleanTitle, confirming an event later produces the
 *          SAME Event_ID — it just flows through as a new session with no
 *          reconciliation. (Re-adding an asterisk to an already-confirmed
 *          event does NOT triage it; existing registrations are kept.)
 *    - THE REGISTRATION LINK injected into each event description is an
 *      HTML ANCHOR, not a raw URL, and carries no visible Form ID. The ID
 *      rides in the href's #fragment — invisible to the reader, ignored by
 *      Forms, still machine-recoverable so a lost form registry can be
 *      rebuilt instead of spawning duplicate forms. See
 *      buildRegistrationLinkLine()/findRegistrationLineInDescription().
 *    - REGISTRATION LINKS ARE PREFILLED with every box checked
 *      (buildPrefilledAllCheckedUrl) so the common "all of us, all dates"
 *      case is read-and-submit and respondents just uncheck exceptions.
 *      Forms has no default-checked grid, so a prefilled response URL is
 *      the only way to do this; it falls back to the plain published URL if
 *      it can't be built. See that function for the one soft edge.
 *    - PER-LOCATION CATERING POLICY (Config -> "🍽️ Lunch Service by
 *      Location") is what keeps the lunch dashboard from filling with blank
 *      rows. Before it existed the only way to say "Zoom never serves lunch"
 *      was a per-date "Not Serving" row for every Zoom date forever, so in
 *      practice those dates read as merely unconfigured — seeded onto the
 *      dashboard AND asked about on forms. The three postures:
 *        Always        lunch unless a date says otherwise (a catering site)
 *        By exception  only dates with a real Hot/Cold row on Lunch_Schedule
 *        Never         no lunch at all — the location never reaches the
 *                      lunch dashboard, and createRegistrationForm() strips
 *                      both lunch questions off its forms entirely
 *      See isLunchOfferedOn(), which is the single place policy and the
 *      per-date override are reconciled.
 *    - THE LUNCH DASHBOARD LISTS EVERY UPCOMING date x location where lunch
 *      is on the table, even at zero registrants, so staff can plan against
 *      (and hand-enter buffers on) dates nobody has signed up for yet. Past
 *      dates are never back-seeded.
 *    - DEMAND ALWAYS WINS over policy. Policy only decides what gets SEEDED;
 *      a date somebody is actually registered to eat on always appears, and
 *      if no Hot/Cold menu backs it, the admin digest says so. That is the
 *      safety net for "By exception" — forgetting a menu row can leave a
 *      date off the plan, but never off the plan once a real person is
 *      expecting to be fed.
 *    - ADMIN NOTIFICATIONS: set an address in Config to get ONE digest per
 *      sync covering only things needing a human — waitlisted registrants,
 *      forms that couldn't be opened, events sent to triage. A sync with
 *      nothing to report sends nothing. Blank address = disabled.
 *    - ONE FORM TEMPLATE, ONE BRANCH POINT. Every group — Fixed or Regular
 *      — is built from the same template, and "Attendance Mode" is now on
 *      every form:
 *        "Everyone, every date"          -> one checkbox of who eats, applied
 *          to every session date, including dates added to a Fixed series
 *          afterward (see the ALL_DATES registry + applyAllDatesCatchup()).
 *        "Let me pick specific dates/people" -> the two roster grids,
 *          "Who is Attending Each Date?" and "Who Needs Lunch Each Date?",
 *          with dates as ROWS and PERSON_COLUMN_LABELS as COLUMNS. Full
 *          per-person, per-date resolution: any guest can attend/skip/eat
 *          independently of any other. Checking lunch WITHOUT attendance is
 *          not silently dropped — processFormResponse() reconciles it as
 *          attending and flags it in Admin_Notes.
 *      There is NO "how many guests?" question: page 1 has three optional
 *      guest-name fields and the headcount is simply how many were filled
 *      in. That kills two bugs by construction — the old "said 3, named 2,
 *      catered for 2" mismatch, and mis-routing between guest-count branch
 *      pages (Forms silently falls through to the NEXT section when an
 *      explicit after-section jump isn't applied, which is how picking 2
 *      guests could land you on the 3-guest page). The whole form now has
 *      exactly two page breaks and two navigation rules, both to SUBMIT.
 *      A grid column whose guest name was left blank is ignored at parse
 *      time, so the pre-checked columns for guests you didn't bring cost
 *      nothing.
 *    - OUR OWN CALENDAR EDITS MUST NOT COME BACK AS WORK. Removing the
 *      calendar-edit triggers during a sync stops them FIRING, not the
 *      changes accumulating — so re-creating them afterwards handed
 *      onCalendarChange() one queued description write per event, each of
 *      which escalated to a full syncCalendars(). An import of 272 events
 *      became a queue of full syncs. primeCalendarSyncTokens() now advances
 *      each calendar's sync token past our own edits immediately before the
 *      triggers go back on (in syncCalendarsInternal()'s finally, and at the
 *      end of a bootstrap).
 *    - TRIGGERS ARE RESET, NOT PATCHED. writeTriggers() used to add a
 *      trigger only if none existed, which cannot clean up a duplicate once
 *      one is there. The real-world case: Apps Script installable triggers
 *      are private to the Google account that created them, so a second
 *      person running "Check Triggers"/initSheet() from their own login
 *      creates a SECOND, mutually invisible set of calendar-edit triggers —
 *      both then fire on every edit, forever. writeTriggers()/
 *      writeCalendarChangeTriggers() now delete every trigger for a managed
 *      handler THIS ACCOUNT can see and recreate exactly the intended set,
 *      every time — see resetTriggersForHandler(). That fixes same-account
 *      duplication outright; cross-account duplication needs a human to
 *      open the Apps Script editor's Triggers page (which — unlike the
 *      API — lists every trigger regardless of creator) and delete the
 *      other account's copies, and to agree only one account manages
 *      triggers going forward.
 *    - TRIAGE DISTRUSTS ITSELF. triageDeletedSessions() is the only thing
 *      that removes sessions, and "the calendar didn't come back" used to
 *      read identically to "every session was deleted." It now ignores
 *      calendars it could not READ, ignores rows it cannot attribute to one
 *      it did read, refuses any sweep that would take out most of the table
 *      (TRIAGE_MAX_SESSIONS_PER_RUN / TRIAGE_MAX_FRACTION_PER_RUN, overridden
 *      once by confirmLargeTriage()), and stands down entirely while a
 *      bootstrap import is writing the table. restoreTriagedRegistrants()
 *      puts rows back if a sweep did fire wrongly — necessary because the
 *      import only reads responses newer than the last sync, so a triaged
 *      registrant exists nowhere else.
 *    - THE FIRST IMPORT IS A SLICED JOB, NOT A SYNC. syncCalendars() is cheap
 *      only because it normally has nothing to do. Importing a real calendar
 *      from scratch — a form per program, a description write per event —
 *      does not fit in one six-minute execution, and a timeout there is
 *      destructive: no `finally` runs, so the calendar triggers stay removed
 *      and the persistent form registry never gets flushed (which duplicates
 *      forms on the next attempt). bootstrapCalendars() (section 4b) pauses
 *      every trigger, imports in budgeted slices that hand off to each other
 *      via one-off triggers, and rebuilds the triggers only when it's done.
 *      syncCalendars()/syncRegistrations() stand down while it runs, and
 *      writeTriggers() refuses to put the paused ones back until it
 *      finishes — a pause is only as good as the paths that can undo it, and
 *      an import that spans half an hour gives "Check Triggers" plenty of
 *      chances. Each slice re-asserts the pause as well.
 *    - LIVE FORMS ARE MIGRATED, NOT JUST THE TEMPLATE. A group's form is
 *      created once and reused for as long as the group runs, so bumping
 *      TEMPLATE_VERSION only ever fixed forms created afterward — everyone
 *      filling in an existing form still met the old questions (and the old
 *      mis-routing). migrateFormsToCurrentTemplate(), which runs at the end
 *      of every syncRegistrations() import, rebuilds any form still on an
 *      older template IN PLACE, keeping its Form ID so every link, registry
 *      entry and calendar description stays valid. Forms already on the
 *      current template are stamped and thereafter skipped without an API
 *      call. Run recheckAllRegistrationForms() from the editor to force a
 *      re-check (e.g. after hand-editing a form).
 *    - NO LUNCH MEANS NO LUNCH QUESTION. The lunch grid only ever lists
 *      dates that actually serve lunch (buildDateLabelSets()), and when NO
 *      date on a form does — or the location never caters —
 *      syncLunchQuestionsOnForm() takes both lunch questions off the form
 *      entirely and says so in the description. They come back on their own
 *      if a catered date later appears. On the data side buildRegistrantRow()
 *      gates lunch demand on isLunchOfferedOn(), so the "everyone, every
 *      date" branch's single who-eats answer can't book a meal on a
 *      Not-Serving date.
 *    - The template calls setCollectEmail(true) and
 *      setAllowResponseEdits(true) — a submitter's email becomes a real
 *      identity key, Google auto-sends a receipt with an edit link, and
 *      Form_Source on Lunch_and_Event_Registrants links straight to that
 *      person's own submission (response.getEditResponseUrl()) instead of
 *      to the shared form editor.
 *    - Allergies / dietary needs is its own required-free text field,
 *      separate from the free-text "Anything Else?" catch-all — previously
 *      a single "Footer Note" paragraph item did double duty as both
 *      display text and the admin-notes scan target. The per-location
 *      note itself is now a non-input SectionHeaderItem.
 *    - Party_ID (= the Google Form response ID) and Party_Size (headcount
 *      including the registrant) are stamped on every row from the same
 *      submission, so staff can see "party of 3, one no-show" at a glance
 *      on Lunch_and_Event_Registrants.
 *    - Name-based identity (dedup / manual-edit protection / the "sign up
 *      for all dates" registry) is matched case/whitespace-insensitively
 *      via normalizeNameKey() — "Jane Smith" and "jane smith " are the same
 *      person. The Name column itself still displays exactly as typed.
 *    - RESUBMISSIONS ARE APPLIED, NOT DROPPED: buildRegistrantRow() keys
 *      identity on Event_ID+Name+Person_Type, same as before, but now also
 *      tracks each row's Party_ID (the originating Response ID). A response
 *      re-seen under the SAME Party_ID (an edit via the "edit response"
 *      link — see setAllowResponseEdits(true) above) patches that one row
 *      in place. A DIFFERENT Party_ID for the same identity — a genuinely
 *      new submission — marks the old row Program_Status/Lunch_Status =
 *      'Superseded' (kept, not deleted, with a note in Admin_Notes) and
 *      inserts the new row as the live truth. 'Superseded' rows are
 *      excluded from every active/waitlist count automatically, the same
 *      way 'Cancelled' already was.
 *    - CAPACITY IS VISIBLE ON THE FORM: whenever a capped session hits 0
 *      Remaining_Seats, its date label on both roster grids gets a
 *      CAPACITY_HINT_SUFFIX ("(FULL - Waitlist)") appended — see
 *      buildCapacityHintsFromRegistryRows() / refreshFormCapacityLabelsForAllForms(),
 *      called at the end of every syncRegistrations() once Remaining_Seats
 *      is fresh. Converts silent waitlisting into something a respondent
 *      actually sees before submitting. A plain hyphen is used (not the em
 *      dash meal-hint separator) so stripMealHint() can strip both
 *      unambiguously when matching a grid row back to its Event_ID.
 *    - Template forms are cached forever in Script Properties, keyed by
 *      TEMPLATE_VERSION — bump that constant whenever the template
 *      structure changes so existing cached forms don't silently drift out
 *      of sync with the parser.
 *    - Form descriptions list dates one-per-line.
 *
 *  PERFORMANCE / CACHING CONTRACT (see section 1c):
 *    Everything expensive in a sync is a REMOTE call — a Sheets read, a
 *    FormApp call, a CalendarApp fetch, a Script Properties round trip — so
 *    the optimization work is all about not making the same one twice.
 *      - Per-EXECUTION caches (Apps Script globals, which die with the run,
 *        so there is no cross-run staleness to reason about): the
 *        Lunch_Schedule meal index, Config's meal buffers + order-ahead
 *        days, per-form item lookups, and the calendar event fetch. Each is
 *        dropped by whatever rewrites its source — invalidateMealInfoIndex()
 *        from renderLunchScheduleSheet(), invalidateConfigCaches() from
 *        buildConfigSheet(), invalidateFormItemIndex() from
 *        applyFormDateLabels(), invalidateCalendarEventsCache() from the
 *        calendar-delta handler. ADD A NEW CACHE ONLY WITH ITS INVALIDATOR.
 *      - Batched Script Properties: the form registry, the all-dates
 *        registry, and the form-label fingerprints are read once and written
 *        at most once per run via flushPersistentRegistries(), called as
 *        soon as each dirtying loop finishes rather than at the very end.
 *      - Fingerprinted form writes: applyFormDateLabels() hashes the labels
 *        it is about to write and skips the entire FormApp round trip when
 *        they match what this script last wrote to that form. Since the
 *        hourly capacity-label refresh normally has nothing to change, the
 *        common case costs zero Forms calls. The fingerprint only tracks
 *        THIS script's writes — a hand-edited form is not detected until
 *        the labels legitimately change again (pass { force: true }).
 *      - Rows already in memory are threaded, not re-read: syncRegistrations()
 *        reads each tab once and hands the rows to the count recompute, the
 *        dashboard render, and the lunch rollup. renderProgramDashboard()
 *        reports registrantsMoved back so a caller knows when its copy went
 *        stale under a triage sweep.
 *    Bulk sheet WRITES were already batched (one setValues/setBackgrounds/
 *    setFormulas per block, never a per-cell loop) — keep it that way.
 *
 *  SETUP:
 *    1. Update CALENDAR_MAP below with your real Calendar IDs -> locations.
 *    2. In the Apps Script editor: Services (+) -> add "Google Calendar API"
 *       (the Advanced Service — this is required for the incremental
 *       calendar-edit sync in section 3b; without it, onCalendarChange()
 *       will fail with "Calendar is not defined").
 *    3. Run initSheet() once (from the editor) to build all tabs, formatting,
 *       AND the triggers.
 *    4. Fill in the Lunch_Schedule tab (now one row per date PER LOCATION)
 *       and Config's Meal Buffer Amounts + Order Ahead Time.
 *    5. Reload the sheet to see the "🗓️ Calendar & Form Manager" menu.
 *    6. FIRST IMPORT: use "Import Everything (First Run)" in that menu
 *       (bootstrapCalendars()), NOT "Sync Cal". The first import has to
 *       build a form for every program on every calendar, which is far more
 *       than one Apps Script execution can do — the bootstrap slices it
 *       across as many runs as it takes and pauses every trigger until it's
 *       finished. See section 4b. initializeAndSyncAll() does steps 3 and 6
 *       in one go.
 * ============================================================================
 */

// ============================================================================
// 1. GLOBAL CONFIGURATION & HELPERS
// ============================================================================

const ENABLE_LOGGING = true;

/** Central logger — no-op when ENABLE_LOGGING is false. */
function log(msg) {
  if (ENABLE_LOGGING) console.log(msg);
}

/** Calendar ID -> human-readable location name. */
const CALENDAR_MAP = {
  'c_a1a2cd2f999f1bed82d1f21c59a1cb381485a28297a3ff1b8d394e2ad5fdc282@group.calendar.google.com': 'Narberth',
  'c_e75805d7180c15888ed58e5625878088059c001053181bbaffceac8f6a64e1dd@group.calendar.google.com': 'Ashbridge',
  'c_562b3332ef81d94b74100a3075f00d0f68061a01edcf46ea1378872c60d91c07@group.calendar.google.com': 'Zoom'
};

/**
 * Hardcoded soft colors per "Month Year" label — used to tint the Event_Date
 * cell itself now (there is no separate Month column anywhere anymore).
 * Deliberately picked from TEAL / GOLD / MAGENTA families — NOT green,
 * peach/orange, or lavender (LOCATION_COLOR_MAP's families), and NOT
 * green/red (status colors). Any month not listed falls back to
 * getMonthColor()'s deterministic generator, which draws from the same three
 * safe hue bands.
 */
const MONTH_COLOR_MAP = {
  'January 2026': '#D6F0EC',
  'February 2026': '#F7F2D2',
  'March 2026': '#F5D6EC',
  'April 2026': '#C2E8E0',
  'May 2026': '#F2ECC0',
  'June 2026': '#F0C2E0',
  'July 2026': '#AEE0D4',
  'August 2026': '#EDE6AE',
  'September 2026': '#EBAED4',
  'October 2026': '#9AD8C8',
  'November 2026': '#E8E09C',
  'December 2026': '#E69AC8'
};

/**
 * Column sizing. Every column is autofitted and then padded out to this
 * multiple of its fitted width, so text never sits flush against the cell
 * edge and a dropdown arrow never overlaps the value under it.
 *
 * The MAX clamp is load-bearing, not decoration: autofit on a long
 * Admin_Notes or "Programs Today" cell already produces a very wide column,
 * and 130% of "very wide" is unusable. The MIN keeps a column of 0/1 counts
 * from collapsing to a sliver. Both are in pixels; tune here and re-run
 * resizeAllSheets() to apply to existing tabs.
 */
const COLUMN_WIDTH_BUFFER_MULTIPLIER = 1.3;
const MIN_COLUMN_WIDTH_PX = 60;
const MAX_COLUMN_WIDTH_PX = 400;

// Status color palettes (kept together for easy re-theming).
const EVENT_STATUS_COLORS = {
  '🟢 Open': '#D9EAD3',
  '🟡 Almost Full': '#FFF2CC',
  '🔴 Waitlist Only': '#F4CCCC',
  '🟢 Unlimited': '#B6D7A8'
};

const REGISTRANT_STATUS_COLORS = {
  'Cancelled': '#F4CCCC',
  'Waitlisted': '#FCE5CD',
  'Active': '#D9EAD3',
  'Needed': '#D9EAD3',
  // A newer submission from the same person/event superseded this row — see
  // buildRegistrantRow()/supersedeRegistrantRow(). Distinct grey (reused
  // from NA_CELL_COLOR) so it reads as "historical," not cancelled/waitlisted.
  'Superseded': '#E8E8E8'
};

const MANUAL_OVERRIDE_COLOR = '#D9D2E9';
const ORDER_AHEAD_FLAG_COLOR = '#FFD966';
const NA_CELL_COLOR = '#E8E8E8';
/** Grey used on a Lunch_Schedule/Master_Lunch_Dashboard Type cell reading "Not Serving". */
const NOT_SERVING_COLOR = '#D9D9D9';

const LUNCH_DASHBOARD_MANUAL_COLUMNS = [
  'Standard_Buffer', 'Tester_Buffer', 'Actual_Ordered', 'Day_1_In-Person', 'Day_1_Takeaway',
  'Subs_In-Person', 'Subs_Takeaway', 'Total_Consumed', 'Thrown_Away', 'Discrepancy'
];
const MANUAL_ENTRY_HEADER_COLOR = '#FFF2CC';
const MANUAL_ENTRY_CELL_TINT = '#FFFCF0';
/**
 * Prepended to a hand-entry column's HEADER CELL by labelManualEntryColumns().
 * Purely decorative — normalizeHeaderText() strips it back off, which is what
 * keeps 'Standard_Buffer' usable as Master_Lunch_Dashboard's header-row marker.
 */
const MANUAL_ENTRY_PREFIX = '✍️';

const MANUAL_OVERRIDE_OPTIONS = ['Auto-Synced', 'Manually Edited', 'Manually Added'];
// 'Superseded' marks a row from an identity (Event_ID + Name + Person_Type)
// that has since submitted again under a different Party_ID — see
// buildRegistrantRow(). It's deliberately excluded from every active/
// waitlist count (scanRegistrants(), buildEventCountsFromRegistrants(),
// buildDashboardRollup() all key off 'Active'/'Waitlisted' by name) without
// needing any special-casing there.
const PROGRAM_STATUS_OPTIONS = ['Active', 'Waitlisted', 'Cancelled', 'Superseded'];
const LUNCH_STATUS_OPTIONS = ['Needed', 'No Lunch', 'Waitlisted', 'Cancelled', 'Superseded'];
const EVENT_TYPE_OPTIONS = ['Fixed', 'Regular'];

/**
 * One color per location, used BOTH for the Location cell itself and (on
 * Master_Lunch_Dashboard) for the whole row band — see
 * buildLocationColorRules() / buildLocationRowTintRules().
 */
const LOCATION_COLOR_MAP = {
  'Narberth': '#FCE5CD',  // light orange
  'Ashbridge': '#D9EAD3', // light green
  'Zoom': '#D9D2E9'       // lavender
};

const SHEET_NAMES = {
  CONFIG: 'Config',
  PROGRAM_DASHBOARD: 'Master_Program_Dashboard',
  LUNCH_EVENT_REGISTRANTS: 'Lunch_and_Event_Registrants',
  LUNCH_DASHBOARD: 'Master_Lunch_Dashboard',
  LUNCH_SCHEDULE: 'Lunch_Schedule',
  TRIAGE: 'Deleted_Event_Triage'
};

const LEGACY_ACTIVE_PROGRAMS_SHEET_NAME = 'Active_Programs';

/**
 * Column layouts. Every date-bearing sheet now leads with Event_Date (its
 * cell background carries the month tint that used to live in a separate
 * Month column). Master_Program_Dashboard's session table no longer has a
 * Manual_Override column at all; the other date-bearing tabs keep it as
 * the second column.
 */
const HEADERS = {
  // The per-session table inside Master_Program_Dashboard (section C).
  Master_Program_Dashboard: [
    'Event_Date', 'Location', 'Clean_Title', 'Event_Time', 'Type_Tag',
    'Active_Count', 'Max_Capacity', 'Waitlist_Count', 'Remaining_Seats', 'Status',
    'Form_Response_Link', 'Edit_Form_Link', 'Form_ID', 'Calendar_Synced?',
    'Event_ID', 'Calendar_Source'
  ],
  // Order_Ahead_Flag is computed once, at import time, and never recomputed
  // afterward — a registration's notice period is a fact about when it
  // happened, not something that should drift if Config changes later.
  // Event_Date leads the row, the same as every other date-bearing tab (it
  // is what these tabs are sorted and split by, and it carries the month
  // tint), with Location and Event right behind it so staff never have to
  // scroll to see which program a registrant belongs to. Party_ID (the Form
  // response ID) sits at the very end — it's an internal grouping key, not
  // something staff read first; Party_Size (the headcount on that
  // submission) stays up front near the person since it IS worth reading at
  // a glance.
  Lunch_and_Event_Registrants: [
    'Event_Date', 'Location', 'Event', 'Manual_Override', 'Name', 'Person_Type', 'Lunch_Type',
    'Primary_Registrant', 'Party_Size', 'Form_Source', 'Program_Status', 'Lunch_Status',
    'Order_Ahead_Flag', 'Admin_Notes', 'Event_ID', 'Party_ID'
  ],
  Master_Lunch_Dashboard: [
    'Event_Date', 'Manual_Override', 'Location', 'Lunch_Type', 'Meal_Shorthand', 'Registered_Count',
    'Total_to_Order', 'Actual_Ordered', 'Standard_Buffer', 'Tester_Buffer', 'Day_1_In-Person',
    'Day_1_Takeaway', 'Subs_In-Person', 'Subs_Takeaway', 'Total_Consumed', 'Thrown_Away',
    'Discrepancy'
  ],
  // Now one row per Event_Date PER LOCATION. Type includes "Not Serving"
  // (see CATERED_LUNCH_TYPES vs LUNCH_TYPE_OPTIONS below).
  Lunch_Schedule: ['Event_Date', 'Location', 'Type', 'Meal_Description', 'Meal_Shorthand'],
  // A superset of Lunch_and_Event_Registrants' own array (same columns, same
  // order) plus 4 triage-only columns — moveRegistrantsToTriage() copies by
  // HEADER NAME, so keeping this a true prefix-plus-extra of the Registrants
  // array is what keeps every registrant column (Location/Event included)
  // landing in triage rows automatically, with no per-column wiring.
  Deleted_Event_Triage: [
    'Event_Date', 'Location', 'Event', 'Manual_Override', 'Name', 'Person_Type', 'Lunch_Type',
    'Primary_Registrant', 'Party_Size', 'Form_Source', 'Program_Status', 'Lunch_Status',
    'Order_Ahead_Flag', 'Admin_Notes', 'Event_ID', 'Party_ID',
    'Deleted_Event_Title', 'Deleted_Event_Location', 'Flagged_Date', 'Triage_Notes'
  ]
};

/** Headers for the small "Today at Each Location" section (A) inside Master_Program_Dashboard. */
const TODAY_AT_LOCATIONS_HEADERS = ['Location', 'Programs Today', 'Sessions Today', 'Registered Today'];

/** Headers for Master_Lunch_Dashboard's "Today's Lunch Needs" block — its own short list. */
const TODAY_LUNCH_HEADERS = ['Location', 'Lunch_Type', 'Meal_Shorthand', 'Registered_Count', 'Total_to_Order'];

/** Zero-based { header: index } map for a plain headers array (not a sheet). */
function getIndexMap(headersArray) {
  const map = {};
  headersArray.forEach((h, i) => { map[h] = i; });
  return map;
}

const MEAL_BUFFER_LOCATIONS = ['Narberth', 'Ashbridge'];
const CONFIG_LAYOUT = {
  MEAL_BUFFERS: {
    title: '🍱 Meal Buffer Amounts (Location x Hot/Cold)',
    startCol: 1,
    headers: ['Location', 'Lunch_Type', 'Standard_Buffer_Amount', 'Tester_Buffer_Amount']
  },
  ORDER_AHEAD: {
    title: '⏰ Order Ahead Time',
    startCol: 6,
    headers: ['Order_Ahead_Days']
  },
  ADMIN_NOTIFICATIONS: {
    title: '📧 Admin Notifications',
    startCol: 8,
    headers: ['Admin_Notification_Email']
  },
  CATERING_POLICY: {
    title: '🍽️ Lunch Service by Location',
    startCol: 10,
    headers: ['Location', 'Catering_Policy']
  }
};
const CONFIG_SPACER_COLS = [5, 7, 9];
const DEFAULT_MEAL_BUFFERS = { standardBufferAmount: 1, testerBufferAmount: 2 };
const DEFAULT_ORDER_AHEAD_DAYS = 7;
const CONFIG_HEADER_ROW = 2;
const CONFIG_DATA_START_ROW = 3;
/** Types that actually need a Meal Buffer Amounts row in Config (a "Not Serving" day never does). */
const CATERED_LUNCH_TYPES = ['Hot', 'Cold'];
/** Full set of Type choices offered on Lunch_Schedule / Master_Lunch_Dashboard. */
const LUNCH_TYPE_OPTIONS = ['Hot', 'Cold', 'Not Serving'];
/** Lunch_and_Event_Registrants' own Lunch_Type domain — a PERSON'S lunch is Hot, Cold, or none, never "Not Serving" (that's a day-level fact). */
const REGISTRANT_LUNCH_TYPE_OPTIONS = ['Hot', 'Cold', 'No Lunch'];

/**
 * A location's STANDING catering posture. Until this existed the only way
 * to say "Zoom never serves lunch" was to hand-add a "Not Serving" row to
 * Lunch_Schedule for every Zoom date forever — so in practice those dates
 * read as merely unconfigured, which meant they were seeded onto the lunch
 * dashboard AND asked about lunch on their registration forms.
 *
 *   ALWAYS       Lunch unless told otherwise. Every upcoming date is seeded
 *                onto the dashboard; a per-date "Not Serving" row suppresses
 *                individual days. (A normal catering site.)
 *   BY_EXCEPTION Nothing is assumed. A date shows up only once someone adds
 *                a real Hot/Cold row for it on Lunch_Schedule. (A site that
 *                caters occasionally.)
 *   NEVER        No lunch, ever. The location never appears on the lunch
 *                dashboard, and its forms don't ask about lunch at all.
 *
 * Policy governs what gets SEEDED. Actual registered demand always wins —
 * see buildDashboardRollup(): if someone is down for lunch on a date, that
 * date appears no matter the policy, and gets flagged to the admin when
 * there's no menu behind it.
 */
const CATERING_POLICIES = {
  ALWAYS: 'Always',
  BY_EXCEPTION: 'By exception',
  NEVER: 'Never'
};
const CATERING_POLICY_OPTIONS = Object.values(CATERING_POLICIES);

/**
 * Seeded into Config on setup; edit there afterward, not here. An unknown
 * location falls back to ALWAYS — the safe direction, since a location that
 * wrongly shows up is a visible nuisance while one that wrongly hides is a
 * missed lunch order.
 */
const DEFAULT_CATERING_POLICY_BY_LOCATION = {
  Narberth: CATERING_POLICIES.ALWAYS,
  Ashbridge: CATERING_POLICIES.BY_EXCEPTION,
  Zoom: CATERING_POLICIES.NEVER
};
const FALLBACK_CATERING_POLICY = CATERING_POLICIES.ALWAYS;

const FORM_FOOTER_BY_LOCATION = {
  Narberth: 'Additional notes or dietary needs? Let us know here.',
  Ashbridge: 'Additional notes or dietary needs? Let us know here.',
  Zoom: 'Additional notes? Let us know here.'
};
const DEFAULT_FORM_FOOTER = 'Additional notes or dietary needs?';

const SYNC_LOOKAHEAD_DAYS = 60;
const LAST_SYNC_PROP_KEY = 'LAST_FORM_SYNC_TIME';

const FORMS_FOLDER_ID = '';
const FORMS_FOLDER_NAME = 'Program Registration Forms';

/** Returns the dedicated forms folder — by hardcoded ID if set, else find-or-create by name. */
function getOrCreateFormsFolder() {
  if (FORMS_FOLDER_ID) {
    try {
      return DriveApp.getFolderById(FORMS_FOLDER_ID);
    } catch (err) {
      log(`⚠️ FORMS_FOLDER_ID "${FORMS_FOLDER_ID}" could not be opened (${err}) — falling back to a by-name lookup.`);
    }
  }
  const folders = DriveApp.getFoldersByName(FORMS_FOLDER_NAME);
  if (folders.hasNext()) {
    const folder = folders.next();
    log(`📋 Using existing "${FORMS_FOLDER_NAME}" folder — copy this ID into FORMS_FOLDER_ID to skip this lookup next time: ${folder.getId()}`);
    return folder;
  }
  const folder = DriveApp.createFolder(FORMS_FOLDER_NAME);
  log(`Created Drive folder "${FORMS_FOLDER_NAME}" for generated registration forms. 📋 Copy this ID into FORMS_FOLDER_ID: ${folder.getId()}`);
  return folder;
}

/**
 * Bump whenever the template FORM STRUCTURE changes (new/renamed items,
 * different page flow, etc.) so cached template IDs in Script Properties
 * are abandoned and rebuilt fresh instead of silently drifting out of sync
 * with what processFormResponse() expects to find.
 */
const TEMPLATE_VERSION = 3;
const TEMPLATE_FORM_PROP_KEY = `TEMPLATE_FORM_ID_V${TEMPLATE_VERSION}`;

/** Stable marker titles used to find-and-customize specific items after copying a template. */
const TEMPLATE_ITEM_TITLES = {
  NAME: 'Name',
  // Roster grids: rows = dates, columns = PERSON_COLUMN_LABELS.
  ATTENDANCE_GRID: 'Who is Attending Each Date?',
  LUNCH_GRID: 'Who Needs Lunch Each Date?',
  ALLERGIES: 'Allergies / Dietary Needs',
  ADDITIONAL_NOTES: 'Anything Else?',
  FOOTER: 'Footer Note',
  ATTENDANCE_MODE: 'Attendance Mode',
  ALL_DATES_LUNCH_PEOPLE: 'Who Needs Lunch? (Applies to Every Date)'
};

/** The two choices on the Attendance Mode question — now on EVERY form, not just Fixed series. */
const ATTENDANCE_MODE_CHOICES = {
  ALL_DATES: 'Everyone, every date',
  INDIVIDUAL: 'Let me pick specific dates/people'
};

/**
 * Titles of the two branch pages. Stable markers, like TEMPLATE_ITEM_TITLES —
 * restoreLunchQuestionsOnForm() needs them to put a re-added lunch question
 * back on the right page instead of at the end of the form.
 */
const TEMPLATE_PAGE_TITLES = {
  ALL_DATES: 'Everyone, Every Date',
  SPECIFIC_DATES: 'Specific Dates'
};

/**
 * The title of the guest-count question on templates v1/v2. Nothing builds
 * this any more — it is kept purely so isFormOnCurrentTemplate() can
 * recognize a form that was copied from one of those older templates and
 * still carries the branch pages behind it. See migrateFormsToCurrentTemplate().
 */
const LEGACY_GUEST_COUNT_TITLE = 'Guest Count';

/**
 * Grid columns and all-dates lunch choices. FIXED at four entries on every
 * form, deliberately: the guest-count question and its four branch pages
 * are gone (see getOrCreateTemplateForm()), so there is nothing left to
 * vary the column list by. A column whose matching guest name was left
 * blank is simply ignored at parse time.
 */
const PERSON_COLUMN_LABELS = ['You', 'Guest 1', 'Guest 2', 'Guest 3'];

/** Max guests one submission can bring — the number of optional name fields on page 1. */
const MAX_GUESTS = PERSON_COLUMN_LABELS.length - 1;

/** Placeholder row used on a freshly-built template's grids, before the first real date list is set. */
const TEMPLATE_GRID_PLACEHOLDER_ROW = '(dates will be filled in automatically)';

/**
 * Returns THE template form — one template for every group, Fixed or not.
 * Built once and reused forever after (keyed by TEMPLATE_VERSION).
 *
 * Page flow — deliberately only ONE branch point in the whole form:
 *
 *   Page 1   Name (required)
 *            Guest 1/2/3 Name (all optional — headcount is simply how many
 *              you fill in; there is no "how many guests?" question)
 *            Attendance Mode (required), which branches to exactly one of:
 *
 *   "Everyone, Every Date"   ALL_DATES_LUNCH_PEOPLE checkbox (who eats, applied
 *                            to every session date, including dates added to a
 *                            Fixed series later) -> SUBMIT
 *
 *   "Specific Dates"         ATTENDANCE_GRID + LUNCH_GRID roster grids, dates as
 *                            rows and PERSON_COLUMN_LABELS as columns -> SUBMIT
 *
 * Both branch pages also carry Allergies, the per-location Footer note, and
 * an "Anything Else?" catch-all.
 *
 * WHY IT IS SHAPED LIKE THIS: the previous template asked "Guest Count"
 * (0/1/2/3) and branched to a guest-detail page per count and then a roster
 * page per count — eight sections, each depending on Google Forms honoring
 * an explicit "after this section, go to..." jump. When such a jump is not
 * applied, Forms silently falls through to the NEXT section in document
 * order, which is how picking 2 guests could land you on the 3-guest page.
 * Dropping the guest-count question removes seven of the eight jumps and
 * makes that entire class of mis-routing impossible rather than merely
 * fixed. It also removes the old "picked 3 guests, typed 2 names, catered
 * for 2" mismatch, since the names ARE the headcount.
 *
 * IMPORTANT ordering note: in Apps Script Forms, a page's contents are
 * whatever items were added between ITS PageBreakItem and the NEXT one —
 * order of addition, not order of variable creation, decides this.
 */
function getOrCreateTemplateForm() {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty(TEMPLATE_FORM_PROP_KEY);
  if (existingId) {
    try {
      return FormApp.openById(existingId);
    } catch (err) {
      log(`⚠️ Stored template form ${existingId} could not be opened (${err}) — building a fresh template.`);
    }
  }

  const form = FormApp.create('TEMPLATE — Registration Form Base (do not edit or delete)');
  addTemplateItemsToForm(form);

  props.setProperty(TEMPLATE_FORM_PROP_KEY, form.getId());
  log(`Created template registration form: ${form.getId()}`);
  return form;
}

/**
 * Writes the current template's settings, questions and single navigation
 * rule onto `form` — which is EMPTY when called from
 * getOrCreateTemplateForm(), and freshly emptied when called from
 * rebuildFormFromCurrentTemplate() to bring a live form built on an older
 * template up to date. Adds nothing per-group: dates, the footer note and
 * the description are layered on afterwards by the caller.
 */
function addTemplateItemsToForm(form) {
  form.setCollectEmail(true);
  form.setAllowResponseEdits(true);

  // --- Page 1: who is registering -------------------------------------
  form.addTextItem().setTitle(TEMPLATE_ITEM_TITLES.NAME).setRequired(true);
  for (let g = 1; g <= MAX_GUESTS; g++) {
    form.addTextItem()
      .setTitle(`Guest ${g} Name`)
      .setHelpText(g === 1 ? 'Leave blank if you are not bringing anyone.' : '')
      .setRequired(false);
  }
  const modeItem = form.addListItem().setTitle(TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE)
    .setHelpText('Most people want the first option.')
    .setRequired(true);

  // --- Branch A: everyone, every date ----------------------------------
  const allDatesPage = form.addPageBreakItem().setTitle(TEMPLATE_PAGE_TITLES.ALL_DATES);
  addAllDatesLunchItem(form);
  form.addTextItem().setTitle(TEMPLATE_ITEM_TITLES.ALLERGIES);
  form.addSectionHeaderItem().setTitle(TEMPLATE_ITEM_TITLES.FOOTER);
  form.addParagraphTextItem().setTitle(TEMPLATE_ITEM_TITLES.ADDITIONAL_NOTES);
  allDatesPage.setGoToPage(FormApp.PageNavigationType.SUBMIT);

  // --- Branch B: per-date roster ---------------------------------------
  const specificPage = form.addPageBreakItem().setTitle(TEMPLATE_PAGE_TITLES.SPECIFIC_DATES);
  form.addCheckboxGridItem().setTitle(TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID)
    .setRows([TEMPLATE_GRID_PLACEHOLDER_ROW]).setColumns(PERSON_COLUMN_LABELS);
  addLunchGridItem(form);
  form.addTextItem().setTitle(TEMPLATE_ITEM_TITLES.ALLERGIES);
  form.addSectionHeaderItem().setTitle(TEMPLATE_ITEM_TITLES.FOOTER);
  form.addParagraphTextItem().setTitle(TEMPLATE_ITEM_TITLES.ADDITIONAL_NOTES);
  specificPage.setGoToPage(FormApp.PageNavigationType.SUBMIT);

  // The form's ONLY navigation decision.
  modeItem.setChoices([
    modeItem.createChoice(ATTENDANCE_MODE_CHOICES.ALL_DATES, allDatesPage),
    modeItem.createChoice(ATTENDANCE_MODE_CHOICES.INDIVIDUAL, specificPage)
  ]);
}

/** The all-dates branch's who-eats checkbox. Appended wherever the cursor is — callers position it. */
function addAllDatesLunchItem(form) {
  return form.addCheckboxItem().setTitle(TEMPLATE_ITEM_TITLES.ALL_DATES_LUNCH_PEOPLE)
    .setChoiceValues(PERSON_COLUMN_LABELS)
    .setHelpText('Uncheck anyone who will not be eating. Ignore rows for guests you did not name. ' +
      'Applies only to the dates lunch is actually served on.');
}

/** The per-date lunch roster grid. Rows are set later by applyFormDateLabels(). */
function addLunchGridItem(form) {
  return form.addCheckboxGridItem().setTitle(TEMPLATE_ITEM_TITLES.LUNCH_GRID)
    .setRows([TEMPLATE_GRID_PLACEHOLDER_ROW]).setColumns(PERSON_COLUMN_LABELS);
}

/**
 * Builds the form description, including the exact dates being registered
 * for — one date per line, not one long semicolon-separated line. Adds a
 * note when any date is lunch-free, and a tip about the "all dates" option
 * for Fixed-series forms.
 */
function buildFormDescription(locationName, dateLabels, isFixed, hasLunchDates) {
  const dateList = dateLabels.map(label => `• ${label}`).join('\n');
  let description = `Location: ${locationName}\n\nDates:\n${dateList}\n\nPlease register below.`;
  if (hasLunchDates === false) {
    // Nothing on this form is catered, so the form isn't asking about lunch
    // at all (see syncLunchQuestionsOnForm()) — say so rather than leaving
    // its absence to be guessed at.
    description += `\n\nNote: Lunch is not provided on any of these dates, so there is nothing to choose.`;
  } else if (dateLabels.some(l => l.indexOf('No Lunch Served') !== -1)) {
    description += `\n\nNote: Lunch is not provided on any date marked "No Lunch Served" above.`;
  }
  if (isFixed) {
    description += `\n\nTip: Attending every session? Choose "Sign up for all dates" on the next page for a faster registration — you'll only need to pick your lunch preference once.`;
  }
  return description;
}

/**
 * Persistent groupKey -> Form_ID map (Script Properties), so a group's
 * sessions can be temporarily removed (e.g. triaged away) without spawning
 * a duplicate form the next time it's seen. findExistingFormIdFromEvents()
 * is a further fallback recovering a form ID directly from a calendar
 * event's own description.
 */
const FORM_REGISTRY_PROP_KEY = 'FORM_REGISTRY_MAP_V1';

/**
 * Both persistent registries below are read once per execution and written
 * back at most once, via flushPersistentRegistries(). They used to
 * get+JSON.parse+stringify+set on EVERY entry — once per group in
 * syncCalendars(), and once per PERSON PER RESPONSE in
 * processAllDatesResponse(), which is the worst offender since a party of
 * four cost four full round trips to the property store. The flush is
 * called as soon as the loop that dirties them finishes (not at the very
 * end of the run) so the crash window stays about as small as it was.
 */
let __formRegistryCache = null;
let __formRegistryDirty = false;
let __allDatesRegistryCache = null;
let __allDatesRegistryDirty = false;

function getPersistentFormRegistry() {
  if (__formRegistryCache) return __formRegistryCache;
  const raw = PropertiesService.getScriptProperties().getProperty(FORM_REGISTRY_PROP_KEY);
  __formRegistryCache = raw ? JSON.parse(raw) : {};
  return __formRegistryCache;
}

function savePersistentFormRegistryEntry(groupKey, formId) {
  const registry = getPersistentFormRegistry();
  if (registry[groupKey] === formId) return;
  registry[groupKey] = formId;
  __formRegistryDirty = true;
}

/**
 * Persistent registry of "sign up for all dates" respondents, keyed by
 * Form_ID, so that when a Fixed-series form later gains NEW dates (the
 * series keeps running), syncRegistrations() can retroactively add rows
 * for those new dates for everyone who originally chose "all dates" —
 * otherwise "all dates" would silently only mean "all dates that existed
 * at the moment I registered."
 */
const ALL_DATES_REGISTRY_PROP_KEY = 'ALL_DATES_REGISTRANTS_V1';

function getAllDatesRegistry() {
  if (__allDatesRegistryCache) return __allDatesRegistryCache;
  const raw = PropertiesService.getScriptProperties().getProperty(ALL_DATES_REGISTRY_PROP_KEY);
  __allDatesRegistryCache = raw ? JSON.parse(raw) : {};
  return __allDatesRegistryCache;
}

function saveAllDatesRegistryEntry(formId, entry) {
  const registry = getAllDatesRegistry();
  if (!registry[formId]) registry[formId] = [];
  const key = `${normalizeNameKey(entry.name)}|${entry.personType}`;
  registry[formId] = registry[formId].filter(e => `${normalizeNameKey(e.name)}|${e.personType}` !== key);
  registry[formId].push(entry);
  __allDatesRegistryDirty = true;
}

/**
 * Which template version each LIVE (per-group) form was built from — the
 * thing that was missing when TEMPLATE_VERSION went to 3: bumping it rebuilt
 * the cached TEMPLATE, but every form already copied from an older one kept
 * its old questions, and those are the forms people actually fill in. See
 * migrateFormsToCurrentTemplate(), which reads this to know what it can skip
 * without an API call.
 */
const FORM_TEMPLATE_VERSION_PROP_KEY = 'FORM_TEMPLATE_VERSIONS_V1';

let __formTemplateVersionCache = null;
let __formTemplateVersionDirty = false;

function getFormTemplateVersions() {
  if (__formTemplateVersionCache) return __formTemplateVersionCache;
  const raw = PropertiesService.getScriptProperties().getProperty(FORM_TEMPLATE_VERSION_PROP_KEY);
  __formTemplateVersionCache = raw ? JSON.parse(raw) : {};
  return __formTemplateVersionCache;
}

function setFormTemplateVersion(formId, version) {
  const versions = getFormTemplateVersions();
  if (versions[formId] === version) return;
  versions[formId] = version;
  __formTemplateVersionDirty = true;
}

/** Writes back whichever persistent registries were actually modified. Safe to call repeatedly — a clean registry costs nothing. */
function flushPersistentRegistries() {
  const props = PropertiesService.getScriptProperties();
  if (__formRegistryDirty && __formRegistryCache) {
    props.setProperty(FORM_REGISTRY_PROP_KEY, JSON.stringify(__formRegistryCache));
    __formRegistryDirty = false;
  }
  if (__allDatesRegistryDirty && __allDatesRegistryCache) {
    props.setProperty(ALL_DATES_REGISTRY_PROP_KEY, JSON.stringify(__allDatesRegistryCache));
    __allDatesRegistryDirty = false;
  }
  if (__formLabelFingerprintDirty && __formLabelFingerprintCache) {
    props.setProperty(FORM_LABEL_FINGERPRINT_PROP_KEY, JSON.stringify(__formLabelFingerprintCache));
    __formLabelFingerprintDirty = false;
  }
  if (__formTemplateVersionDirty && __formTemplateVersionCache) {
    props.setProperty(FORM_TEMPLATE_VERSION_PROP_KEY, JSON.stringify(__formTemplateVersionCache));
    __formTemplateVersionDirty = false;
  }
}

const SYNC_LOCK_WAIT_MS = 10 * 1000;

const TIMEZONE = SpreadsheetApp.getActiveSpreadsheet()
  ? SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone()
  : Session.getScriptTimeZone();

/**
 * A header cell's canonical name. labelManualEntryColumns() decorates the
 * hand-entry columns' header cells with MANUAL_ENTRY_PREFIX, so the literal
 * cell text on Master_Lunch_Dashboard reads "✍️ Standard_Buffer" — every
 * header lookup has to see through that decoration, or a column (and, for
 * findAllHeaderRows(), the entire header row it marks) becomes invisible.
 */
function normalizeHeaderText(value) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  return text.indexOf(MANUAL_ENTRY_PREFIX) === 0 ? text.substring(MANUAL_ENTRY_PREFIX.length).trim() : text;
}

/** Scans Row 1 for an exact header match and returns its 1-based column index (flat, single-header sheets like Config). */
function getColumnIndex(sheet, colName) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return -1;
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (let i = 0; i < headerRow.length; i++) {
    if (normalizeHeaderText(headerRow[i]) === colName) return i + 1;
  }
  log(`⚠️ getColumnIndex: header "${colName}" not found on sheet "${sheet.getName()}"`);
  return -1;
}

/** Convenience wrapper: builds a { headerName: colIndex } map from Row 1 in one pass. */
function getHeaderMap(sheet) {
  return getHeaderMapAt(sheet, 1);
}

/** Same as getHeaderMap(), but for a header at an arbitrary row. */
function getHeaderMapAt(sheet, headerRow) {
  const map = {};
  if (!headerRow || headerRow < 1) return map;
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return map;
  const headerRowValues = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  headerRowValues.forEach((h, i) => {
    const name = normalizeHeaderText(h);
    if (name && map[name] === undefined) map[name] = i + 1;
  });
  return map;
}

/**
 * Scans down row-by-row (up to maxRowsToScan) for EVERY row that contains
 * uniqueHeaderText anywhere in it, returning all matching row numbers. Every
 * date-bearing tab now has TWO such header rows (Upcoming + Past sub-tables
 * — see section 6), so this replaces the old single-header-row finder.
 */
function findAllHeaderRows(sheet, uniqueHeaderText, maxRowsToScan) {
  const lastRow = Math.min(Math.max(sheet.getLastRow(), 0), maxRowsToScan || 3000);
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  if (lastRow < 1) return [];
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const rows = [];
  for (let r = 0; r < values.length; r++) {
    if (values[r].some(v => normalizeHeaderText(v) === uniqueHeaderText)) rows.push(r + 1);
  }
  return rows;
}

/** Locates Master_Program_Dashboard's session-table header rows (unique marker: 'Event_ID'). */
function findProgramSessionHeaderRows(sheet) {
  return findAllHeaderRows(sheet, 'Event_ID', 5000);
}

function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    log(`Created missing tab: ${name}`);
  }
  return sheet;
}

/**
 * Reads a range as values, but substitutes the formula string wherever a
 * cell contains one — use this instead of plain getValues() whenever rows
 * are about to be copied/relocated elsewhere (a plain getValues() read
 * would flatten a HYPERLINK formula down to dead plain text).
 */
function getRowsPreservingFormulas(sheet, startRow, startCol, numRows, numCols) {
  const range = sheet.getRange(startRow, startCol, numRows, numCols);
  const values = range.getValues();
  const formulas = range.getFormulas();
  return values.map((row, r) => row.map((val, c) => formulas[r][c] || val));
}

/**
 * Generic "dropdown restricted to a predefined list" helper — every
 * dropdown in the workbook is built on top of this ONE implementation.
 */
function applyValueListValidationBounded(sheet, colIndex, options, startRow, numRows) {
  if (!colIndex || colIndex < 1 || numRows < 1 || !options || options.length === 0) return;
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(false).build();
  sheet.getRange(startRow, colIndex, numRows, 1).setDataValidation(rule);
}

/** Same as above, from startRow to the end of the sheet. */
function applyValueListValidationRange(sheet, colIndex, options, startRow) {
  if (!colIndex || colIndex < 1) return;
  const numRows = Math.max(sheet.getMaxRows() - startRow + 1, 1);
  applyValueListValidationBounded(sheet, colIndex, options, startRow, numRows);
}

/** Applies a dropdown restricted to MANUAL_OVERRIDE_OPTIONS, starting at row 2 (unbounded — general utility). */
function applyManualOverrideValidation(sheet, colIndex) {
  applyManualOverrideValidationRange(sheet, colIndex, 2);
}

function applyManualOverrideValidationRange(sheet, colIndex, startRow) {
  applyValueListValidationRange(sheet, colIndex, MANUAL_OVERRIDE_OPTIONS, startRow);
}

function applyManualOverrideValidationBounded(sheet, colIndex, startRow, numRows) {
  applyValueListValidationBounded(sheet, colIndex, MANUAL_OVERRIDE_OPTIONS, startRow, numRows);
}

/** Deterministic color fallback for a location not in LOCATION_COLOR_MAP. */
function getLocationColor(locationName) {
  if (LOCATION_COLOR_MAP[locationName]) return LOCATION_COLOR_MAP[locationName];
  let hash = 0;
  for (let i = 0; i < locationName.length; i++) {
    hash = locationName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hslToPastelHex(hueAvoidingReservedColors(hash), 45, 85);
}

/** Dropdown restricted to the current CALENDAR_MAP location names, from startRow to the end of the sheet. */
function applyLocationValidationRange(sheet, colIndex, startRow) {
  applyValueListValidationRange(sheet, colIndex, Object.values(CALENDAR_MAP), startRow);
}

/** Same, but bounded to an exact number of rows. */
function applyLocationValidationBounded(sheet, colIndex, startRow, numRows) {
  applyValueListValidationBounded(sheet, colIndex, Object.values(CALENDAR_MAP), startRow, numRows);
}

/** Builds one color-coded conditional format rule per known location, across one or more ranges. */
function buildLocationColorRules(ranges) {
  if (ranges.length === 0) return [];
  return Object.keys(LOCATION_COLOR_MAP).map(loc =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(loc)
      .setBackground(LOCATION_COLOR_MAP[loc])
      .setRanges(ranges)
      .build()
  );
}

/**
 * Same colors as buildLocationColorRules(), but painted across a row BAND
 * rather than just the Location cell, keyed off that row's own Location
 * column — so a lunch schedule mixing several locations on the same date
 * reads as blocks of color instead of one tinted cell per row.
 *
 * excludeCols (1-based) carves out the cells that already carry their own
 * meaning — the month-tinted Event_Date, the yellow hand-entry columns — the
 * same way buildManualOverrideRowTintRules() does. Push these rules AFTER any
 * more specific rule over the same cells (the purple manual-override tint,
 * the grey "Not Serving" type cell): the first matching rule wins.
 */
function buildLocationRowTintRules(sheet, dataStartRow, numRows, numCols, locationCol, excludeCols) {
  if (numRows < 1 || !locationCol) return [];
  const colLetter = columnToLetter(locationCol);
  const ranges = buildRowRangesExcludingColumns(sheet, dataStartRow, numRows, numCols, excludeCols);
  if (ranges.length === 0) return [];
  return Object.keys(LOCATION_COLOR_MAP).map(loc =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$${colLetter}${dataStartRow}="${loc}"`)
      .setBackground(LOCATION_COLOR_MAP[loc])
      .setRanges(ranges)
      .build()
  );
}

/** Converts a 1-based column index to its A1 letter(s) (1 -> 'A', 27 -> 'AA'). */
function columnToLetter(col) {
  let letter = '';
  while (col > 0) {
    const rem = (col - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

/**
 * Returns one Range per contiguous run of 1-based columns from 1..numCols,
 * skipping any column in excludeCols — used so a "whole row" conditional
 * tint never paints over a cell that already carries its own more specific
 * meaning.
 */
function buildRowRangesExcludingColumns(sheet, startRow, numRows, numCols, excludeCols) {
  const excludeSet = new Set((excludeCols || []).filter(c => c && c > 0));
  const ranges = [];
  let runStart = null;
  for (let c = 1; c <= numCols; c++) {
    if (excludeSet.has(c)) {
      if (runStart !== null) { ranges.push(sheet.getRange(startRow, runStart, numRows, c - runStart)); runStart = null; }
    } else if (runStart === null) {
      runStart = c;
    }
  }
  if (runStart !== null) ranges.push(sheet.getRange(startRow, runStart, numRows, numCols - runStart + 1));
  return ranges;
}

/**
 * Builds conditional format rules that tint MOST of a row's cells whenever
 * that row's Manual_Override reads "Manually Edited" or "Manually Added".
 * excludeCols (1-based) lets a caller carve out columns with their own more
 * specific highlight (Status, Location, the month tint, a manual-entry
 * column's yellow wash) so the purple tint never overrides them.
 */
function buildManualOverrideRowTintRules(sheet, dataStartRow, numRows, numCols, overrideCol, excludeCols) {
  if (numRows < 1 || !overrideCol) return [];
  const colLetter = columnToLetter(overrideCol);
  const ranges = buildRowRangesExcludingColumns(sheet, dataStartRow, numRows, numCols, excludeCols);
  if (ranges.length === 0) return [];
  return ['Manually Edited', 'Manually Added'].map(text =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$${colLetter}${dataStartRow}="${text}"`)
      .setBackground(MANUAL_OVERRIDE_COLOR)
      .setRanges(ranges)
      .build()
  );
}

/** Highlights + labels the header cells of columns meant for hand entry. */
function labelManualEntryColumns(sheet, headerRow, headers, manualColumnNames) {
  manualColumnNames.forEach(name => {
    const idx = headers.indexOf(name);
    if (idx === -1) return;
    sheet.getRange(headerRow, idx + 1)
      .setValue(`${MANUAL_ENTRY_PREFIX} ${name}`)
      .setBackground(MANUAL_ENTRY_HEADER_COLOR)
      .setFontColor('#000000')
      .setFontWeight('bold');
  });
}

/** Washes the data cells of manual-entry columns with a light tint. */
function tintManualEntryColumns(sheet, startRow, numRows, headers, manualColumnNames) {
  if (numRows < 1) return;
  manualColumnNames.forEach(name => {
    const idx = headers.indexOf(name);
    if (idx === -1) return;
    sheet.getRange(startRow, idx + 1, numRows, 1).setBackground(MANUAL_ENTRY_CELL_TINT);
  });
}

/** Greys out only blank/"--" cells in given columns. General-purpose utility (not currently on any render path). */
function greyOutDashCells(sheet, startRow, numRows, colIndexes) {
  if (numRows < 1) return;
  colIndexes.forEach(col => {
    if (!col || col < 1) return;
    const values = sheet.getRange(startRow, col, numRows, 1).getValues();
    values.forEach((r, i) => {
      const v = String(r[0]).trim();
      if (v === '--' || v === '') {
        sheet.getRange(startRow + i, col).setBackground(NA_CELL_COLOR);
      }
    });
  });
}

/** Deterministic pastel color fallback for months not in MONTH_COLOR_MAP. */
function getMonthColor(monthName) {
  if (MONTH_COLOR_MAP[monthName]) return MONTH_COLOR_MAP[monthName];
  let hash = 0;
  for (let i = 0; i < monthName.length; i++) {
    hash = monthName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hueAvoidingReservedColors(hash);
  return hslToPastelHex(hue, 55, 88);
}

/**
 * Maps an arbitrary hash into a hue that skips reserved bands (status
 * green/red, plus the three location colors' neighborhoods), leaving three
 * safe zones: gold/yellow, teal, magenta — exactly where MONTH_COLOR_MAP's
 * palette lives.
 */
function hueAvoidingReservedColors(hash) {
  const bands = [[50, 80], [165, 195], [290, 335]];
  const totalWidth = bands.reduce((sum, b) => sum + (b[1] - b[0]), 0);
  let pos = Math.abs(hash) % totalWidth;
  for (const [lo, hi] of bands) {
    const width = hi - lo;
    if (pos < width) return lo + pos;
    pos -= width;
  }
  return bands[0][0];
}

function hslToPastelHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function getMonthLabel(date) {
  return Utilities.formatDate(date, TIMEZONE, 'MMMM yyyy');
}

function formatDateKey(date) {
  return Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd');
}

function formatDateLabel(date) {
  return Utilities.formatDate(date, TIMEZONE, 'EEE, MMM d, yyyy');
}

/** Parses a 'yyyy-MM-dd' key back into a local Date at midnight. */
function parseDateKey(dateKey) {
  const parts = String(dateKey).split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

/** Returns a real Date from a sheet cell value, or null if it can't be parsed. */
function coerceDate(val) {
  if (val instanceof Date) return val;
  if (val === '' || val === null || val === undefined) return null;
  const d = new Date(val);
  return isNaN(d) ? null : d;
}

function makeHyperlinkFormula(url, label) {
  return `=HYPERLINK("${url}","${label}")`;
}

function computeEventId(calendarId, cleanTitle, dateKey) {
  const raw = `${calendarId}|${cleanTitle}|${dateKey}`;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw);
  return digest.map(b => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, '0')).join('').substring(0, 12);
}

function computeStatus(activeCount, maxCapacity) {
  if (maxCapacity <= 0) return '🟢 Open';
  const remaining = maxCapacity - activeCount;
  if (remaining <= 0) return '🔴 Waitlist Only';
  if (remaining <= Math.max(1, Math.ceil(maxCapacity * 0.15))) return '🟡 Almost Full';
  return '🟢 Open';
}

/**
 * Suffix appended by formatDateLabelWithMeal() when a capped session has
 * hit 0 Remaining_Seats — converts silent waitlisting into something a
 * respondent actually sees before submitting (see
 * buildCapacityHintsFromRegistryRows() / refreshFormCapacityLabelsForAllForms()).
 * Deliberately a plain hyphen, not the em dash " — " used for meal hints,
 * so stripMealHint() can tell the two apart unambiguously.
 */
const CAPACITY_HINT_SUFFIX = ' (FULL - Waitlist)';

/** Strips the CAPACITY_HINT_SUFFIX and/or the " — <shorthand/description>" menu hint appended by formatDateLabelWithMeal(), returning the plain date label. */
function stripMealHint(label) {
  let s = String(label);
  if (s.endsWith(CAPACITY_HINT_SUFFIX)) s = s.slice(0, -CAPACITY_HINT_SUFFIX.length);
  const idx = s.indexOf(' — ');
  return idx === -1 ? s : s.substring(0, idx);
}

/** Tints an Event_Date column's cells by month — the direct replacement for the old separate Month column everywhere. */
function applyMonthColorTint(sheet, colIndex1Based, startRow, numRows) {
  if (numRows < 1) return;
  const values = sheet.getRange(startRow, colIndex1Based, numRows, 1).getValues();
  const backgrounds = values.map(r => { const d = coerceDate(r[0]); return [d ? getMonthColor(getMonthLabel(d)) : '#FFFFFF']; });
  sheet.getRange(startRow, colIndex1Based, numRows, 1).setBackgrounds(backgrounds);
}

/** Builds a "text equals" conditional format rule across one or more explicit ranges. */
function buildTextEqualsRuleForRanges(ranges, text, bgColor) {
  if (!ranges || ranges.length === 0) return null;
  return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text).setBackground(bgColor).setRanges(ranges).build();
}


// ============================================================================
// 1c. PER-EXECUTION CACHES  (the sync hot paths)
// ============================================================================
//
// An Apps Script global lives exactly as long as ONE execution, which makes
// globals the natural home for "read this tab once per run" memoization:
// there is no cross-run staleness to reason about, only within-run
// invalidation whenever this script itself rewrites the tab a cache was
// built from. Every cache below is explicitly dropped by the code path that
// dirties it — grep the invalidate* functions for their call sites.
//
// What these replace (all of it per-call before):
//   - getMealInfoForDate() re-read the ENTIRE Lunch_Schedule tab on every
//     single call, and buildDateLabelSets() calls it 2-3x PER DATE. A
//     10-date form therefore cost ~30 full-tab reads to build its labels,
//     once per form, on every sync.
//   - getMealBufferConfigForLocation()/getOrderAheadDays() re-read Config
//     per call, the former once per lunch-dashboard rollup row.
//   - form.getItems() is a REMOTE call and getResponseValueByTitle() made
//     one per lookup — roughly ten per response, times every response.
//   - CalendarApp.getEvents() ran once per calendar in syncCalendarsInternal()
//     AND again in every triageDeletedSessions() pass; a full
//     initializeAndSyncAll() hit the calendars four times over.
// ============================================================================

let __mealInfoIndexCache = null;
let __mealBufferIndexCache = null;
let __orderAheadDaysCache = null;
let __adminNotificationEmailCache = null;
let __cateringPolicyIndexCache = null;
let __calendarEventsCache = null;
let __formItemIndexCache = {};

/**
 * Reads Lunch_Schedule ONCE per execution into
 * { 'yyyy-MM-dd|Location': mealInfo, 'yyyy-MM-dd': mealInfo }. The
 * date-only key preserves getMealInfoForDate()'s original "no location
 * given -> first matching row wins" behavior; first write wins for both key
 * shapes, matching the old top-to-bottom scan.
 */
function getMealInfoIndex() {
  if (__mealInfoIndexCache) return __mealInfoIndexCache;
  const index = {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.LUNCH_SCHEDULE) : null;
  if (sheet) {
    const headers = HEADERS.Lunch_Schedule;
    const map = getIndexMap(headers);
    readAllSectionedRows(sheet, headers, 'Event_Date').forEach(row => {
      const rowDate = coerceDate(row[map['Event_Date']]);
      if (!rowDate) return;
      const dateKey = formatDateKey(rowDate);
      const location = String(row[map['Location']] || '').trim();
      const info = {
        type: row[map['Type']] || '',
        description: row[map['Meal_Description']] || '',
        shorthand: row[map['Meal_Shorthand']] || ''
      };
      const locatedKey = `${dateKey}|${location}`;
      if (index[locatedKey] === undefined) index[locatedKey] = info;
      if (index[dateKey] === undefined) index[dateKey] = info;
    });
  }
  __mealInfoIndexCache = index;
  return index;
}

/** Called by renderLunchScheduleSheet() — the only thing that rewrites the tab this index is built from. */
function invalidateMealInfoIndex() {
  __mealInfoIndexCache = null;
}

/** Called by buildConfigSheet() — the only thing that rewrites/seeds the Config tab. */
function invalidateConfigCaches() {
  __mealBufferIndexCache = null;
  __orderAheadDaysCache = null;
  __adminNotificationEmailCache = null;
  __cateringPolicyIndexCache = null;
}

/**
 * Item lookups for one form, built with a SINGLE form.getItems() round
 * trip: { byTitle: {title: [item...]}, paragraphItems: [...] }. Cached per
 * form ID for the rest of the execution. Only ever used for READS — the
 * refresh paths that mutate a form's items call invalidateFormItemIndex().
 */
function getFormItemIndex(form) {
  const formId = form.getId();
  if (__formItemIndexCache[formId]) return __formItemIndexCache[formId];
  const items = form.getItems();
  const byTitle = {};
  const paragraphItems = [];
  items.forEach(item => {
    const title = item.getTitle();
    if (!byTitle[title]) byTitle[title] = [];
    byTitle[title].push(item);
    if (item.getType() === FormApp.ItemType.PARAGRAPH_TEXT) paragraphItems.push(item);
  });
  const index = { form, formId, items, byTitle, paragraphItems };
  __formItemIndexCache[formId] = index;
  return index;
}

function invalidateFormItemIndex(formId) {
  if (formId) delete __formItemIndexCache[formId];
  else __formItemIndexCache = {};
}

/**
 * One CalendarApp.getEvents() per calendar per execution, keyed on the sync
 * window so a differently-scoped call still re-fetches. Returns
 * { calendarId: [CalendarEvent...] | null }, where null means the calendar
 * was inaccessible (callers log and skip, same as before).
 *
 * Safe to share across a full syncCalendars(): that run edits event
 * DESCRIPTIONS (backInjectCalendarDescriptions) but never adds or removes
 * events, so the set of live events this cache represents stays accurate.
 */
function getCalendarEventsForWindow(start, end) {
  const windowKey = `${start.getTime()}|${end.getTime()}`;
  if (__calendarEventsCache && __calendarEventsCache.windowKey === windowKey) {
    return __calendarEventsCache.byCalendar;
  }
  const byCalendar = {};
  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    const calendar = CalendarApp.getCalendarById(calendarId);
    byCalendar[calendarId] = calendar ? calendar.getEvents(start, end) : null;
  });
  __calendarEventsCache = { windowKey, byCalendar };
  return byCalendar;
}

/** Drops the calendar cache — used after anything that could change which events exist. */
function invalidateCalendarEventsCache() {
  __calendarEventsCache = null;
}


// ============================================================================
// 1b. LUNCH SCHEDULE LOOKUP (per Event_Date x Location — see Lunch_Schedule tab)
// ============================================================================

/** Returns the hardcoded form footer note for a location (falls back to a generic note). */
function getFormFooterForLocation(locationName) {
  return FORM_FOOTER_BY_LOCATION[locationName] || DEFAULT_FORM_FOOTER;
}

/**
 * Looks up the day's meal info (Type, Meal_Description, Meal_Shorthand)
 * from Lunch_Schedule for one specific date AND location. Returns null if
 * no row exists for that date+location yet. Type may be 'Hot' | 'Cold' |
 * 'Not Serving'. Backed by getMealInfoIndex()'s one-read-per-execution map
 * (this used to re-read the whole tab on every call).
 */
function getMealInfoForDate(date, location) {
  if (!date) return null;
  const index = getMealInfoIndex();
  const dateKey = formatDateKey(date);
  const key = location ? `${dateKey}|${String(location).trim()}` : dateKey;
  return index[key] || null;
}

/**
 * Builds a "date label + menu hint [+ capacity hint]" string, e.g. "Mon,
 * Jan 5, 2026 — Turkey Sandwich (FULL - Waitlist)", using Meal_Shorthand
 * when present, falling back to Meal_Description. When the date+location is
 * marked "Not Serving," the hint instead reads "No Lunch Served" — this is
 * what lets a form communicate the lack of catering right on the date row
 * itself. capacityHint (CAPACITY_HINT_SUFFIX or '') is always appended
 * LAST, after any meal hint. Used ONLY for form-facing display text;
 * internal matching/storage always uses the plain label via
 * stripMealHint()/formatDateLabel().
 */
function formatDateLabelWithMeal(date, location, capacityHint) {
  const baseLabel = formatDateLabel(date);
  const meal = getMealInfoForDate(date, location);
  let label;
  if (!meal) label = baseLabel;
  else if (meal.type === 'Not Serving') label = `${baseLabel} — No Lunch Served`;
  else {
    const hint = meal.shorthand || meal.description;
    label = hint ? `${baseLabel} — ${hint}` : baseLabel;
  }
  return capacityHint ? `${label}${capacityHint}` : label;
}

/**
 * Splits a set of session dates into the full label list (for the
 * attendance roster grid — every date, whether or not lunch is served) and
 * the lunch-grid label subset (only dates where Lunch_Schedule doesn't mark
 * that date+location "Not Serving") — so the lunch grid never offers a
 * choice on a day nothing is actually being catered. capacityHints is an
 * optional { 'yyyy-MM-dd': CAPACITY_HINT_SUFFIX } map (see
 * buildCapacityHintsFromRegistryRows()) — omit it and no date gets a
 * capacity hint.
 *
 * Both lists are DE-DUPLICATED. A group with two sessions on the same day —
 * a morning and an afternoon sitting of the same program — produces the same
 * label twice, and a Google Forms grid rejects duplicate row labels outright
 * ("Invalid data updating form"), which fails the whole form write and takes
 * the date list with it. Collapsing them costs nothing downstream: a grid row
 * is matched back to its session by label (registryIndex is keyed
 * `formId|label`), so the two sittings were always going to resolve to one
 * row anyway.
 */
function buildDateLabelSets(dates, locationName, capacityHints) {
  capacityHints = capacityHints || {};
  const label = d => formatDateLabelWithMeal(d, locationName, capacityHints[formatDateKey(d)]);
  const allDateLabels = dedupePreservingOrder(dates.map(label));
  const lunchDateLabels = dedupePreservingOrder(dates.filter(d => isLunchOfferedOn(d, locationName)).map(label));
  return { allDateLabels, lunchDateLabels };
}

/** First occurrence of each value, in the order they appeared. */
function dedupePreservingOrder(values) {
  const seen = new Set();
  return values.filter(v => (seen.has(v) ? false : (seen.add(v), true)));
}

/**
 * Builds { 'yyyy-MM-dd': CAPACITY_HINT_SUFFIX } from a batch of
 * Master_Program_Dashboard rows (any set sharing the same header layout —
 * typically one form's sessions), using each row's own Max_Capacity /
 * Remaining_Seats. Uncapped sessions (no Max_Capacity) never get a hint.
 */
function buildCapacityHintsFromRegistryRows(rows, map) {
  const hints = {};
  rows.forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (!d) return;
    const rawCap = row[map['Max_Capacity']];
    const isCapped = rawCap !== '' && rawCap !== '--' && Number(rawCap) > 0;
    if (!isCapped) return;
    const remaining = Number(row[map['Remaining_Seats']]);
    if (!isNaN(remaining) && remaining <= 0) hints[formatDateKey(d)] = CAPACITY_HINT_SUFFIX;
  });
  return hints;
}

/**
 * Generic lunch response choices offered on every form (Yes/No — the
 * specific dish/serving status for a given day comes from Lunch_Schedule
 * and is shown directly on the date row via formatDateLabelWithMeal()).
 */
const GENERIC_LUNCH_CHOICES = ['No Lunch', 'Yes - Lunch'];


// ============================================================================
// 1d. FORM DATE-LABEL WRITES  (fingerprinted — see applyFormDateLabels)
// ============================================================================
//
// Every path that pushes date labels onto a form funnels through
// applyFormDateLabels(). Writing a form item is a remote call AND creates a
// new form revision, and the labels are usually byte-identical to what's
// already there — refreshFormCapacityLabelsForAllForms() in particular runs
// on EVERY hourly sync across every capped form. So we keep a hash of the
// last labels written per form in Script Properties and short-circuit
// before FormApp.openById() (itself the most expensive call in the path)
// whenever nothing changed.
//
// The fingerprint tracks only what THIS script writes. A human editing a
// form's grid rows by hand would not be noticed until the labels legitimately
// change again — pass { force: true } (or clear the property) to re-assert.
// ============================================================================

const FORM_LABEL_FINGERPRINT_PROP_KEY = 'FORM_LABEL_FINGERPRINTS_V1';

let __formLabelFingerprintCache = null;
let __formLabelFingerprintDirty = false;

function getFormLabelFingerprints() {
  if (__formLabelFingerprintCache) return __formLabelFingerprintCache;
  const raw = PropertiesService.getScriptProperties().getProperty(FORM_LABEL_FINGERPRINT_PROP_KEY);
  __formLabelFingerprintCache = raw ? JSON.parse(raw) : {};
  return __formLabelFingerprintCache;
}

function computeFormLabelFingerprint(attendanceLabels, lunchLabels) {
  const raw = JSON.stringify([attendanceLabels, lunchLabels]);
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw);
  return digest.map(b => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, '0')).join('');
}

/**
 * Sets a form's ATTENDANCE_GRID rows to attendanceLabels and its LUNCH_GRID
 * rows to lunchLabels, skipping the whole thing when the labels match what we
 * last wrote to that form.
 *
 * An EMPTY lunchLabels list means no date on this form serves lunch, in which
 * case the lunch grid isn't on the form at all any more (see
 * syncLunchQuestionsOnForm()) — the loop below simply finds nothing to write.
 *
 * options.form    — an already-open Form, to avoid a second openById()
 * options.force   — write even if the fingerprint matches
 * options.context — short string for the log line on failure
 * Returns true if the form was actually written to.
 */
function applyFormDateLabels(formId, attendanceLabels, lunchLabels, options) {
  options = options || {};
  const fingerprint = computeFormLabelFingerprint(attendanceLabels, lunchLabels);
  const fingerprints = getFormLabelFingerprints();
  if (!options.force && fingerprints[formId] === fingerprint) return false;

  try {
    const form = options.form || FormApp.openById(formId);
    const items = form.getItems();
    items.filter(it => it.getTitle() === TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID)
      .forEach(it => it.asCheckboxGridItem().setRows(attendanceLabels));
    if (lunchLabels && lunchLabels.length > 0) {
      items.filter(it => it.getTitle() === TEMPLATE_ITEM_TITLES.LUNCH_GRID)
        .forEach(it => it.asCheckboxGridItem().setRows(lunchLabels));
    }
  } catch (err) {
    log(`⚠️ Could not write date labels to form ${formId}${options.context ? ` (${options.context})` : ''}: ${err}`);
    return false;
  }

  fingerprints[formId] = fingerprint;
  __formLabelFingerprintDirty = true;
  invalidateFormItemIndex(formId); // cached grid row/column shapes for this form are now stale
  return true;
}

/**
 * Builds a PREFILLED form URL with every box in both roster grids already
 * checked — every person, every date — so the common "we're all coming to
 * everything" case is a read-and-submit instead of a wall of empty
 * checkboxes. Respondents uncheck the exceptions.
 *
 * Google Forms has no notion of a default-checked grid, so the only way to
 * do this is a prefilled response URL; that URL is what we hand out as the
 * registration link (calendar descriptions, the dashboard's "View Live
 * Form"). It has to be regenerated whenever the grid rows change, which is
 * exactly when the label writes happen.
 *
 * Entries are emitted for BOTH branches' items at once — the two roster
 * grids and the all-dates who-eats checkbox. Forms simply ignores the
 * parameters for a page a given respondent never visits, so one URL covers
 * whichever branch they pick.
 *
 * KNOWN SOFT EDGE: a prefill value only matches a row whose label is still
 * byte-identical, so after refreshFormCapacityLabelsForAllForms() appends a
 * "(FULL - Waitlist)" hint to a date, the already-published link stops
 * pre-checking THAT date until the link is regenerated (next time the form
 * gains/loses dates). The same applies to a link published before
 * migrateFormsToCurrentTemplate() rebuilt its form, since the entry IDs
 * themselves change. Every other date still pre-checks, and a full sign-up
 * is never wrong — just one box short of pre-filled. Regenerating on every
 * capacity change would mean rewriting every calendar description on every
 * sync, which costs far more than it saves.
 *
 * Returns null on any failure — callers fall back to the plain published
 * URL, which is the pre-existing behavior and always works.
 */
function buildPrefilledAllCheckedUrl(form) {
  try {
    let response = form.createResponse();
    let anyPrefilled = false;

    form.getItems().forEach(item => {
      const title = item.getTitle();
      const isGrid = title === TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID || title === TEMPLATE_ITEM_TITLES.LUNCH_GRID;
      const isPeopleCheckbox = title === TEMPLATE_ITEM_TITLES.ALL_DATES_LUNCH_PEOPLE;
      if (!isGrid && !isPeopleCheckbox) return;

      try {
        if (isGrid) {
          const grid = item.asCheckboxGridItem();
          const rows = grid.getRows();
          const columns = grid.getColumns();
          if (rows.length === 0 || columns.length === 0) return;
          // One entry per row: the full column list = every person checked.
          response = response.withItemResponse(grid.createResponse(rows.map(() => columns.slice())));
        } else {
          // The "everyone, every date" branch's single who-eats checkbox.
          const checkbox = item.asCheckboxItem();
          const choices = checkbox.getChoices().map(c => c.getValue());
          if (choices.length === 0) return;
          response = response.withItemResponse(checkbox.createResponse(choices));
        }
        anyPrefilled = true;
      } catch (err) {
        // An item still holding a placeholder row, or otherwise not
        // answerable — skip it rather than losing the whole URL.
        log(`ℹ️ Skipped prefill for "${title}" on form ${form.getId()}: ${err}`);
      }
    });

    if (!anyPrefilled) return null;
    return response.toPrefilledUrl();
  } catch (err) {
    log(`⚠️ Could not build a prefilled all-checked URL for form ${form.getId()} (${err}) — falling back to the plain published URL.`);
    return null;
  }
}

/** The link we actually hand out: prefilled-all-checked when we can build one, plain published URL otherwise. */
function buildRegistrationUrl(form) {
  return buildPrefilledAllCheckedUrl(form) || form.getPublishedUrl();
}

/**
 * Strips both lunch questions — the per-date LUNCH_GRID and the all-dates
 * who-eats checkbox — off a form that has no lunch to offer: a location
 * whose catering policy is NEVER, or a form none of whose dates serve
 * lunch. Asking someone to pick a lunch that isn't being served is noise at
 * best and a wrong expectation at worst.
 *
 * The parser needs no special case for this: getGridResponseByTitle()
 * returns null when the item is absent and getResponseValueByTitle()
 * returns '', both of which already resolve to "No Lunch" for everyone.
 */
function removeLunchQuestionsFromForm(form, locationName, reason) {
  const doomed = [TEMPLATE_ITEM_TITLES.LUNCH_GRID, TEMPLATE_ITEM_TITLES.ALL_DATES_LUNCH_PEOPLE];
  let removed = 0;
  form.getItems().forEach(item => {
    if (doomed.indexOf(item.getTitle()) === -1) return;
    try {
      form.deleteItem(item);
      removed++;
    } catch (err) {
      log(`⚠️ Could not remove "${item.getTitle()}" from the ${locationName} form (${err}).`);
    }
  });
  if (removed > 0) {
    log(`Removed ${removed} lunch question(s) from a ${locationName} form — ` +
      (reason || `that location's catering policy is "${CATERING_POLICIES.NEVER}"`) + '.');
  }
  return removed;
}

/**
 * The inverse of removeLunchQuestionsFromForm(): puts a stripped lunch
 * question back when lunch returns to a form (a Fixed series that gains its
 * first catered date, a menu row added to a By-exception location). Without
 * this, "hide the question when there's nothing to eat" would be a one-way
 * door on a form that outlives the dates it was created with.
 *
 * A re-added item lands at the END of the form, so each one is moved back to
 * its template position — beside the attendance grid on the Specific Dates
 * page, and first on the Everyone, Every Date page. Rows are left as the
 * placeholder; the caller's applyFormDateLabels({ force: true }) sets them.
 */
function restoreLunchQuestionsOnForm(form) {
  const titles = form.getItems().map(it => it.getTitle());
  let restored = 0;

  if (titles.indexOf(TEMPLATE_ITEM_TITLES.LUNCH_GRID) === -1) {
    const gridItem = addLunchGridItem(form);
    const attendanceIdx = form.getItems().findIndex(it => it.getTitle() === TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID);
    if (attendanceIdx !== -1) form.moveItem(gridItem.getIndex(), attendanceIdx + 1);
    restored++;
  }

  if (titles.indexOf(TEMPLATE_ITEM_TITLES.ALL_DATES_LUNCH_PEOPLE) === -1) {
    const checkboxItem = addAllDatesLunchItem(form);
    const pageIdx = form.getItems().findIndex(it =>
      it.getType() === FormApp.ItemType.PAGE_BREAK && it.getTitle() === TEMPLATE_PAGE_TITLES.ALL_DATES);
    if (pageIdx !== -1) form.moveItem(checkboxItem.getIndex(), pageIdx + 1);
    restored++;
  }

  if (restored > 0) log(`Restored ${restored} lunch question(s) to form ${form.getId()} — it has catered dates again.`);
  return restored;
}

/**
 * Single decision point for whether a form asks about lunch at all: it does
 * when its location caters AND at least one date on the form actually
 * serves lunch. Both directions are handled, so a form self-heals whichever
 * way its schedule moves.
 *
 * Per-DATE filtering is separate and already handled by buildDateLabelSets()
 * — the lunch grid's rows are only the dates that serve lunch, so a date
 * marked "Not Serving" never appears as a lunch row even on a form whose
 * other dates do.
 *
 * Returns how many questions were added or removed, so a caller can force
 * the date-label write that has to follow a restore (a restored grid still
 * holds the template's placeholder row).
 */
function syncLunchQuestionsOnForm(form, locationName, hasLunchDates) {
  if (getCateringPolicyForLocation(locationName) === CATERING_POLICIES.NEVER) {
    return removeLunchQuestionsFromForm(form, locationName);
  }
  if (!hasLunchDates) {
    return removeLunchQuestionsFromForm(form, locationName, 'no date on this form serves lunch');
  }
  return restoreLunchQuestionsOnForm(form);
}


/**
 * Fired via onEdit() when Lunch_Schedule is hand-edited. Reorganizes the
 * tab into fresh Upcoming/Past sections reflecting whatever was just
 * typed, then pushes updated date labels out to any form covering the
 * edited date(s)+location(s) — since those labels carry a " — <hint>"
 * suffix that would otherwise sit stale.
 */
function handleLunchScheduleEdit(e, sheet) {
  const zones = getSectionZones(sheet, 'Event_Date');
  const editedRow = e.range.getRow();
  if (!isRowInAnyDataZone(zones, editedRow)) return;

  const headers = HEADERS.Lunch_Schedule;
  const map = getIndexMap(headers);
  const startRow = editedRow;
  const numRows = e.range.getNumRows();
  const touched = sheet.getRange(startRow, 1, numRows, headers.length).getValues();

  const dateLocationPairs = touched
    .map(r => ({ date: coerceDate(r[map['Event_Date']]), location: r[map['Location']] }))
    .filter(p => p.date);

  renderLunchScheduleSheet();

  dateLocationPairs.forEach(p => refreshFormsForChangedLunchDate(p.date, p.location));
}

/**
 * Finds every form with at least one session on `changedDate` AT
 * `location` and rewrites that form's date-dependent items with fresh
 * labels — every date the form covers, not just changedDate — so a single
 * Lunch_Schedule edit self-heals any stale label on that form.
 */
function refreshFormsForChangedLunchDate(changedDate, location) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) return;
  const headers = HEADERS.Master_Program_Dashboard;
  const rows = readAllSectionedRows(registrySheet, headers, 'Event_ID');
  if (rows.length === 0) return;
  const map = getIndexMap(headers);
  const changedKey = formatDateKey(changedDate);

  const affectedFormIds = new Set();
  rows.forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (d && formatDateKey(d) === changedKey && (!location || row[map['Location']] === location)) {
      const formId = row[map['Form_ID']];
      if (formId) affectedFormIds.add(formId);
    }
  });
  if (affectedFormIds.size === 0) return;

  affectedFormIds.forEach(formId => {
    const formRows = rows.filter(row => row[map['Form_ID']] === formId);
    const formLocation = formRows.length > 0 ? formRows[0][map['Location']] : location;
    const datesForForm = formRows.map(row => coerceDate(row[map['Event_Date']])).filter(Boolean).sort((a, b) => a - b);
    if (datesForForm.length === 0) return;

    const capacityHints = buildCapacityHintsFromRegistryRows(formRows, map);
    const { allDateLabels, lunchDateLabels } = buildDateLabelSets(datesForForm, formLocation, capacityHints);

    // A menu edit is exactly how a form gains or loses its last lunch date,
    // so the question set is re-checked here, not just the row labels.
    let form = null;
    let questionsChanged = 0;
    try {
      form = FormApp.openById(formId);
      questionsChanged = syncLunchQuestionsOnForm(form, formLocation, lunchDateLabels.length > 0);
    } catch (err) {
      log(`⚠️ Could not open form ${formId} to re-check its lunch questions after a Lunch_Schedule edit (${err}).`);
    }

    if (applyFormDateLabels(formId, allDateLabels, lunchDateLabels,
      { form, force: questionsChanged > 0, context: 'Lunch_Schedule edit' })) {
      log(`Refreshed form ${formId}'s date labels after a Lunch_Schedule edit affecting ${changedKey} (${formLocation}).`);
    }
  });
  flushPersistentRegistries();
}


// ============================================================================
// 2. SHEET SETUP UTILITY  (initSheet)
// ============================================================================

function initSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const legacySheet = ss.getSheetByName(LEGACY_ACTIVE_PROGRAMS_SHEET_NAME);
  if (legacySheet) {
    ss.deleteSheet(legacySheet);
    log(`Removed legacy "${LEGACY_ACTIVE_PROGRAMS_SHEET_NAME}" tab — its data now lives in "${SHEET_NAMES.PROGRAM_DASHBOARD}".`);
  }

  buildConfigSheet(ss);
  initLunchScheduleSheet(ss);

  try {
    getOrCreateTemplateForm();
  } catch (err) {
    log(`⚠️ Could not build/verify the template registration form during setup (${err}) — it will be retried on the next calendar sync.`);
  }

  renderRegistrantsSheet(true);
  renderTriageSheet(true);

  initPlaceholderSheet(ss, SHEET_NAMES.LUNCH_DASHBOARD, 'Run "Sync Registrations" from the menu to populate this dashboard.');

  renderProgramDashboard(true);

  writeTriggers();
  reorderTabs(ss);

  SpreadsheetApp.getActiveSpreadsheet().toast('Sheet setup complete ✅', 'Calendar & Form Manager', 5);
  log('initSheet complete.');
}

/**
 * Builds/refreshes the day-by-day, per-location Lunch_Schedule tab. If an
 * older Month-based (no Location) layout is found, it's renamed to a
 * timestamped backup instead of being destroyed.
 */
function initLunchScheduleSheet(ss) {
  const sheet = ss.getSheetByName(SHEET_NAMES.LUNCH_SCHEDULE);
  if (sheet && sheet.getRange(1, 1).getValue() === 'Month') {
    const backupName = `Lunch_Schedule_OLD_${Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd_HHmmss')}`;
    sheet.setName(backupName);
    log(`⚠️ Existing Lunch_Schedule tab used the older Month-based layout — renamed to "${backupName}". ` +
      `The new tab tracks one row per date PER LOCATION (with a "Not Serving" Type option) — please migrate anything you still need.`);
  }
  renderLunchScheduleSheet(true);
}

/** Puts tabs in a logical, at-a-glance order. */
function reorderTabs(ss) {
  const order = [
    SHEET_NAMES.PROGRAM_DASHBOARD,
    SHEET_NAMES.LUNCH_DASHBOARD,
    SHEET_NAMES.LUNCH_EVENT_REGISTRANTS,
    SHEET_NAMES.LUNCH_SCHEDULE,
    SHEET_NAMES.CONFIG,
    SHEET_NAMES.TRIAGE
  ];
  order.forEach((name, i) => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(i + 1);
  });
}

function initPlaceholderSheet(ss, tabName, message) {
  const sheet = getOrCreateSheet(ss, tabName);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1).setValue(message).setFontStyle('italic').setFontColor('#666666');
  }
  autosizeColumns(sheet);
}

function setHeadersIfNeeded(sheet, headers) {
  const existing = sheet.getRange(1, 1, 1, Math.max(headers.length, sheet.getLastColumn() || 1)).getValues()[0];
  const needsWrite = headers.some((h, i) => String(existing[i] || '').trim() !== h);
  if (needsWrite) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    log(`Headers written on "${sheet.getName()}"`);
  }
}

function styleHeaderRow(sheet, numCols) {
  sheet.getRange(1, 1, 1, numCols)
    .setFontWeight('bold')
    .setBackground('#434343')
    .setFontColor('#FFFFFF')
    .setVerticalAlignment('middle')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
}

/** Writes a merged, colored section banner at an arbitrary row. */
function writeSectionBanner(sheet, row, numCols, text) {
  const range = sheet.getRange(row, 1, 1, numCols);
  try { range.breakApart(); } catch (err) { /* not previously merged */ }
  range.merge()
    .setValue(text)
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#6D9EEB')
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
}

/** Writes a bold, dark header row of the given headers at an arbitrary row. */
function writeSectionHeader(sheet, row, numCols, headerValues) {
  sheet.getRange(row, 1, 1, numCols).setValues([headerValues])
    .setFontWeight('bold').setBackground('#434343').setFontColor('#FFFFFF')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
}

/** Manual alternating white/light-gray fill — safe to be overwritten later. */
function applyZebraStripingManual(sheet, numDataRows) {
  const lastCol = Math.max(sheet.getLastColumn(), HEADERS[sheet.getName()] ? HEADERS[sheet.getName()].length : 1);
  applyZebraStripingManualBounded(sheet, 2, numDataRows, lastCol);
}

/** Same idea, but for an exact row range/column count. */
function applyZebraStripingManualBounded(sheet, startRow, numRows, numCols) {
  if (numRows < 1 || numCols < 1) return;
  const backgrounds = [];
  for (let r = 0; r < numRows; r++) {
    backgrounds.push(new Array(numCols).fill(r % 2 === 0 ? '#FFFFFF' : '#F6F6F6'));
  }
  sheet.getRange(startRow, 1, numRows, numCols).setBackgrounds(backgrounds);
}

/** Native row banding for tabs that are a single flat table with nothing else competing for background color. */
function applyZebraStripingBanding(sheet, startRow) {
  startRow = startRow || 2;
  sheet.getBandings().forEach(b => b.remove());
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const numRows = Math.max(sheet.getMaxRows() - startRow + 1, 1);
  const range = sheet.getRange(startRow, 1, numRows, lastCol);
  const banding = range.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  banding.setFirstRowColor('#FFFFFF');
  banding.setSecondRowColor('#F3F3F3');
}

/**
 * Resizes columns to fit their content via a single whole-sheet call.
 * options.minCols guarantees columns are considered even if
 * sheet.getLastColumn() hasn't caught up yet this execution. options.force
 * additionally clears any lingering WRAP strategy first (wrapped cells
 * report a fixed/incorrect content width and block autosize).
 */
function autosizeColumns(sheet, options) {
  options = options || {};
  const force = !!options.force;
  const lastCol = Math.max(sheet.getLastColumn(), options.minCols || 0);
  if (lastCol < 1) return;

  try {
    if (force) {
      const lastRow = Math.max(sheet.getLastRow(), 1);
      sheet.getRange(1, 1, lastRow, lastCol).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    }
    sheet.autoResizeColumns(1, lastCol);
    applyColumnWidthBuffer(sheet, lastCol);
  } catch (err) {
    log(`autosizeColumns skipped on "${sheet.getName()}": ${err}`);
  }
}

/**
 * Pads already-autofitted columns out to COLUMN_WIDTH_BUFFER_MULTIPLIER of
 * their fitted width, clamped to [MIN_COLUMN_WIDTH_PX, MAX_COLUMN_WIDTH_PX].
 * Assumes the caller just ran autoResizeColumns() — it reads the fitted
 * widths rather than re-fitting.
 *
 * On call counts, since this runs on every render of every tab: the fit is
 * ONE batched autoResizeColumns() (not one autoResizeColumn() per column),
 * and while the N getColumnWidth() reads are unavoidable — SpreadsheetApp
 * has no batch width read — the WRITES are grouped. Consecutive columns
 * landing on the same target width go out as a single setColumnWidths()
 * run, and after clamping that happens a lot: every column pinned to the
 * cap collapses into one call, as does every run of similar short columns.
 */
function applyColumnWidthBuffer(sheet, lastCol) {
  const targets = [];
  for (let col = 1; col <= lastCol; col++) {
    const padded = Math.round(sheet.getColumnWidth(col) * COLUMN_WIDTH_BUFFER_MULTIPLIER);
    targets.push(Math.max(MIN_COLUMN_WIDTH_PX, Math.min(padded, MAX_COLUMN_WIDTH_PX)));
  }

  let runStart = 0;
  for (let i = 1; i <= targets.length; i++) {
    if (i < targets.length && targets[i] === targets[runStart]) continue;
    sheet.setColumnWidths(runStart + 1, i - runStart, targets[runStart]);
    runStart = i;
  }
}

/**
 * One-shot padded autofit across EVERY sheet in the workbook. Exposed on
 * the menu ("Resize All Sheets") and safe to run any time — it only ever
 * sets column widths, so there's no data, formatting, or form state to
 * lose. Use it after tuning the width constants above, or to fix up a tab
 * that predates them.
 *
 * Deliberately NOT called from any render path: each render already
 * autosizes the single tab it just rewrote, which is strictly cheaper than
 * re-walking the workbook, and doing both would size every sheet twice.
 */
function resizeAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  sheets.forEach(sheet => autosizeColumns(sheet, { force: true }));
  log(`resizeAllSheets: padded autofit applied to ${sheets.length} sheet(s).`);
  ss.toast(`Resized ${sheets.length} sheet(s) ✅`, 'Calendar & Form Manager', 5);
}


// ============================================================================
// 2b. CONFIG SHEET (Meal Buffer Amounts + Order Ahead Time — see CONFIG_LAYOUT above)
// ============================================================================

function buildConfigSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_NAMES.CONFIG);
  const isCurrentLayout = sheet && sheet.getRange(1, 1).getValue() === CONFIG_LAYOUT.MEAL_BUFFERS.title;

  if (sheet && !isCurrentLayout && sheet.getLastRow() > 0) {
    const backupName = `Config_OLD_${Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd_HHmmss')}`;
    sheet.setName(backupName);
    log(`⚠️ Existing Config tab used an older layout — renamed to "${backupName}". ` +
      `Lunch Menu rows now belong on the "${SHEET_NAMES.LUNCH_SCHEDULE}" tab (by date AND location), ` +
      `and Form Footer Notes are hardcoded in FORM_FOOTER_BY_LOCATION — please migrate anything you still need.`);
    sheet = null;
  }
  if (!sheet) sheet = ss.insertSheet(SHEET_NAMES.CONFIG);

  writeConfigStructure(sheet);
  styleConfigSheet(sheet);
  return sheet;
}

function writeConfigStructure(sheet) {
  Object.values(CONFIG_LAYOUT).forEach(section => {
    const span = section.headers.length;
    const bannerRange = sheet.getRange(1, section.startCol, 1, span);
    try { bannerRange.breakApart(); } catch (err) { /* not previously merged */ }
    bannerRange.merge()
      .setValue(section.title)
      .setFontWeight('bold')
      .setFontColor('#FFFFFF')
      .setBackground('#6D9EEB')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

    sheet.getRange(CONFIG_HEADER_ROW, section.startCol, 1, span)
      .setValues([section.headers])
      .setFontWeight('bold')
      .setBackground('#434343')
      .setFontColor('#FFFFFF');
  });
  sheet.setFrozenRows(CONFIG_HEADER_ROW);
}

function styleConfigSheet(sheet) {
  applyZebraStripingBanding(sheet, CONFIG_DATA_START_ROW);
  const lastSectionEndCol = Math.max(...Object.values(CONFIG_LAYOUT).map(s => s.startCol + s.headers.length - 1));
  autosizeColumns(sheet, { force: true, minCols: lastSectionEndCol });

  const bufferSection = CONFIG_LAYOUT.MEAL_BUFFERS;
  const validationRows = MEAL_BUFFER_LOCATIONS.length * CATERED_LUNCH_TYPES.length; // exactly the fixed Location x Hot/Cold combos

  applyValueListValidationBounded(sheet, bufferSection.startCol, MEAL_BUFFER_LOCATIONS, CONFIG_DATA_START_ROW, validationRows);
  applyValueListValidationBounded(sheet, bufferSection.startCol + 1, CATERED_LUNCH_TYPES, CONFIG_DATA_START_ROW, validationRows);

  // One policy row per location, so the dropdowns are bounded the same way.
  const policySection = CONFIG_LAYOUT.CATERING_POLICY;
  const policyRows = Math.max(Object.keys(CALENDAR_MAP).length, 1);
  applyValueListValidationBounded(sheet, policySection.startCol, Object.values(CALENDAR_MAP), CONFIG_DATA_START_ROW, policyRows);
  applyValueListValidationBounded(sheet, policySection.startCol + 1, CATERING_POLICY_OPTIONS, CONFIG_DATA_START_ROW, policyRows);

  seedMealBufferRows(sheet);
  seedOrderAheadRow(sheet);
  seedAdminNotificationRow(sheet);
  seedCateringPolicyRows(sheet);
  invalidateConfigCaches(); // the seeds above may have just written cells the caches were built from
}

/** Pre-fills the fixed Location x Hot/Cold combinations if they aren't already present. Never overwrites an existing combo's row. */
function seedMealBufferRows(sheet) {
  const section = CONFIG_LAYOUT.MEAL_BUFFERS;
  // Scanned across the sheet's full current height so an existing combo
  // sitting past this section's own data (because some OTHER section is
  // currently taller) is still found — see the startRow comment below for
  // why that same wide scan must NOT be used to decide where to append.
  const sheetLastRow = sheet.getLastRow();
  const existingCombos = new Set();
  if (sheetLastRow >= CONFIG_DATA_START_ROW) {
    const existing = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol, sheetLastRow - CONFIG_DATA_START_ROW + 1, 2).getValues();
    existing.forEach(([loc, type]) => { if (loc && type) existingCombos.add(`${loc}|${type}`); });
  }

  const rowsToAdd = [];
  MEAL_BUFFER_LOCATIONS.forEach(loc => {
    CATERED_LUNCH_TYPES.forEach(type => {
      if (!existingCombos.has(`${loc}|${type}`)) {
        rowsToAdd.push([loc, type, DEFAULT_MEAL_BUFFERS.standardBufferAmount, DEFAULT_MEAL_BUFFERS.testerBufferAmount]);
      }
    });
  });
  if (rowsToAdd.length === 0) return;

  // Deliberately NOT sheet.getLastRow(): that's the tallest column on the
  // WHOLE sheet, not this section's own. Once any other Config section is
  // taller than this one, appending at sheetLastRow + 1 pushes these rows
  // down into that other section's column range instead of stacking under
  // this section's own existing rows. existingCombos.size IS this section's
  // own row count (it counts real Location+Type rows already present), so
  // it's what "the next empty row in THIS column" actually means.
  const startRow = CONFIG_DATA_START_ROW + existingCombos.size;
  sheet.getRange(startRow, section.startCol, rowsToAdd.length, section.headers.length).setValues(rowsToAdd);
  log(`Seeded ${rowsToAdd.length} Meal Buffer Amounts row(s) on "${SHEET_NAMES.CONFIG}".`);
}

function seedOrderAheadRow(sheet) {
  const section = CONFIG_LAYOUT.ORDER_AHEAD;
  const cell = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol);
  if (cell.getValue() === '') {
    cell.setValue(DEFAULT_ORDER_AHEAD_DAYS);
    log(`Seeded default Order Ahead Time (${DEFAULT_ORDER_AHEAD_DAYS} days) on "${SHEET_NAMES.CONFIG}".`);
  }
}

/**
 * Writes one policy row per CALENDAR_MAP location, seeded from
 * DEFAULT_CATERING_POLICY_BY_LOCATION. Never overwrites a location that
 * already has a row — this is a setting staff own once it exists.
 */
function seedCateringPolicyRows(sheet) {
  const section = CONFIG_LAYOUT.CATERING_POLICY;
  const sheetLastRow = sheet.getLastRow(); // see seedMealBufferRows() for why this is scan-only, never append-math
  const existing = new Set();
  if (sheetLastRow >= CONFIG_DATA_START_ROW) {
    sheet.getRange(CONFIG_DATA_START_ROW, section.startCol, sheetLastRow - CONFIG_DATA_START_ROW + 1, 1)
      .getValues()
      .forEach(([loc]) => { const v = String(loc || '').trim(); if (v) existing.add(v); });
  }

  const rowsToAdd = Object.values(CALENDAR_MAP)
    .filter(loc => !existing.has(loc))
    .map(loc => [loc, DEFAULT_CATERING_POLICY_BY_LOCATION[loc] || FALLBACK_CATERING_POLICY]);
  if (rowsToAdd.length === 0) return;

  // existing.size IS this section's own row count so far — NOT
  // sheet.getLastRow(), which by the time this runs (fourth of four Config
  // seeds) reflects whichever section is tallest and would append these
  // rows into that section's row range instead of this one's. This is what
  // put "Lunch Service by Location" at rows 7-9 instead of 3-5 the first
  // time this ran, once Meal Buffer Amounts had already filled rows 3-6.
  const startRow = CONFIG_DATA_START_ROW + existing.size;
  sheet.getRange(startRow, section.startCol, rowsToAdd.length, section.headers.length).setValues(rowsToAdd);
  sheet.getRange(startRow, section.startCol + 1, rowsToAdd.length, 1).setNote(
    'Always = lunch unless a date is marked Not Serving.\n'
    + 'By exception = only dates with a Hot/Cold row on Lunch_Schedule.\n'
    + 'Never = no lunch at all; hidden from the lunch dashboard and not asked about on forms.');
  log(`Seeded ${rowsToAdd.length} Lunch Service by Location row(s) on "${SHEET_NAMES.CONFIG}".`);
}

/**
 * Leaves the admin email BLANK on purpose — an empty cell means "don't
 * send anything," and guessing an address (the current user's, say) would
 * start mailing someone who never asked for it. Just annotates the cell so
 * it's obvious what goes there.
 */
function seedAdminNotificationRow(sheet) {
  const section = CONFIG_LAYOUT.ADMIN_NOTIFICATIONS;
  const cell = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol);
  if (String(cell.getValue() || '').trim() === '') {
    cell.setNote('Optional. One address to receive a per-sync digest of items needing attention '
      + '(waitlisted registrants, forms that failed to open, triaged deleted events). Leave blank to disable.');
  }
}

/**
 * Looks up the static Standard_Buffer/Tester_Buffer amounts configured for
 * one location + lunch type (Hot/Cold) in Config's "Meal Buffer Amounts"
 * section. Falls back to DEFAULT_MEAL_BUFFERS if no matching row exists
 * (which is always the case for "Not Serving," by design).
 */
function getMealBufferConfigForLocation(locationName, lunchType) {
  const index = getMealBufferIndex();
  const hit = index[`${locationName}|${String(lunchType).trim()}`];
  if (hit) return Object.assign({}, hit);

  log(`No Meal Buffer Amounts row found for "${locationName}" / "${lunchType}" yet — using defaults (Standard: ${DEFAULT_MEAL_BUFFERS.standardBufferAmount}, Tester: ${DEFAULT_MEAL_BUFFERS.testerBufferAmount}).`);
  return Object.assign({}, DEFAULT_MEAL_BUFFERS);
}

/**
 * Reads Config's "Meal Buffer Amounts" section ONCE per execution into
 * { 'Location|Type': {standardBufferAmount, testerBufferAmount} }. Was a
 * full Config read per call, and updateMasterLunchDashboard() calls it once
 * per rollup row.
 */
function getMealBufferIndex() {
  if (__mealBufferIndexCache) return __mealBufferIndexCache;
  const index = {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
  const lastRow = sheet ? sheet.getLastRow() : 0;
  if (sheet && lastRow >= CONFIG_DATA_START_ROW) {
    const section = CONFIG_LAYOUT.MEAL_BUFFERS;
    const numRows = lastRow - CONFIG_DATA_START_ROW + 1;
    const data = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol, numRows, section.headers.length).getValues();
    data.forEach(([loc, type, standardAmt, testerAmt]) => {
      const key = `${String(loc).trim()}|${String(type).trim()}`;
      if (index[key] !== undefined) return; // first matching row wins, as the old top-down scan did
      index[key] = {
        standardBufferAmount: (standardAmt !== '' && !isNaN(standardAmt)) ? Number(standardAmt) : DEFAULT_MEAL_BUFFERS.standardBufferAmount,
        testerBufferAmount: (testerAmt !== '' && !isNaN(testerAmt)) ? Number(testerAmt) : DEFAULT_MEAL_BUFFERS.testerBufferAmount
      };
    });
  }
  __mealBufferIndexCache = index;
  return index;
}

/**
 * Reads Config's "Lunch Service by Location" section ONCE per execution
 * into { Location: policy }. Anything not listed — or listed with an
 * unrecognized value — falls back to FALLBACK_CATERING_POLICY.
 */
function getCateringPolicyIndex() {
  if (__cateringPolicyIndexCache) return __cateringPolicyIndexCache;
  const index = {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
  const lastRow = sheet ? sheet.getLastRow() : 0;
  if (sheet && lastRow >= CONFIG_DATA_START_ROW) {
    const section = CONFIG_LAYOUT.CATERING_POLICY;
    const numRows = lastRow - CONFIG_DATA_START_ROW + 1;
    const data = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol, numRows, section.headers.length).getValues();
    data.forEach(([loc, policy]) => {
      const location = String(loc || '').trim();
      const value = String(policy || '').trim();
      if (!location || index[location] !== undefined) return;
      if (CATERING_POLICY_OPTIONS.indexOf(value) === -1) return;
      index[location] = value;
    });
  }
  __cateringPolicyIndexCache = index;
  return index;
}

/** A location's standing lunch posture — see CATERING_POLICIES. */
function getCateringPolicyForLocation(locationName) {
  const key = String(locationName || '').trim();
  const configured = getCateringPolicyIndex()[key];
  if (configured) return configured;
  return DEFAULT_CATERING_POLICY_BY_LOCATION[key] || FALLBACK_CATERING_POLICY;
}

/**
 * Should this date+location be OFFERED lunch — on the form, and seeded onto
 * the lunch dashboard? Policy sets the default; an explicit Lunch_Schedule
 * row can always override in either direction.
 */
function isLunchOfferedOn(date, locationName) {
  const policy = getCateringPolicyForLocation(locationName);
  if (policy === CATERING_POLICIES.NEVER) return false;

  const meal = getMealInfoForDate(date, locationName);
  if (meal && meal.type === 'Not Serving') return false;
  if (policy === CATERING_POLICIES.BY_EXCEPTION) {
    // Nothing assumed: a real catered menu row has to exist for this date.
    return !!meal && CATERED_LUNCH_TYPES.indexOf(meal.type) !== -1;
  }
  return true; // ALWAYS
}

function getOrderAheadDays() {
  if (__orderAheadDaysCache !== null) return __orderAheadDaysCache;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
  let days = DEFAULT_ORDER_AHEAD_DAYS;
  if (sheet) {
    const section = CONFIG_LAYOUT.ORDER_AHEAD;
    const val = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol).getValue();
    const num = Number(val);
    if (val !== '' && !isNaN(num) && num > 0) days = num;
  }
  __orderAheadDaysCache = days;
  return days;
}

/**
 * The address in Config's "📧 Admin Notifications" section, or '' when
 * blank — in which case notifyAdmin() silently does nothing, so leaving it
 * empty is a perfectly valid way to turn notifications off.
 */
function getAdminNotificationEmail() {
  if (__adminNotificationEmailCache !== null) return __adminNotificationEmailCache;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
  let email = '';
  if (sheet) {
    const section = CONFIG_LAYOUT.ADMIN_NOTIFICATIONS;
    email = String(sheet.getRange(CONFIG_DATA_START_ROW, section.startCol).getValue() || '').trim();
  }
  __adminNotificationEmailCache = email;
  return email;
}

/**
 * Sends one admin email, if an address is configured. Never throws — a
 * failed notification must not take down the sync that triggered it.
 */
function notifyAdmin(subject, body) {
  const email = getAdminNotificationEmail();
  if (!email) return false;
  try {
    MailApp.sendEmail(email, subject, body);
    log(`Sent admin notification to ${email}: ${subject}`);
    return true;
  } catch (err) {
    log(`⚠️ Could not send admin notification to "${email}" (${err}).`);
    return false;
  }
}

/**
 * Per-run collector for things an admin should hear about. Sections are
 * only included in the digest if something was actually added to them, and
 * NO email is sent at all when the whole thing is empty — a quiet sync
 * stays quiet, which is the only way a notification like this stays worth
 * reading.
 */
let __adminDigest = null;

function noteForAdmin(category, message) {
  if (!__adminDigest) __adminDigest = {};
  if (!__adminDigest[category]) __adminDigest[category] = [];
  __adminDigest[category].push(message);
}

/** Sends the accumulated digest (if any) and resets the collector. */
function flushAdminDigest(context) {
  const digest = __adminDigest;
  __adminDigest = null;
  if (!digest) return false;

  const categories = Object.keys(digest).filter(c => digest[c].length > 0);
  if (categories.length === 0) return false;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lines = [];
  categories.forEach(category => {
    lines.push(`${category} (${digest[category].length}):`);
    digest[category].forEach(m => lines.push(`  • ${m}`));
    lines.push('');
  });
  if (ss) lines.push(`Workbook: ${ss.getUrl()}`);

  const total = categories.reduce((sum, c) => sum + digest[c].length, 0);
  return notifyAdmin(`[Calendar & Form Manager] ${context}: ${total} item(s) need attention`, lines.join('\n'));
}

function computeOrderAheadFlag(eventDate, submittedAt, orderAheadDays) {
  if (!eventDate || !submittedAt || !orderAheadDays) return '';
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysNotice = Math.floor((eventDate - submittedAt) / msPerDay);
  if (daysNotice < 0) return '⚠️ Registered after the event date';
  if (daysNotice < orderAheadDays) return `⚠️ Only ${daysNotice}d notice (need ${orderAheadDays}d)`;
  return '';
}


// ============================================================================
// 3. MENU & TRIGGER HOOKS
// ============================================================================

/**
 * Deliberately small: the three things anyone needs day to day, plus
 * Resize All Sheets, which is safe to click at any time (it only touches
 * column widths — no data, no formatting, no forms), plus the first-run
 * import. The setup entry points — initSheet() (rebuild every tab +
 * formatting) and initializeAndSyncAll() — are still here and still work;
 * they're just run from the Apps Script editor now rather than sitting in a
 * menu where a mis-click reformats the whole workbook.
 *
 * "Import Everything (First Run)" is in the menu because it's the one thing
 * a new workbook genuinely needs and the one thing Sync Cal cannot do in a
 * single execution on a busy calendar — see section 4b.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🗓️ Calendar & Form Manager')
    .addItem('Sync Cal', 'syncCalendars')
    .addItem('Sync Registrations', 'syncRegistrations')
    .addItem('Check Triggers', 'writeTriggers')
    .addSeparator()
    .addItem('Import Everything (First Run)', BOOTSTRAP_ENTRY_NAME)
    .addItem('Resize All Sheets', 'resizeAllSheets')
    .addToUi();
}

/**
 * Full setup from nothing. The calendar half runs as a sliced bootstrap
 * rather than a single syncCalendars(), because on a real calendar the first
 * import is far too much work for one execution — see section 4b.
 * bootstrapCalendars() returns as soon as its first slice is done and
 * finishes itself in the background, restoring every trigger (including the
 * hourly registration sync, which then imports any existing responses).
 */
function initializeAndSyncAll() {
  initSheet();
  bootstrapCalendars();
  log('initializeAndSyncAll: setup done; the calendar import continues in the background.');
}

/**
 * Ensures the triggers this project depends on exist, WITH NO DUPLICATES —
 *  - Two time-driven triggers (daily calendar sync, hourly registration sync)
 *  - One calendar-update trigger per calendar in CALENDAR_MAP, so an edit
 *    made directly on a calendar kicks off onCalendarChange() (which now
 *    does a cheap incremental check before deciding whether a full
 *    syncCalendars() is actually warranted — see section 3b).
 *
 * A FULL RESET, not an add-if-missing: every trigger for a handler this
 * project manages is deleted first, then exactly the intended set is
 * created. See resetTriggersForHandler(). This is what makes it safe to
 * press "Check Triggers" as often as you like — it can never leave two
 * copies of the same trigger both firing, however many were sitting there
 * before, and whatever left them there.
 *
 * THE ONE THING THIS CANNOT FIX: Apps Script installable triggers are
 * private to the Google account that created them — ScriptApp.getProjectTriggers()
 * only ever returns the triggers the CURRENTLY RUNNING account can see, never
 * another account's. If two different people have each run "Check Triggers"
 * / initSheet() / Import Everything on this project from their own Google
 * logins, each created their OWN calendar-edit triggers, invisible to each
 * other — so both fire on every calendar edit, independently, forever,
 * and no run of this function (from either account) can see or remove the
 * other's copies. That is what actually caused the extra calendar triggers
 * this comment is here because of.
 *   FIX: only ever run setup/trigger functions (this one, initSheet(),
 *   bootstrapCalendars(), the "Check Triggers"/"Import Everything" menu
 *   items) from ONE Google account — ideally whichever one owns the
 *   spreadsheet. To find and remove another account's leftover triggers,
 *   open the Apps Script editor's Triggers page (clock icon in the left
 *   sidebar) — unlike the API, that page lists every trigger on the
 *   project regardless of which account created it, with a "Created by"
 *   column, and anyone with edit access can delete from there.
 *
 * DECLINES while a bootstrap import is in flight, because that import
 * deliberately took these triggers down (see pauseAutomationForBootstrap()).
 * This is the guard that matters: the pause is only as good as the places
 * that can undo it, and "Check Triggers" — pressed by someone watching a long
 * import and wondering why nothing is scheduled — is exactly the reflex that
 * would put a hundred queued calendar edits back in play mid-run. Only
 * finishBootstrap() passes force, restoring everything when the import is
 * genuinely done.
 */
function writeTriggers(force) {
  if (!force && isBootstrapActive()) {
    const message = `Triggers stay paused until the large-setup import finishes — it restores them itself.`;
    log(`writeTriggers: ${message}`);
    toastIfPossible(message);
    return;
  }

  let removed = 0;
  removed += resetTriggersForHandler('syncCalendars', () =>
    ScriptApp.newTrigger('syncCalendars').timeBased().everyDays(1).atHour(5).create());
  removed += resetTriggersForHandler('syncRegistrations', () =>
    ScriptApp.newTrigger('syncRegistrations').timeBased().everyHours(1).create());

  const calendarResult = writeCalendarChangeTriggers(true); // the bootstrap check above already ran
  removed += calendarResult.removed;

  const message = removed > 0
    ? `Triggers rebuilt ✅ (cleared ${removed} duplicate/stale one(s) under this account — see the log if more keep appearing)`
    : `All triggers verified — 1 daily, 1 hourly, ${calendarResult.created} calendar-edit ✅`;
  toastIfPossible(message); // also called from a trigger run, where there's no UI
  log(`writeTriggers complete: ${message}`);
}

/**
 * Deletes every trigger for `handlerName` visible to this account, then
 * calls `create` to install the replacement.
 *
 * Returns the number of EXCESS triggers found — existing.length minus the
 * one this handler is meant to have, floored at 0. Every normal run removes
 * exactly one (the trigger being replaced) and that's not worth reporting;
 * this return value is what lets writeTriggers() tell "routine rebuild" from
 * "there were actually duplicates" apart in its summary.
 */
function resetTriggersForHandler(handlerName, create) {
  const existing = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === handlerName);
  existing.forEach(t => ScriptApp.deleteTrigger(t));
  const excess = Math.max(existing.length - 1, 0);
  if (excess > 0) {
    log(`⚠️ Found ${existing.length} "${handlerName}" triggers (expected at most 1) — removed all of them before rebuilding.`);
  }
  create();
  return excess;
}

/**
 * Same reset as resetTriggersForHandler(), but for the one handler with
 * MULTIPLE expected triggers (one per calendar) — so "how many did we
 * expect" has to be compared after creating, not before. `removed` in the
 * result is the EXCESS over that expected count (see resetTriggersForHandler()
 * for why routine replacement doesn't count).
 */
function writeCalendarChangeTriggers(force) {
  if (!force && isBootstrapActive()) {
    log('writeCalendarChangeTriggers: skipped — a large-setup import has these paused on purpose.');
    return { removed: 0, created: 0 };
  }

  const existing = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'onCalendarChange');
  existing.forEach(t => ScriptApp.deleteTrigger(t));
  const expected = Object.keys(CALENDAR_MAP).length;
  const excess = Math.max(existing.length - expected, 0);
  if (excess > 0) {
    log(`⚠️ Found ${existing.length} calendar-edit triggers (expected ${expected}, one per location) — removed all of them before rebuilding.`);
  }

  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    ScriptApp.newTrigger('onCalendarChange').forUserCalendar(calendarId).onEventUpdated().create();
    log(`Created calendar-edit trigger for "${CALENDAR_MAP[calendarId]}".`);
  });
  return { removed: excess, created: expected };
}

/**
 * Removes every onCalendarChange trigger. The FULL syncCalendarsInternal()
 * still calls this before it edits calendar descriptions
 * (backInjectCalendarDescriptions), and rebuilds the triggers again in a
 * `finally` block regardless of success/failure — so a full sync's own
 * description edits can never re-fire these triggers and loop. The cheap
 * incremental delta-check in section 3b does NOT edit calendar events, so
 * it's safe to run even while these triggers are active.
 */
function removeCalendarChangeTriggers() {
  const triggers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'onCalendarChange');
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  if (triggers.length > 0) {
    log(`Removed ${triggers.length} calendar-edit trigger(s) for the duration of this sync.`);
  }
  return triggers.length;
}

/**
 * Dispatches to a per-sheet handler for tabs that carry a Manual_Override
 * column (Registrants, Lunch Dashboard) plus the Lunch_Schedule edit hook.
 * Master_Program_Dashboard's session table no longer has a Manual_Override
 * column at all (see HEADERS.Master_Program_Dashboard), so there's nothing
 * to auto-flip there anymore.
 */
function onEdit(e) {
  try {
    const sheet = e.range.getSheet();
    const name = sheet.getName();
    if (name === SHEET_NAMES.LUNCH_EVENT_REGISTRANTS) {
      handleRegistrantsEdit(e, sheet);
    } else if (name === SHEET_NAMES.LUNCH_DASHBOARD) {
      handleLunchDashboardEdit(e, sheet);
    } else if (name === SHEET_NAMES.LUNCH_SCHEDULE) {
      handleLunchScheduleEdit(e, sheet);
    }
  } catch (err) {
    log(`onEdit error: ${err}`);
  }
}

/**
 * A 0-based { headerName: index } map read off the table's OWN header row,
 * falling back to the canonical array when the sheet's row can't supply one.
 *
 * An onEdit handler has to trust the sheet, not the constant: right after a
 * HEADERS layout changes, the tab still holds the previous order until its
 * next render, and a map built from the constant would flip Manual_Override
 * on top of whatever column now sits at that index.
 */
function getLiveHeaderMap(sheet, headerRow, headers) {
  const sheetMap = getHeaderMapAt(sheet, headerRow);
  const map = {};
  headers.forEach(h => { if (sheetMap[h]) map[h] = sheetMap[h] - 1; });
  return map['Manual_Override'] === undefined ? getIndexMap(headers) : map;
}

/**
 * Shared auto-flip: given a { headerName: 0-based index } map for whatever
 * table the edit landed in, flips that row's Manual_Override to "Manually
 * Edited" — unless the edit WAS to Manual_Override or Event_ID themselves.
 */
function autoFlipManualOverride(sheet, headerMap0Based, editedRow, editedCol1Based) {
  const overrideCol = headerMap0Based['Manual_Override'];
  if (overrideCol === undefined) return;
  const overrideCol1Based = overrideCol + 1;
  if (editedCol1Based === overrideCol1Based) return;
  const eventIdCol = headerMap0Based['Event_ID'];
  if (eventIdCol !== undefined && editedCol1Based === eventIdCol + 1) return;

  const cell = sheet.getRange(editedRow, overrideCol1Based);
  const current = String(cell.getValue()).trim();
  if (current === 'Auto-Synced' || current === '') {
    cell.setValue('Manually Edited');
  }
}

/** Lunch_and_Event_Registrants: auto-flip on any hand-edit within a data zone, plus status-change toasts. */
function handleRegistrantsEdit(e, sheet) {
  const zones = getSectionZones(sheet, 'Event_ID');
  const editedRow = e.range.getRow();
  const zone = findZoneForRow(zones, editedRow);
  if (!zone) return;

  const headerMap = getLiveHeaderMap(sheet, zone.headerRow, HEADERS.Lunch_and_Event_Registrants);
  const editedCol = e.range.getColumn();
  autoFlipManualOverride(sheet, headerMap, editedRow, editedCol);

  if (typeof e.value === 'undefined') return; // multi-cell paste, skip toast logic

  const isProgramStatusCol = editedCol === headerMap['Program_Status'] + 1;
  const isLunchStatusCol = editedCol === headerMap['Lunch_Status'] + 1;

  if ((isProgramStatusCol || isLunchStatusCol) && e.value === 'Cancelled') {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      '⚠️ Alert: Registration cancelled! Please verify if this changes your catering order numbers.',
      'Calendar & Form Manager', 6
    );
  }

  if (isProgramStatusCol && e.oldValue === 'Waitlisted' && e.value === 'Active') {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      "🚀 Promotion detected! Remember to update their Lunch Status from 'Waitlisted' to 'Needed' if they require a meal.",
      'Calendar & Form Manager', 6
    );
  }
}

/** Master_Lunch_Dashboard: only the Full Schedule table (Upcoming/Past zones, marker 'Standard_Buffer') is real, editable data. */
function handleLunchDashboardEdit(e, sheet) {
  const zones = getSectionZones(sheet, 'Standard_Buffer');
  const editedRow = e.range.getRow();
  const zone = findZoneForRow(zones, editedRow);
  if (!zone) return;

  const headerMap = getLiveHeaderMap(sheet, zone.headerRow, HEADERS.Master_Lunch_Dashboard);
  autoFlipManualOverride(sheet, headerMap, editedRow, e.range.getColumn());
}


// ============================================================================
// 3b. CALENDAR INCREMENTAL SYNC  (onCalendarChange -> Calendar.Events.list)
// ============================================================================
//
// Requires the "Calendar" Advanced Service (Editor -> Services -> + Calendar
// API). The standard EventUpdated trigger payload doesn't say WHICH event
// changed, so instead of re-scanning the whole calendar on every edit, this
// keeps a per-calendar syncToken (Script Properties) and asks the Calendar
// API for only what changed since the last check. If that delta contains
// something we actually care about (a new/modified/cancelled TIMED event,
// matching our title pattern, inside the tracked lookahead window), it
// hands off to the existing, fully-tested syncCalendars() reconciliation
// pass — re-implementing that whole pipeline (grouping, form reuse,
// capacity/waitlist recompute, triage) per single delta event would
// duplicate a lot of carefully-tested logic for very little benefit; the
// real win of incremental sync here is that an edit that ISN'T relevant to
// us (an all-day reminder, a change far outside our window) now costs one
// cheap Events.list call instead of a full multi-calendar scan + form sync.
// ============================================================================

const CALENDAR_SYNC_TOKEN_PROP_PREFIX = 'CALENDAR_SYNC_TOKEN_';
/** Baseline lookback for a calendar's very first (no-token) incremental sync call. */
const CALENDAR_SYNC_TOKEN_TIMEMIN_DAYS_BACK = 1;

function getCalendarSyncTokenPropKey(calendarId) {
  return `${CALENDAR_SYNC_TOKEN_PROP_PREFIX}${calendarId}`;
}

function saveCalendarSyncToken(calendarId, token) {
  const props = PropertiesService.getScriptProperties();
  const key = getCalendarSyncTokenPropKey(calendarId);
  if (token) props.setProperty(key, token);
  else props.deleteProperty(key);
}

/**
 * Fired by the calendar-edit triggers installed in writeCalendarChangeTriggers().
 */
function onCalendarChange(e) {
  // FIRST LINE, before anything else costs a call: a bootstrap import deletes
  // these triggers, but a firing can still arrive afterwards — Google's
  // notification channel for a calendar is torn down asynchronously, and the
  // import is generating hundreds of changes for it to deliver. Deletion
  // stops NEW subscriptions; it does not recall what is already in flight.
  //
  // So the handler treats being called during an import as normal and makes
  // it free: one log line, no delta call, no lock, no sheet read. If these
  // keep appearing long after an import ends, the triggers are being
  // re-created rather than drained — logProjectTriggers() tells you which.
  if (isBootstrapActive()) {
    log('onCalendarChange ignored — a large-setup import is running and is editing these events itself.');
    return;
  }

  const calendarId = e && e.calendarId;
  if (!calendarId) {
    log('onCalendarChange fired with no calendarId on the event object — falling back to a full syncCalendars().');
    syncCalendars();
    return;
  }
  log(`onCalendarChange fired (calendarId: ${calendarId}) — running an incremental delta check.`);
  processCalendarDeltaForCalendar(calendarId);
}

function processCalendarDeltaForCalendar(calendarId) {
  if (isBootstrapActive()) {
    log(`processCalendarDeltaForCalendar: a large-setup import is in progress — skipping (it is editing these events itself).`);
    return;
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    log('processCalendarDeltaForCalendar: another sync is already running — skipping this run.');
    return;
  }
  let releasedEarly = false;
  try {
    const result = fetchCalendarDelta(calendarId);
    if (result.fullSyncRequired) {
      log(`Sync token for "${CALENDAR_MAP[calendarId] || calendarId}" was invalid/expired or the API call failed — falling back to a full syncCalendars().`);
      releasedEarly = true;
      lock.releaseLock();
      syncCalendars(); // acquires its own lock
      return;
    }
    if (result.changedEvents.length === 0) {
      log(`No calendar changes for "${CALENDAR_MAP[calendarId] || calendarId}" since the last check.`);
      return;
    }
    applyCalendarDeltaToSheets(calendarId, result.changedEvents);
  } finally {
    if (!releasedEarly) lock.releaseLock();
  }
}

/**
 * Pulls just the events that changed on `calendarId` since the last call,
 * using the Calendar API's incremental sync-token pattern. On the very
 * first call for a calendar (no stored token yet), this instead does a
 * bounded baseline fetch purely to obtain a starting nextSyncToken — it
 * does NOT try to reconcile historical events that way (the daily full
 * syncCalendars() scan, and the menu, already handle that).
 */
function fetchCalendarDelta(calendarId) {
  const tokenKey = getCalendarSyncTokenPropKey(calendarId);
  const props = PropertiesService.getScriptProperties();
  const syncToken = props.getProperty(tokenKey);

  const options = { showDeleted: true, singleEvents: true, maxResults: 250 };
  if (syncToken) {
    options.syncToken = syncToken;
  } else {
    const timeMin = new Date();
    timeMin.setDate(timeMin.getDate() - CALENDAR_SYNC_TOKEN_TIMEMIN_DAYS_BACK);
    options.timeMin = timeMin.toISOString();
  }

  const changedEvents = [];
  let pageToken = null;
  let nextSyncToken = null;

  try {
    do {
      if (pageToken) options.pageToken = pageToken; else delete options.pageToken;
      // Requires the "Calendar" Advanced Service to be enabled for this
      // project (Editor -> Services -> + Calendar API).
      const eventList = Calendar.Events.list(calendarId, options);
      (eventList.items || []).forEach(ev => changedEvents.push(ev));
      pageToken = eventList.nextPageToken;
      if (eventList.nextSyncToken) nextSyncToken = eventList.nextSyncToken;
    } while (pageToken);
  } catch (err) {
    const msg = String((err && err.message) || err);
    const isExpiredToken = msg.indexOf('410') !== -1 || /sync ?token/i.test(msg);
    if (isExpiredToken) {
      log(`⚠️ Calendar sync token for ${calendarId} expired/invalid (${err}) — clearing it so the next check re-baselines.`);
      saveCalendarSyncToken(calendarId, null);
    } else {
      log(`⚠️ Calendar.Events.list failed for ${calendarId} (${err}).`);
    }
    return { fullSyncRequired: true, changedEvents: [] };
  }

  if (nextSyncToken) saveCalendarSyncToken(calendarId, nextSyncToken);

  if (!syncToken) {
    log(`Established an initial Calendar sync token for "${CALENDAR_MAP[calendarId] || calendarId}" — no deltas processed on this baseline call.`);
    return { fullSyncRequired: false, changedEvents: [] };
  }

  return { fullSyncRequired: false, changedEvents };
}

/**
 * Advances every calendar's sync token past changes THIS SCRIPT just made,
 * without acting on them. Call it after anything that edits calendar events,
 * immediately before the calendar-edit triggers go back on.
 *
 * Removing the triggers during a sync only stops them FIRING; it does not
 * stop the changes accumulating. Re-creating them afterwards therefore hands
 * onCalendarChange() a backlog of our own description writes — one per event
 * — every one of which reads as "relevant" and escalates to a full
 * syncCalendars(). One import of 272 events becomes a queue of full syncs,
 * each re-reading every calendar and re-rendering every tab. That storm is
 * what this prevents.
 *
 * The trade-off is deliberate: a genuine third-party edit made in the same
 * window is drained too, and waits for the next scheduled full sync (hourly
 * for registrations, daily for calendars) instead of being reacted to
 * immediately. Losing a few minutes of reaction time beats a self-sustaining
 * sync loop.
 */
function primeCalendarSyncTokens(reason) {
  let primed = 0;
  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    try {
      const result = fetchCalendarDelta(calendarId);
      if (result.fullSyncRequired) {
        log(`ℹ️ Could not prime the sync token for "${CALENDAR_MAP[calendarId]}" — its next delta check will re-baseline.`);
        return;
      }
      primed++;
    } catch (err) {
      // Typically the Calendar Advanced Service not being enabled. Nothing
      // here is load-bearing enough to fail a sync over.
      log(`ℹ️ Could not prime the sync token for "${CALENDAR_MAP[calendarId]}" (${err}).`);
    }
  });
  if (primed > 0) log(`Primed ${primed} calendar sync token(s) past this ${reason}'s own edits.`);
  return primed;
}

function isRawEventAllDay(ev) {
  return !!(ev.start && ev.start.date && !ev.start.dateTime);
}

function getRawEventStart(ev) {
  if (!ev.start) return null;
  if (ev.start.dateTime) return new Date(ev.start.dateTime);
  if (ev.start.date) return new Date(ev.start.date);
  return null;
}

/**
 * Decides whether the delta contains anything worth reconciling. A
 * cancelled (event.status === 'cancelled') event always counts as
 * potentially relevant, since a tracked session may have just been
 * deleted. An active event counts if it's a timed event, inside our
 * tracked lookahead window, and matches our title pattern.
 *
 * A still-tentative event ("*" title) is NOT relevant — the full sync
 * would skip it anyway. Note this still catches CONFIRMATION correctly:
 * dropping the asterisk makes the delta's new title non-tentative, which
 * reads as relevant here and triggers the sync that builds its form.
 */
function applyCalendarDeltaToSheets(calendarId, changedEvents) {
  const { start, end } = computeSyncDateRange();
  const locationName = CALENDAR_MAP[calendarId] || calendarId;

  const relevant = changedEvents.some(ev => {
    if (isRawEventAllDay(ev)) return false;
    const evStart = getRawEventStart(ev);
    if (!evStart || evStart < start || evStart > end) return false;
    if (ev.status === 'cancelled') return true;
    const parsed = parseEventTitle(ev.summary);
    return !!parsed && !parsed.isTentative;
  });

  if (!relevant) {
    log(`Calendar delta for "${locationName}" contained ${changedEvents.length} change(s), none relevant to tracked sessions — skipping a full sync.`);
    return;
  }

  log(`Calendar delta for "${locationName}" contained a relevant change — running a full syncCalendars() to reconcile.`);
  invalidateCalendarEventsCache(); // the delta just told us the event set moved
  syncCalendars();
}


// ============================================================================
// 4. CALENDAR SYNC & FORM GENERATION  (syncCalendars)
// ============================================================================

function computeSyncDateRange() {
  const today = new Date();
  const target = new Date(today);
  target.setDate(target.getDate() + SYNC_LOOKAHEAD_DAYS);

  const start = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0);
  const end = new Date(target.getFullYear(), target.getMonth() + 1, 0, 23, 59, 59);
  return { start, end };
}

/** A leading "*" on the title marks an event TENTATIVE — see parseEventTitle(). */
const TENTATIVE_TITLE_PREFIX = '*';

/** Every bracketed group in a string: "[Cap: 12] [Fixed]" and "[Cap: 12, Fixed]" both work. */
const BRACKET_GROUP_REGEX = /\[([^\]]*)\]/g;

/**
 * Pulls the settings this system understands out of any bracketed groups
 * in a blob of text:
 *   [Cap: 12]          -> capacity 12
 *   [Fixed]            -> one continuous series rather than month buckets
 *   [Cap: 12, Fixed]   -> both, one bracket
 * Unrecognized bracket contents are ignored, so people can bracket other
 * notes in a description without confusing anything.
 */
function parseSettingsBrackets(text) {
  const raw = String(text || '');
  let capacity = 0;
  let isFixed = false;
  let sawAny = false;

  BRACKET_GROUP_REGEX.lastIndex = 0; // the /g regex is module-level; never trust its cursor
  let match;
  while ((match = BRACKET_GROUP_REGEX.exec(raw)) !== null) {
    const content = match[1] || '';
    const capMatch = /Cap:\s*(\d+)/i.exec(content);
    if (capMatch) { capacity = parseInt(capMatch[1], 10); sawAny = true; }
    if (/\bFixed\b/i.test(content)) { isFixed = true; sawAny = true; }
  }
  return { capacity, isFixed, sawAny };
}

/**
 * Parses event titles. The title is now just the program name, optionally
 * prefixed with "*":
 *   "Yoga Basics"    -> a program
 *   "*Yoga Basics"   -> the same program, TENTATIVE (see below)
 *
 * BOTH capacity and Fixed-vs-Regular now live in the event DESCRIPTION —
 * see parseSettingsBrackets() / resolveEventSettings(). The title is what
 * attendees read on a shared calendar, and "[Cap: 12, Fixed]" there is
 * internal scheduling jargon. Brackets left in a title are still read as a
 * legacy fallback (and logged) so existing calendars don't silently lose
 * their capacity, but they're stripped from cleanTitle either way.
 *
 * A title beginning with "*" marks the event TENTATIVE: it is skipped
 * entirely by the form/registry pipeline until the asterisk is removed
 * (see syncCalendarsInternal()). The asterisk is stripped from cleanTitle,
 * which matters a lot — computeEventId() keys off cleanTitle, so an event's
 * ID is IDENTICAL before and after it is confirmed. Un-asterisking is
 * therefore just "a new event appears," with no ID churn.
 */
function parseEventTitle(title) {
  let raw = String(title || '').trim();
  if (!raw) return null;

  let isTentative = false;
  while (raw.charAt(0) === TENTATIVE_TITLE_PREFIX) {
    isTentative = true;
    raw = raw.substring(1).trim();
  }
  if (!raw) return null;

  const legacy = parseSettingsBrackets(raw);
  // Strip every bracketed group, wherever it sits, so the clean title is
  // stable no matter how someone spaced things out.
  const cleanTitle = raw.replace(BRACKET_GROUP_REGEX, ' ').replace(/\s+/g, ' ').trim();
  if (!cleanTitle) return null;

  return {
    cleanTitle,
    isTentative,
    legacyCapacity: legacy.capacity,
    legacyIsFixed: legacy.isFixed,
    hasLegacyBrackets: legacy.sawAny
  };
}

/**
 * Resolves { capacity, isFixed } for one event: the DESCRIPTION's brackets
 * win, and anything the description doesn't specify falls back to legacy
 * brackets left in the title (with a one-time nudge in the log).
 */
function resolveEventSettings(event, parsedTitle) {
  const description = (event && typeof event.getDescription === 'function')
    ? (event.getDescription() || '')
    : '';
  const fromDescription = parseSettingsBrackets(description);

  const capacity = fromDescription.capacity || parsedTitle.legacyCapacity || 0;
  const isFixed = fromDescription.isFixed || parsedTitle.legacyIsFixed || false;

  if (parsedTitle.hasLegacyBrackets && !fromDescription.sawAny) {
    log(`ℹ️ "${parsedTitle.cleanTitle}" still carries its settings in the TITLE. That still works, but the supported ` +
      `place is now the event DESCRIPTION — move "[Cap: N]" / "[Fixed]" there and drop them from the title.`);
  }
  return { capacity, isFixed };
}

/** Public entry point: acquires a script lock so overlapping executions can't race each other. */
function syncCalendars() {
  if (isBootstrapActive()) {
    log(`syncCalendars: a large-setup import (${BOOTSTRAP_ENTRY_NAME}()) is in progress — skipping this run so the two don't fight over the same forms.`);
    return;
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    log('syncCalendars: another sync is already running — skipping this run.');
    return;
  }
  try {
    syncCalendarsInternal();
  } finally {
    lock.releaseLock();
  }
}

function syncCalendarsInternal() {
  removeCalendarChangeTriggers();
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const registrySheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);

    if (findProgramSessionHeaderRows(registrySheet).length === 0) {
      renderProgramDashboard();
    }

    const summary = importCalendarGroups(registrySheet);
    renderProgramDashboard();

    SpreadsheetApp.getActiveSpreadsheet().toast(
      `Calendar sync complete ✅ (${describeImportSummary(summary)})`, 'Calendar & Form Manager', 5);
  } finally {
    flushPersistentRegistries(); // never strand a form-label fingerprint written during this run
    flushAdminDigest('Calendar sync');
    // Order matters: swallow our own description edits BEFORE the triggers
    // that would otherwise react to them come back on.
    primeCalendarSyncTokens('sync');
    writeCalendarChangeTriggers();
  }
}

/**
 * THE calendar->registry import, shared by syncCalendarsInternal() and the
 * batched bootstrapCalendars(). Walks every group that has dates not already
 * on the session table, gives each one a form (new, reused, or recovered from
 * an event description), writes its rows, and stamps the registration link
 * back onto its calendar events.
 *
 * options.deadline — epoch ms. Checked BETWEEN groups: the loop stops cleanly
 *   the moment it can no longer be confident a whole group fits in what's
 *   left of the execution. A group is the unit of work because its rows, its
 *   form and its calendar-description edits have to land together; stopping
 *   mid-group would leave a form with no rows pointing at it.
 * options.onGroupDone — called after each processed group, for progress logs.
 *
 * Returns a summary including `remaining` (groups still needing work when the
 * deadline hit) and `outOfTime`.
 */
function importCalendarGroups(registrySheet, options) {
  options = options || {};
  const { start, end } = computeSyncDateRange();
  log(`Calendar import window: ${start} -> ${end}`);

  const existingState = getExistingRegistryState(registrySheet);
  const eventsByCalendar = getCalendarEventsForWindow(start, end);
  const work = collectCalendarWork(eventsByCalendar, existingState);

  const summary = {
    groupsTotal: work.length, groupsProcessed: 0, groupsFailed: 0,
    formsCreated: 0, formsReused: 0, eventsAdded: 0, remaining: 0, outOfTime: false
  };

  for (let i = 0; i < work.length; i++) {
    if (options.deadline && Date.now() >= options.deadline) {
      summary.outOfTime = true;
      summary.remaining = work.length - i;
      log(`Out of time for this run — ${summary.remaining} group(s) left to import.`);
      break;
    }

    const item = work[i];
    try {
      const result = processCalendarGroup(registrySheet, item, existingState);
      summary.groupsProcessed++;
      summary.eventsAdded += result.eventsAdded;
      if (result.formCreated) summary.formsCreated++; else summary.formsReused++;
    } catch (err) {
      // One bad group must not cost the whole run — especially mid-bootstrap,
      // where everything after it would be stranded too.
      summary.groupsFailed++;
      log(`⚠️ Could not import "${item.group.groupKey}" (${err}) — continuing with the rest.`);
      noteForAdmin('Programs that could not be imported',
        `${item.group.cleanTitle} (${item.locationName}) — ${err}`);
    }
    if (options.onGroupDone) options.onGroupDone(summary);
  }

  flushPersistentRegistries(); // one write covering every group touched above
  return summary;
}

/** Human-readable one-liner for a toast/log line. */
function describeImportSummary(summary) {
  const parts = [`${summary.groupsProcessed} program group(s)`, `${summary.eventsAdded} new date(s)`];
  if (summary.formsCreated > 0) parts.push(`${summary.formsCreated} new form(s)`);
  if (summary.formsReused > 0) parts.push(`${summary.formsReused} existing form(s) reused`);
  if (summary.groupsFailed > 0) parts.push(`${summary.groupsFailed} failed`);
  return parts.join(', ');
}

/**
 * Turns the raw calendar fetch into an ordered list of units of work —
 * `{ group, locationName, configInfo, newEvents }` — skipping groups whose
 * dates are all already on the session table. Pure in-memory work: no form,
 * sheet or calendar writes happen here, so a caller can safely build the
 * whole list up front and then process as much of it as it has time for.
 */
function collectCalendarWork(eventsByCalendar, existingState) {
  const work = [];

  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    const locationName = CALENDAR_MAP[calendarId];
    const events = eventsByCalendar[calendarId];
    if (!events) {
      log(`⚠️ Calendar not found or inaccessible: ${calendarId}`);
      return;
    }

    const tentativeTitles = new Set();
    const parsedEvents = events
      .filter(ev => !ev.isAllDayEvent())
      .map(ev => {
        const parsed = parseEventTitle(ev.getTitle());
        if (!parsed) return null;
        // Tentative events are skipped WHOLESALE — no form, no registry
        // row — until the leading "*" comes off. Because parseEventTitle()
        // strips the asterisk from cleanTitle, confirming an event later
        // produces the exact same Event_ID, so it simply flows through as
        // a brand-new session with no reconciliation needed.
        if (parsed.isTentative) {
          tentativeTitles.add(parsed.cleanTitle);
          return null;
        }
        const settings = resolveEventSettings(ev, parsed);
        parsed.capacity = settings.capacity;
        parsed.isFixed = settings.isFixed;
        return { ev, parsed };
      })
      .filter(Boolean);

    if (tentativeTitles.size > 0) {
      log(`Skipped ${tentativeTitles.size} tentative program(s) at ${locationName} (title starts with "*"): ` +
        `${Array.from(tentativeTitles).join(', ')}. Remove the asterisk to generate forms.`);
    }

    const configInfo = { footerNote: getFormFooterForLocation(locationName) };

    buildEventGroups(parsedEvents, calendarId).forEach(group => {
      const newEvents = group.events.filter(ev => {
        const eventId = computeEventId(calendarId, group.cleanTitle, formatDateKey(ev.getStartTime()));
        return !existingState.eventIds.has(eventId);
      });
      if (newEvents.length === 0) {
        log(`No new dates for "${group.groupKey}" — already up to date, skipping.`);
        return;
      }
      work.push({ group, locationName, configInfo, newEvents });
    });
  });

  return work;
}

/**
 * One unit of work: resolve the group's form, write its new session rows, and
 * put the registration link on its calendar events. Returns
 * { formCreated, eventsAdded }.
 */
function processCalendarGroup(registrySheet, item, existingState) {
  const { group, locationName, configInfo, newEvents } = item;

  let existingFormId = existingState.groupFormMap[group.groupKey];
  if (!existingFormId) {
    existingFormId = findExistingFormIdFromEvents(group.events);
    if (existingFormId) {
      log(`Recovered existing form ${existingFormId} for "${group.groupKey}" from a calendar event description.`);
    }
  }

  let formInfo;
  let formCreated = false;
  if (existingFormId) {
    try {
      formInfo = refreshFormForNewDates(existingFormId, group, locationName, configInfo);
      log(`Reused existing form for "${group.groupKey}"; added ${newEvents.length} new date(s).`);
    } catch (err) {
      log(`⚠️ Could not reopen existing form ${existingFormId} for "${group.groupKey}" (${err}) — creating a replacement form.`);
      formInfo = createRegistrationForm(group, locationName, configInfo);
      formCreated = true;
    }
  } else {
    formInfo = createRegistrationForm(group, locationName, configInfo);
    formCreated = true;
    log(`Created new form for "${group.groupKey}" with ${newEvents.length} date(s).`);
  }
  savePersistentFormRegistryEntry(group.groupKey, formInfo.formId);
  // Flushed HERE, not at the end of the run: between creating a form and
  // writing its rows there is a window where nothing durable points at it,
  // and an execution killed in that window would create a second form for
  // this group on the next attempt. One property write per new group is a
  // cheap price for that never happening. (Everything after this point is
  // itself durable — the rows carry Form_ID, and so does the event
  // description.)
  flushPersistentRegistries();

  const newEventsGroup = Object.assign({}, group, { events: newEvents });
  writeEventRegistryRows(registrySheet, newEventsGroup, locationName, formInfo);

  backInjectCalendarDescriptions(group, formInfo);

  // Keep the in-memory state honest for the rest of THIS run: these dates now
  // exist, and this group now has a form.
  newEvents.forEach(ev => existingState.eventIds.add(
    computeEventId(group.calendarId, group.cleanTitle, formatDateKey(ev.getStartTime()))));
  existingState.groupFormMap[group.groupKey] = formInfo.formId;

  return { formCreated, eventsAdded: newEvents.length };
}

/** Groups parsed calendar events into Fixed-series or monthly-chunk buckets. */
function buildEventGroups(parsedEvents, calendarId) {
  const groups = {};

  parsedEvents.forEach(({ ev, parsed }) => {
    const startTime = ev.getStartTime();
    const monthLabel = getMonthLabel(startTime);
    const typeTag = parsed.isFixed ? 'Fixed' : 'Regular';

    const key = parsed.isFixed
      ? `${calendarId}::${parsed.cleanTitle}::FIXED`
      : `${calendarId}::${parsed.cleanTitle}::${monthLabel}`;

    if (!groups[key]) {
      groups[key] = {
        groupKey: key,
        calendarId,
        cleanTitle: parsed.cleanTitle,
        capacity: parsed.capacity,
        isFixed: parsed.isFixed,
        typeTag,
        monthLabel: parsed.isFixed ? null : monthLabel,
        events: []
      };
    }
    groups[key].events.push(ev);
  });

  return Object.values(groups).map(g => {
    g.events.sort((a, b) => a.getStartTime() - b.getStartTime());
    if (g.isFixed) {
      const first = g.events[0].getStartTime();
      const last = g.events[g.events.length - 1].getStartTime();
      g.seriesWeeks = Math.max(1, Math.round((last - first) / (7 * 24 * 60 * 60 * 1000)) + 1);
    }
    return g;
  });
}

/**
 * Scans the current per-session table (both Upcoming and Past zones) to
 * build eventIds (every Event_ID already recorded) and groupFormMap
 * (groupKey -> Form_ID already generated), falling back to the persistent
 * registry for any group whose session rows aren't currently on the sheet.
 */
function getExistingRegistryState(registrySheet) {
  const state = { eventIds: new Set(), groupFormMap: {} };
  const headers = HEADERS.Master_Program_Dashboard;
  const rows = readAllSectionedRows(registrySheet, headers, 'Event_ID');
  const map = getIndexMap(headers);

  rows.forEach(row => {
    const eventId = row[map['Event_ID']];
    if (eventId) state.eventIds.add(eventId);

    const source = row[map['Calendar_Source']];
    const title = row[map['Clean_Title']];
    const typeTag = row[map['Type_Tag']];
    const formId = row[map['Form_ID']];
    if (!source || !title || !formId) return;

    const d = coerceDate(row[map['Event_Date']]);
    const month = d ? getMonthLabel(d) : '';
    const key = typeTag === 'Fixed' ? `${source}::${title}::FIXED` : `${source}::${title}::${month}`;
    if (!state.groupFormMap[key]) state.groupFormMap[key] = formId;
  });

  const persistent = getPersistentFormRegistry();
  Object.keys(persistent).forEach(key => {
    if (!state.groupFormMap[key]) state.groupFormMap[key] = persistent[key];
  });

  return state;
}


// ============================================================================
// 4b. LARGE-SETUP BOOTSTRAP  (bootstrapCalendars / resumeBootstrapCalendars)
// ============================================================================
//
// WHY THIS EXISTS: a normal syncCalendars() finishes in seconds because it has
// almost nothing to do — every group already has its form and its rows, so it
// skips them. The FIRST import is the opposite: every group is new, and each
// one costs a Drive copy, a dozen-plus Forms calls, a sheet write and one
// calendar-description write PER EVENT. Multiply that by a full 60-day window
// of programs across three calendars and it blows straight through Apps
// Script's six-minute execution limit — which is exactly what happens when
// you run initSheet() and then Sync Cal on a real calendar.
//
// A timeout there is worse than slow. The kill is not an exception, so
// syncCalendarsInternal()'s `finally` never runs: the calendar-edit triggers
// it removed at the start stay removed, the persistent registries never get
// flushed (so the forms it just created are forgotten and DUPLICATED on the
// next attempt), and whatever it managed to write is half-applied.
//
// So the bootstrap works in slices:
//   - Automation is paused up front — the calendar-edit triggers AND the
//     time-driven syncCalendars/syncRegistrations triggers — so nothing else
//     runs while a multi-execution import is in flight. syncCalendars() also
//     refuses to start on its own while the bootstrap is active.
//   - Each slice imports whole groups until its time budget runs out, then
//     hands off to the next slice via a one-off trigger. Progress lives in
//     the SHEET (a group with rows is skipped next time), so a slice never
//     has to trust anything it kept in memory.
//   - The hand-off trigger is armed BEFORE the work starts, timed to fire
//     after this slice's budget. If a slice is killed anyway, the next one
//     still comes. A slice that finishes normally re-arms it for a minute
//     out, so the common case doesn't idle.
//   - The final slice rebuilds every trigger, renders the dashboard once,
//     and clears the state.
// ============================================================================

const BOOTSTRAP_ENTRY_NAME = 'bootstrapCalendars';
const BOOTSTRAP_RESUME_HANDLER = 'resumeBootstrapCalendars';
const BOOTSTRAP_STATE_PROP_KEY = 'BOOTSTRAP_STATE_V1';

/**
 * How long one slice may spend importing before it stops between groups.
 * Apps Script's ceiling is 6 minutes for consumer accounts; the gap is
 * headroom for the group in flight plus the wrap-up (flush, re-arm, log).
 */
const BOOTSTRAP_SLICE_BUDGET_MS = 3.5 * 60 * 1000;
/** Gap before the next slice after a clean hand-off. */
const BOOTSTRAP_RESUME_DELAY_MS = 60 * 1000;
/** Watchdog: armed before a slice starts, so a slice killed by the timeout still gets a successor. */
const BOOTSTRAP_WATCHDOG_DELAY_MS = BOOTSTRAP_SLICE_BUDGET_MS + 2.5 * 60 * 1000;
/** Hard stop, so a bug can never leave the project trading triggers forever. */
const BOOTSTRAP_MAX_SLICES = 30;
/** Consecutive slices allowed to make no progress before giving up. */
const BOOTSTRAP_MAX_STALLED_SLICES = 2;
/**
 * After this long with no slice completing, isBootstrapActive() stops
 * believing the state — otherwise a bootstrap that died in a way that took
 * its watchdog with it would block every normal sync indefinitely.
 */
const BOOTSTRAP_STALE_MS = 2 * 60 * 60 * 1000;

function getBootstrapState() {
  const raw = PropertiesService.getScriptProperties().getProperty(BOOTSTRAP_STATE_PROP_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    log(`⚠️ Bootstrap state was unreadable (${err}) — treating it as finished.`);
    return null;
  }
}

function saveBootstrapState(state) {
  PropertiesService.getScriptProperties().setProperty(BOOTSTRAP_STATE_PROP_KEY, JSON.stringify(state));
}

function clearBootstrapState() {
  PropertiesService.getScriptProperties().deleteProperty(BOOTSTRAP_STATE_PROP_KEY);
}

/** Is a sliced import in flight right now? Stale state (see BOOTSTRAP_STALE_MS) reads as "no". */
function isBootstrapActive() {
  const state = getBootstrapState();
  if (!state) return false;
  const age = Date.now() - (state.lastSliceAt || state.startedAt || 0);
  if (age > BOOTSTRAP_STALE_MS) {
    log(`⚠️ Ignoring a large-setup import that hasn't advanced in ${Math.round(age / 60000)} minute(s) — ` +
      `run ${BOOTSTRAP_ENTRY_NAME}() to restart it, or cancelBootstrapCalendars() to clear it.`);
    return false;
  }
  return true;
}

/**
 * START HERE for a big calendar. Imports every program on every calendar —
 * creating each one's registration form, or adopting the form already linked
 * from its calendar description — across as many executions as it takes,
 * with all automation paused until it's done.
 *
 * Safe to run on an already-populated workbook: groups whose dates are
 * already on the session table are skipped, so this is also the way to
 * recover after a sync that timed out half-finished.
 */
function bootstrapCalendars() {
  if (isBootstrapActive()) {
    const state = getBootstrapState();
    const message = `A large-setup import is already running (slice ${state.slices} of at most ${BOOTSTRAP_MAX_SLICES}) — leaving it alone.`;
    log(message);
    toastIfPossible(message);
    return;
  }

  pauseAutomationForBootstrap();
  saveBootstrapState({
    startedAt: Date.now(), lastSliceAt: Date.now(), slices: 0, stalledSlices: 0,
    lastRemaining: null, groupsProcessed: 0, eventsAdded: 0,
    formsCreated: 0, formsReused: 0, groupsFailed: 0
  });
  log('Large-setup import started: automation paused, importing in slices.');
  toastIfPossible('Large-setup import started — this runs in the background and may take several minutes.');

  runBootstrapSlice();
}

/** Trigger handler for the next slice. Never call this directly — use bootstrapCalendars(). */
function resumeBootstrapCalendars() {
  runBootstrapSlice();
}

/**
 * One execution's worth of importing. Everything that decides whether there
 * is a NEXT slice happens here.
 */
function runBootstrapSlice() {
  const state = getBootstrapState();
  if (!state) {
    // Nothing in flight — a leftover trigger firing after the job finished.
    deleteBootstrapResumeTriggers();
    return;
  }

  // Armed BEFORE anything else, including the lock: from here on every exit
  // path leaves exactly one live successor behind, so neither an outright
  // kill nor a lock we couldn't get can strand the import. finishBootstrap()
  // is what finally clears it.
  armBootstrapResume(BOOTSTRAP_WATCHDOG_DELAY_MS);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    log('Bootstrap slice: another execution holds the lock — the next slice will retry.');
    return;
  }

  try {
    state.slices++;
    state.lastSliceAt = Date.now();
    saveBootstrapState(state);

    // Re-asserted EVERY slice, not just at the start. An import runs for
    // half an hour across a dozen executions, and a single trigger that
    // comes back during it — someone pressing "Check Triggers", a re-run of
    // initSheet(), anything at all — puts every event this import has
    // already touched back in onCalendarChange()'s queue, and the remaining
    // slices then fight a sync storm instead of importing. Costs one
    // getProjectTriggers() call per slice and normally removes nothing.
    pauseAutomationForBootstrap();

    if (state.slices > BOOTSTRAP_MAX_SLICES) {
      finishBootstrap(state, `stopped after ${BOOTSTRAP_MAX_SLICES} slices without finishing`);
      return;
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const registrySheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
    if (findProgramSessionHeaderRows(registrySheet).length === 0) {
      renderProgramDashboard();
    }

    const summary = importCalendarGroups(registrySheet, { deadline: Date.now() + BOOTSTRAP_SLICE_BUDGET_MS });
    state.groupsProcessed += summary.groupsProcessed;
    state.eventsAdded += summary.eventsAdded;
    state.formsCreated += summary.formsCreated;
    state.formsReused += summary.formsReused;
    state.groupsFailed += summary.groupsFailed;
    log(`Bootstrap slice ${state.slices}: ${describeImportSummary(summary)}; ${summary.remaining} group(s) left.`);

    if (!summary.outOfTime) {
      finishBootstrap(state, null);
      return;
    }

    // Still work to do. Guard against a group that can never succeed keeping
    // this going forever: no forward movement twice running ends it.
    const madeProgress = summary.groupsProcessed > 0 &&
      (state.lastRemaining === null || summary.remaining < state.lastRemaining);
    state.stalledSlices = madeProgress ? 0 : state.stalledSlices + 1;
    state.lastRemaining = summary.remaining;
    saveBootstrapState(state);

    if (state.stalledSlices >= BOOTSTRAP_MAX_STALLED_SLICES) {
      finishBootstrap(state, `stopped early — ${summary.remaining} group(s) could not be imported`);
      return;
    }

    armBootstrapResume(BOOTSTRAP_RESUME_DELAY_MS); // replaces the watchdog with a prompt hand-off
    log(`Bootstrap: handing off to the next slice in ${Math.round(BOOTSTRAP_RESUME_DELAY_MS / 1000)}s.`);
  } catch (err) {
    // An exception, unlike a timeout, is ours to handle: put the system back
    // together rather than leaving automation paused.
    log(`⚠️ Bootstrap slice failed (${err}) — restoring automation.`);
    noteForAdmin('Large-setup import', `The import stopped with an error and automation was restored: ${err}`);
    finishBootstrap(getBootstrapState() || state, `stopped by an error: ${err}`);
  } finally {
    flushPersistentRegistries(); // a killed slice's forms must never be forgotten
    lock.releaseLock();
  }
}

/**
 * Last slice: one dashboard render for everything imported, every trigger
 * back in place, state cleared. `problem` is null on a clean finish.
 */
function finishBootstrap(state, problem) {
  state = state || {};
  deleteBootstrapResumeTriggers();

  // Rendered while the bootstrap still counts as active, deliberately: that
  // is what keeps triageDeletedSessions() out of this render. Everything on
  // the session table was put there by the import that just ran, and a
  // half-read calendar at this exact moment must never be allowed to
  // conclude that all of it has been deleted.
  try {
    renderProgramDashboard(true);
  } catch (err) {
    log(`⚠️ Bootstrap: could not render the dashboard at the end (${err}) — the data is imported; re-run Sync Cal to redraw.`);
  }

  clearBootstrapState();

  try {
    // Swallow the import's own description edits before the calendar-edit
    // triggers go back on, or every one of the events just written becomes a
    // full syncCalendars() a moment later.
    primeCalendarSyncTokens('import');
    // force: this IS the restore, and the state was cleared just above — but
    // not relying on that ordering is what keeps automation from staying off.
    writeTriggers(true); // daily sync, hourly registrations, one calendar-edit trigger per calendar
  } catch (err) {
    // Automation staying paused is the one outcome worth shouting about.
    log(`⚠️ Bootstrap: could not restore the triggers (${err}) — run "Check Triggers" from the menu.`);
    noteForAdmin('Large-setup import',
      `The import finished but its triggers could not be restored (${err}). Run "Check Triggers" from the menu.`);
  }

  const totals = `${state.groupsProcessed || 0} program group(s), ${state.eventsAdded || 0} date(s), ` +
    `${state.formsCreated || 0} new form(s), ${state.formsReused || 0} existing form(s) reused` +
    (state.groupsFailed > 0 ? `, ${state.groupsFailed} failed` : '');
  const headline = problem
    ? `⚠️ Large-setup import ${problem}. Imported so far: ${totals}.`
    : `Large-setup import complete ✅ (${totals}, over ${state.slices || 1} run(s)).`;

  log(headline);
  if (problem) noteForAdmin('Large-setup import', headline);
  toastIfPossible(headline);
  flushAdminDigest('Large-setup import');
  log('Automation restored. Run "Sync Registrations" (or wait for the hourly trigger) to pull in any existing form responses.');
}

/**
 * Deletes the syncCalendars / syncRegistrations / onCalendarChange triggers
 * for the duration of the import. Idempotent by design — every slice calls
 * it, so a trigger that reappears mid-import survives at most one slice.
 */
const BOOTSTRAP_PAUSED_HANDLERS = ['syncCalendars', 'syncRegistrations', 'onCalendarChange'];

function pauseAutomationForBootstrap() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (BOOTSTRAP_PAUSED_HANDLERS.indexOf(t.getHandlerFunction()) === -1) return;
    ScriptApp.deleteTrigger(t);
    removed++;
  });
  if (removed > 0) {
    log(`Paused ${removed} trigger(s) for the duration of the import — finishBootstrap() puts them all back.`);
  }
  return removed;
}

/** Replaces any pending hand-off with exactly one, `delayMs` out. */
function armBootstrapResume(delayMs) {
  deleteBootstrapResumeTriggers();
  ScriptApp.newTrigger(BOOTSTRAP_RESUME_HANDLER).timeBased().after(delayMs).create();
}

/**
 * DIAGNOSTIC — run from the Apps Script editor. Logs every trigger this
 * project currently has, plus whether an import is in flight.
 *
 * Use it when onCalendarChange executions keep appearing during an import.
 * There are only two explanations and this separates them:
 *
 *   - NO onCalendarChange trigger listed, yet executions keep arriving:
 *     Google is draining notifications it had already accepted for a channel
 *     that is being torn down. Nothing in this script can recall those. They
 *     cost one log line each (see onCalendarChange) and stop on their own.
 *   - onCalendarChange triggers ARE listed while an import is active:
 *     something re-created them. That is a bug worth chasing — check whether
 *     initSheet() or another project (a second copy of this script bound to
 *     the same calendars) is running.
 */
function logProjectTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  const active = isBootstrapActive();
  log(`Project triggers (${triggers.length}) — large-setup import ${active ? 'IS' : 'is NOT'} currently active:`);
  triggers.forEach(t => {
    const source = t.getTriggerSourceId();
    log(`  • ${t.getHandlerFunction()}${source ? ` [${CALENDAR_MAP[source] || source}]` : ''}`);
  });
  if (active && triggers.some(t => t.getHandlerFunction() === 'onCalendarChange')) {
    log('⚠️ A calendar-edit trigger exists DURING an import — it should have been paused. ' +
      'Something re-created it; the next slice will remove it again.');
  }
  return triggers.length;
}

function deleteBootstrapResumeTriggers() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() !== BOOTSTRAP_RESUME_HANDLER) return;
    ScriptApp.deleteTrigger(t); // one-off triggers linger after firing; clear them out
    removed++;
  });
  return removed;
}

/**
 * ESCAPE HATCH — run from the Apps Script editor. Stops a sliced import and
 * puts automation back exactly as finishBootstrap() would. Whatever was
 * already imported stays imported; re-running bootstrapCalendars() picks up
 * from there.
 */
function cancelBootstrapCalendars() {
  const state = getBootstrapState();
  if (!state) {
    deleteBootstrapResumeTriggers();
    writeTriggers(true);
    log('No large-setup import was running — triggers verified anyway.');
    return;
  }
  finishBootstrap(state, 'was cancelled');
}

/** Toasts when there's a UI to toast into (a trigger run has none) — never worth throwing over. */
function toastIfPossible(message) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, 'Calendar & Form Manager', 8);
  } catch (err) {
    // Running from a trigger with no active spreadsheet UI — the log line stands on its own.
  }
}

/**
 * The registration line we inject into a calendar event description.
 *
 * It's an HTML anchor — Google Calendar renders a subset of HTML in
 * descriptions — so attendees see a short "Register for X" link instead of
 * a raw URL. That matters more than it used to: the URL is now a PREFILLED
 * form link (see buildPrefilledAllCheckedUrl) carrying an entry parameter
 * per date per person, which is far too long to read as bare text.
 *
 * The form ID rides along in the href's #fragment rather than as a visible
 * "[Form ID: ...]" tag. A fragment is never sent to the server and is
 * ignored by Forms, so it changes nothing for the person clicking it — but
 * it keeps the ID machine-recoverable, which is what lets
 * findExistingFormIdFromEvents() rebuild a lost form registry instead of
 * spawning duplicate forms.
 */
const REGISTRATION_LINK_FRAGMENT_KEY = 'form';

function buildRegistrationLinkLine(group, formInfo) {
  const label = group.isFixed
    ? `📝 Register for ${group.cleanTitle}`
    : `📝 Register for ${group.cleanTitle} — ${group.monthLabel}`;
  const href = `${formInfo.publishedUrl}#${REGISTRATION_LINK_FRAGMENT_KEY}=${formInfo.formId}`;
  return `<a href="${href}">${label}</a>`;
}

/** Matches our anchor, capturing (1) the URL without fragment and (2) the form ID. */
const REGISTRATION_ANCHOR_REGEX =
  new RegExp(`<a href="([^"#]*)#${REGISTRATION_LINK_FRAGMENT_KEY}=([a-zA-Z0-9_-]+)"[^>]*>.*?</a>`, 'i');
/** Pre-anchor format, still read so events stamped by older versions keep working. */
const LEGACY_REGISTRATION_LINE_REGEX = /^.*Registration Link:\s*(\S+)\s*\[Form ID:\s*([a-zA-Z0-9_-]+)\]\s*$/m;

/** Finds our registration line in a description in either format. Returns { url, formId, matchText } or null. */
function findRegistrationLineInDescription(description) {
  const anchor = REGISTRATION_ANCHOR_REGEX.exec(description);
  if (anchor) return { url: anchor[1], formId: anchor[2], matchText: anchor[0], isLegacy: false };
  const legacy = LEGACY_REGISTRATION_LINE_REGEX.exec(description);
  if (legacy) return { url: legacy[1], formId: legacy[2], matchText: legacy[0], isLegacy: true };
  return null;
}

function findExistingFormIdFromEvents(events) {
  for (const ev of events) {
    const found = findRegistrationLineInDescription(ev.getDescription() || '');
    if (!found) continue;
    try {
      FormApp.openById(found.formId);
      return found.formId;
    } catch (err) {
      log(`⚠️ Found a Form ID marker (${found.formId}) in an event description, but it could not be opened (${err}) — ignoring.`);
    }
  }
  return null;
}

/**
 * Reopens an already-existing form for a series/month and refreshes its
 * date-dependent items. Not-serving dates are excluded from the lunch grid
 * rows (see buildDateLabelSets()) but still appear on the Dates checkbox.
 */
function refreshFormForNewDates(formId, group, locationName, configInfo) {
  const form = FormApp.openById(formId);
  const dates = group.events.map(ev => ev.getStartTime());
  const { allDateLabels, lunchDateLabels } = buildDateLabelSets(dates, locationName);

  form.setDescription(buildFormDescription(locationName, allDateLabels, group.isFixed, lunchDateLabels.length > 0));

  // Catches a form that predates this location's policy being set to Never,
  // or predates the policy feature entirely, and re-checks whether the dates
  // now on the form serve lunch at all. Both directions are handled and both
  // are no-ops once the form already matches, so this is cheap on every
  // subsequent call.
  const questionsChanged = syncLunchQuestionsOnForm(form, locationName, lunchDateLabels.length > 0);

  // Only ROWS are refreshed here — grid COLUMNS (the person labels) are the
  // same on every form and are set once at template-build time.
  applyFormDateLabels(formId, allDateLabels, lunchDateLabels,
    { form, force: questionsChanged > 0, context: 'new dates on an existing form' });

  return {
    formId: form.getId(),
    // Rebuilt here rather than reused: the grid rows just changed, and a
    // prefill URL encodes the exact rows it was generated against.
    publishedUrl: buildRegistrationUrl(form),
    editUrl: form.getEditUrl(),
    dateLabels: allDateLabels
  };
}

/**
 * Creates a new per-group registration form by COPYING the appropriate
 * template — the Fixed-series template (with its Attendance Mode / All-
 * Dates-Lunch pages) for Fixed groups, the regular template otherwise.
 */
function createRegistrationForm(group, locationName, configInfo) {
  const formTitle = group.isFixed
    ? `${group.cleanTitle} — Registration`
    : `${group.cleanTitle} - ${group.monthLabel}`;

  // One template for everything now — the Attendance Mode fast path is on
  // every form, so Fixed and Regular groups no longer need separate bases.
  const templateForm = getOrCreateTemplateForm();
  const copiedFile = DriveApp.getFileById(templateForm.getId()).makeCopy(formTitle, getOrCreateFormsFolder());
  const form = FormApp.openById(copiedFile.getId());
  form.setTitle(formTitle);

  try {
    form.setAcceptingResponses(true);
  } catch (err) {
    log(`⚠️ Could not confirm "accepting responses" on copied form "${formTitle}" (${err}).`);
  }
  try {
    if (typeof form.setPublished === 'function') form.setPublished(true);
  } catch (err) {
    log(`⚠️ Could not explicitly publish copied form "${formTitle}" (${err}) — copies are published by default in most accounts.`);
  }

  const dates = group.events.map(ev => ev.getStartTime());
  const { allDateLabels, lunchDateLabels } = buildDateLabelSets(dates, locationName);

  form.setDescription(buildFormDescription(locationName, allDateLabels, group.isFixed, lunchDateLabels.length > 0));

  // A location that never caters — or a form none of whose dates serve lunch
  // — shouldn't be asking about lunch at all.
  syncLunchQuestionsOnForm(form, locationName, lunchDateLabels.length > 0);

  // Only ROWS are set here — grid COLUMNS (the person labels) were already
  // baked into the template. force:true because a fresh copy still carries
  // the template's placeholder rows even though this brand-new form ID has
  // no fingerprint on file yet.
  applyFormDateLabels(form.getId(), allDateLabels, lunchDateLabels, { form, force: true, context: 'new form' });
  applyFormFooterNote(form, configInfo.footerNote);
  setFormTemplateVersion(form.getId(), TEMPLATE_VERSION);

  return {
    formId: form.getId(),
    publishedUrl: buildRegistrationUrl(form), // prefilled all-checked when possible
    editUrl: form.getEditUrl(),
    dateLabels: allDateLabels
  };
}

/** Stamps the per-location note onto every copy of the template's FOOTER section header. */
function applyFormFooterNote(form, footerNote) {
  if (!footerNote) return;
  form.getItems().filter(it => it.getTitle() === TEMPLATE_ITEM_TITLES.FOOTER)
    .forEach(it => it.asSectionHeaderItem().setTitle(footerNote));
}

function writeEventRegistryRows(registrySheet, group, locationName, formInfo) {
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const isUncapped = !group.capacity || group.capacity <= 0;

  const rows = group.events.map(ev => {
    const startTime = ev.getStartTime();
    const dateKey = formatDateKey(startTime);
    const eventId = computeEventId(group.calendarId, group.cleanTitle, dateKey);
    const row = new Array(headers.length).fill('');

    row[map['Event_Date']] = startTime;
    row[map['Location']] = locationName;
    row[map['Clean_Title']] = group.cleanTitle;
    // Fallback only — renderProgramDashboard() always overwrites this with
    // a =TEXT(Event_Date,...) formula (see that function for why a formula
    // is required rather than a written time-like string).
    row[map['Event_Time']] = Utilities.formatDate(startTime, TIMEZONE, 'h:mm a');
    row[map['Type_Tag']] = group.typeTag;

    row[map['Max_Capacity']] = isUncapped ? '' : group.capacity;
    row[map['Active_Count']] = 0;
    row[map['Waitlist_Count']] = isUncapped ? '' : 0;
    row[map['Remaining_Seats']] = isUncapped ? '' : group.capacity;
    row[map['Status']] = isUncapped ? '🟢 Unlimited' : computeStatus(0, group.capacity);

    row[map['Form_Response_Link']] = makeHyperlinkFormula(formInfo.publishedUrl, 'View Live Form');
    row[map['Edit_Form_Link']] = makeHyperlinkFormula(formInfo.editUrl, 'Edit Form Settings');
    row[map['Form_ID']] = formInfo.formId;
    row[map['Calendar_Synced?']] = true;
    row[map['Event_ID']] = eventId;
    row[map['Calendar_Source']] = group.calendarId;
    return row;
  });

  if (rows.length > 0) {
    registrySheet.getRange(registrySheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
}

/** Moves any Lunch_and_Event_Registrants rows tied to a deleted event into the Triage tab. */
function moveRegistrantsToTriage(registrantsSheet, deletedEventInfo) {
  const headers = HEADERS.Lunch_and_Event_Registrants;
  const allRows = readAllSectionedRows(registrantsSheet, headers, 'Event_ID');
  const map = getIndexMap(headers);
  const tMap = getIndexMap(HEADERS.Deleted_Event_Triage);
  const flaggedNow = new Date();

  const keepRows = [];
  const newTriageRows = [];

  allRows.forEach(row => {
    const eventId = row[map['Event_ID']];
    const info = deletedEventInfo[eventId];
    if (!info) { keepRows.push(row); return; }

    const triageRow = new Array(HEADERS.Deleted_Event_Triage.length).fill('');
    headers.forEach(h => { if (tMap[h] !== undefined) triageRow[tMap[h]] = row[map[h]]; });
    triageRow[tMap['Deleted_Event_Title']] = info.cleanTitle;
    triageRow[tMap['Deleted_Event_Location']] = info.location;
    triageRow[tMap['Flagged_Date']] = flaggedNow;
    triageRow[tMap['Triage_Notes']] = 'Original calendar event no longer found during sync — please confirm with the registrant.';
    newTriageRows.push(triageRow);
  });

  if (newTriageRows.length === 0) return;

  renderRegistrantsSheet(false, keepRows);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const triageSheet = getOrCreateSheet(ss, SHEET_NAMES.TRIAGE);
  const existingTriageRows = readAllSectionedRows(triageSheet, HEADERS.Deleted_Event_Triage, 'Event_ID');
  renderTriageSheet(false, existingTriageRows.concat(newTriageRows));

  log(`Moved ${newTriageRows.length} registrant row(s) to "${SHEET_NAMES.TRIAGE}".`);
  Object.keys(deletedEventInfo).forEach(eventId => {
    const info = deletedEventInfo[eventId];
    noteForAdmin('Deleted events sent to triage',
      `${info.cleanTitle} (${info.location}) — its calendar event is gone; registrants need confirming.`);
  });
}

/**
 * The inverse of moveRegistrantsToTriage(): puts triaged rows back on
 * Lunch_and_Event_Registrants for every session that is on the dashboard
 * again.
 *
 * Needed because a triage sweep is not recoverable from the forms. The import
 * only ever reads responses newer than the last sync, so a registration that
 * was already imported and then triaged exists nowhere else — moving the row
 * back IS the recovery. Rows for sessions that are still gone are left in
 * triage, and an identity already present on the Registrants tab is dropped
 * rather than duplicated.
 *
 * Run from the Apps Script editor. Returns the number of rows restored.
 */
function restoreTriagedRegistrants() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const triageSheet = ss.getSheetByName(SHEET_NAMES.TRIAGE);
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!triageSheet || !registrySheet) {
    log('restoreTriagedRegistrants: no triage tab or no dashboard — nothing to do.');
    return 0;
  }

  const triageHeaders = HEADERS.Deleted_Event_Triage;
  const regHeaders = HEADERS.Lunch_and_Event_Registrants;
  const tMap = getIndexMap(triageHeaders);
  const rMap = getIndexMap(regHeaders);

  const sessionRows = readAllSectionedRows(registrySheet, HEADERS.Master_Program_Dashboard, 'Event_ID');
  const sessionMap = getIndexMap(HEADERS.Master_Program_Dashboard);
  const liveEventIds = new Set(sessionRows.map(row => row[sessionMap['Event_ID']]).filter(Boolean));
  if (liveEventIds.size === 0) {
    log('restoreTriagedRegistrants: the session table is empty — import the calendar first, then run this again.');
    return 0;
  }

  const registrantsSheet = getOrCreateSheet(ss, SHEET_NAMES.LUNCH_EVENT_REGISTRANTS);
  const registrantRows = readAllSectionedRows(registrantsSheet, regHeaders, 'Event_ID');
  const present = new Set(registrantRows.map(row =>
    `${row[rMap['Event_ID']]}|${normalizeNameKey(row[rMap['Name']])}|${row[rMap['Person_Type']]}`));

  const triageRows = readAllSectionedRows(triageSheet, triageHeaders, 'Event_ID');
  const stayInTriage = [];
  const restored = [];

  triageRows.forEach(row => {
    const eventId = row[tMap['Event_ID']];
    if (!eventId || !liveEventIds.has(eventId)) { stayInTriage.push(row); return; }

    const key = `${eventId}|${normalizeNameKey(row[tMap['Name']])}|${row[tMap['Person_Type']]}`;
    if (present.has(key)) {
      log(`restoreTriagedRegistrants: ${row[tMap['Name']]} is already on the Registrants tab for this session — dropping the triaged copy.`);
      return;
    }

    // Triage is a superset of the registrant layout, so this copies by name.
    const restoredRow = new Array(regHeaders.length).fill('');
    regHeaders.forEach(h => { if (tMap[h] !== undefined) restoredRow[rMap[h]] = row[tMap[h]]; });
    const notes = String(restoredRow[rMap['Admin_Notes']] || '').trim();
    const stamp = `Restored from ${SHEET_NAMES.TRIAGE} on ${Utilities.formatDate(new Date(), TIMEZONE, 'M/d/yyyy')}.`;
    restoredRow[rMap['Admin_Notes']] = notes ? `${notes} | ${stamp}` : stamp;
    present.add(key);
    restored.push(restoredRow);
  });

  if (restored.length === 0) {
    log('restoreTriagedRegistrants: nothing in triage belongs to a session that is back.');
    return 0;
  }

  renderRegistrantsSheet(false, registrantRows.concat(restored));
  renderTriageSheet(false, stayInTriage);
  log(`restoreTriagedRegistrants: put ${restored.length} row(s) back on "${SHEET_NAMES.LUNCH_EVENT_REGISTRANTS}"; ` +
    `${stayInTriage.length} row(s) stay in triage (their session is still missing).`);
  toastIfPossible(`Restored ${restored.length} registrant row(s) from triage ✅`);
  return restored.length;
}

function backInjectCalendarDescriptions(group, formInfo) {
  const linkLine = buildRegistrationLinkLine(group, formInfo);

  group.events.forEach(ev => {
    const existing = ev.getDescription() || '';
    const found = findRegistrationLineInDescription(existing);

    if (found) {
      // Already current, in the current format — leave the event alone
      // rather than burning a write (and a notification) on every sync.
      if (!found.isLegacy && found.url === formInfo.publishedUrl && found.formId === formInfo.formId) return;
      const corrected = existing.replace(found.matchText, linkLine);
      if (corrected !== existing) ev.setDescription(corrected);
      return;
    }

    const appended = existing ? `${existing}\n\n${linkLine}` : linkLine;
    if (appended !== existing) ev.setDescription(appended);
  });
}


// ============================================================================
// 5. REGISTRATION IMPORT & WAITLISTING  (syncRegistrations)
// ============================================================================

function getLastSyncTime() {
  const stored = PropertiesService.getScriptProperties().getProperty(LAST_SYNC_PROP_KEY);
  return stored ? new Date(stored) : new Date(0);
}

function setLastSyncTime(date) {
  PropertiesService.getScriptProperties().setProperty(LAST_SYNC_PROP_KEY, date.toISOString());
}

function syncRegistrations() {
  if (isBootstrapActive()) {
    log(`syncRegistrations: a large-setup import (${BOOTSTRAP_ENTRY_NAME}()) is writing to the session table — skipping this run.`);
    return;
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
  const registrantsSheet = getOrCreateSheet(ss, SHEET_NAMES.LUNCH_EVENT_REGISTRANTS);

  const lastSync = getLastSyncTime();
  const syncStartedAt = new Date();
  const orderAheadDays = getOrderAheadDays();

  // One read of each tab up front; both registry-derived structures below
  // are built from the same rows rather than scanning the sheet twice.
  const sessionRows = readAllSectionedRows(registrySheet, HEADERS.Master_Program_Dashboard, 'Event_ID');
  const registryIndex = buildRegistryIndex(registrySheet, sessionRows);
  const existingRows = readAllSectionedRows(registrantsSheet, HEADERS.Lunch_and_Event_Registrants, 'Event_ID');
  const protectedKeys = getProtectedRegistrantKeys(existingRows);
  const existingRowIndex = getExistingRegistrantIndex(existingRows);

  const formIds = getDistinctFormIds(registrySheet, sessionRows);
  const newRows = [];

  formIds.forEach(formId => {
    let form;
    try {
      form = FormApp.openById(formId);
    } catch (err) {
      log(`⚠️ Could not open form ${formId}: ${err}`);
      // Worth an admin's attention: a form we can't open is one whose
      // registrations are silently not being imported.
      noteForAdmin('Forms that could not be opened', `${formId} — ${err}`);
      return;
    }

    const responses = form.getResponses(lastSync);
    if (responses.length === 0) return; // don't pay for an item index on a form with nothing new
    const formIndex = getFormItemIndex(form); // ONE getItems() round trip for every response on this form
    responses.forEach(response => {
      const rowsForResponse = processFormResponse(formIndex, response, registryIndex, protectedKeys, existingRowIndex, orderAheadDays);
      newRows.push(...rowsForResponse.filter(Boolean));
    });
  });

  flushPersistentRegistries(); // one write for every all-dates entry recorded above

  // Deliberately AFTER the import loop above: bringing a form built on an
  // older template up to date replaces its questions, and a response that
  // hadn't been imported yet would lose its answers with them.
  migrateFormsToCurrentTemplate(registrySheet, sessionRows);

  // Catch up "sign up for all dates" registrants on Fixed-series forms
  // whose date list has grown since they originally registered.
  applyAllDatesCatchup(registryIndex, protectedKeys, existingRowIndex, orderAheadDays, newRows);

  const combinedRegistrantRows = existingRows.concat(newRows);
  renderRegistrantsSheet(false, combinedRegistrantRows);

  // combinedRegistrantRows IS what was just written to the Registrants tab,
  // so every consumer below can work from it instead of re-reading — except
  // where renderProgramDashboard()'s triage pass rewrites the tab, which it
  // reports back via registrantsMoved.
  recomputeEventRegistryCounts(registrySheet, registrantsSheet, combinedRegistrantRows);
  refreshFormCapacityLabelsForAllForms(registrySheet);

  const dashboardResult = renderProgramDashboard(false, { registrantRows: combinedRegistrantRows });
  updateMasterLunchDashboard(dashboardResult.registrantsMoved ? null : combinedRegistrantRows);

  flushPersistentRegistries();
  setLastSyncTime(syncStartedAt);
  flushAdminDigest('Registration sync'); // no-op unless something above actually needed attention
  SpreadsheetApp.getActiveSpreadsheet().toast(`Registration sync complete ✅ (${newRows.length} new rows)`, 'Calendar & Form Manager', 5);
}

function getDistinctFormIds(registrySheet, sessionRows) {
  const headers = HEADERS.Master_Program_Dashboard;
  const rows = sessionRows || readAllSectionedRows(registrySheet, headers, 'Event_ID');
  const map = getIndexMap(headers);
  const values = rows.map(row => row[map['Form_ID']]);
  return Array.from(new Set(values.filter(Boolean)));
}

/** Maps "Form_ID|Plain Session Date Label" -> { eventId, maxCapacity, eventDate }. */
function buildRegistryIndex(registrySheet, sessionRows) {
  const index = {};
  const headers = HEADERS.Master_Program_Dashboard;
  const rows = sessionRows || readAllSectionedRows(registrySheet, headers, 'Event_ID');
  const map = getIndexMap(headers);
  rows.forEach(row => {
    const formId = row[map['Form_ID']];
    const eventDateRaw = row[map['Event_Date']];
    if (!formId || !eventDateRaw) return;
    const eventDate = coerceDate(eventDateRaw);
    if (!eventDate) return;
    const label = formatDateLabel(eventDate);
    index[`${formId}|${label}`] = {
      eventId: row[map['Event_ID']],
      maxCapacity: Number(row[map['Max_Capacity']]) || 0,
      eventDate,
      location: row[map['Location']] || '',
      cleanTitle: row[map['Clean_Title']] || ''
    };
  });
  return index;
}

/**
 * Normalizes a name for IDENTITY purposes only (dedup / manual-edit
 * protection / the "sign up for all dates" registry) — "Jane Smith" and
 * "jane smith " are the same person. Display values (the Name column
 * itself) always keep the original, as-typed casing/spacing.
 */
function normalizeNameKey(name) {
  return String(name || '').trim().toLowerCase();
}

/** Keys (Event_ID|normalized Name|Person_Type) for rows marked Manually Edited OR Manually Added. */
function getProtectedRegistrantKeys(rows) {
  const map = getIndexMap(HEADERS.Lunch_and_Event_Registrants);
  const set = new Set();
  rows.forEach(row => {
    const override = String(row[map['Manual_Override']]).trim();
    if (override === 'Manually Edited' || override === 'Manually Added') {
      set.add(`${row[map['Event_ID']]}|${normalizeNameKey(row[map['Name']])}|${row[map['Person_Type']]}`);
    }
  });
  return set;
}

/**
 * Map of (Event_ID|normalized Name|Person_Type) -> that row's live array,
 * for every currently-present row (Superseded ones included — a further
 * resubmission still needs to find and re-supersede the CURRENT row, not
 * pile up duplicates). buildRegistrantRow() uses this both to skip true
 * duplicate imports and to locate the row a resubmission should patch or
 * supersede.
 */
function getExistingRegistrantIndex(rows) {
  const map = getIndexMap(HEADERS.Lunch_and_Event_Registrants);
  const index = new Map();
  rows.forEach(row => index.set(`${row[map['Event_ID']]}|${normalizeNameKey(row[map['Name']])}|${row[map['Person_Type']]}`, row));
  return index;
}

/**
 * Pulls a named item's response value out of a FormResponse. Checks ALL
 * items sharing that title (a given title appears on several branch-specific
 * pages) and returns the first one that was actually part of this
 * respondent's path.
 *
 * Takes a formIndex from getFormItemIndex() rather than a Form: this used
 * to call form.getItems() — a REMOTE call — on every single lookup, and
 * processFormResponse() makes about ten lookups per response.
 */
function getResponseValueByTitle(formIndex, response, title) {
  const items = formIndex.byTitle[title] || [];
  for (const item of items) {
    const itemResponse = response.getResponseForItem(item);
    if (!itemResponse) continue;
    const val = itemResponse.getResponse();
    if (val === null || val === undefined || val === '') continue;
    if (Array.isArray(val) && val.length === 0) continue;
    return val;
  }
  return '';
}

/**
 * Same "check every branch page, return whichever instance was actually
 * part of this respondent's path" approach as getResponseValueByTitle(),
 * but for a checkbox-grid item (ATTENDANCE_GRID / LUNCH_GRID): returns
 * { rows, columns, values }, where values[rowIdx] is the array of checked
 * column labels for that row. Returns null if the title never had a real
 * answer (shouldn't happen for ATTENDANCE_GRID since every branch has one,
 * but LUNCH_GRID is legitimately absent whenever the response predates this
 * form structure or every date on the form is "Not Serving").
 *
 * getRows()/getColumns() are themselves remote calls, so the resolved grid
 * is memoized on the formIndex — every response on a form shares one read.
 */
function getGridResponseByTitle(formIndex, response, title) {
  const items = formIndex.byTitle[title] || [];
  if (!formIndex.gridShapeByItemId) formIndex.gridShapeByItemId = {};
  for (const item of items) {
    const itemResponse = response.getResponseForItem(item);
    if (!itemResponse) continue;
    const values = itemResponse.getResponse();
    if (!values || !Array.isArray(values)) continue;
    const itemId = item.getId();
    let shape = formIndex.gridShapeByItemId[itemId];
    if (!shape) {
      const grid = item.asCheckboxGridItem();
      shape = { rows: grid.getRows(), columns: grid.getColumns() };
      formIndex.gridShapeByItemId[itemId] = shape;
    }
    return { rows: shape.rows, columns: shape.columns, values };
  }
  return null;
}

/**
 * Combines the Allergies/Dietary text answer with the "Anything Else?"
 * catch-all into one Admin_Notes string. The Footer Note is a display-only
 * SectionHeaderItem now (see getOrCreateTemplateForm()) so it never shows up
 * here — previously a single paragraph item did double duty as both the
 * static per-location note AND the admin-notes scan target, which meant a
 * respondent could never actually see their own note echoed back to them
 * separately from a genuine "anything else" answer.
 */
function getAdminNotesResponse(formIndex, response) {
  const allergies = String(getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.ALLERGIES) || '').trim();

  let notes = '';
  for (const item of formIndex.paragraphItems) {
    const itemResponse = response.getResponseForItem(item);
    if (!itemResponse) continue;
    const val = String(itemResponse.getResponse() || '').trim();
    if (val) { notes = val; break; }
  }

  const parts = [];
  if (allergies) parts.push(`Allergies/Dietary: ${allergies}`);
  if (notes) parts.push(notes);
  return parts.join(' | ');
}

/**
 * Resolves the people on one submission from the name fields alone. There
 * is no guest-count question any more: the headcount IS how many guest
 * name fields were filled in, which makes the old "said 3, named 2,
 * catered for 2" mismatch structurally impossible.
 *
 * Returned in PERSON_COLUMN_LABELS order, and a guest whose name was left
 * blank produces NO entry — so a stray check in that guest's grid column
 * (they're all pre-checked) is correctly ignored rather than inventing a
 * nameless person.
 */
function resolvePeopleOnResponse(formIndex, response, registrantName, adminNotes) {
  const people = [{
    name: registrantName, personType: 'Attendee', primaryRegistrant: 'Self',
    columnLabel: PERSON_COLUMN_LABELS[0], baseNotes: adminNotes
  }];
  for (let g = 1; g <= MAX_GUESTS; g++) {
    const guestName = String(getResponseValueByTitle(formIndex, response, `Guest ${g} Name`) || '').trim();
    if (!guestName) continue;
    people.push({
      name: guestName, personType: 'Guest', primaryRegistrant: registrantName,
      columnLabel: PERSON_COLUMN_LABELS[g], baseNotes: ''
    });
  }
  return people;
}

function processFormResponse(formIndex, response, registryIndex, protectedKeys, existingRowIndex, orderAheadDays) {
  const form = formIndex.form;
  const name = String(getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.NAME) || 'Unknown').trim();
  const adminNotes = getAdminNotesResponse(formIndex, response);
  // Points at this specific submission (requires setAllowResponseEdits(true)
  // on the template — see getOrCreateTemplateForm()), not the shared form editor.
  const responseEditUrl = response.getEditResponseUrl();
  const submittedAt = response.getTimestamp();
  const partyId = response.getId();

  const people = resolvePeopleOnResponse(formIndex, response, name, adminNotes);
  const partySize = people.length;

  const attendanceMode = getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE);
  if (attendanceMode === ATTENDANCE_MODE_CHOICES.ALL_DATES) {
    return processAllDatesResponse({
      formIndex, response, registryIndex, protectedKeys, existingRowIndex, orderAheadDays,
      name, people, adminNotes, responseEditUrl, submittedAt, partyId, partySize
    });
  }

  // Specific-dates path. Two roster grids: ATTENDANCE_GRID's rows are every
  // date on the form, LUNCH_GRID's rows are only the lunch-eligible ("not
  // Not-Serving") subset — see buildDateLabelSets().
  const attendanceGrid = getGridResponseByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID);
  const lunchGrid = getGridResponseByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.LUNCH_GRID);
  if (!attendanceGrid) return [];

  const rows = [];
  attendanceGrid.rows.forEach((dateLabel, rowIdx) => {
    const plainDateLabel = stripMealHint(dateLabel);
    const registryEntry = registryIndex[`${form.getId()}|${plainDateLabel}`];
    if (!registryEntry) {
      log(`⚠️ No Master_Program_Dashboard match for form ${form.getId()} / ${plainDateLabel}`);
      return;
    }

    const attendingCols = attendanceGrid.values[rowIdx] || [];
    const lunchRowIdx = lunchGrid ? lunchGrid.rows.findIndex(r => stripMealHint(r) === plainDateLabel) : -1;
    const lunchCols = (lunchGrid && lunchRowIdx >= 0) ? (lunchGrid.values[lunchRowIdx] || []) : [];

    people.forEach(person => {
      const isAttending = attendingCols.indexOf(person.columnLabel) !== -1;
      const wantsLunch = lunchCols.indexOf(person.columnLabel) !== -1;
      if (!isAttending && !wantsLunch) return; // this person didn't check anything for this date — no row

      let notes = person.baseNotes || '';
      if (!isAttending && wantsLunch) {
        // Reconcile rather than silently drop: a checked lunch box implies
        // attendance even if that same date wasn't also checked in the
        // attendance grid. Flag it for staff instead of guessing quietly.
        const flag = `⚠️ Checked lunch without attendance for ${plainDateLabel} — reconciled as attending.`;
        notes = notes ? `${notes} | ${flag}` : flag;
        log(`Reconciliation: ${person.name} checked "${TEMPLATE_ITEM_TITLES.LUNCH_GRID}" without "${TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID}" for ${plainDateLabel} on form ${form.getId()} — treating as attending.`);
      }

      rows.push(buildRegistrantRow({
        registryEntry, name: person.name, personType: person.personType,
        lunchType: wantsLunch ? 'Yes - Lunch' : 'No Lunch', primaryRegistrant: person.primaryRegistrant,
        adminNotes: notes, formEditUrl: responseEditUrl, protectedKeys, existingRowIndex, submittedAt, orderAheadDays,
        partyId, partySize
      }));
    });
  });

  return rows.filter(Boolean);
}

/**
 * Handles a Fixed-series form submitted via "Sign up for all dates": one
 * lunch choice per person is applied to EVERY current session date on the
 * form (matchingEntries), and each person is recorded in the persistent
 * ALL_DATES registry so future syncRegistrations() runs can retroactively
 * add rows for any dates added to the series afterward (see
 * applyAllDatesCatchup()).
 */
function processAllDatesResponse(args) {
  const {
    formIndex, response, registryIndex, protectedKeys, existingRowIndex, orderAheadDays,
    people, adminNotes, responseEditUrl, submittedAt, partyId, partySize
  } = args;

  // A single checkbox of PERSON_COLUMN_LABELS: who eats, applied to every
  // date. Checked-but-unnamed columns are already filtered out, since
  // `people` only contains rows for guests who were actually named.
  const eaters = getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.ALL_DATES_LUNCH_PEOPLE) || [];
  const eaterSet = new Set(Array.isArray(eaters) ? eaters : [eaters]);

  const formId = formIndex.formId;
  const matchingEntries = Object.keys(registryIndex).filter(k => k.startsWith(`${formId}|`)).map(k => registryIndex[k]);

  const rows = [];
  people.forEach(person => {
    const lunchType = eaterSet.has(person.columnLabel) ? 'Yes - Lunch' : 'No Lunch';
    saveAllDatesRegistryEntry(formId, {
      name: person.name, personType: person.personType, lunchType,
      primaryRegistrant: person.primaryRegistrant, adminNotes: person.baseNotes || '',
      formEditUrl: responseEditUrl, submittedAt: submittedAt.toISOString(), partyId, partySize
    });
    matchingEntries.forEach(registryEntry => {
      rows.push(buildRegistrantRow({
        registryEntry, name: person.name, personType: person.personType, lunchType,
        primaryRegistrant: person.primaryRegistrant, adminNotes: person.baseNotes || '', formEditUrl: responseEditUrl,
        protectedKeys, existingRowIndex, submittedAt, orderAheadDays, partyId, partySize
      }));
    });
  });
  return rows.filter(Boolean);
}

/**
 * Runs every registration sync: for every form with "all dates" registrants
 * on file, checks whether any of the form's CURRENT session dates are
 * missing a row for that person, and fills them in — this is what makes
 * "all dates" keep meaning "every date," including ones added to an
 * ongoing Fixed series after the original registration.
 */
function applyAllDatesCatchup(registryIndex, protectedKeys, existingRowIndex, orderAheadDays, newRows) {
  const registry = getAllDatesRegistry();
  Object.keys(registry).forEach(formId => {
    const matchingEntries = Object.keys(registryIndex).filter(k => k.startsWith(`${formId}|`)).map(k => registryIndex[k]);
    if (matchingEntries.length === 0) return;
    registry[formId].forEach(entry => {
      matchingEntries.forEach(registryEntry => {
        const row = buildRegistrantRow({
          registryEntry, name: entry.name, personType: entry.personType, lunchType: entry.lunchType,
          primaryRegistrant: entry.primaryRegistrant, adminNotes: entry.adminNotes || '',
          formEditUrl: entry.formEditUrl, protectedKeys, existingRowIndex,
          submittedAt: new Date(entry.submittedAt), orderAheadDays,
          partyId: entry.partyId || '', partySize: entry.partySize || ''
        });
        if (row) newRows.push(row);
      });
    });
  });
}

/**
 * Marks an existing registrant row as no longer current, WITHOUT deleting
 * it — so staff can see a change actually happened rather than the row
 * just vanishing. Applied when a genuinely different submission (a
 * different Party_ID) shows up for the same Event_ID+Name+Person_Type.
 */
function supersedeRegistrantRow(row, map, supersededAt) {
  if (row[map['Program_Status']] === 'Superseded') return; // already marked by an earlier resubmission this pass
  row[map['Program_Status']] = 'Superseded';
  row[map['Lunch_Status']] = 'Superseded';
  const note = `Superseded by a newer submission on ${Utilities.formatDate(supersededAt, TIMEZONE, 'M/d/yyyy h:mm a')}.`;
  const existingNotes = String(row[map['Admin_Notes']] || '').trim();
  row[map['Admin_Notes']] = existingNotes ? `${existingNotes} | ${note}` : note;
}

/**
 * Resolves what actually gets STORED in a registrant row's Lunch_Type
 * column: the day's real Hot/Cold designation (from Lunch_Schedule, via
 * registryEntry's own date+location) for anyone who wants lunch, 'No Lunch'
 * for anyone who doesn't. Never returns the raw form answer verbatim — a
 * person's lunch type is Hot or Cold, matching Lunch_Schedule's own
 * vocabulary, not a restatement of whether they said yes.
 *
 * Resolved ONCE at row-creation/patch time and never revisited — like
 * Order_Ahead_Flag, it's a fact about what Lunch_Schedule said when this
 * row was written, not something that should drift if the menu changes
 * later. If no Hot/Cold row exists yet for that date, this returns '' —
 * still correctly counted as Needed (see lunchStatus below, which is
 * derived from wantsLunch directly, never from this string) and already
 * surfaced separately by buildDashboardRollup()'s "no menu set" admin note.
 */
function resolveRegistrantLunchType(wantsLunch, registryEntry) {
  if (!wantsLunch) return 'No Lunch';
  const meal = getMealInfoForDate(registryEntry.eventDate, registryEntry.location);
  return (meal && (meal.type === 'Hot' || meal.type === 'Cold')) ? meal.type : '';
}

function buildRegistrantRow(args) {
  const {
    registryEntry, name, personType, lunchType, primaryRegistrant, adminNotes, formEditUrl,
    protectedKeys, existingRowIndex, submittedAt, orderAheadDays, partyId, partySize
  } = args;
  const displayName = String(name || '').trim();
  const key = `${registryEntry.eventId}|${normalizeNameKey(displayName)}|${personType}`;
  // The caller's lunchType is just an intent signal ('No Lunch' vs
  // anything else) — resolveRegistrantLunchType() is what turns that into
  // an actual Hot/Cold value. Deriving lunchStatus from this boolean rather
  // than from the resolved string means an unresolved Hot/Cold (no menu
  // configured yet) never downgrades a real "Needed" registrant.
  //
  // Gated on isLunchOfferedOn(): a date that serves no lunch produces no
  // lunch demand, whatever the form said. The per-date roster grid can't
  // even offer such a date (buildDateLabelSets() leaves it out), but the
  // "everyone, every date" branch asks the lunch question ONCE for the whole
  // form — without this gate, one checkbox would have booked a meal on every
  // Not-Serving date the form covers.
  const intendsLunch = !!lunchType && lunchType !== 'No Lunch';
  const wantsLunch = intendsLunch && isLunchOfferedOn(registryEntry.eventDate, registryEntry.location);

  if (protectedKeys.has(key)) {
    return null; // never overwrite a manually-edited/added row, resubmission or not
  }

  const map = getIndexMap(HEADERS.Lunch_and_Event_Registrants);
  const existingRow = existingRowIndex.get(key);

  if (existingRow) {
    const existingPartyId = existingRow[map['Party_ID']];
    if (existingPartyId && existingPartyId === partyId) {
      // Same Response ID — Google keeps a response's ID stable when a
      // respondent uses their "edit response" link (see
      // form.setAllowResponseEdits(true) in getOrCreateTemplateForm()), so
      // this is the SAME submission being re-seen, not a new one. Refresh
      // the one row in place rather than appending a duplicate.
      existingRow[map['Lunch_Type']] = resolveRegistrantLunchType(wantsLunch, registryEntry);
      existingRow[map['Lunch_Status']] = existingRow[map['Program_Status']] === 'Waitlisted'
        ? 'Waitlisted'
        : (wantsLunch ? 'Needed' : 'No Lunch');
      existingRow[map['Admin_Notes']] = adminNotes || '';
      existingRow[map['Party_Size']] = partySize || '';
      existingRow[map['Order_Ahead_Flag']] = computeOrderAheadFlag(registryEntry.eventDate, submittedAt, orderAheadDays);
      existingRow[map['Form_Source']] = makeHyperlinkFormula(formEditUrl, 'View Submission');
      return null; // nothing new to append — the existing row was updated in place
    }
    // A genuinely different submission (a different Party_ID) for the same
    // identity: keep the old row visible for the audit trail instead of
    // silently dropping this resubmission the way a plain duplicate-key
    // check used to.
    supersedeRegistrantRow(existingRow, map, submittedAt);
  }

  const isCapped = registryEntry.maxCapacity > 0;
  const programStatus = isCapped && registryEntry.activeCountSoFar >= registryEntry.maxCapacity
    ? 'Waitlisted' : 'Active';
  const lunchStatus = programStatus === 'Waitlisted'
    ? 'Waitlisted'
    : (wantsLunch ? 'Needed' : 'No Lunch');

  if (programStatus === 'Waitlisted') {
    // Someone just hit a cap. That's the one registration outcome a human
    // usually has to do something about, so it goes in the admin digest.
    noteForAdmin('Waitlisted registrants',
      `${displayName} (${personType}) for ${formatDateLabel(registryEntry.eventDate)} — capacity ${registryEntry.maxCapacity} is full.`);
  }

  registryEntry.activeCountSoFar = (registryEntry.activeCountSoFar || 0) + (programStatus === 'Active' ? 1 : 0);

  const row = new Array(HEADERS.Lunch_and_Event_Registrants.length).fill('');

  row[map['Location']] = registryEntry.location || '';
  row[map['Event']] = registryEntry.cleanTitle || '';
  row[map['Event_Date']] = registryEntry.eventDate;
  row[map['Manual_Override']] = 'Auto-Synced';
  row[map['Name']] = displayName;
  row[map['Person_Type']] = personType;
  row[map['Lunch_Type']] = resolveRegistrantLunchType(wantsLunch, registryEntry);
  row[map['Primary_Registrant']] = primaryRegistrant;
  row[map['Party_ID']] = partyId || '';
  row[map['Party_Size']] = partySize || '';
  // Points at this specific submission (response.getEditResponseUrl(), via
  // processFormResponse()/processAllDatesResponse()), not the shared form editor.
  row[map['Form_Source']] = makeHyperlinkFormula(formEditUrl, 'View Submission');
  row[map['Program_Status']] = programStatus;
  row[map['Lunch_Status']] = lunchStatus;
  row[map['Order_Ahead_Flag']] = computeOrderAheadFlag(registryEntry.eventDate, submittedAt, orderAheadDays);
  row[map['Admin_Notes']] = adminNotes || '';
  row[map['Event_ID']] = registryEntry.eventId;

  existingRowIndex.set(key, row); // reserve/replace immediately so a later row in this same pass supersedes/patches THIS one
  return row;
}

/** Recomputes Active_Count / Waitlist_Count / Remaining_Seats / Status on the session table (both Upcoming and Past zones). */
function recomputeEventRegistryCounts(registrySheet, registrantsSheet, registrantRows) {
  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return;

  const regMap = getHeaderMapAt(registrySheet, headerRows[0]); // identical column layout at every header row
  const counts = buildEventCountsFromRegistrants(registrantsSheet, registrantRows);

  headerRows.forEach((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(registrySheet, hRow, nextHeader, regMap['Event_Date']);
    if (!zone) return;
    recomputeCountsForZone(registrySheet, zone.start, zone.count, regMap, counts);
  });
}

function buildEventCountsFromRegistrants(registrantsSheet, registrantRows) {
  const counts = {};
  const headers = HEADERS.Lunch_and_Event_Registrants;
  const rows = registrantRows || readAllSectionedRows(registrantsSheet, headers, 'Event_ID');
  const map = getIndexMap(headers);
  rows.forEach(row => {
    const eventId = row[map['Event_ID']];
    if (!eventId) return;
    if (!counts[eventId]) counts[eventId] = { active: 0, waitlist: 0 };
    if (row[map['Program_Status']] === 'Active') counts[eventId].active++;
    if (row[map['Program_Status']] === 'Waitlisted') counts[eventId].waitlist++;
  });
  return counts;
}

function recomputeCountsForZone(registrySheet, dataStart, numRows, regMap, counts) {
  const eventIds = registrySheet.getRange(dataStart, regMap['Event_ID'], numRows, 1).getValues();
  const maxCaps = registrySheet.getRange(dataStart, regMap['Max_Capacity'], numRows, 1).getValues();

  const activeOut = [], waitlistOut = [], remainingOut = [], statusOut = [];
  for (let i = 0; i < numRows; i++) {
    const eventId = eventIds[i][0];
    const rawCap = maxCaps[i][0];
    const isUncapped = rawCap === '--' || rawCap === '' || Number(rawCap) <= 0;
    const maxCap = isUncapped ? 0 : Number(rawCap);
    const c = counts[eventId] || { active: 0, waitlist: 0 };

    activeOut.push([c.active]);
    if (isUncapped) {
      waitlistOut.push(['']);
      remainingOut.push(['']);
      statusOut.push(['🟢 Unlimited']);
    } else {
      waitlistOut.push([c.waitlist]);
      remainingOut.push([Math.max(maxCap - c.active, 0)]);
      statusOut.push([computeStatus(c.active, maxCap)]);
    }
  }
  registrySheet.getRange(dataStart, regMap['Active_Count'], numRows, 1).setValues(activeOut);
  registrySheet.getRange(dataStart, regMap['Waitlist_Count'], numRows, 1).setValues(waitlistOut);
  registrySheet.getRange(dataStart, regMap['Remaining_Seats'], numRows, 1).setValues(remainingOut);
  registrySheet.getRange(dataStart, regMap['Status'], numRows, 1).setValues(statusOut);
}

/**
 * Call AFTER recomputeEventRegistryCounts() so Remaining_Seats is fresh.
 * Re-stamps every capped form's roster-grid ROW labels with a
 * CAPACITY_HINT_SUFFIX wherever a session has hit 0 Remaining_Seats — this
 * is what turns silent waitlisting into a signal a respondent can actually
 * see before they submit. Forms with no capped sessions at all are skipped
 * entirely (nothing on them can ever go full), so this stays cheap on the
 * common case of unlimited/"Regular" programs.
 */
function refreshFormCapacityLabelsForAllForms(registrySheet) {
  const headers = HEADERS.Master_Program_Dashboard;
  const rows = readAllSectionedRows(registrySheet, headers, 'Event_ID');
  if (rows.length === 0) return;
  const map = getIndexMap(headers);
  const byForm = groupRegistryRowsByForm(rows, map);

  Object.keys(byForm).forEach(formId => {
    const formRows = byForm[formId];
    const hasCappedSession = formRows.some(row => {
      const rawCap = row[map['Max_Capacity']];
      return rawCap !== '' && rawCap !== '--' && Number(rawCap) > 0;
    });
    if (!hasCappedSession) return; // nothing on this form can ever go FULL — skip the API round trip

    const location = formRows[0][map['Location']];
    const dates = formRows.map(r => coerceDate(r[map['Event_Date']])).filter(Boolean).sort((a, b) => a - b);
    if (dates.length === 0) return;
    const capacityHints = buildCapacityHintsFromRegistryRows(formRows, map);
    const { allDateLabels, lunchDateLabels } = buildDateLabelSets(dates, location, capacityHints);
    // Fingerprinted: on the overwhelmingly common "nothing filled up since
    // last hour" sync this costs a hash compare and no FormApp call at all.
    applyFormDateLabels(formId, allDateLabels, lunchDateLabels, { context: 'capacity labels' });
  });
  flushPersistentRegistries();
}

/** { Form_ID: [session rows] } from a batch of Master_Program_Dashboard rows. Rows with no form are skipped. */
function groupRegistryRowsByForm(rows, map) {
  const byForm = {};
  rows.forEach(row => {
    const formId = row[map['Form_ID']];
    if (!formId) return;
    if (!byForm[formId]) byForm[formId] = [];
    byForm[formId].push(row);
  });
  return byForm;
}

/**
 * Is this live form built on the CURRENT template? Structural, not a
 * version stamp — it has to be able to judge a form first seen long before
 * stamps existed.
 *
 * A form is out of date when it still carries the v1/v2 guest-count question
 * (and, behind it, that template's per-count branch pages), when it is
 * missing the single Attendance Mode branch point, or when it has more page
 * breaks than the current template's two. Any of those means a respondent is
 * being routed by the old eight-section flow — the one that could answer
 * "1 guest" and land on the 2-guest page.
 */
function isFormOnCurrentTemplate(form) {
  const items = form.getItems();
  const titles = items.map(it => it.getTitle());
  if (titles.indexOf(LEGACY_GUEST_COUNT_TITLE) !== -1) return false;
  if (titles.indexOf(TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE) === -1) return false;
  if (titles.indexOf(TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID) === -1) return false;
  const pageBreaks = items.filter(it => it.getType() === FormApp.ItemType.PAGE_BREAK).length;
  return pageBreaks <= Object.keys(TEMPLATE_PAGE_TITLES).length;
}

/**
 * Rewrites a live form's questions to the current template IN PLACE, keeping
 * its Form ID.
 *
 * Keeping the ID is the whole point: every calendar description, dashboard
 * link, registry entry, all-dates registrant record and label fingerprint in
 * the system is keyed by it, and none of them have to be chased down. The
 * cost is that responses already collected against the OLD questions lose
 * their per-question answers when those questions are deleted — which is why
 * this runs from syncRegistrations() only AFTER that run has imported
 * everything new. Rows already on Lunch_and_Event_Registrants are the record
 * of those registrations and are untouched.
 */
function rebuildFormFromCurrentTemplate(form, context) {
  clearFormNavigation(form);
  const items = form.getItems();
  for (let i = items.length - 1; i >= 0; i--) {
    form.deleteItem(items[i]);
  }
  addTemplateItemsToForm(form);

  const { allDateLabels, lunchDateLabels } = buildDateLabelSets(context.dates, context.location, context.capacityHints);
  form.setDescription(buildFormDescription(context.location, allDateLabels, context.isFixed, lunchDateLabels.length > 0));
  syncLunchQuestionsOnForm(form, context.location, lunchDateLabels.length > 0);
  // force: a rebuilt form's grids are back to the template placeholder row,
  // and its fingerprint on file still describes the labels it had before.
  applyFormDateLabels(form.getId(), allDateLabels, lunchDateLabels, { form, force: true, context: 'template migration' });
  applyFormFooterNote(form, getFormFooterForLocation(context.location));
  setFormTemplateVersion(form.getId(), TEMPLATE_VERSION);
}

/** Ceiling on how many out-of-date forms one execution will rebuild — see migrateFormsToCurrentTemplate(). */
const MAX_FORM_REBUILDS_PER_RUN = 5;

/**
 * Cuts every "go to section" link on a form: choice-level page navigation on
 * list/multiple-choice items, and page-level navigation on the page breaks
 * themselves.
 *
 * This is what a rebuild has to do FIRST. Deleting a page break that another
 * item's choice still points at leaves the form describing a jump to a
 * section that no longer exists, and Forms rejects the whole update with a
 * flat "Invalid data updating form" — which is exactly how a migration fails
 * on the old eight-section template, where seven choices point at branch
 * pages. Neutralize the links, and the items delete cleanly.
 */
function clearFormNavigation(form) {
  form.getItems().forEach(item => {
    try {
      const type = item.getType();
      if (type === FormApp.ItemType.PAGE_BREAK) {
        item.asPageBreakItem().setGoToPage(FormApp.PageNavigationType.CONTINUE);
        return;
      }
      if (type !== FormApp.ItemType.LIST && type !== FormApp.ItemType.MULTIPLE_CHOICE) return;
      const typed = type === FormApp.ItemType.LIST ? item.asListItem() : item.asMultipleChoiceItem();
      const values = typed.getChoices().map(c => c.getValue()).filter(v => v !== '' && v !== null && v !== undefined);
      if (values.length > 0) typed.setChoiceValues(values); // plain choices — no navigation attached
    } catch (err) {
      log(`ℹ️ Could not clear navigation on "${item.getTitle()}" of form ${form.getId()} (${err}) — continuing.`);
    }
  });
}

/**
 * Brings every live registration form up to the current template.
 *
 * This is the missing half of a TEMPLATE_VERSION bump. Bumping it rebuilds
 * the cached template, so forms created AFTERWARDS are correct — but a
 * group's form is created once and then reused for as long as the group
 * runs (see refreshFormForNewDates()), so the forms people are actually
 * filling in stayed on whatever template they were born with. A respondent
 * on a v1/v2 form still met the guest-count question and its branch pages,
 * and still got mis-routed by them; the fix shipped in the template never
 * reached them.
 *
 * Cheap by design: a form whose stamp already reads TEMPLATE_VERSION is
 * skipped without any API call, so the steady state costs one Script
 * Properties read. Only unstamped or stale forms are opened, and no more
 * than MAX_FORM_REBUILDS_PER_RUN are rebuilt in any one execution — a
 * rebuild is a few dozen Forms calls, and the hourly sync it rides on has a
 * six-minute ceiling. Whatever is left over is picked up next run, so a
 * backlog drains itself.
 *
 * Call AFTER responses have been imported — see rebuildFormFromCurrentTemplate().
 * Returns the number of forms rebuilt.
 */
function migrateFormsToCurrentTemplate(registrySheet, sessionRows) {
  const headers = HEADERS.Master_Program_Dashboard;
  const rows = sessionRows || readAllSectionedRows(registrySheet, headers, 'Event_ID');
  if (rows.length === 0) return 0;
  const map = getIndexMap(headers);
  const byForm = groupRegistryRowsByForm(rows, map);
  const versions = getFormTemplateVersions();

  const newUrlByFormId = {};
  let rebuilt = 0;
  let deferred = 0;

  Object.keys(byForm).forEach(formId => {
    if (versions[formId] === TEMPLATE_VERSION) return; // already known good — no API call
    if (rebuilt >= MAX_FORM_REBUILDS_PER_RUN) { deferred++; return; }

    let form;
    try {
      form = FormApp.openById(formId);
    } catch (err) {
      log(`⚠️ migrateFormsToCurrentTemplate: could not open form ${formId} (${err}).`);
      noteForAdmin('Forms that could not be opened', `${formId} — ${err}`);
      return;
    }

    if (isFormOnCurrentTemplate(form)) {
      setFormTemplateVersion(formId, TEMPLATE_VERSION); // first sighting of an already-current form: just record it
      return;
    }

    const formRows = byForm[formId];
    const location = formRows[0][map['Location']];
    const dates = formRows.map(r => coerceDate(r[map['Event_Date']])).filter(Boolean).sort((a, b) => a - b);
    if (dates.length === 0) return;

    try {
      rebuildFormFromCurrentTemplate(form, {
        location,
        dates,
        isFixed: formRows.some(r => r[map['Type_Tag']] === 'Fixed'),
        capacityHints: buildCapacityHintsFromRegistryRows(formRows, map)
      });
    } catch (err) {
      log(`⚠️ migrateFormsToCurrentTemplate: could not rebuild form ${formId} for "${location}" (${err}).`);
      noteForAdmin('Forms that could not be updated',
        `${formId} (${location}) still uses the old guest-count layout — rebuilding it failed with: ${err}`);
      return;
    }

    rebuilt++;
    newUrlByFormId[formId] = buildRegistrationUrl(form);
    log(`Rebuilt form ${formId} ("${location}") on template v${TEMPLATE_VERSION} — the guest-count branch pages are gone.`);
    noteForAdmin('Registration forms updated',
      `"${form.getTitle()}" (${location}) was still on the old guest-count layout and has been rebuilt on the current one. ` +
      `Its link is unchanged; the boxes it pre-checks are re-generated on the dashboard's "View Live Form" link, ` +
      `and calendar invites pick the new one up the next time that program's dates change.`);
  });

  if (rebuilt > 0) updateRegistryFormLinks(registrySheet, newUrlByFormId);
  if (deferred > 0) log(`${deferred} more form(s) still on an older template — they'll be rebuilt on the next sync.`);
  flushPersistentRegistries();
  return rebuilt;
}

/**
 * Re-points Master_Program_Dashboard's "View Live Form" links at freshly
 * generated URLs, for the forms in urlByFormId. Needed after a rebuild: the
 * link we hand out is a PREFILLED url (buildRegistrationUrl()) whose
 * entry.N parameters name the form's item IDs, and a rebuilt form has new
 * ones. The stale link still opens the right form — Forms ignores parameters
 * it doesn't recognize — it just stops pre-checking anything.
 */
function updateRegistryFormLinks(registrySheet, urlByFormId) {
  if (Object.keys(urlByFormId).length === 0) return;
  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return;
  const sheetMap = getHeaderMapAt(registrySheet, headerRows[0]); // 1-based, read off the sheet itself

  headerRows.forEach((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(registrySheet, hRow, nextHeader, sheetMap['Event_Date']);
    if (!zone) return;

    const idValues = registrySheet.getRange(zone.start, sheetMap['Form_ID'], zone.count, 1).getValues();
    const linkRange = registrySheet.getRange(zone.start, sheetMap['Form_Response_Link'], zone.count, 1);
    const formulas = linkRange.getFormulas();
    const values = linkRange.getValues();
    const links = formulas.map((f, r) => [f[0] || values[r][0]]); // leave every other row exactly as it is
    let touched = false;
    idValues.forEach((idRow, r) => {
      const url = urlByFormId[idRow[0]];
      if (!url) return;
      links[r] = [makeHyperlinkFormula(url, 'View Live Form')];
      touched = true;
    });
    if (touched) linkRange.setValues(links);
  });
}

/**
 * MAINTENANCE — run from the Apps Script editor when a form needs
 * re-checking right now rather than at the next hourly sync (which already
 * calls migrateFormsToCurrentTemplate() itself), or after someone has hand-
 * edited a form's questions, since the version stamps this clears are the
 * only reason a form gets skipped without being opened.
 *
 * Returns the number of forms that were actually rebuilt.
 */
function recheckAllRegistrationForms() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) return 0;

  PropertiesService.getScriptProperties().deleteProperty(FORM_TEMPLATE_VERSION_PROP_KEY);
  __formTemplateVersionCache = null;
  __formTemplateVersionDirty = false;

  const rebuilt = migrateFormsToCurrentTemplate(registrySheet);
  flushAdminDigest('Form re-check');
  log(`recheckAllRegistrationForms: rebuilt ${rebuilt} form(s) on template v${TEMPLATE_VERSION}.`);
  return rebuilt;
}

/**
 * ONE-TIME MAINTENANCE — run from the Apps Script editor, not wired to any
 * sync or the menu. createRegistrationForm() strips lunch questions off a
 * NEVER-policy location's form at creation, and refreshFormForNewDates()
 * catches up an existing form the next time it gains new dates — but a
 * form that already exists AND isn't due for new dates soon just sits with
 * stale lunch questions on it until one of those paths touches it. This
 * sweeps every currently-live form for a NEVER-policy location right now.
 *
 * Safe to run any time: removeLunchQuestionsFromForm() is a no-op on a form
 * that's already clean, so re-running this costs a few FormApp calls and
 * changes nothing.
 */
function cleanupNeverPolicyForms() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) return;

  const headers = HEADERS.Master_Program_Dashboard;
  const rows = readAllSectionedRows(registrySheet, headers, 'Event_ID');
  const map = getIndexMap(headers);

  const locationByForm = {};
  rows.forEach(row => {
    const formId = row[map['Form_ID']];
    const location = row[map['Location']];
    if (!formId || !location) return;
    if (!locationByForm[formId]) locationByForm[formId] = location;
  });

  let checked = 0;
  Object.keys(locationByForm).forEach(formId => {
    const location = locationByForm[formId];
    if (getCateringPolicyForLocation(location) !== CATERING_POLICIES.NEVER) return;
    checked++;
    try {
      removeLunchQuestionsFromForm(FormApp.openById(formId), location);
    } catch (err) {
      log(`⚠️ cleanupNeverPolicyForms: could not open form ${formId} for "${location}" (${err}).`);
    }
  });
  log(`cleanupNeverPolicyForms: checked ${checked} form(s) at Never-policy location(s).`);
}


// ============================================================================
// 6. SECTIONED TABLE HELPERS  (Upcoming / Past split — every date-bearing tab)
// ============================================================================
//
// Every tab keyed by Event_Date now renders as two stacked sub-tables: dates
// today-or-later ("Upcoming", ascending) and dates before today ("Past",
// most-recent-first). This section holds the shared machinery: finding a
// tab's (possibly several) header rows, reading all its rows regardless of
// which zone they're currently in, splitting rows by date, and writing the
// two zones back out with consistent banners/headers/zebra striping/month
// tinting. Master_Program_Dashboard and Master_Lunch_Dashboard call the
// lower-level writeUpcomingPastSections() directly (since they have their
// own extra Today/Metrics sections above); the three flat, single-table
// tabs (Lunch_and_Event_Registrants, Deleted_Event_Triage, Lunch_Schedule)
// use the renderFlatDateSheet() wrapper instead.
// ============================================================================

/**
 * Given the exact row of one header and the row of the NEXT header (or null
 * if this is the last zone), finds the contiguous span of rows in between
 * that actually contain a parseable date in dateCol1Based — i.e. the real
 * data rows, skipping whatever banner/spacer rows sit in between. Returns
 * null if the zone has no data rows.
 */
function getZoneDataRange(sheet, headerRow, nextHeaderRow, dateCol1Based) {
  if (!dateCol1Based) return null;
  const scanEnd = nextHeaderRow ? nextHeaderRow - 1 : sheet.getLastRow();
  if (scanEnd < headerRow + 1) return null;
  const values = sheet.getRange(headerRow + 1, dateCol1Based, scanEnd - headerRow, 1).getValues();
  let firstRow = -1, lastRow = -1;
  values.forEach((v, i) => {
    if (coerceDate(v[0])) {
      if (firstRow === -1) firstRow = headerRow + 1 + i;
      lastRow = headerRow + 1 + i;
    }
  });
  if (firstRow === -1) return null;
  return { start: firstRow, count: lastRow - firstRow + 1 };
}

/** Returns [{headerRow, dataStart, dataEnd}, ...] for every header row found via `markerHeaderName` on `sheet`. */
function getSectionZones(sheet, markerHeaderName) {
  const headerRows = findAllHeaderRows(sheet, markerHeaderName, 5000);
  if (headerRows.length === 0) return [];
  const map = getHeaderMapAt(sheet, headerRows[0]);
  const dateCol = map['Event_Date'];
  return headerRows.map((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(sheet, hRow, nextHeader, dateCol);
    return zone
      ? { headerRow: hRow, dataStart: zone.start, dataEnd: zone.start + zone.count - 1 }
      : { headerRow: hRow, dataStart: hRow + 1, dataEnd: hRow };
  });
}

function isRowInAnyDataZone(zones, row) {
  return findZoneForRow(zones, row) !== null;
}

/** The zone (from getSectionZones()) whose data rows contain `row`, or null. */
function findZoneForRow(zones, row) {
  return zones.filter(z => row >= z.dataStart && row <= z.dataEnd)[0] || null;
}

/**
 * Reads every current data row across all of a tab's stacked sub-tables
 * (each with its own header row located via `markerHeaderName`) into one
 * combined array, preserving formulas. Banner/spacer rows are skipped
 * automatically since they never contain a parseable Event_Date.
 *
 * Rows come back in `headers` order even when the SHEET's own columns are in
 * a different order — see buildHeaderProjection(). That is what lets a
 * HEADERS entry be reordered (or gain/lose a column) without scrambling the
 * data already sitting on the tab: the next render reads by header NAME and
 * writes back out in the new order.
 */
function readAllSectionedRows(sheet, headers, markerHeaderName) {
  const headerRows = findAllHeaderRows(sheet, markerHeaderName, 5000);
  if (headerRows.length === 0) return [];
  const lastRow = sheet.getLastRow();
  const sheetLastCol = Math.max(sheet.getLastColumn(), headers.length);
  const dateColIdx = headers.indexOf('Event_Date');
  let combined = [];
  headerRows.forEach((hRow, i) => {
    const zoneEnd = (i + 1 < headerRows.length) ? headerRows[i + 1] - 1 : lastRow;
    if (zoneEnd <= hRow) return;
    const projection = buildHeaderProjection(sheet, hRow, headers, sheetLastCol);
    const numCols = projection ? sheetLastCol : headers.length;
    let rows = getRowsPreservingFormulas(sheet, hRow + 1, 1, zoneEnd - hRow, numCols);
    if (projection) rows = rows.map(row => projection.map(src => (src === -1 ? '' : row[src])));
    combined = combined.concat(dateColIdx >= 0 ? rows.filter(row => coerceDate(row[dateColIdx])) : rows);
  });
  return combined;
}

/**
 * Compares a header ROW as it actually sits on the sheet against the header
 * array the code expects.
 *
 * Returns null when they already line up column-for-column — the fast path,
 * and the only case that ever ran before this existed. Otherwise returns a
 * per-canonical-column array of 0-based SHEET column indexes (-1 for a
 * column the sheet doesn't have yet), so readAllSectionedRows() can project
 * each row into the expected order.
 *
 * This is what makes changing a HEADERS layout safe on a workbook that
 * already holds data. Reordering the array used to silently reinterpret
 * every stored row positionally — with Event_Date moving to column A, every
 * existing registrant row would have been read with a Location string where
 * its date belonged, failed the date filter, and been dropped on the next
 * render.
 */
function buildHeaderProjection(sheet, headerRow, headers, lastCol) {
  const rowValues = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0].map(normalizeHeaderText);
  const alreadyAligned = headers.every((h, i) => rowValues[i] === h);
  if (alreadyAligned) return null;

  const colByName = {};
  rowValues.forEach((name, i) => { if (name && colByName[name] === undefined) colByName[name] = i; });
  const projection = headers.map(h => (colByName[h] === undefined ? -1 : colByName[h]));
  const missing = headers.filter((h, i) => projection[i] === -1);
  log(`Re-aligned "${sheet.getName()}" row ${headerRow} by header name` +
    (missing.length > 0 ? ` (no column on the sheet yet for: ${missing.join(', ')})` : ''));
  return projection;
}

/** Splits rows into { upcoming (today-or-later, ascending), past (before today, most-recent-first) }. Rows with no parseable date are treated as upcoming (kept visible). */
function partitionByDate(rows, dateColIdx, todayKey) {
  const upcoming = [], past = [];
  rows.forEach(row => {
    const d = dateColIdx >= 0 ? coerceDate(row[dateColIdx]) : null;
    if (!d) { upcoming.push(row); return; }
    if (formatDateKey(d) >= todayKey) upcoming.push(row); else past.push(row);
  });
  const byDateAsc = (a, b) => {
    const da = coerceDate(a[dateColIdx]), db = coerceDate(b[dateColIdx]);
    if (!da || !db) return 0;
    return da - db;
  };
  upcoming.sort(byDateAsc);
  past.sort((a, b) => -byDateAsc(a, b));
  return { upcoming, past };
}

/**
 * Writes two stacked sub-tables ("Upcoming" then "Past") starting at
 * `startRow`, each with its own banner, header row, and zebra-striped/
 * month-tinted data rows. Returns the exact row numbers used, so callers
 * can layer per-zone validation/conditional-formatting/formulas on top.
 */
function writeUpcomingPastSections(sheet, startRow, headers, upcomingRows, pastRows, options) {
  options = options || {};
  const numCols = headers.length;
  const dateColIdx = headers.indexOf('Event_Date');
  let row = startRow;

  writeSectionBanner(sheet, row, numCols, options.upcomingLabel || '⏳ Upcoming');
  row++;
  writeSectionHeader(sheet, row, numCols, headers);
  const upcomingHeaderRow = row;
  row++;
  const upcomingDataStart = row;
  if (upcomingRows.length > 0) sheet.getRange(upcomingDataStart, 1, upcomingRows.length, numCols).setValues(upcomingRows);
  applyZebraStripingManualBounded(sheet, upcomingDataStart, upcomingRows.length, numCols);
  if (dateColIdx >= 0) applyMonthColorTint(sheet, dateColIdx + 1, upcomingDataStart, upcomingRows.length);
  row += upcomingRows.length;
  row++; // spacer

  writeSectionBanner(sheet, row, numCols, options.pastLabel || '🕓 Past');
  row++;
  writeSectionHeader(sheet, row, numCols, headers);
  const pastHeaderRow = row;
  row++;
  const pastDataStart = row;
  if (pastRows.length > 0) sheet.getRange(pastDataStart, 1, pastRows.length, numCols).setValues(pastRows);
  applyZebraStripingManualBounded(sheet, pastDataStart, pastRows.length, numCols);
  if (dateColIdx >= 0) applyMonthColorTint(sheet, dateColIdx + 1, pastDataStart, pastRows.length);
  row += pastRows.length;

  return {
    nextRow: row + 1,
    upcomingHeaderRow, upcomingDataStart, upcomingCount: upcomingRows.length,
    pastHeaderRow, pastDataStart, pastCount: pastRows.length
  };
}

/**
 * Fully rebuilds a "flat" (single logical table) sheet into Upcoming/Past
 * sub-tables, driven entirely by each row's Event_Date. Used for
 * Lunch_and_Event_Registrants, Deleted_Event_Triage, and Lunch_Schedule.
 */
function renderFlatDateSheet(sheet, headers, allRows, opts) {
  opts = opts || {};
  sheet.clear();
  sheet.clearFormats();
  sheet.getBandings().forEach(b => b.remove());
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();

  const todayKey = formatDateKey(new Date());
  const dateColIdx = headers.indexOf('Event_Date');
  const { upcoming, past } = partitionByDate(allRows, dateColIdx, todayKey);

  const result = writeUpcomingPastSections(sheet, 1, headers, upcoming, past, opts);
  sheet.setFrozenRows(result.upcomingHeaderRow);

  if (opts.afterWrite) opts.afterWrite(sheet, headers, result);

  autosizeColumns(sheet, { force: !!opts.force, minCols: headers.length });
  return result;
}


// ============================================================================
// 6b. PER-SHEET RENDER WRAPPERS  (Registrants / Triage / Lunch_Schedule)
// ============================================================================

function renderRegistrantsSheet(force, allRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.LUNCH_EVENT_REGISTRANTS);
  const headers = HEADERS.Lunch_and_Event_Registrants;
  const rows = allRows || readAllSectionedRows(sheet, headers, 'Event_ID');
  return renderFlatDateSheet(sheet, headers, rows, {
    upcomingLabel: '⏳ Upcoming Registrants',
    pastLabel: '🕓 Past Registrants',
    force,
    afterWrite: applyRegistrantsFormatting
  });
}

function renderTriageSheet(force, allRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.TRIAGE);
  const headers = HEADERS.Deleted_Event_Triage;
  const rows = allRows || readAllSectionedRows(sheet, headers, 'Event_ID');
  return renderFlatDateSheet(sheet, headers, rows, {
    upcomingLabel: '⏳ Upcoming (Triaged)',
    pastLabel: '🕓 Past (Triaged)',
    force,
    afterWrite: applyRegistrantsFormatting
  });
}

/**
 * Shared formatting for Lunch_and_Event_Registrants AND Deleted_Event_Triage
 * — both carry the same Manual_Override / Program_Status / Lunch_Status /
 * Order_Ahead_Flag / Event_Date columns, just with Triage adding a few
 * extra trailing columns that don't need special styling beyond zebra.
 */
function applyRegistrantsFormatting(sheet, headers, result) {
  const map = getIndexMap(headers);
  const zones = [
    { start: result.upcomingDataStart, count: result.upcomingCount },
    { start: result.pastDataStart, count: result.pastCount }
  ];

  zones.forEach(z => {
    if (z.count < 1) return;
    applyManualOverrideValidationBounded(sheet, map['Manual_Override'] + 1, z.start, z.count);
    applyValueListValidationBounded(sheet, map['Program_Status'] + 1, PROGRAM_STATUS_OPTIONS, z.start, z.count);
    applyValueListValidationBounded(sheet, map['Lunch_Status'] + 1, LUNCH_STATUS_OPTIONS, z.start, z.count);
    applyValueListValidationBounded(sheet, map['Lunch_Type'] + 1, REGISTRANT_LUNCH_TYPE_OPTIONS, z.start, z.count);
  });

  const overrideCol = map['Manual_Override'] + 1;
  const programCol = map['Program_Status'] + 1;
  const lunchCol = map['Lunch_Status'] + 1;
  const orderAheadCol = map['Order_Ahead_Flag'] + 1;
  const dateCol = map['Event_Date'] + 1;

  const rules = [];
  zones.forEach(z => {
    if (z.count < 1) return;
    rules.push(...buildManualOverrideRowTintRules(sheet, z.start, z.count, headers.length, overrideCol, [programCol, lunchCol, orderAheadCol, dateCol]));
  });

  const activeZones = zones.filter(z => z.count > 0);
  const programRanges = activeZones.map(z => sheet.getRange(z.start, programCol, z.count, 1));
  const lunchRanges = activeZones.map(z => sheet.getRange(z.start, lunchCol, z.count, 1));
  const orderAheadRanges = activeZones.map(z => sheet.getRange(z.start, orderAheadCol, z.count, 1));

  ['Cancelled', 'Waitlisted', 'Active', 'Superseded'].forEach(text => {
    const rule = buildTextEqualsRuleForRanges(programRanges, text, REGISTRANT_STATUS_COLORS[text]);
    if (rule) rules.push(rule);
  });
  ['Cancelled', 'Waitlisted', 'Needed', 'Superseded'].forEach(text => {
    const rule = buildTextEqualsRuleForRanges(lunchRanges, text, REGISTRANT_STATUS_COLORS[text]);
    if (rule) rules.push(rule);
  });
  if (orderAheadRanges.length > 0) {
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenCellNotEmpty().setBackground(ORDER_AHEAD_FLAG_COLOR).setRanges(orderAheadRanges).build());
  }

  sheet.setConditionalFormatRules(rules);
  // No autosize here on purpose: this runs as renderFlatDateSheet()'s
  // afterWrite hook, and that function autosizes immediately afterward.
  // Doing it in both places sized Registrants and Triage twice per render.
}

function renderLunchScheduleSheet(force, allRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.LUNCH_SCHEDULE);
  const headers = HEADERS.Lunch_Schedule;
  const rows = allRows || readAllSectionedRows(sheet, headers, 'Event_Date');
  const result = renderFlatDateSheet(sheet, headers, rows, {
    upcomingLabel: '⏳ Upcoming Menu',
    pastLabel: '🕓 Past Menu',
    force,
    afterWrite: applyLunchScheduleFormatting
  });
  invalidateMealInfoIndex(); // this tab is exactly what getMealInfoIndex() is built from
  return result;
}

function applyLunchScheduleFormatting(sheet, headers, result) {
  const map = getIndexMap(headers);
  const zones = [
    { start: result.upcomingDataStart, count: result.upcomingCount },
    { start: result.pastDataStart, count: result.pastCount }
  ];

  zones.forEach(z => {
    if (z.count < 1) return;
    applyValueListValidationBounded(sheet, map['Location'] + 1, Object.values(CALENDAR_MAP), z.start, z.count);
    applyValueListValidationBounded(sheet, map['Type'] + 1, LUNCH_TYPE_OPTIONS, z.start, z.count);
  });

  const rules = [];
  const activeZones = zones.filter(z => z.count > 0);
  const locRanges = activeZones.map(z => sheet.getRange(z.start, map['Location'] + 1, z.count, 1));
  rules.push(...buildLocationColorRules(locRanges));

  const typeRanges = activeZones.map(z => sheet.getRange(z.start, map['Type'] + 1, z.count, 1));
  const notServingRule = buildTextEqualsRuleForRanges(typeRanges, 'Not Serving', NOT_SERVING_COLOR);
  if (notServingRule) rules.push(notServingRule);

  sheet.setConditionalFormatRules(rules);
}


// ============================================================================
// 7. MASTER PROGRAM DASHBOARD  (renderProgramDashboard)
// ============================================================================
//
// One function rebuilds the ENTIRE sheet, top to bottom, every time it's
// called: it reads whatever is currently across both the Upcoming and Past
// session sub-tables, removes any session whose calendar event has
// disappeared (routing its registrants to Triage first, refreshing that
// session's form), sorts/splits the rest by date, computes the Today/
// Metrics sections, then clears the sheet and writes everything fresh.
// ============================================================================

/**
 * options.registrantRows — already-in-memory Lunch_and_Event_Registrants
 * rows, to skip re-reading that tab. Honored only when this render's own
 * triage pass didn't rewrite the tab underneath them (see registrantsMoved).
 * Returns { registrantsMoved } so a caller holding those rows knows whether
 * they are still safe to reuse afterward.
 */
function renderProgramDashboard(force, options) {
  options = options || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
  const registrantsSheet = getOrCreateSheet(ss, SHEET_NAMES.LUNCH_EVENT_REGISTRANTS);
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);

  let sessionRows = readAllSectionedRows(sheet, headers, 'Event_ID');

  const triageResult = triageDeletedSessions(sessionRows, map, registrantsSheet);
  sessionRows = triageResult.rows;

  sessionRows.forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (d) row[map['Event_Date']] = d;
  });

  if (triageResult.affectedFormIds.size > 0) {
    refreshFormDateListsForForms(sessionRows, map, triageResult.affectedFormIds);
  }

  const reusableRegistrantRows = triageResult.registrantsMoved ? null : options.registrantRows;
  const registrantScan = scanRegistrants(registrantsSheet, reusableRegistrantRows);
  const todayData = buildTodayAtLocations(sessionRows, map, registrantScan);
  const metrics = computeProgramMetrics(sessionRows, map, registrantScan);

  writeProgramDashboardSheet(sheet, headers, map, sessionRows, todayData, metrics, force);
  return { registrantsMoved: triageResult.registrantsMoved };
}

/**
 * A triage sweep this size is treated as a symptom, not an instruction — see
 * triageDeletedSessions(). Both have to be exceeded before a sweep is
 * refused, so deleting one whole small program still works normally while a
 * "everything vanished" reading never does.
 */
const TRIAGE_MAX_SESSIONS_PER_RUN = 15;
const TRIAGE_MAX_FRACTION_PER_RUN = 0.25;
/** One-shot property set by confirmLargeTriage() to let the next sweep exceed those limits. */
const TRIAGE_OVERRIDE_PROP_KEY = 'TRIAGE_OVERRIDE_ONCE';

/**
 * Cross-checks in-memory session rows against what's genuinely still on the
 * calendars right now and drops any that are gone. Dropped sessions'
 * registrants are moved to Deleted_Event_Triage. Master_Program_Dashboard no
 * longer has a Manual_Override column, so nothing can be protected from
 * this anymore — every session's presence is strictly calendar-derived.
 *
 * WHICH MAKES THIS THE MOST DESTRUCTIVE FUNCTION IN THE FILE, and it is
 * built to distrust itself accordingly:
 *
 *   1. A calendar that could not be READ proves nothing. getCalendarById()
 *      returns null on a transient failure, and the old code read that as an
 *      empty event list — i.e. "every session at that location is deleted."
 *      Rows whose Calendar_Source we couldn't read are now left alone.
 *   2. A sweep that would take out most of the table is refused outright.
 *      Programs get cancelled a few at a time; 268 sessions disappearing at
 *      once is a failed calendar read, a mid-import snapshot, or a bug — and
 *      the cost of pausing is one log line, while the cost of proceeding is
 *      the whole dashboard plus every registrant on it. confirmLargeTriage()
 *      is the way to say "no, really".
 *   3. While a bootstrap import is in flight, nothing is triaged at all: the
 *      session table is being written as we read it.
 */
function triageDeletedSessions(sessionRows, map, registrantsSheet) {
  const empty = { rows: sessionRows, affectedFormIds: new Set(), registrantsMoved: false };

  if (isBootstrapActive()) {
    log('Triage skipped: a large-setup import is still writing the session table.');
    return empty;
  }

  const { start, end } = computeSyncDateRange();

  // Shares syncCalendarsInternal()'s fetch for this window — a full
  // initializeAndSyncAll() used to hit every calendar four separate times
  // (once per renderProgramDashboard(), plus the sync's own scan).
  const eventsByCalendar = getCalendarEventsForWindow(start, end);
  const readableCalendars = new Set();
  const liveEventIds = new Set();
  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    const events = eventsByCalendar[calendarId];
    if (!events) {
      log(`⚠️ Triage: "${CALENDAR_MAP[calendarId]}" could not be read this run — its sessions are left as they are.`);
      return;
    }
    readableCalendars.add(calendarId);
    events.forEach(ev => {
      if (ev.isAllDayEvent()) return;
      const parsed = parseEventTitle(ev.getTitle());
      if (!parsed) return;
      liveEventIds.add(computeEventId(calendarId, parsed.cleanTitle, formatDateKey(ev.getStartTime())));
    });
  });

  if (readableCalendars.size === 0) {
    log('Triage skipped: no calendar could be read this run.');
    return empty;
  }

  const doomedRows = [];
  const deletedEventInfo = {};
  sessionRows.forEach(row => {
    const eventId = row[map['Event_ID']];
    const d = coerceDate(row[map['Event_Date']]);
    const source = row[map['Calendar_Source']];
    // No Calendar_Source (a hand-added row) can't be attributed to a calendar
    // we verified, so it is never triaged.
    if (!eventId || !d || !source || !readableCalendars.has(source)) return;
    if (d < start || d > end) return; // outside the window we can see
    if (liveEventIds.has(eventId)) return;
    doomedRows.push(row);
    deletedEventInfo[eventId] = { cleanTitle: row[map['Clean_Title']], location: row[map['Location']] };
  });

  const deletedCount = Object.keys(deletedEventInfo).length;
  if (deletedCount === 0) return empty;

  if (isTriageTooBig(deletedCount, sessionRows.length)) {
    const message = `Triage REFUSED: ${deletedCount} of ${sessionRows.length} session(s) looked deleted in one pass, ` +
      `which is far more likely to be a bad calendar read than ${deletedCount} real cancellations. ` +
      `Nothing was removed. If they really are all gone, run confirmLargeTriage() from the Apps Script ` +
      `editor and let the next sync through.`;
    log(`⚠️ ${message}`);
    noteForAdmin('Sessions that look deleted', message);
    return empty;
  }

  const doomedSet = new Set(doomedRows);
  const keep = sessionRows.filter(row => !doomedSet.has(row));
  const affectedFormIds = new Set();
  doomedRows.forEach(row => {
    const formId = row[map['Form_ID']];
    if (formId) affectedFormIds.add(formId);
  });

  moveRegistrantsToTriage(registrantsSheet, deletedEventInfo);
  log(`Triaged ${deletedCount} deleted event(s) during dashboard render.`);

  // registrantsMoved tells callers that any registrant rows they were
  // holding from before this call are now stale — moveRegistrantsToTriage()
  // rewrites the Registrants tab.
  return { rows: keep, affectedFormIds, registrantsMoved: true };
}

/** Is this sweep big enough to need a human? Consumes the one-shot override if one is set. */
function isTriageTooBig(deletedCount, totalRows) {
  const overLimit = deletedCount > TRIAGE_MAX_SESSIONS_PER_RUN &&
    deletedCount > totalRows * TRIAGE_MAX_FRACTION_PER_RUN;
  if (!overLimit) return false;

  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(TRIAGE_OVERRIDE_PROP_KEY)) {
    props.deleteProperty(TRIAGE_OVERRIDE_PROP_KEY); // one sweep only
    log('Large triage allowed once by confirmLargeTriage().');
    return false;
  }
  return true;
}

/**
 * MAINTENANCE — run from the Apps Script editor. Lets the NEXT sweep remove
 * more sessions than the safety limit allows, once. Use it after checking
 * that the sessions really are gone from the calendar.
 */
function confirmLargeTriage() {
  PropertiesService.getScriptProperties().setProperty(TRIAGE_OVERRIDE_PROP_KEY, String(Date.now()));
  log(`confirmLargeTriage: the next sweep may exceed ${TRIAGE_MAX_SESSIONS_PER_RUN} sessions. ` +
    `Run "Sync Cal" to trigger it — the permission is used up by that one sweep.`);
}

/** After sessions are removed (their calendar event vanished), pushes an updated date list to any form those sessions belonged to. */
function refreshFormDateListsForForms(keptSessionRows, map, affectedFormIds) {
  const datesByForm = {};
  const locationByForm = {};
  const rowsByForm = {};
  keptSessionRows.forEach(row => {
    const formId = row[map['Form_ID']];
    if (!formId || !affectedFormIds.has(formId)) return;
    const d = coerceDate(row[map['Event_Date']]);
    if (!d) return;
    if (!datesByForm[formId]) datesByForm[formId] = [];
    datesByForm[formId].push(d);
    if (!locationByForm[formId]) locationByForm[formId] = row[map['Location']];
    if (!rowsByForm[formId]) rowsByForm[formId] = [];
    rowsByForm[formId].push(row);
  });

  affectedFormIds.forEach(formId => {
    const dates = (datesByForm[formId] || []).sort((a, b) => a - b);
    const location = locationByForm[formId];
    const capacityHints = buildCapacityHintsFromRegistryRows(rowsByForm[formId] || [], map);
    const { allDateLabels, lunchDateLabels } = buildDateLabelSets(dates, location, capacityHints);
    const attendanceLabels = allDateLabels.length > 0 ? allDateLabels : ['No upcoming dates'];
    const lunchLabels = lunchDateLabels.length > 0 ? lunchDateLabels : ['No upcoming dates'];
    if (applyFormDateLabels(formId, attendanceLabels, lunchLabels, { context: 'deleted-event cleanup' })) {
      log(`Refreshed form ${formId}'s date list to ${dates.length} remaining date(s) after a deleted-event cleanup.`);
    }
    if (dates.length === 0) {
      // Emptying a live form is a big enough thing to say out loud: it means
      // every session that form covered is gone from the calendar.
      noteForAdmin('Registration forms left with no dates',
        `Form ${formId} (${location || 'unknown location'}) now shows "No upcoming dates" — every session it covered ` +
        `disappeared from the calendar. Check that this was intended.`);
    }
  });
  flushPersistentRegistries();
}

/** One pass over Lunch_and_Event_Registrants powering BOTH the Today block and the participation metrics. */
function scanRegistrants(registrantsSheet, registrantRows) {
  const result = { countsByEventId: {}, activeNamesByEventId: {} };
  const headers = HEADERS.Lunch_and_Event_Registrants;
  const rows = registrantRows || readAllSectionedRows(registrantsSheet, headers, 'Event_ID');
  const map = getIndexMap(headers);
  rows.forEach(row => {
    const eventId = row[map['Event_ID']];
    if (!eventId) return;
    const status = row[map['Program_Status']];
    const name = row[map['Name']];

    if (!result.countsByEventId[eventId]) result.countsByEventId[eventId] = { active: 0, waitlist: 0 };
    if (status === 'Active') {
      result.countsByEventId[eventId].active++;
      if (name) {
        if (!result.activeNamesByEventId[eventId]) result.activeNamesByEventId[eventId] = new Set();
        result.activeNamesByEventId[eventId].add(String(name).trim());
      }
    }
    if (status === 'Waitlisted') result.countsByEventId[eventId].waitlist++;
  });
  return result;
}

/** One row per CALENDAR_MAP location, summarizing what's happening there today. */
function buildTodayAtLocations(sessionRows, map, registrantScan) {
  const todayKey = formatDateKey(new Date());
  const locations = Object.values(CALENDAR_MAP);

  return locations.map(loc => {
    const todaysSessions = sessionRows.filter(row => {
      const d = coerceDate(row[map['Event_Date']]);
      return d && formatDateKey(d) === todayKey && row[map['Location']] === loc;
    });
    const programs = Array.from(new Set(todaysSessions.map(r => r[map['Clean_Title']]))).sort();
    const registeredToday = todaysSessions.reduce((sum, row) => {
      const c = registrantScan.countsByEventId[row[map['Event_ID']]];
      return sum + (c ? c.active : 0);
    }, 0);
    return {
      location: loc,
      programsToday: programs.length > 0 ? programs.join(', ') : 'No programs today',
      sessionsToday: todaysSessions.length,
      registeredToday
    };
  });
}

/** Computes the "Program Participation Metrics" numbers directly from the session table + a live registrant scan. */
function computeProgramMetrics(sessionRows, map, registrantScan) {
  const totalSessions = sessionRows.length;
  const uniqueTitles = new Set();
  const uniqueParticipants = new Set();
  let totalRegistrations = 0;
  const fillRates = [];

  sessionRows.forEach(row => {
    const title = row[map['Clean_Title']];
    if (title) uniqueTitles.add(title);

    const eventId = row[map['Event_ID']];
    const c = registrantScan.countsByEventId[eventId];
    const active = c ? c.active : 0;
    totalRegistrations += active;

    const names = registrantScan.activeNamesByEventId[eventId];
    if (names) names.forEach(n => uniqueParticipants.add(n));

    const rawCap = row[map['Max_Capacity']];
    const isUncapped = rawCap === '--' || rawCap === '' || Number(rawCap) <= 0;
    if (!isUncapped) {
      const cap = Number(rawCap);
      if (cap > 0) fillRates.push((active / cap) * 100);
    }
  });

  const avgFillRate = fillRates.length > 0 ? `${Math.round(fillRates.reduce((a, b) => a + b, 0) / fillRates.length)}%` : '';

  return {
    totalPrograms: uniqueTitles.size,
    totalSessions,
    totalRegistrations,
    totalUniqueParticipants: uniqueParticipants.size,
    avgFillRate
  };
}

function setEventTimeFormulas(sheet, dataStart, count, map, dateColLetter) {
  if (count < 1) return;
  const formulas = [];
  for (let i = 0; i < count; i++) formulas.push([`=TEXT(${dateColLetter}${dataStart + i},"h:mm AM/PM")`]);
  sheet.getRange(dataStart, map['Event_Time'] + 1, count, 1).setFormulas(formulas);
}

/** Clears the sheet and redraws all sections in order, then applies all formatting. */
function writeProgramDashboardSheet(sheet, headers, map, sessionRows, todayData, metrics, force) {
  sheet.clear();
  sheet.clearFormats();
  sheet.getBandings().forEach(b => b.remove());
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();

  const numCols = headers.length;
  let row = 1;

  // --- Section A: Today at Each Location ---
  writeSectionBanner(sheet, row, numCols, '📍 Today at Each Location');
  row++;
  writeSectionHeader(sheet, row, TODAY_AT_LOCATIONS_HEADERS.length, TODAY_AT_LOCATIONS_HEADERS);
  row++;
  const todayDataStart = row;
  const todayRowsOut = todayData.map(t => [t.location, t.programsToday, t.sessionsToday, t.registeredToday]);
  if (todayRowsOut.length > 0) sheet.getRange(todayDataStart, 1, todayRowsOut.length, TODAY_AT_LOCATIONS_HEADERS.length).setValues(todayRowsOut);
  applyZebraStripingManualBounded(sheet, todayDataStart, todayRowsOut.length, TODAY_AT_LOCATIONS_HEADERS.length);
  row += todayRowsOut.length;
  row++; // spacer

  // --- Section B: Program Participation Metrics ---
  writeSectionBanner(sheet, row, numCols, '📈 Program Participation Metrics');
  row++;
  const metricHeaders = ['Total Programs', 'Total Sessions', 'Total Registrations', 'Unique Participants', 'Avg Fill Rate'];
  writeSectionHeader(sheet, row, metricHeaders.length, metricHeaders);
  row++;
  sheet.getRange(row, 1, 1, metricHeaders.length)
    .setValues([[metrics.totalPrograms, metrics.totalSessions, metrics.totalRegistrations, metrics.totalUniqueParticipants, metrics.avgFillRate]])
    .setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  row++;
  row++; // spacer

  // --- Section C: All Program Sessions, split into Upcoming / Past ---
  const todayKey = formatDateKey(new Date());
  const { upcoming, past } = partitionByDate(sessionRows, map['Event_Date'], todayKey);
  const result = writeUpcomingPastSections(sheet, row, headers, upcoming, past, {
    upcomingLabel: '🔜 Upcoming Sessions', pastLabel: '🕓 Past Sessions'
  });

  const dateColLetter = columnToLetter(map['Event_Date'] + 1);
  setEventTimeFormulas(sheet, result.upcomingDataStart, upcoming.length, map, dateColLetter);
  setEventTimeFormulas(sheet, result.pastDataStart, past.length, map, dateColLetter);

  const zones = [
    { start: result.upcomingDataStart, count: upcoming.length },
    { start: result.pastDataStart, count: past.length }
  ];
  const rules = [];
  const locationRanges = [];
  if (todayRowsOut.length > 0) locationRanges.push(sheet.getRange(todayDataStart, 1, todayRowsOut.length, 1));

  zones.forEach(z => {
    if (z.count < 1) return;
    ['Active_Count', 'Max_Capacity', 'Waitlist_Count', 'Remaining_Seats'].forEach(h => {
      sheet.getRange(z.start, map[h] + 1, z.count, 1).setNumberFormat('0');
    });
    applyLocationValidationBounded(sheet, map['Location'] + 1, z.start, z.count);
    applyValueListValidationBounded(sheet, map['Type_Tag'] + 1, EVENT_TYPE_OPTIONS, z.start, z.count);

    Object.keys(EVENT_STATUS_COLORS).forEach(text => {
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text).setBackground(EVENT_STATUS_COLORS[text])
        .setRanges([sheet.getRange(z.start, map['Status'] + 1, z.count, 1)]).build());
    });
    locationRanges.push(sheet.getRange(z.start, map['Location'] + 1, z.count, 1));
  });

  rules.push(...buildLocationColorRules(locationRanges));
  sheet.setConditionalFormatRules(rules);

  // Freeze through the Today block only, so it stays visible while the rest scrolls.
  sheet.setFrozenRows(todayDataStart + todayRowsOut.length - 1);
  autosizeColumns(sheet, { force: !!force, minCols: headers.length });
  log(`renderProgramDashboard complete: ${todayRowsOut.length} location(s) today, ${upcoming.length} upcoming / ${past.length} past session row(s).`);
}


// ============================================================================
// 8. MASTER LUNCH DASHBOARD  (updateMasterLunchDashboard)
// ============================================================================
//
// Row layout:
//   1              Today banner (merged)
//   2              Today headers (TODAY_LUNCH_HEADERS)
//   3..(2+N)       One Today row per location, N = number of locations
//   spacerRow      Blank
//   (from there)   Upcoming Lunch Schedule banner/header/data, then a
//                  spacer, then Past Lunch Schedule banner/header/data —
//                  sizes are dynamic, computed fresh every render.
//
// The Today block is a pure, fully-recomputed READ-ONLY view — it's never
// itself edited. The Full Schedule (Upcoming+Past) is upserted, so
// hand-entered buffers/actuals/discrepancy numbers and Manually Added rows
// survive every sync.
// ============================================================================

function getDashboardRowPlan() {
  const numLocations = Math.max(Object.keys(CALENDAR_MAP).length, 1);
  const todayBannerRow = 1;
  const todayHeaderRow = 2;
  const todayDataStart = 3;
  const todayDataEnd = todayDataStart + numLocations - 1;
  const spacerRow = todayDataEnd + 1;
  const scheduleStartRow = spacerRow + 1;
  return { numLocations, todayBannerRow, todayHeaderRow, todayDataStart, todayDataEnd, spacerRow, scheduleStartRow };
}

/**
 * Aggregates Master_Program_Dashboard's session table + Lunch_and_Event_Registrants
 * into one row per (date, location): how many people need lunch, plus that
 * day's Meal_Shorthand/Type pulled from Lunch_Schedule (per date AND
 * location now). Only rows with Program_Status=Active AND Lunch_Status=Needed
 * count toward catering.
 *
 * Every UPCOMING session date+location is seeded at count 0 whether or not
 * anyone has registered yet, so the catering schedule shows what is coming
 * instead of materializing a date only once its first registrant appears —
 * staff need the empty rows to plan against (and to hand-enter buffers on).
 * Dates explicitly marked "Not Serving" for their location are left out;
 * a date with no Lunch_Schedule row at all IS seeded, since an unconfigured
 * date is exactly the thing worth surfacing. Past dates are never seeded —
 * that would backfill a wall of empty history.
 */
function buildDashboardRollup(registrantRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const registrantsSheet = ss.getSheetByName(SHEET_NAMES.LUNCH_EVENT_REGISTRANTS);
  if (!registrySheet) return [];

  const regHeaders = HEADERS.Master_Program_Dashboard;
  const regRows = readAllSectionedRows(registrySheet, regHeaders, 'Event_ID');
  if (regRows.length === 0) return [];
  const regMap = getIndexMap(regHeaders);

  const eventMeta = {};
  regRows.forEach(row => {
    const eventId = row[regMap['Event_ID']];
    const d = coerceDate(row[regMap['Event_Date']]);
    if (!eventId || !d) return;
    eventMeta[eventId] = { dateKey: formatDateKey(d), location: row[regMap['Location']] || '' };
  });

  const rollup = {};

  // Seed upcoming date+location pairs at 0 so the schedule shows what's
  // coming rather than only what's already been registered for — but only
  // where the location's catering policy says lunch is on the table. Without
  // this filter a never-catering location (Zoom) contributes a blank row for
  // every single session it runs. See isLunchOfferedOn().
  const todayKey = formatDateKey(new Date());
  Object.keys(eventMeta).forEach(eventId => {
    const meta = eventMeta[eventId];
    if (!meta.location || meta.dateKey < todayKey) return;
    if (!isLunchOfferedOn(parseDateKey(meta.dateKey), meta.location)) return;
    const key = `${meta.dateKey}|${meta.location}`;
    if (!rollup[key]) rollup[key] = { dateKey: meta.dateKey, location: meta.location, registeredCount: 0 };
  });

  if (registrantsSheet || registrantRows) {
    const lrHeaders = HEADERS.Lunch_and_Event_Registrants;
    const lrRows = registrantRows || readAllSectionedRows(registrantsSheet, lrHeaders, 'Event_ID');
    const lrMap = getIndexMap(lrHeaders);
    lrRows.forEach(row => {
      const eventId = row[lrMap['Event_ID']];
      const meta = eventMeta[eventId];
      if (!meta) return;
      if (row[lrMap['Program_Status']] !== 'Active' || row[lrMap['Lunch_Status']] !== 'Needed') return;

      if (getCateringPolicyForLocation(meta.location) === CATERING_POLICIES.NEVER) {
        // NEVER is a hard fact ("this location cannot serve food"), not a
        // scheduling gap — so unlike ALWAYS/BY_EXCEPTION below, demand does
        // NOT override it. A row like this is a data artifact, almost
        // always a form that still asked about lunch before its location
        // was set to Never (createRegistrationForm()/refreshFormForNewDates()
        // strip that question going forward, but can't undo an answer
        // someone already submitted). Flag it for cleanup instead of
        // putting a blank row on the dashboard.
        noteForAdmin('Lunch needed at a Never-catering location',
          `${row[lrMap['Name']]} is marked Lunch_Status=Needed for ${meta.location} on ` +
          `${formatDateLabel(parseDateKey(meta.dateKey))}, but that location's policy is "Never." ` +
          `Probably a stale form answer — fix their Lunch_Status on Lunch_and_Event_Registrants.`);
        return;
      }

      // DEMAND ALWAYS WINS (for ALWAYS/BY_EXCEPTION). Policy decides what
      // gets SEEDED; it never suppresses a date somebody is actually signed
      // up to eat on. This is the safety net for "By exception" — forgetting
      // to add the menu row can make a date invisible on the schedule, but
      // never invisible once a real person is expecting lunch.
      const key = `${meta.dateKey}|${meta.location}`;
      if (!rollup[key]) {
        rollup[key] = { dateKey: meta.dateKey, location: meta.location, registeredCount: 0, unplanned: true };
      }
      rollup[key].registeredCount++;
    });
  }

  // Anything that only exists because someone registered for it, on a date
  // with no catered menu behind it, is worth telling a human about.
  Object.keys(rollup).forEach(key => {
    const r = rollup[key];
    if (!r.unplanned || r.registeredCount === 0 || r.dateKey < todayKey) return;
    const meal = getMealInfoForDate(parseDateKey(r.dateKey), r.location);
    const hasMenu = !!meal && CATERED_LUNCH_TYPES.indexOf(meal.type) !== -1;
    if (hasMenu) return;
    noteForAdmin('Lunch needed with no menu set',
      `${r.registeredCount} person(s) need lunch at ${r.location} on ${formatDateLabel(parseDateKey(r.dateKey))}, ` +
      `but Lunch_Schedule has no Hot/Cold row for it.`);
  });

  return Object.values(rollup).map(r => {
    const meal = getMealInfoForDate(parseDateKey(r.dateKey), r.location);
    r.mealType = meal ? meal.type : '';
    r.mealShorthand = meal ? (meal.shorthand || meal.description) : '';
    return r;
  }).sort((a, b) => (a.dateKey === b.dateKey ? a.location.localeCompare(b.location) : (a.dateKey < b.dateKey ? -1 : 1)));
}

function updateMasterLunchDashboard(registrantRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.LUNCH_DASHBOARD);
  const headers = HEADERS.Master_Lunch_Dashboard;
  const map = getIndexMap(headers);
  const plan = getDashboardRowPlan();
  const rollup = buildDashboardRollup(registrantRows);

  // 'Standard_Buffer' is unique to the Full Schedule headers (not present
  // on TODAY_LUNCH_HEADERS), so it safely finds only the schedule's own
  // header rows and not the Today block's.
  const existingTable = readAllSectionedRows(sheet, headers, 'Standard_Buffer');
  const tableByKey = {};
  existingTable.forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (!d) return;
    tableByKey[`${formatDateKey(d)}|${row[map['Location']]}`] = row;
  });

  rollup.forEach(r => {
    const key = `${r.dateKey}|${r.location}`;
    let row = tableByKey[key];
    const override = row ? row[map['Manual_Override']] : null;
    if (override === 'Manually Added' || override === 'Manually Edited') return;

    if (!row) {
      row = new Array(headers.length).fill('');
      const bufferConfig = r.registeredCount > 0
        ? getMealBufferConfigForLocation(r.location, r.mealType || 'Hot')
        : { standardBufferAmount: 0, testerBufferAmount: 0 };
      row[map['Standard_Buffer']] = bufferConfig.standardBufferAmount;
      row[map['Tester_Buffer']] = bufferConfig.testerBufferAmount;
      row[map['Manual_Override']] = 'Auto-Synced';
      tableByKey[key] = row;
      existingTable.push(row);
    }

    row[map['Event_Date']] = parseDateKey(r.dateKey);
    row[map['Location']] = r.location;
    row[map['Lunch_Type']] = r.mealType || '';
    row[map['Meal_Shorthand']] = r.mealShorthand || '';
    row[map['Registered_Count']] = r.registeredCount;
  });

  writeMasterLunchDashboardSheet(sheet, plan, headers, existingTable, rollup);
}

function writeMasterLunchDashboardSheet(sheet, plan, headers, fullTableRows, rollup) {
  const map = getIndexMap(headers);
  const numCols = headers.length;

  sheet.clear();
  sheet.clearFormats();
  sheet.getBandings().forEach(b => b.remove());
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();

  writeSectionBanner(sheet, plan.todayBannerRow, numCols, `📋 Today's Lunch Needs — ${Utilities.formatDate(new Date(), TIMEZONE, 'EEEE, MMM d, yyyy')}`);
  writeSectionHeader(sheet, plan.todayHeaderRow, TODAY_LUNCH_HEADERS.length, TODAY_LUNCH_HEADERS);
  const todayMap = getIndexMap(TODAY_LUNCH_HEADERS);

  const todayKey = formatDateKey(new Date());
  const dateColIdx = map['Event_Date'];
  const { upcoming, past } = partitionByDate(fullTableRows, dateColIdx, todayKey);

  const registeredCol = columnToLetter(map['Registered_Count'] + 1);
  const standardBufferCol = columnToLetter(map['Standard_Buffer'] + 1);
  const testerBufferCol = columnToLetter(map['Tester_Buffer'] + 1);
  const totalToOrderColLetter = columnToLetter(map['Total_to_Order'] + 1);

  // Deterministic row math mirroring exactly what writeUpcomingPastSections()
  // below will place, computed up front so the Total_to_Order formulas (and
  // the Today block's cross-reference to them) can be written before the
  // sections are actually rendered.
  const upcomingHeaderRow = plan.scheduleStartRow + 1;
  const upcomingDataStart = upcomingHeaderRow + 1;
  // +1 blank spacer row, +1 for the Past section's own banner row (writeUpcomingPastSections
  // writes: spacer, banner, header, data — so the header sits TWO rows after the last
  // upcoming data row's end, not one; this previously under-counted by one row).
  const pastHeaderRow = upcomingDataStart + upcoming.length + 2;
  const pastDataStart = pastHeaderRow + 1;

  const scheduleRowByKey = {};
  const assignRowKeyAndFormula = (row, sheetRow) => {
    const d = coerceDate(row[map['Event_Date']]);
    if (d) scheduleRowByKey[`${formatDateKey(d)}|${row[map['Location']]}`] = sheetRow;
    row[map['Total_to_Order']] = `=${registeredCol}${sheetRow}+${standardBufferCol}${sheetRow}+${testerBufferCol}${sheetRow}`;
  };
  upcoming.forEach((row, i) => assignRowKeyAndFormula(row, upcomingDataStart + i));
  past.forEach((row, i) => assignRowKeyAndFormula(row, pastDataStart + i));

  const locations = Object.values(CALENDAR_MAP);
  const todayRows = locations.map(loc => {
    const match = rollup.find(r => r.dateKey === todayKey && r.location === loc);
    const row = new Array(TODAY_LUNCH_HEADERS.length).fill('');
    row[todayMap['Location']] = loc;
    if (match) {
      row[todayMap['Lunch_Type']] = match.mealType || '';
      row[todayMap['Meal_Shorthand']] = match.mealShorthand || '';
      row[todayMap['Registered_Count']] = match.registeredCount;
      const scheduleRow = scheduleRowByKey[`${todayKey}|${loc}`];
      row[todayMap['Total_to_Order']] = scheduleRow ? `=${totalToOrderColLetter}${scheduleRow}` : match.registeredCount;
    } else {
      row[todayMap['Lunch_Type']] = '';
      row[todayMap['Meal_Shorthand']] = 'No lunch orders today';
      row[todayMap['Registered_Count']] = 0;
      row[todayMap['Total_to_Order']] = 0;
    }
    return row;
  });

  if (todayRows.length > 0) {
    sheet.getRange(plan.todayDataStart, 1, todayRows.length, TODAY_LUNCH_HEADERS.length).setValues(todayRows);
    sheet.getRange(plan.todayDataStart, todayMap['Registered_Count'] + 1, todayRows.length, 1).setNumberFormat('0');
    sheet.getRange(plan.todayDataStart, todayMap['Total_to_Order'] + 1, todayRows.length, 1).setNumberFormat('0');
  }
  applyZebraStripingManualBounded(sheet, plan.todayDataStart, todayRows.length, TODAY_LUNCH_HEADERS.length);
  sheet.getRange(plan.spacerRow, 1, 1, numCols).clearContent().setBackground('#FFFFFF');

  const result = writeUpcomingPastSections(sheet, plan.scheduleStartRow, headers, upcoming, past, {
    upcomingLabel: '📊 Upcoming Lunch Schedule', pastLabel: '📊 Past Lunch Schedule'
  });
  if (result.upcomingDataStart !== upcomingDataStart || result.pastDataStart !== pastDataStart) {
    log(`⚠️ Master_Lunch_Dashboard row math mismatch — Total_to_Order cross-references may be off. ` +
      `Expected upcoming@${upcomingDataStart}/past@${pastDataStart}, got upcoming@${result.upcomingDataStart}/past@${result.pastDataStart}.`);
  }

  labelManualEntryColumns(sheet, result.upcomingHeaderRow, headers, LUNCH_DASHBOARD_MANUAL_COLUMNS);
  labelManualEntryColumns(sheet, result.pastHeaderRow, headers, LUNCH_DASHBOARD_MANUAL_COLUMNS);

  const zones = [
    { start: result.upcomingDataStart, count: result.upcomingCount },
    { start: result.pastDataStart, count: result.pastCount }
  ];
  const numericCols = ['Registered_Count', 'Actual_Ordered', 'Standard_Buffer', 'Tester_Buffer', 'Day_1_In-Person',
    'Day_1_Takeaway', 'Subs_In-Person', 'Subs_Takeaway', 'Total_Consumed', 'Thrown_Away', 'Discrepancy'];

  zones.forEach(z => {
    if (z.count < 1) return;
    sheet.getRange(z.start, map['Event_Date'] + 1, z.count, 1).setNumberFormat('M/d/yyyy');
    numericCols.forEach(h => sheet.getRange(z.start, map[h] + 1, z.count, 1).setNumberFormat('0'));
    tintManualEntryColumns(sheet, z.start, z.count, headers, LUNCH_DASHBOARD_MANUAL_COLUMNS);
  });

  sheet.setFrozenRows(result.upcomingHeaderRow);
  const locationCol = map['Location'] + 1;

  zones.forEach(z => {
    if (z.count < 1) return;
    applyManualOverrideValidationBounded(sheet, map['Manual_Override'] + 1, z.start, z.count);
    applyValueListValidationBounded(sheet, map['Lunch_Type'] + 1, LUNCH_TYPE_OPTIONS, z.start, z.count);
    applyLocationValidationBounded(sheet, locationCol, z.start, z.count);
  });

  const todayLocationCol = todayMap['Location'] + 1;
  applyLocationValidationBounded(sheet, todayLocationCol, plan.todayDataStart, plan.numLocations);

  const rules = [];
  const manualEntryColIndexes = LUNCH_DASHBOARD_MANUAL_COLUMNS.map(h => map[h] + 1);
  zones.forEach(z => {
    if (z.count < 1) return;
    rules.push(...buildManualOverrideRowTintRules(sheet, z.start, z.count, numCols, map['Manual_Override'] + 1,
      [locationCol, map['Event_Date'] + 1, ...manualEntryColIndexes]));
  });

  const activeZones = zones.filter(z => z.count > 0);
  const typeRanges = activeZones.map(z => sheet.getRange(z.start, map['Lunch_Type'] + 1, z.count, 1));
  const notServingRule = buildTextEqualsRuleForRanges(typeRanges, 'Not Serving', NOT_SERVING_COLOR);
  if (notServingRule) rules.push(notServingRule);

  // Location color-coding, painted across the row rather than on the single
  // Location cell — this tab is one row per date PER LOCATION, so the block
  // of color is what makes "everything for Ashbridge that week" scannable.
  // Last in the rule list on purpose: the manual-override tint and the grey
  // "Not Serving" cell above both need to win where they overlap.
  activeZones.forEach(z => {
    rules.push(...buildLocationRowTintRules(sheet, z.start, z.count, numCols, locationCol,
      [map['Event_Date'] + 1, ...manualEntryColIndexes]));
  });
  rules.push(...buildLocationRowTintRules(sheet, plan.todayDataStart, plan.numLocations,
    TODAY_LUNCH_HEADERS.length, todayLocationCol, []));

  sheet.setConditionalFormatRules(rules);
  autosizeColumns(sheet, { minCols: numCols });
}
