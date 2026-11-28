# Workshop intake from a shared Google Sheet

New vehicles typed into the shared sheet reach Workshop Status within 5 minutes.
Only new or changed rows are sent; unchanged rows cost nothing.

## Who does what

| Step | Who |
|---|---|
| Apply migrations `20261128090000_workshop_intake.sql` and `20261128091000_workshop_intake_erp.sql` | Owner OK, then applied |
| Deploy edge function `workshop-sheet-ingest` with `verify_jwt = false` | Owner OK, then deployed |
| Create a long random secret (32+ characters) and set it as the Supabase secret `WORKSHOP_SHEET_SECRET` | Owner (never in chat or code) |
| Register the sheet in Workshop Status > Intake > Sheets (gives the sheet id) | Admin with "Configure module" |
| Paste `intake-sheet.gs` into the sheet (Extensions > Apps Script), set Script Properties `TP_ENDPOINT`, `TP_SHEET_ID`, `TP_SECRET`, run `installTrigger()` once | Sheet owner |

## Columns

`Row ID | Asset code | Workshop site | Job card no | Complaint | Work type | Priority | Production out | Remarks | Entered by | Sent hash | Tyre Pulse result`

Row ID, Sent hash and Tyre Pulse result are filled by the script.

## What happens to a row

1. The script gives the row an id and sends it.
2. Tyre Pulse fills plate and type from the fleet register, routes the vehicle to the
   on-shift supervisor of the workshop site (day 06:00-18:00, night 18:00-06:00 by
   default, editable on the roster), and sends one "N vehicles waiting for you" notice.
3. The supervisor confirms (or returns with a reason). A person never confirms an entry
   they made themselves.
4. The vehicle stays in the list until a supervisor releases it with a reason. A row that
   disappears from the sheet does NOT release the vehicle (only the daily Excel file does
   that, for its own rows).

## If the sheet goes silent

If nothing arrives for 30 minutes (a removed trigger, Apps Script quota, revoked access),
the person who registered the sheet gets a notice once.
