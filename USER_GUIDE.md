# Calendar & Form Manager — User Guide

This system turns **Google Calendar events into registration forms**, and turns
**form responses into a catering order**. You mostly work in Google Calendar;
the spreadsheet fills itself in.

---

## The one-minute version

1. You create an event on one of the program calendars.
2. The system builds a registration form for it and pastes the link into the
   calendar event's description.
3. People register. Their answers land on the **Lunch_and_Event_Registrants**
   tab, one row per person per session.
4. **Master_Lunch_Dashboard** adds up who needs lunch each day so you know what
   to order.

Everything runs on a schedule. You rarely need to press anything.

---

## Naming your calendar events

This is the only "syntax" in the whole system, and it's the part worth getting
right — the title and description control what the system does.

| You write | It means |
|---|---|
| `Chess Night` | A program with **no capacity limit** |
| `Yoga Basics [Cap: 12]` | Capped at **12 people**; #13 is waitlisted automatically |
| `*Yoga Basics [Cap: 12]` | **Tentative** — no form is created yet (see below) |

**Capacity** goes in square brackets in the title: `[Cap: 12]`. Leave it off for
unlimited.

**Fixed series** — put `[Fixed]` **in the event description**, not the title.
A Fixed series is one continuous run (a 6-week course) that gets *one* form for
the whole thing. Without it, events are grouped **by month**, so a program
running all year gets a separate form for January, February, and so on.

> If you have older events with `Fixed` in the *title*, they still work — the
> system logs a reminder to move it. New events should use the description.

**Tentative events** — start the title with `*` and the system leaves it alone
entirely: no form, no dashboard row. Use this while a date is still being
confirmed. When you remove the `*`, the event flows through normally on the next
sync and gets its form.

> Removing the `*` is safe and creates no duplicates. Re-adding a `*` to an
> event that *already* has registrations does **not** delete anything — existing
> registrations are kept.

---

## The tabs

They appear in this order, and it's roughly the order you'd use them.

### 1. Master_Program_Dashboard
Your at-a-glance view. Three sections stacked top to bottom:

- **📍 Today at Each Location** — what's running today and how many are signed up
- **📈 Program Participation Metrics** — totals and average fill rate
- **🔜 Upcoming Sessions / 🕓 Past Sessions** — every session, with links

The **Status** column is computed for you:

| Status | Meaning |
|---|---|
| 🟢 Unlimited | No cap set on the event |
| 🟢 Open | Plenty of room |
| 🟡 Almost Full | Within the last 15% of seats |
| 🔴 Waitlist Only | Full — new sign-ups are waitlisted |

**This whole tab is rebuilt from the calendar on every sync.** Don't hand-edit
it; your changes will be overwritten. If a session is wrong here, fix the
calendar event.

### 2. Master_Lunch_Dashboard
What to order. **Today's Lunch Needs** sits at the top and always stays visible.
Below it is the full schedule, split upcoming/past.

Every **upcoming** date and location appears here **even with zero registrants**,
so you can plan ahead and enter buffers before anyone signs up. Dates you've
marked *Not Serving* are left out.

Columns with a **✍️ pencil and a yellow header are yours to fill in** — the
system never overwrites them:

`Standard_Buffer` · `Tester_Buffer` · `Actual_Ordered` · `Day_1_In-Person` ·
`Day_1_Takeaway` · `Subs_In-Person` · `Subs_Takeaway` · `Total_Consumed` ·
`Thrown_Away` · `Discrepancy`

**Total_to_Order** is a live formula: `Registered_Count + Standard_Buffer +
Tester_Buffer`.

### 3. Lunch_and_Event_Registrants
One row **per person, per session** — guests get their own rows, not a note on
someone else's.

| Column | What it tells you |
|---|---|
| `Person_Type` | `Attendee` (registered themselves) or `Guest` |
| `Primary_Registrant` | `Self`, or the name of whoever brought them |
| `Party_ID` / `Party_Size` | Groups one submission together — "party of 3, one no-show" |
| `Form_Source` | Link to **that person's actual submission** |
| `Program_Status` | Active · Waitlisted · Cancelled · Superseded |
| `Lunch_Status` | Needed · No Lunch · Waitlisted · Cancelled · Superseded |
| `Order_Ahead_Flag` | Highlighted when someone registered too late to order for |
| `Admin_Notes` | Allergies/dietary needs, plus anything they typed |

Only rows that are **`Active` *and* `Needed`** count toward the catering numbers.

**Superseded** means that person submitted the form again and this is the older
version. It's kept on purpose so you can see the change happened — it's excluded
from all counts automatically.

### 4. Lunch_Schedule
**You own this tab.** It's the menu, one row per **date per location**.

| Column | Notes |
|---|---|
| `Event_Date` | The day |
| `Location` | Narberth / Ashbridge / Zoom |
| `Type` | `Hot`, `Cold`, or `Not Serving` |
| `Meal_Description` | Full description |
| `Meal_Shorthand` | Short label — **this is what registrants see on the form** |

Setting a date to **Not Serving** removes it from the lunch question on that
form and labels it "No Lunch Served," so nobody is asked to pick a meal that
doesn't exist. Editing this tab immediately pushes updated labels to the
affected forms.

### 5. Config
Three small settings blocks:

- **🍱 Meal Buffer Amounts** — extra meals per Location × Hot/Cold, used to
  pre-fill new lunch rows
