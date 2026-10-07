# Workshop Status - daily Excel mapping (from the real file)

Source inspected: `daily morning update.xlsx` (2026-10-07), one sheet `October CR (7)`, 88 rows.

## File structure

- Rows 1-3: title band - `GREEN CONCRETE COMPANY CJSC`, `JOB CARD ENTRY`, report date (2026-10-07).
- The body is split into **sections**. Each section is a one-cell title row (merged A:M)
  followed by its own header row, then data rows:
  - `TRANSIT MIXER` (24 rows)
  - `M-PUMPS, STATIONARY PUMP, LINE PUMP, PLACING BOOM` (6 rows)
  - `WHEEL LOADERS, PICK UPS, BUS ...` (1 row)
  - `BT-PLANT, ICE PLANT, CHILLER ...` (5 rows)
  - `JOB CARD CLOSED DETAILS` (39 rows) - vehicles released/closed on the report date.
- Active vehicles today: **36** (the four open sections). Closed section: 39.
- Header text varies between sections (`Workshop/Fleet  Production Account` vs
  `Workshop /Fleet  Production  Account`; the K and L headers are blank after the first
  section), so headers are matched by normalised alias, never by column position.
- No data beyond column M.

## Columns found and ownership

| Excel column | Stored as | Owner |
|---|---|---|
| SR.NO | `excel_data.sr_no` (row reference only) | Excel |
| ASSET NO. | `asset_no` (canonical id with org + country) | Excel |
| REG. NO. | `reg_no` (for plant it holds a type word: ICE PLANT, GENERATOR, BOBCAT) | Excel |
| JOB CARD NO. | `job_card_ref` - plain reference text only, no Job Card link or workflow | Excel |
| LOCATION | `site` (normalised by the existing site normaliser; raw kept in `excel_data`) | Excel |
| PRODUCTION / FLEET COMPLIANT | `complaint` | Excel |
| DIAGNOSTICS | `diagnostics` | Excel |
| BREAKDOWN DATE | `ooc_since` - Days Down is computed from it | Excel |
| DOWN DAYS | `excel_down_days` - kept for comparison only, never displayed as the truth | Excel |
| Workshop/Fleet Production Account | `department` (WORKSHOP / FLEET / BT-PLANT) | Excel |
| expected time to release | `excel_expected_release` - reference only; does NOT overwrite TyrePulse `expected_release_date` | Excel (reference) |
| current status note | `excel_status_note` - reference only | Excel (reference) |
| REMARKS | `source_remarks` (e.g. WAITING FOR PARTS, SENT OUTSIDE FOR REPAIR) | Excel |
| section title | `vehicle_category` (TRANSIT MIXER, M-PUMPS ...) | Excel |

TyrePulse-owned (never written by an upload): current stage, delay reason, detailed reason,
work done, action taken, next action, parts status, MR, PO, responsible person, supporting
person, expected part date, expected release date, blocker, remarks, attachments, history.

The Excel `expected time to release` and `current status note` columns are empty in the
sample. They are captured as reference values so nothing is lost, but they do not overwrite
the TyrePulse fields, which are maintained in the app.

## Rules derived from the file

- **Closed section is not active.** A vehicle listed only under `JOB CARD CLOSED DETAILS`
  is never added to the active list. If it was active, it is removed from the current
  report and the removal event records "listed under closed details in the Excel" as
  evidence. Final disposition is still entered by a person.
- **Active beats closed.** The same asset can appear in both (sample: TM411 active on
  GCKR/JC/0748/1026 and closed on GCKR/JC/0682/1026; MP121 likewise). The open row decides.
- **Duplicates** are counted only among active rows. Repeats inside the closed section
  (MP130, MP127) are ignored.
- **Country** is not in the file; the uploader picks it (default from their scope).
- **Days Down** = report date or today minus `BREAKDOWN DATE`; the typed DOWN DAYS is only
  compared, so a stale number in the file is detectable.
