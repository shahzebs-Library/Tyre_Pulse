# 02. Backend table and RPC map

Artifact 2 of the nine required by section 75 of the Flutter migration spec.

**This is the most important artifact in the migration.** Spec section 2 records
that the Kotlin rebuild invented a REST API that does not exist. This file is the
REAL Supabase surface the production Expo app talks to, so Flutter can be built
against what is actually there.

## Confidence key

| Mark | Meaning |
|---|---|
| VERIFIED | Read directly from source in this repo (mobile source, or a MIGRATIONS_V*.sql) |
| RECORDED | A measured live figure quoted from PROJECT_MEMORY |
| UNVERIFIED | Needs a live database check. The Supabase connector was disconnected when this was written |

Everything below is VERIFIED unless marked otherwise. No row counts or schema
details are asserted from memory alone.

---

## 1. The fabricated endpoints - read this first

The Kotlin app declares Retrofit endpoints as though a bespoke REST service
existed. It does not. Checked by searching every `MIGRATIONS_V*.sql` in the repo
for a `create table` of each name:

| Kotlin endpoint | CREATE TABLE found? | Verdict | What actually serves this need |
|---|---|---|---|
| `GET approvals` | none | FABRICATED | No `approvals` table. An approval queue is a QUERY over `inspections` and `checklist_submissions` filtered on `approval_status`, decided through the RPCs `decide_inspection_approval` and `decide_checklist_approval` |
| `GET tasks`, `GET tasks/{id}`, `PATCH tasks/{id}/status` | none | FABRICATED | The real table is `wo_tasks` (created in a migration, VERIFIED), reached with `wo_assignments` |
| `POST replacements`, `GET replacements/{id}`, `GET replacements/reasons` | none | FABRICATED | A tyre replacement is a write to `tyre_records` plus a `tyre_status_marks` row. Removal reasons are a COLUMN on `tyre_records`, not a lookup endpoint |
| `GET lookup_reasons` | none, and the string appears in zero migrations | FABRICATED | No such object anywhere in the repo |
| `GET tyre_history` | none, and the string appears in zero migrations | FABRICATED | Tyre history is a filtered query over `tyre_records` by `serial_no` |
| `GET workshop_events` | none, and the string appears in zero migrations | FABRICATED | The real table is `tech_activity_events` (VERIFIED) |
| `PATCH {table}` / `POST {table}` (generic) | n/a | ACCEPTABLE | This is plain PostgREST and is how the real client works |

**Rule for Flutter: never add an endpoint constant. There is no application
server. Every call is PostgREST on a real table, a Postgres RPC, or a Supabase
Edge Function.** Spec rules 2 and 3.

`engine_hours_logs` is a REAL table (referenced by 20 migrations, VERIFIED) that
the Kotlin app read and the current Expo app does not. It is a genuine capability
gap, not a fabrication - see artifact 09.

---

## 2. Tables the production Expo app uses

Derived by scanning `mobile/lib/**` and `mobile/app/**` for `.from('<table>')`.
The count is the number of call sites, which is a rough proxy for how central the
table is - not a row count.

| Table | Call sites | Used by |
|---|---|---|
| `vehicle_fleet` | 23 | Assets, inspection asset picker, scanner, accident form, meter logs, washing |
| `inspections` | 14 | Inspection capture, history, approvals queue |
| `accidents` | 12 | Accident report, register, detail, case status |
| `profiles` | 11 | Auth bootstrap, role resolution, admin user management |
| `tyre_records` | 10 | Tyre history, serial search, replacement, scrap |
| `corrective_actions` | 10 | Home badges, RCA, follow-up |
| `sites` | 7 | Site pickers across capture forms |
| `alerts` | 5 | Alerts screen, home |
| `notifications` | 4 | Notification inbox |
| `checklist_submissions` | 4 | Checklist fill, history, approvals |
| `user_signatures` | 3 | Saved approver signature (V601) |
| `work_orders` | 2 | Workshop, work order detail |
| `tech_activity_events` | 2 | Workshop live activity |
| `stock_records` | 2 | Stock count |
| `pm_programs` | 2 | Preventive maintenance |
| `pending_uploads` | 2 | Admin approval of queued uploads |
| `odometer_logs` | 2 | Meter logs |
| `checklist_templates` | 2 | Checklist list and fill |
| `wo_tasks` | 1 | Workshop task list |
| `wo_assignments` | 1 | Workshop assignment |
| `wash_records` | 1 | Vehicle washing |
| `user_access_grants` | 1 | Per-user module grants |
| `tyre_status_marks` | 1 | Scrap mark |
| `system_config` | 1 | Minimum-version gate, public config |
| `stock_movements` | 1 | Stock movement posting |
| `rca_records` | 1 | Root cause analysis |
| `checklist_assignments` | 1 | Assigned checklists |
| `account_deletion_requests` | 1 | In-app deletion request (Play requirement) |
| `accident_remarks` | 1 | Accident detail |
| `accident_parts` | 1 | Accident detail |
| `accident_case_workstreams` | 1 | Accident case status |