- **⏰ Order Ahead Time** — how many days' notice you need. Registrations
  inside that window get flagged.
- **📧 Admin Notifications** — one email address (optional)

If you set the email, you get **at most one message per sync**, and only when
something needs a person: waitlisted registrants, forms that couldn't be opened,
and events sent to triage. A quiet sync sends nothing. **Leave it blank to turn
notifications off.**

### 6. Deleted_Event_Triage
Safety net. If a calendar event disappears but people had registered for it,
their rows are moved here instead of being deleted, with a note. Follow up with
those people, then clear the rows.

---

## What registrants see

The form asks their **name**, whether they're bringing **guests (0–3)**, and then
shows a roster:

```
Who is Attending Each Date?
                 You   Guest 1   Guest 2
  Tue Aug 5       ☑       ☑         ☐
  Thu Aug 7       ☑       ☐         ☐

Who Needs Lunch Each Date?
                 You   Guest 1   Guest 2
  Tue Aug 5       ☑       ☑         ☐
  Thu Aug 7       ☐       ☐         ☐
```

Dates are rows, people are columns — so any guest can attend or skip any single
date independently, and eat or not eat independently.

A few things worth knowing:

- **The link you hand out arrives with every box already checked.** Most people
  are coming to everything, so they just uncheck exceptions and submit.
- Each date shows the **meal shorthand** next to it, and `(FULL - Waitlist)` once
  a capped session runs out of seats — so nobody joins a waitlist unknowingly.
- **Guest names are required.** You can't pick "3 guests" and cater for two.
- There's a dedicated **Allergies / Dietary Needs** field.
- Email addresses are collected, so people get a receipt with a link to **edit
  their own response** later.
- **Fixed series only:** an "Attendance Mode" question up front — *Sign up for
  all dates* (pick lunch once, applied to every session, including dates added
  to the series later) or *Select individual dates*.

If someone changes their mind and submits again, the new answers win and the old
row is marked `Superseded`.

---

## The menu

Under **🗓️ Calendar & Form Manager** at the top of the spreadsheet:

| Item | What it does |
|---|---|
| **Sync Cal** | Reads the calendars, creates/updates forms |
| **Sync Registrations** | Pulls in new form responses, recomputes everything |
| **Check Triggers** | Makes sure the automatic schedule is in place |
| **Resize All Sheets** | Tidies column widths only — safe any time |

You normally don't need these. Automatically:

- **Sync Cal** runs **daily at ~5am**, and also whenever you edit a program
  calendar
- **Sync Registrations** runs **hourly**
- The system looks about **60 days ahead**

Press a menu item when you want something *now* instead of waiting.

> If the menu isn't there, reload the spreadsheet page.

---

## Common tasks

**Add a new program**
Create the calendar event with the right title. Wait for the next sync (or press
Sync Cal). The registration link appears in the event description and on the
dashboard.

**Change what's for lunch**
Edit **Lunch_Schedule**. Forms update themselves.

**Cancel one person's registration**
On **Lunch_and_Event_Registrants**, set their `Program_Status` to `Cancelled`.
The row turns purple (`Manually Edited`) and is protected from being overwritten.

**Add a walk-in who never filled out the form**
Add a row on **Lunch_and_Event_Registrants** and set `Manual_Override` to
`Manually Added`. It'll be counted and never overwritten.

**Move someone off the waitlist**
Change `Program_Status` from `Waitlisted` to `Active`. You'll get a reminder
toast to also update their `Lunch_Status` to `Needed` if they're eating.

**A session was cancelled**
Delete the calendar event. On the next sync the session leaves the dashboard and
any registrants move to **Deleted_Event_Triage** so you can contact them.

---

## Things to know

**Purple rows are protected.** Anything you hand-edit gets marked
`Manually Edited` (or `Manually Added`) and the system stops touching it. That's
what keeps your corrections from being wiped — but it also means a protected row
won't pick up later form changes.

**Names are matched loosely.** "Jane Smith" and "jane smith " are treated as the
same person, so a person doesn't get double-counted or double-catered.

**The dashboards are rebuilt, not patched.** Master_Program_Dashboard and the
Today blocks are regenerated from scratch each sync. Only the pencil columns on
Master_Lunch_Dashboard and manually-marked registrant rows survive.

---

## Known issues

- **Resize All Sheets doesn't currently produce the intended widths.** Google's
  auto-resize behaves inconsistently, and this is still being worked on. It's
  harmless to run — it only touches column widths — it just may not do much.

---

## Troubleshooting

**A new event didn't get a form**
Check, in order: does the title start with `*` (tentative)? Is it an all-day
event (those are skipped)? Is it more than ~60 days out? Is it on one of the
three configured calendars?

**A form shows the wrong dates or meals**
Run **Sync Cal**. If the meal text is stale, re-save the row on
**Lunch_Schedule**.

**Someone's registration never appeared**
Check **Deleted_Event_Triage** — the event may have been deleted. Otherwise run
**Sync Registrations** and check whether the row is there but `Superseded` (they
submitted twice) or `Waitlisted` (session was full).

**The lunch count looks too low**
Only `Active` + `Needed` rows count. Check for rows sitting at `Waitlisted`,
`Cancelled`, or `Superseded`.

**Nothing is syncing at all**
Run **Check Triggers**. If that doesn't help, the script may need to be
re-authorized from the Apps Script editor.
