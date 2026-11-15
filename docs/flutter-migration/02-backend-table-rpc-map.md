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

---

## 7. Objects the Flutter app uses that the production scan predates

Added 2026-09-23. Sections 2 and 3 were derived by scanning the Expo app, so
they cannot list anything the Flutter app started calling afterwards. This
section closes that gap. Every object below was checked against the file that
creates it; nothing is listed from memory. Sections 1 to 6 are unchanged
because the Flutter source cites them by number.

The registry `lib/core/network/supabase_tables.dart` is the code-side twin of
this file. **Its header says a name missing from the registry must be added
here as UNVERIFIED and the work stopped.** The objects marked "not in registry"
below break that rule today; see 7.5.

### 7.1 Tables

| Table | Created by | Status | Flutter use |
|---|---|---|---|
| `inspection_schedules` | Predates the migration-file convention; `supabase/migrations/20260921074351_inspection_plan_adherence.sql` adds `assigned_to`, `team`, `plan_ref`, `grace_days` | VERIFIED live 2026-09-21 per the registry comment | Read through `get_schedule_adherence`, never directly. Inspection plans (artifact 01 section 2.15) |
| `accident_case_workstreams` | `docs/accident-module/02_DATA_MODEL.sql` (V417) | Live since V417 | Accident case workspaces |
| `accident_insurance_claims` | V417 (`02_DATA_MODEL.sql`, `14_INSURANCE.sql`) | Live | Insurance workspace |
| `accident_evidence` | V417 (`13_EVIDENCE.sql`) | Live | Evidence workspace |
| `accident_handover_inspections` | V417 | Live | Legacy accepted/rejected handover |
| `accident_sla_instances` | V417 (`12_SLA_ENGINE.sql`) | Live | SLA timers on a case |
| `accident_claim_recoveries` | V417 | Live; columns from the 2026-09-16 parity migration read defensively | Recovery workspace |
| `accident_liability_assessments` | V417 | Live | Liability workspace |
| `accident_damage_assessments` | V417 | Live | Damage workspace |
| `accident_repair_orders` | V417 | Live; the vendor contact columns come from the parity migration below, AUTHORED NOT APPLIED | Repair workspace. A reader must survive a missing column |
| `accident_case_communications` | V417 (`11_NOTIFICATIONS.sql`) | Live | Notes, emails and calls on a case |
| `accident_dispatches` | `supabase/migrations/20260916130000_accident_mock_field_parity.sql` | **AUTHORED, NOT APPLIED** | One row per dispatch leg. Every reader must treat 42P01 as "not provisioned yet", never as an empty result |
| `driver_fine_responses` | `supabase/migrations/20260912110325_driver_workspace_fines_and_assignments.sql` | VERIFIED. `SELECT` granted to `authenticated`, RLS `organisation_id = app_current_org() AND driver_workspace_access(driver_id) <> 'none'` | Signature fetched on demand, because the read RPC strips it from the payload. **Not in registry** |

`engine_hours_logs` and `user_signatures`, which section 2 already discusses,
are also in the registry. `repair_requests` is NOT: its migration,
`MIGRATIONS_V608_REPAIR_REQUEST_RFR.sql`, is committed but its header still
reads AUTHORED - NOT YET APPLIED, so the table does not exist (artifact 06
section 2, artifact 09 decision D5).

Home (`features/home/data/home_repository.dart`, added 2026-09-27) reads only
`inspections`, which section 2 already lists and the registry already holds as
`SupabaseTables.inspections`: an exact head count (PostgREST `count=exact`) of
`approval_status = 'pending_approval'` plus the newest `created_at`, and the
signed-in user's own recent rows by `created_by` (written by
`inspection_payload.dart`, indexed by `MIGRATIONS_V21.sql`). No new table, RPC
or bucket. The approvals count is shown only to a role that
`decide_inspection_approval` (last redefined in
`MIGRATIONS_V606_CHECKLIST_DATA_COLLECTOR_APPROVAL.sql`) would let sign -
`core/permissions/inspection_signers.dart` mirrors that role list.
`get_mobile_analytics` (V479) is registered but deliberately NOT used for a
Home "fleet pulse": its only health measure is `tyre_records.risk_level`,
which is essentially unpopulated, so its counts would describe an unrated
fleet, not a measured one.