**30 tables.** Flutter must not add a 31st without a migration (spec rule 11).

---

## 3. RPCs the production Expo app calls

Derived by scanning for `.rpc('<name>')`. 27 distinct RPCs.

### Auth and access
| RPC | Purpose |
|---|---|
| `login_attempt_status` | Pre-auth lockout probe. Anon-callable |
| `record_login_failure` | Records a failed attempt. Anon-callable |
| `reset_login_attempts` | Clears the caller's own counter. AUTHENTICATED only - that asymmetry is what makes the lockout real |
| `register_user_device` / `revoke_user_device` | Push token registration |
| `set_user_access_grant` / `revoke_user_access_grant` | Per-user module grants |
| `admin_mobile_user_action` | Approve / lock / unlock / deactivate / set role |

### Approvals
| RPC | Purpose |
|---|---|
| `decide_inspection_approval` | The ONLY correct way to approve an inspection. Server derives the approver identity and refuses an unsigned approval |
| `approve_pending_upload` / `reject_pending_upload` / `restamp_pending_upload_country` | Queued-upload review |
| `approve_accident_closure` / `reject_accident_closure` | Accident closure gate |
| `checklist_last_submission` | Last submission for a template, drives the interval warning |

### Operations
| RPC | Purpose |
|---|---|
| `scrap_tyre_by_serial` / `unscrap_tyre_by_serial` | Atomic scrap. Writes the mark AND the status together, so the two can never disagree |
| `tyre_scrap_allowed` / `tyre_unscrap_allowed` | Server-answered permission. The client must ASK, never infer from the role string |
| `record_pm_service` | Atomic insert-and-advance of a PM schedule |
| `set_stock_count` / `post_stock_movement` | Stock |
| `reference_asset_options` / `reference_site_options` | Picker option lists |
| `get_mobile_analytics` | One-row analytics aggregate. Replaced a client-side full-table scan |
| `get_report_snapshot_authed` | Authenticated report snapshot |
| `get_accident_audit` | Accident case timeline |

### Edge functions
| Function | Purpose |
|---|---|
| `chat-ai` | The only edge function the mobile app invokes |

---

## 4. Two server rules Flutter must obey

**PostgREST caps every response at 1000 rows.** RECORDED, and repeatedly measured
in this project. A `.limit(2000)` is not a bound - the number in the source is a
claim the server never honours. Only `.range()` paging gets past it, and **the cap
applies to a set-returning RPC exactly as it does to a table read**.

The consequence is not a short list, it is a WRONG ANSWER that looks right: a
picker silently missing 617 assets reads to the user as "that asset was never
created". RECORDED: this hit the asset pickers, the QR label page, the mobile
inspection site feed and five reads in the mobile AI screen.

**Page a set-returning RPC by IDENTITY, not by offset.** RECORDED: `.range()` on
an RPC is a different server path from `.range()` on a table, and if a range were
ignored the failure mode is the SAME 1000 rows fetched repeatedly, not a short
list. Fold each page into a Set by key and stop when a page adds nothing new.

**Before paging any RPC, check its ORDER BY is total.** A non-unique sort makes
offset paging lossy - a tie straddling a page boundary returns one row twice and
drops another.

---

## 5. Country and site scoping

Every business table carries `organisation_id` and most carry `country` and
`site`. RLS is the real boundary; client filters are a convenience.

**The null-safe convention is load-bearing.** A country filter must be written as
`country.eq.<X>,country.is.null` (a row with no country is visible to everyone),
NOT a strict `.eq('country', X)`. RECORDED: a strict `.eq` on `work_orders`
silently hid 55,606 country-less job cards from every country view.

Flutter must implement one `applyCountry` helper and route every scoped read
through it, exactly as `src/lib/api/_client.js` does on the web.

---

## 6. What still needs a live check

The Supabase connector was disconnected when this was written, so the following
are UNVERIFIED and must be confirmed before Flutter code depends on them:

1. The exact column list and nullability of each of the 30 tables. The mobile
   services use explicit column constants, so the SELECTED columns are VERIFIED,
   but the full table shape is not.
2. Which of the 27 RPCs are SECURITY DEFINER, and their exact argument
   signatures. Getting an argument name wrong produces a 42883 that reads as
   "function does not exist".
3. Whether any RPC has an internal LIMIT. RECORDED: `get_asset_master` does, so a
   caller must raise `p_limit` as well as page, or the function itself cuts the
   page short.
4. Current row counts, to decide which reads must page on day one.