### 7.2 RPCs

Each was confirmed by locating its `create function` in a migration.

| RPC | Created or last redefined in | Security | Flutter use |
|---|---|---|---|
| `decide_checklist_approval` | `MIGRATIONS_V597_DECIDE_CHECKLIST_APPROVAL_TWO_STAGE.sql` | Server derives the approver | Checklist approval. Omitted from section 3's list of 27, named in sections 1 and in artifact 06 section 4 |
| `get_schedule_adherence(p_country text, p_from date, p_to date)` | `20260921074351_inspection_plan_adherence.sql`; anon revoked by `20260921084516_plan_rpc_anon_revoke.sql` | SECURITY INVOKER, so RLS bounds it | Inspection plans. Set-returning: capped at 1000 rows, and the cap is SHARED with colleagues' plans because it returns the whole country scope. The client keeps the window short and reports `truncated` |
| `list_profile_directory(p_ids uuid[], p_search text, p_limit int, p_offset int, p_roles text[], p_active_only boolean)` | `20261112170000_profile_directory_and_private_readers.sql`; anon and PUBLIC revoked in the same file | SECURITY DEFINER; organisation resolved in the body from the caller, active callers only | The staff directory: names, employee id, role and scope, no contact data. The reader for OTHER people's names (accident case owners, inspection action assignee picker). Set-returning: capped at 1000 rows per call by the function; page with `p_offset` |
| `driver_workspace(p_driver_id uuid, p_offset integer)` | `20260912110325_driver_workspace_fines_and_assignments.sql`; body in `private.driver_workspace_read`, redefined by `20260921134725_driver_fine_enterprise_workflows.sql` | INVOKER wrapper over a DEFINER reader that checks org and `driver_workspace_access` | Driver workspace read, paged 100 rows at a time per list. **Not in registry** |
| `driver_workspace_command(p_action text, p_payload jsonb, p_request_id uuid)` | Same two migrations; the 2026-09-21 one makes it DEFINER and routes `review_fine`, `correct_fine`, `reassign_fine` to `private.driver_fine_enterprise_command` | DEFINER | Every driver-workspace write. Actions include `create_driver`, `link_account`, `assign_team`, `create_fine`, `respond_fine`, `review_fine`, `attach_evidence`, `link_record`, `unlink_record`. `p_request_id` makes a retry idempotent. **Not in registry** |
| `driver_workspace_options(p_kind text, p_search text, p_offset integer)` | Same two migrations | DEFINER | Pickers inside the driver workspace. **Not in registry** |

`driver_fine_register` and `driver_workspace_run_reminders` exist in the same
migration and are not called by the phone.

Added 2026-09-29, push notifications (FCM): `register_user_device(p_push_token,
p_platform, p_device_id, p_app_version)` and `revoke_user_device(p_push_token)`,
created by `MIGRATIONS_V321_USER_DEVICES.sql` (DEFINER, `auth.uid()` scoped,
anon revoked). Already listed in section 1 and in `SupabaseRpcs`; the Flutter
caller is `lib/core/push/push_device_repository.dart`. `user_devices` has no
provider column: the server tells an FCM token from an Expo token by its form
(`ExponentPushToken[`/`ExpoPushToken[` = Expo, anything else = FCM).

### 7.3 Storage buckets

Section 3 lists no buckets at all. These are the ones the Flutter code touches.

| Bucket | Created or governed by | Flutter use |
|---|---|---|
| `tyre-photos` | Read policy `MIGRATIONS_V128_TYRE_PHOTOS_READ_POLICY.sql`, hardened V40/V59/V202 (V59: 20 MB, images only) | Inspection and tyre photos; `private_storage_reference_resolver.dart`. Since 2026-09-26 also workshop evidence photos under `modules/workshop/<uid8>/`, the same path `mobile/lib/photoUpload.ts` `uploadModulePhoto(..., 'workshop')` uses (`workshopPhotoBucket` in `features/workshop/data/workshop_photo_uploader.dart` - a second literal for the same bucket, beside `inspectionPhotoBucket`) |
| `accident-photos` | Storage policies in `MIGRATIONS_V40_SECURITY_HARDENING.sql`, `MIGRATIONS_V59_STORAGE_HARDENING.sql`, `MIGRATIONS_V202_SECURITY_HARDENING.sql` | Queued accident evidence (`accident_evidence_command_pusher.dart`), case evidence (`accidentCaseEvidenceBucket` in `accident_case_rows.dart`) and dispatch evidence (`accidentDispatchEvidenceBucket` in `accident_dispatch_repository.dart`). All three name the SAME bucket, through three separate constants |
| `driver-fine-evidence` | `20260912110823_driver_fine_private_evidence_storage.sql`: private, 5 MB, `image/jpeg`, `image/png`, `application/pdf`; upload and read gated by `private.driver_fine_storage_access` | Fine evidence. Signed URLs live 60 seconds. **Not in registry** |

### 7.4 Edge functions

Unchanged: `chat-ai` is still the only function the phone invokes.

Added 2026-09-29: the phone still invokes only `chat-ai`, but its pushes are
DELIVERED by `workflow-notify` (server-invoked by the V119 pg_cron deliverer).
That function now sends FCM HTTP v1 (project `tyrepulse-32127`) for non-Expo
tokens using the edge secret `FIREBASE_SERVICE_ACCOUNT`, with data keys
`type`, `event_type`, `entity_type`, `entity_id`, `instance_id`, `channel` and
Android channel `alerts`. Recipients fan out over `user_devices` through
`_user_push_tokens` (`20260924124000_push_fanout_user_devices.sql`).

### 7.5 Registry drift to close

`features/driver_workspace/data/driver_workspace_repository.dart` references
three RPCs, one table and one bucket by string literal. All five are real, so
nothing fabricated reaches the server, but the rule exists because the literal
form is how the Kotlin rebuild drifted into five endpoints that never existed.
To close it: add `driverFineResponses` to `SupabaseTables`, the three RPCs to
`SupabaseRpcs` (and `all`), give the bucket a named constant, and point the
repository at them. It is a code change that needs `flutter analyze` and the
registry drift test to run in CI.

### 7.6 Maintenance Control Center reads (added 2026-09-27)

`features/preventive_maintenance/data/maintenance_work_order_repository.dart`
reads two tables already in the registry (`SupabaseTables.workOrders`,
`SupabaseTables.profiles`); no new table, RPC or bucket. Online-only reads, no
writes. Every column was traced to its migration:

| Read | Columns | Created by |
|---|---|---|
| Head counts on `work_orders` (`Prefer: count=exact`, HEAD) | `work_type`, `status`, `country` | `MIGRATIONS_V16.sql` |
| Queue preview on `work_orders`, two bounded selects (breakdowns oldest first, other open work newest first) | `id`, `work_order_no`, `asset_no`, `work_type`, `status`, `priority`, `site`, `opened_at`, `target_completion` | `MIGRATIONS_V16.sql` |
| | `asset_category` | `MIGRATIONS_V381_JOB_CARD_INTAKE.sql` |
| | `assigned_owner_id` (uuid -> `profiles.id`) | `MIGRATIONS_V291_WORKSHOP_LIVE_CONTROL.sql` |
| Technician names on `profiles` (`id in (...)`) | `id`, `full_name` | `profiles_select` in `MIGRATIONS_V5.sql` lets every authenticated user read every profile |

"Active" is `status not in (Completed, Closed, Cancelled)`: the
`work_orders_status_check` in `MIGRATIONS_V497_WORK_ORDER_STATUS_CHECK_UNION.sql`
admits no other finished value and no casing variant, and the column is NOT
NULL, so the exact server-side `not in` is complete. A breakdown is
`work_type = 'Emergency'`, the value the V381 job-card intake maps the ERP's
"Break Down" onto and `get_daily_job_cards` (V381c) counts. Country scoping
reuses `workOrderCountryFilter` (`country.eq.X,country.is.null`), never a
strict `.eq`. A failed count renders `-`, never `0`. Fleet availability, the
mock's fourth tile, has no source and is not shown; the tile is Overdue PM.

### 7.7 Scan to sign in on the web (added 2026-10-04)

| RPC | Created in | Security | Flutter use |
|---|---|---|---|
| `qr_login_approve(p_id uuid, p_secret text, p_approve boolean default true)` | `supabase/migrations/20261004121000_login_showcase_and_qr_login.sql` | DEFINER, `search_path public, extensions`; EXECUTE granted to `authenticated` only (anon revoked); raises 42501 unless the caller is approved and unlocked (`is_approved_and_unlocked()`) | "Sign in on a computer" (`features/qr_login/`). The web sign-in page shows a QR `tyrepulse://qr-login?id=<uuid>&s=<hex>`; the signed-in phone approves (`p_approve=true`) or declines (`false`). Returns jsonb `{ok:true,status:'approved'\|'denied'}` or `{ok:false,reason:'invalid'\|'expired'\|'consumed'\|'approved'\|'denied'}`. Codes live 2 minutes and the secret is compared by sha256. Named `SupabaseRpcs.qrLoginApprove` (in `all`); caller `features/qr_login/data/qr_login_repository.dart` |
| `qr_login_peek(p_id uuid, p_secret text)` + `qr_login_approve(..., p_match text default null)` | `supabase/migrations/20261004150000_qr_login_hardening.sql` | DEFINER; peek EXECUTE `authenticated` only; both raise 42501 unless approved and unlocked | Hardening: the phone peeks first (`{ok:true,user_agent,ip,age_seconds,options:[3 two-digit]}` or `{ok:false,reason}`), then approves with `p_match` = the number the computer shows. Wrong number -> `reason:mismatch` and the code is cancelled; Admin / super admin -> `reason:admin`. Named `SupabaseRpcs.qrLoginPeek` (in `all`); caller `features/qr_login/data/qr_login_repository.dart` |

The same migration creates `qr_login_start`, `qr_login_status` and the table
`qr_login_requests` (RLS on, no policies, no client grants); the browser and
the `qr-login` edge function use those, the phone never does.

### 7.8 Per-machine axle count (added 2026-11-04)

| Column | Created in | Flutter use |
|---|---|---|
| `vehicle_fleet.axle_count smallint` (1..10, nullable) | `supabase/migrations/20261103140000_vehicle_fleet_axle_count.sql` | Added to `vehicleFleetColumns`. `VehicleFleetRepository.loadAll`/`byAssetNo` feed every row into `registerFleetAxleRows` (`features/tyre_diagram/domain/vehicle_axle_registry.dart`), and `resolveVehicleType` then picks `Concrete pump 4-axle` (12 tyres) for a machine recorded as 4 axles. Read-only; RLS on `vehicle_fleet` unchanged. Kept on the device by `VehicleAxleStore` (shared_preferences key `tp.vehicle_axle_counts.v1`), saved after each live fleet read and restored before the offline cache is read, so an offline restart still draws the 12-tyre pump. |

### 7.9 Raise action from an inspection + previous meter reading (added 2026-11-08)

| Object | Flutter use |
|---|---|
| `corrective_actions` INSERT (title, description, priority, status 'Open', asset_no, tyre_serial, site, country, due_date, assigned_to, source_type 'inspection', source_id, source_detail) | `InspectionActionRepository` (`features/inspections/data/inspection_action_repository.dart`), one row per selected finding; rows built by `domain/inspection_action_plan.dart`, a port of web `src/lib/inspectionTyreFlags.js`. 23505 (the V496 one-open-action-per-defect guard) is reported as already raised. RLS unchanged. |
| `corrective_actions` SELECT by `source_type='inspection'` + `source_id` | Filters out findings already raised before the sheet opens. |
| `inspections.linked_action_id` UPDATE (only when null) | Best effort, after the first action is created, so the web register shows "Action raised". Allowed on a locked row by `lock_inspection_content`. |
| `profiles` SELECT (id, full_name, username, role, site; approved, not locked) | Assignee picker in `raise_inspection_action_sheet.dart`, same role groups as web `RaiseActionDialog`. |
| `inspections` SELECT newest odometer_km / hour_meter for the asset | `inspection_previous_meters.dart`: warning on the new-inspection meter fields when a reading is lower; never blocks. |

### 7.10 Sign-in and password requests (added 2026-11-08)

| Object | Flutter use |
|---|---|
| `get_email_by_identifier(identifier)` RPC (anon) | `auth_repository.dart` `_madeUpEmailFor`: since `20261108130000` it returns ONLY made-up `@users.tyrepulse.app` addresses, so field accounts sign in directly from the phone (own IP, own auth rate limit). |
| `sign-in` edge function (verify_jwt false, self-validating) | Real-email accounts and unknown names: resolves the email server-side, enforces and records the lockout, returns only tokens; the app then calls `auth.setSession`. |
| `request_password_reset(p_identifier)` RPC (anon, always `{"ok":true}`) | Login "Forgot password?" dialog; queues a request for the company's admin (`20261108120000`). |

### 7.11 Company work assignments, My Work lane (added 2026-11-09)

The Tasks screen's workforce lane (artifact 01 section 2.15) reads and writes
the workforce operations core. Migrations `20261109160000_workforce_operations_core.sql`,
`20261109170000_workforce_time_accounting.sql`,
`20261109180000_workforce_management_analytics.sql` and
`20261109190000_workforce_reassign_notify.sql` are all APPLIED LIVE. Every
object below was checked against the migration that creates it. **None is in
`SupabaseTables` / `SupabaseRpcs`**: `features/my_work/` uses string literals,
the same drift as 7.5.

| Object | Created or last redefined in | Security | Flutter use |
|---|---|---|---|
| `workforce_assignments` SELECT | Table from `20261022095000`; `asset_no`, `tyre_serial`, `tyre_position`, `operational_record_table`, `operational_record_id` added by `20261109160000` | RLS; the phone filters `assigned_to = auth.uid()`, newest 100 | `WorkforceAssignmentsRepository.listMine`. Reads the extended columns and falls back to `id, organisation_id, title, instructions, site, status, priority, due_at` on 42703 / PGRST204 (a server that predates `20261109160000`). Rows are cached per user for offline display |
| `workforce_assignments` direct UPDATE of `status` | Refused by `20261109160000` for everyone: trigger `workforce_assignment_guard` accepts a status change only while the transaction GUC `workforce.via` is `transition` (set inside `workforce_assignment_transition`), else 42501 | n/a | **Not used.** The old repository `advance()` that did `update({'status': ...})` was removed from the app |
| `workforce_assignment_transition(p_assignment_id uuid, p_action text, p_idempotency_key text, p_note text default null, p_client_at timestamptz default null, p_reason_code text default null)` | `20261109160000`. The old 5-argument version is renamed `workforce_assignment_transition_v1_retired` and revoked, so PostgREST sees one function | DEFINER, `search_path ''`; EXECUTE `authenticated` only (anon and PUBLIC revoked) | Every status update (accept, start, block, resume, complete), sent from the feature's own offline queue (artifact 06 section 7.8). `p_reason_code` is one of `waiting_stock`, `waiting_equipment`, `vehicle_unavailable`, `safety_hold`, `waiting_approval`, `waiting_manpower`, `other`; the phone sends the key ONLY when there is a cause, so a block queued by an older build replays with the original argument set and the server records the cause as NULL ("not recorded"). Returns `{ok, result: applied / replayed / already_applied, status}` or `{ok: false, reason, current_status}` |
| Refusal reasons the phone maps to en/ar/ur | `20261109160000` (plus the earlier contract) | n/a | `invalid_transition`, `not_found`, `forbidden`, `note_required`, `key_reuse`, `self_review`, `evidence_required`, `record_required`, `review_note_required`, `record_not_found`, `asset_mismatch`, `record_already_linked`, `record_type_mismatch` (`workforceServerRefusalReasons` in `workforce_sync_engine.dart`). `evidence_required` is NOT terminal: attaching evidence and retrying is the fix |
| `workforce_assignment_evidence` SELECT, INSERT | `20261109160000` | RESTRICTIVE org isolation; read by the assignee or a workforce manager; insert only by the assignee (`uploaded_by = auth.uid()`), path under `<organisation_id>/assignments/<assignment_id>/`, assignment `acknowledged` / `in_progress` / `blocked`. SELECT + INSERT granted to `authenticated` only; append-only trigger refuses UPDATE and DELETE | Evidence count per card (`assignment_id in (...)`; a failed read is "unavailable", never 0) and one row per upload: `organisation_id, assignment_id, kind (photo / document), object_path, file_name (1-240), mime_type (image/jpeg, image/png, application/pdf), byte_size (1 B to 10 MB)`; `uploaded_by` left to its `auth.uid()` default |
| Bucket `workforce-evidence` | Created by `20261022104000_workforce_evidence.sql`; storage policies `workforce_assignment_files_select` / `_insert` redefined by `20261109160000` | Private. Insert needs folder 2 = `assignments` and an assignment the caller owns in an evidence status; read needs a matching evidence row | Upload before the row insert at `<organisation_id>/assignments/<assignment_id>/<microsecond stamp>.<jpg / png / pdf>`. If the row insert fails, the object delete is attempted best effort (no delete policy exists, so it may stay, unreadable) |

Server-side, not called by the phone: `workforce_reassign(p_assignment_id,
p_new_assignee, p_note, p_idempotency_key, p_override_reason)` (requalifies the
new assignee; `20261109190000` adds an AFTER UPDATE OF `assigned_to` trigger,
so a reassignment now notifies the new assignee by push, and the previous one
in-app), `workforce_link_operational_record(p_assignment_id, p_table,
p_record_id, p_idempotency_key)` (same org, same asset, one record per task;
the phone only displays the result as needed / linked), the qualification gate
(trigger `zz_workforce_assignment_qualify`, `workforce_qualification`,
`workforce_recommend_assignees`) and the board RPCs `workforce_board_summary`,
`workforce_team_analytics`, `workforce_employee_timeline`.

### 7.12 Vehicle handover (added 2026-11-12)

`MIGRATIONS_V181_HANDOVER_REPORTS.sql` (base table),
`20261112130000_handover_two_stage_signoff.sql` (the two-stage ladder, the
`decide_handover_approval` RPC, the `Fleet Incharge` `custom_roles` seed) and
`20261112143000_handover_signoff_forgery_guard.sql` are APPLIED LIVE. Every
object below was checked against the migration that creates it. **These two ARE
in the registry** - `SupabaseTables.handoverReports` and
`SupabaseRpcs.decideHandoverApproval` - so, unlike 7.5 and 7.11, the repository
does not reference them by string literal.

| Object | Created or last redefined in | Security | Flutter use |
|---|---|---|---|
| `handover_reports` SELECT / INSERT (upsert on `client_uuid`) | Table from `MIGRATIONS_V181_HANDOVER_REPORTS.sql`; approval ladder columns (`approval_status` default `pending_supervisor`, `supervisor_*`, `incharge_*`, `review_note`) and `document_no` (auto `HND-<8 hex>`) from `20261112130000` | RLS (org + country + site). The phone reads its own (`created_by = auth.uid()`) and the sign-off queue (`approval_status in (pending_supervisor, pending_incharge)`); it inserts the capture with `approval_status = 'pending_supervisor'` | `HandoverRemoteRepository` (`handoverRecordColumns`): `byId`, `myHandovers`, `pendingHandovers`, `upsertHandover(onConflict: client_uuid)`. The capture carries `damages` (jsonb per marker: `view,x,y,type,level,note,photo_url`), `photos` (array of `tp-storage://` refs), `signature_url` (the driver's data-URL mark), plus odometer/fuel/condition/cleanliness. A write is idempotent on `client_uuid`, so a replay from the offline queue lands once |
| `handover_reports` direct UPDATE of the approval columns | Refused outside the RPC by `20261112143000` (the forgery guard) | n/a | **Not used.** The app never writes a signature or status directly; every decision goes through `decide_handover_approval` |
| `decide_handover_approval(p_id uuid, p_approved boolean, p_signature text default null, p_note text default null)` | `20261112130000` | DEFINER; the supervisor rung is signable by `app_is_elevated()` OR `Fleet Supervisor` / `Fleet Incharge`, the incharge rung by super / Admin / `Fleet Incharge`; an incharge-level signer at the supervisor rung closes both (`both_steps`); a reject needs a note. Returns `{ok, decision, status, both_steps}` | `HandoverRemoteRepository.decide(HandoverDecision)`. The approve path must carry `p_signature`; the UI pre-checks it with the pure `handover_approval.dart` (`canDecide` / `stageFor`) only to show or hide the sign-off bar - the server stays the authority |
| Bucket `tyre-photos` | Pre-existing private bucket (authenticated upload) | Private; `tp-storage://` refs resolved to short-lived signed URLs by the shared `privateStorageImageUrlProvider` | `HandoverPhotoUploader` uploads each capture photo (general and per-marker) to `handover/<id>/<slot>_<microsecond>.<ext>` and returns `tp-storage://tyre-photos/<path>`; the sync engine swaps the local paths for the refs before the row write |

### 7.13 Multi-factor sign-in step (added 2026-11-12)

No table, RPC or edge function. `lib/core/auth/mfa_repository.dart` uses only
the Supabase Auth (GoTrue) MFA endpoints through `supabase_flutter`:
`auth.mfa.getAuthenticatorAssuranceLevel` (local, reads the access token),
`auth.mfa.listFactors` (fallback only) and `auth.mfa.challengeAndVerify`.
The server rule it serves is `20261112160000_super_admin_requires_mfa_session.sql`
(a super admin with a verified factor is one only at `aal2`). See artifact 03
section 9.1.

### 7.14 Module Control status (added 2026-11-12)

| Object | Created by | Access | Flutter use |
|---|---|---|---|
| `modules` SELECT of `module_id, status` | Table from V258 (applied live; it has no file in the repo, so its existence and columns were verified against the live database on 2026-11-12). The authenticated read policy is `MIGRATIONS_V275_CONSOLE_AUDIT.sql`; the maintenance window columns are `MIGRATIONS_V278_MAINTENANCE_WEBGATE.sql` | GLOBAL table (no `organisation_id`); every signed-in user may read, only super admin / Admin may write | `SupabaseAccessPermissionsRepository._readModuleStatuses`: one bounded read (about 200 rows) beside the two permission RPCs, at sign-in and on resume. Read-only. A failed read returns null and FAILS OPEN. See artifact 04 section 11 |
