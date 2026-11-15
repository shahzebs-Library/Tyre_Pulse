# Module workflow audit B: Workshop and Maintenance, Inspections and Compliance, Drivers and Safety, Monitoring and Logistics

Date: 2026-11-12. Working tree: branch `claude/tyrepulse-inspector-build-7rxp2t` (uncommitted console and Flutter edits present; none touch the pages audited here, so main and the working tree agree for this scope). Read-only audit. Database access was SELECT only on project `jhssdmeruxtrlqnwfksc`. Machine-readable copy: `modules_B.json` in this folder.

## 1. Two verdicts

**Internal Production Readiness (current company): READY WITH RISKS.** The operational core is in daily use and works: 2,630 inspections (792 in the last 30 days), 133 checklist submissions (63 in 30 days), 96,944 job cards (2,916 created in 30 days, mostly import), 36 workshop status records, 249 wash records. No module in scope is broken. 15 of 81 modules are at risk, for four reasons: (a) work order writes are capability-only so Managers cannot act on Live Control, (b) several boards read tyre condition columns that nothing populates, (c) refused updates fail silently, (d) corrective actions and sign-off queues are not being cleared (159 open actions against 2 closed, 90 checklists waiting for sign-off).

**Commercial SaaS Readiness (a second, independent company): NOT READY in this scope without the P1 fixes.** No module reaches class 1. The core workflows (Inspections, Checklists, Work Orders, Workshop Status, Alerts rules) each carry at least one P1 that either ties the workflow to the current company (hard-coded approver role names, the daily Excel layout, a Company A default-organisation stamp) or crosses the tenant boundary (alert rule evaluation, parts request notifications, global job card numbers). 44 of the 75 menu items in scope are switched off in Module Control today; 17 modules are class 4 and must not be marketed because they imply device or card feeds that do not exist.

| Commercial class | Count | | Internal status | Count |
|---|---|---|---|---|
| 1 Commercially ready | 0 | | ready | 66 |
| 2 Functional, needs customer setup or data | 40 | | at risk | 15 |
| 3 Needs functional or data-quality repairs | 20 | | broken | 0 |
| 4 Incomplete or future development | 17 | | | |
| 5 Duplicate needing consolidation | 3 | | | |
| 6 Internal or legacy | 1 | | | |

81 entries = 75 menu items plus 6 unlisted routes (checklist builder, checklist run and submission view, My Checklists, workshop job detail, workshop TV board, driver detail).

Findings by severity: P1 7, P2 10, P3 6.

## 2. Method and what "verified" means here

- Routes and guards read from `src/App.jsx` (lines 607 to 901) and `src/components/ProtectedRoute.jsx`; menu from `NAV_GROUPS` in `src/components/Layout.jsx` (lines 189 to 281).
- For every page a script walked its imports to the service files and extracted tables, RPCs and edge functions (result in `modules_B.json`).
- Catalog queries: table existence, exact row counts, organisation and country columns, policy sets, CHECK constraints, NOT NULL columns, triggers, function bodies for the approval, numbering, notification and alert functions, Module Control status.
- Column check: every explicit column list, order and filter column in the single-table services in scope was compared with the live columns. Result: no unknown column in any select (the two hits were false positives: `repairRequests.js` also reads `work_orders`, `telematicsDevices.js` also reads `vehicle_fleet`).
- Page hygiene scan on all 81 pages: every page has loading, error and empty handling and routes errors through `toUserMessage`; raw `error.message` rendering was not found in this scope.
- Tests run: `inspectionApproval`, `checklistApproval`, `workOrdersPaging`, `workOrderStatus`, `workshopLive`, `approvalsBulk`, `rowCapGuard`, `inspectionTyreFlags`: 8 files, 160 tests, all pass.
- Each finding states VERIFIED, PLAUSIBLE or ASSUMED. Per-module "empty company" text for the simple ledger pages is ASSUMED from the shared pattern (verified in detail on `src/lib/api/trips.js` and by the hygiene scan), not from opening each page in a browser.

## 3. How the guards actually behave (VERIFIED)

- `ModuleRoute` checks role permission and Module Control status. `RoleRoute` checks role (super admin always passes; custom roles and per-user grants are additive). `ModuleStatusGate` wraps every page, so a module switched off is closed to non-admin users whatever guard the route uses. Admin and super admin always pass.
- Unguarded routes in scope: `/checklists`, `/checklists/:templateId/run`, `/checklists/submission/:id`, `/my-checklists`, `/inspection-planner`, `/workforce-daily`, `/driver-workspace`. They rely on in-page checks and on row security. Row security holds (organisation, country and site policies are RESTRICTIVE on every table checked), so this is a consistency point, not a leak.
- Shared keys: `/ai-tyre-inspection` and `/inspection-intelligence` share `inspections`; `/alert-thresholds` shares `alerts`; `/downtime` and `/fuel-efficiency` share `fleet_analytics`; `/fleet-health` shares `fleet_intelligence`; `/driver-management` shares `fleet_master`; `/anomalies` shares `tyre_records`. Switching the shared key off takes the sibling pages with it.
- Module Control (`public.modules`) has no organisation column (MODB-16). 44 keys in this scope are `disabled`; see MODULE_RESTORE_LIST for the restore decision. Keys with no registry row (read as live): `workforce_daily`, `checklist_audit`, `checklist_builder`, `ai_tyre_inspection`, `inspection_intelligence`, `alert_thresholds`, `downtime`, `anomalies`, `daily_ops:workshop`.

## 4. Operational core, traced end to end

**Inspections** (`src/pages/Inspections.jsx`, `src/lib/api/inspections.js`, RPC `decide_inspection_approval`, Flutter `features/inspections` and `features/approvals`). Create: client validates title, site, date and meters, maps the type to a CHECK-valid value, sends an explicit column list (no unknown or generated columns). Insert policy admits admin, manager, inspector, tyre man or the create capability. Sign-off goes through the guarded RPC (signature required, already-decided refusal, organisation and country checked). Records lock on approval. Paging uses a unique tiebreak. Export exists (PDF, Excel). Defects: signer roles hard-coded (MODB-1), silent refused updates and swallowed errors (MODB-7), edit overwrites the author (MODB-8), no country on web-created rows (MODB-9), Company A default-organisation stamp (MODB-19). Empty company: workspace renders with a New inspection action; the asset picker is empty until the fleet is loaded; only an Admin can sign.

**Checklists** (builder, run, submissions, schedules, insights, audit pack; `src/lib/api/checklists.js`, RPCs `decide_checklist_approval`, `raise_checklist_corrective_actions`, `generate_checklist_assignments`; Flutter `features/checklists`). Template create payload matches the table (only `name` is NOT NULL without default). Publishing versions the template; submissions snapshot the template; document numbers are minted per organisation; a blocking fault mark prevents closure in the database; photos are read through signed URLs scoped to the uploader organisation. Defects: approver roles hard-coded (MODB-2); no starter templates and schedules never used (MODB-13). Empty company: "No checklists yet"; an Admin, Manager or Director must build the first form.

**Work Orders and Live Control** (`src/pages/WorkOrders.jsx`, `WorkshopLive.jsx`, `src/lib/api/workOrders.js`, `workshopLive.js`; RPCs `get_work_orders_page`, `get_work_order_stats` are SECURITY INVOKER so row security applies; Flutter `features/work_orders`, `features/workshop`). Server-side paging, canonical status mapping and export are correct and tested. Defects: capability-only writes with no UI gating (MODB-3); global number uniqueness and sequence (MODB-6); Company A stamp (MODB-19); default labour rate (MODB-21). Live data: statuses Completed 39,487, Closed 57,437, In Progress 19; only 20 jobs have an assigned owner; attendance and shifts are empty.

**Workshop Status** (`src/pages/WorkshopStatus.jsx`, 10 service files, definer writers, append-only events; Flutter `features/workshop_status`). The strongest tested module in scope (23 web test files, 8 database suites). Permissions resolve through `workshop_status_can` to the role matrix. Defect: records are created only by the daily Excel in the current company layout (MODB-12).

**Corrective Actions** (`src/pages/CorrectiveActions.jsx`, `src/lib/api/correctiveActions.js`, trigger `trg_corrective_to_action_item`, checklist fault trigger). Values match the CHECKs (priority High/Medium/Low, status Open/In Progress/Closed). Actions raised from inspections and checklists are idempotent. Defects: refused updates are silent (MODB-7), role policy does not match the audience (MODB-22), backlog (MODB-14). Only an analytics test exists; the write path is untested.

## 5. Findings

| ID | Sev | Confidence | Internal | Commercial class | Recommended fix | Risk to current company | Acceptance test | Area |
|---|---|---|---|---|---|---|---|---|
| MODB-1 | P1 | VERIFIED | ready | 3 | Move the signer list to a per-organisation setting (or resolve through the existing approval matrix) and fall back to Admin, Manager, Director when none is set; keep the current list as this tenant setting. Update the client mirror in the same change. | low: seed the current five roles as the tenant setting so behaviour is unchanged | As a Manager in a second organisation with no custom roles, approve a pending inspection: accepted. In the current company a Manager is still refused. | DB, web, Flutter |
| MODB-2 | P1 | VERIFIED | ready | 3 | Same pattern for checklist_is_supervisor and checklist_is_area_manager: per-organisation approver roles with a built-in fallback. | low: seed current lists | Second organisation Manager approves a single-stage checklist; two-stage still needs the configured final approver. | DB, web, Flutter |
| MODB-3 | P1 | VERIFIED | at risk | 3 | Seed create and edit capability for Manager (and the workshop roles a tenant chooses) when an organisation is created; give the tenant Admin an in-app way to manage capabilities; hide or disable write controls when hasCapability is false. | medium: the current company restricted these writes on purpose; do not change its stored overrides, only add UI gating | A Manager without the capability sees no New Work Order button; a new organisation Manager can create a job. | DB, web |
| MODB-4 | P1 | VERIFIED | at risk (latent, 0 rules) | 3 | Add the rule owner organisation (and country scope) to every metric query; replace the tread_depth metric with one that reads a real source; catch per-rule errors so one bad rule cannot stop the run. | none: no rules exist | Two organisations with different data and identical rules get different counts; a tread rule does not abort the cron run. | DB |
| MODB-5 | P1 | VERIFIED | ready (one tenant) | 3 | Pass the row organisation into notify_elevated_users and filter recipients by it (and by country). | none for one tenant | Insert a parts request in organisation B: no notification row for organisation A users. | DB |
| MODB-6 | P1 | VERIFIED (index, sequence); PLAUSIBLE (cross-tenant overwrite through staging upsert) | ready | 3 | Make uniqueness (organisation_id, work_order_no); number per organisation; change every ON CONFLICT (work_order_no) to the composite key in the same migration. | medium: staging and import upserts depend on the current key; change key and upserts together and test the daily import | Two organisations each hold job card "JC-0001"; importing in one never touches the other. | DB |
| MODB-7 | P2 | VERIFIED | at risk | 3 | Use update ... select and treat zero rows as "you do not have permission"; remove the two swallow-all catches. | none | A Director changing an action status sees a clear refusal; a refused delete shows an error. | web |
| MODB-8 | P2 | VERIFIED (code); ASSUMED (no trigger restores it) | at risk | 3 | Send created_by only on insert. | none | Edit another user inspection; created_by is unchanged. | web |
| MODB-9 | P2 | VERIFIED | at risk | 3 | Stamp country from the selected asset or the active country on insert; backfill the 61 rows from the asset. | low: 61 rows become scoped to their country | New web inspection carries the asset country. | web, DB |
| MODB-10 | P2 | VERIFIED | at risk | 3 | Either write the latest inspection reading per wheel onto the tyre record (or a view) or repoint these boards at inspections.tyre_conditions. | low: boards that show N/A start showing real values | After an inspection with pressures, the vehicle shows on Fleet Health with those values. | DB, web |
| MODB-11 | P2 | VERIFIED | at risk | 3 | Rebuild Driver Intelligence on the drivers register and assignments, or retire it. | none (module is off) | Page lists registered drivers. | web |
| MODB-12 | P2 | VERIFIED | ready | 3 | Add a manual "add vehicle to workshop" writer, a downloadable template and a documented header list. | none: additive | A new organisation creates its first workshop record without a file. | DB, web, Flutter |
| MODB-13 | P2 | VERIFIED | ready | 2 | Provide a starter template library that an Admin can copy into the tenant; pilot one schedule end to end. | none: additive | New organisation copies a starter form, publishes it, schedules it, and an assignment appears next day. | DB, web |
| MODB-14 | P3 | VERIFIED | at risk | n/a (operational) | Owner action: review the open actions and sign-off queues; consider auto-closing actions when the linked job completes. | none | Open action count falls; queue age reported. | owner action |
| MODB-15 | P2 | VERIFIED | ready (all off) | 4 | Do not market. Keep hidden. If offered, describe as manual registers. | none | Sales material and menus do not offer these as live monitoring. | marketing, owner action |
| MODB-16 | P2 | VERIFIED | ready | 3 | Add per-organisation module status (override table) with the global row as default. | low | Switching a module off for organisation B leaves A unchanged. | DB, console |
| MODB-17 | P3 | VERIFIED (services); ASSUMED (no notice on each page) | ready | 2 | State the cap on the page or page the read. | none | A ledger with 600 rows says how many are shown. | web |
| MODB-19 | P1 | VERIFIED | ready | 3 | Replace the constant with a resolver that refuses a null organisation unless single-tenant mode is on (the import resolver pattern already used for expenses). | medium: dashboard CSV imports for the current company rely on the stamp; keep single-tenant mode on for it | A service-role insert with no organisation in multi-tenant mode is refused, not stamped. | DB |
| MODB-20 | P3 | VERIFIED | ready | 2 | Let the client rule also accept an approve grant. | none | A user with the grant sees the sign-off control. | web, Flutter |
| MODB-21 | P2 | VERIFIED | at risk | 3 | Show cost impact only when a rate is configured, or label "default rate 120". | none | With no configured rate the column reads "Rate not set". | web |
| MODB-22 | P3 | VERIFIED | at risk | 3 | Align the insert and update policies with the intended roles (or capabilities) and gate the buttons the same way. | low | Roles that cannot write do not see write controls. | DB, web |
| MODB-23 | P3 | VERIFIED | ready | 2 | Pilot before selling: one site, real shifts, check-ins, one PM plan. | none | Evidence of a full cycle in production data. | owner action |
| MODB-24 | P3 | VERIFIED | ready (off) | 2 | Add currency, default from country. | none | Expense rows carry a currency. | DB, web |

**MODB-1** (P1)
- Evidence: pg_proc decide_inspection_approval (role list Admin, PMV Manager, Workshop Area Manager, Workshop Maintenance Area Manager, Tyre Data Collector); src/lib/inspectionApproval.js:27-33
- What happens: Inspection sign-off is limited to a hard-coded list of role names that exist only as custom roles of the current company. Built-in Manager and Director are refused. A new company can only sign inspections as Admin (or by recreating those exact role names, or a per-user approve grant).

**MODB-2** (P1)
- Evidence: pg_proc checklist_is_supervisor (Admin, Maintenance Supervisor, Workshop Supervisor, PMV Manager, Workshop Area Manager, Workshop Maintenance Area Manager, Tyre Data Collector); decide_checklist_approval; src/lib/checklistAccess.js:13,54
- What happens: Checklist approval (both stages) is tied to the current company role names. Manager and Director can author templates but cannot approve a submission. Final approval needs checklist_is_area_manager (same hard-coding).

**MODB-3** (P1)
- Evidence: pg_policies work_orders: only work_orders_cap_insert / work_orders_cap_update are permissive for writes; app_user_can reads organisations.settings permission_overrides (new org has none); src/pages/WorkOrders.jsx:164 gates only delete; src/App.jsx:681 admits Manager and Director to Live Control
- What happens: Work order create and edit is capability-only. In a new company only the Admin can create or edit a job card; Managers see New Work Order, New Job, assign and status controls and receive a permission refusal. In the current company only Admin, Tyre Data Collector and Data Monitor Officer hold the capability, so the 3 Managers on Live Control cannot create jobs or change job status.

**MODB-4** (P1)
- Evidence: pg_proc evaluate_alert_thresholds (SECURITY DEFINER, cron evaluate-alert-thresholds): dynamic counts over public.inspections and public.tyre_records with site and brand filters only, no organisation predicate; references inspections.tread_depth, a column that does not exist (information_schema count 0)
- What happens: Alert rules are evaluated across every organisation, so a second company would be alerted on (and learn counts about) the first company data. The tread_depth metric would raise an unknown column error at run time. Latent today: alert_thresholds holds 0 rows.

**MODB-5** (P1)
- Evidence: pg_proc notify_elevated_users (inserts for every profile with role Admin, Manager or Director, no org filter); caller notify_workshop_parts, trigger on parts_requests
- What happens: A new parts request notifies the Admin, Manager and Director users of every organisation, with the request title and body.

**MODB-6** (P1)
- Evidence: pg_indexes work_orders_work_order_no_key UNIQUE (work_order_no) with no organisation column; generate_work_order_no uses one global sequence work_order_seq
- What happens: Job card numbers are unique across all tenants. A second company importing ERP job cards whose numbers already exist for another tenant is refused with a duplicate error it cannot see or resolve, and the staging pipe upsert on work_order_no could refresh another tenant row. App generated WO numbers come from one shared sequence, so gaps expose other tenants volume.

**MODB-7** (P2)
- Evidence: src/lib/api/correctiveActions.js:49-51 and src/lib/api/inspections.js:211-213 update with no returning row; pg_policies actions_update (Manager, Admin) and role_update_inspections (admin, manager, inspector); src/pages/Inspections.jsx:847-861 markDone and confirmDelete swallow errors
- What happens: An update refused by row security affects 0 rows and returns success, so a Director, Inspector, Tyre Man or supervisor who changes a corrective action status (or a Tyre Man who edits an inspection) sees no error and no change. Mark done and delete on inspections discard any error by design.

**MODB-8** (P2)
- Evidence: src/pages/Inspections.jsx:824-835: payload sets created_by to the current user and is sent to patchInspection on edit
- What happens: Editing an unlocked inspection reassigns created_by to the editor, which changes authorship and the "my inspections" filter.

**MODB-9** (P2)
- Evidence: src/pages/Inspections.jsx:814-819 WRITABLE_COLS has no country; live: 61 of 2,630 inspections have country NULL; corrective_actions 2 NULL
- What happens: Web created inspections carry no country, so they are visible to every country scope and drop out of per-country reports.

**MODB-10** (P2)
- Evidence: live: tyre_records risk_level, tread_depth, pressure_reading populated on 0 of 11,260 rows; readings live in inspections.tyre_conditions (2,630 rows); src/pages/LiveFleetStatus.jsx:443, FleetHealthBoard.jsx:229, ComplianceDashboard.jsx:250 select those tyre_records columns
- What happens: Live Fleet Status, Fleet Health Board, the tread and pressure parts of Compliance Dashboard, tyre alerts and the estimated tyre dates on Maintenance Calendar read condition columns that nothing populates. They render honest N/A but deliver no information for the current company or a new one.

**MODB-11** (P2)
- Evidence: live: tyre_records.driver_name populated on 0 of 11,260; src/pages/DriverManagement.jsx:189 reads tyre_records only; drivers register (674 rows) is not read by that page
- What happens: Driver Intelligence and the driver to tyre correlation in Driver Safety have no data source in practice.

**MODB-12** (P2)
- Evidence: src/lib/workshopStatus/excelParser.js:7-8,37-68 (sectioned workbook with merged title rows); no insert or create RPC in src/lib/api/workshopStatus*.js; no template download in DailyUploadPanel.jsx; workshop_status_can requires app_sees_all_sites for upload
- What happens: Workshop Status records can only be created by uploading a daily Excel in the current company layout. There is no manual add and no downloadable template, so a new company sees an empty board with no usable first action unless it reproduces that file layout.

**MODB-13** (P2)
- Evidence: live: checklist_templates 12 rows (9 published, 3 archived) all in one organisation; no starter library in src/pages/ChecklistBuilder.jsx or src/lib/checklist; checklist_schedules 0 rows, checklist_assignments 0 rows
- What happens: A new company starts with zero checklist templates and must author every form in the builder (file import exists). Schedules have never been used, so the "due" list and the daily assignment cron are unproven with real data.

**MODB-14** (P3)
- Evidence: live: corrective_actions 159 Open, 2 Closed (144 raised by the checklist trigger); checklist_submissions 81 pending + 9 pending area manager; inspections 263 rejected and In Progress; inspection_schedules 1 future plan of 245
- What happens: Operational backlog signals in the current company: actions are raised automatically but almost never closed, sign-off queues are long, the planner has one future plan.

**MODB-15** (P2)
- Evidence: live row count 0 on gps_positions, trips, trip_segments, telematics_devices, dashcam_events, cold_chain_logs, tachograph_records, hos_logs, ifta_records, charging_sessions, fuel_cards, fuel_transactions, fuel_theft_alerts, dtc_codes, geofences, route_plans; services are plain table CRUD (example src/lib/api/trips.js); no ingest edge function or RPC
- What happens: GPS, telematics, trip, tachograph, dashcam, cold chain, DTC, fuel card and charging modules are manual entry ledgers. No device, card or telematics feed exists. The names promise live monitoring that the product does not do.

**MODB-16** (P2)
- Evidence: information_schema: public.modules has no organisation column (module_id, status, ...)
- What happens: Module Control is global: switching a module off for one tenant switches it off for every tenant. See restore list.

**MODB-17** (P3)
- Evidence: src/lib/api/trips.js:59, bayScheduling.js:112, serviceRequests.js:54, dispatch.js:22, gpsPositions.js:84, journeys.js:37, certifications.js:28, dvir.js:33, equipment.js:44, driverDocuments.js:26: limit = 500
- What happens: The simple ledgers read the newest 500 rows and compute their KPI tiles and exports from that page of data. Only some pages state the cap.

**MODB-19** (P1)
- Evidence: pg_proc stamp_import_default_org contains the current company UUID; trigger trg_stamp_import_default_org on inspections and work_orders
- What happens: Rows written without an organisation (service role or dashboard import) are stamped with the current company. A second tenant loaded that way would land inside the first tenant.

**MODB-20** (P3)
- Evidence: decide_inspection_approval honours app_cap_granted(inspections, approve); src/lib/inspectionApproval.js:21-25 says a grant is not consulted
- What happens: A user given a per-user approve grant is accepted by the server but is never shown the sign-off control.

**MODB-21** (P2)
- Evidence: src/lib/workshopLive.js:444,599-608 DEFAULT_LABOUR_RATE = 120; live workshop_config 0 rows; src/pages/WorkshopAnalytics.jsx:264 labels it with the active currency
- What happens: Delay cost impact on Live Control and Workshop Analytics is hours lost multiplied by a labour rate that falls back to a hard-coded 120 per hour, labelled SAR, AED or EGP alike, with no statement that the rate is a default.

**MODB-22** (P3)
- Evidence: pg_policies corrective_actions: actions_insert (Reporter, Manager, Admin), actions_update (Manager, Admin); rca_records insert (Admin, Manager, Reporter); no role gating in src/pages/CorrectiveActions.jsx
- What happens: Write policies name roles that do not match who uses the screen (Director and Inspector excluded) while the page shows create, edit and status controls to everyone.

**MODB-23** (P3)
- Evidence: live: all workforce_* tables 0 rows including workforce_task_types and workforce_employees; tech_activity_events 27, wo_assignments 27, workshop_attendance 0, shifts 0, pm_programs 0, technician_skills 0
- What happens: The workforce, attendance, shift and PM features have never carried real data, so their end to end behaviour is unproven outside tests.

**MODB-24** (P3)
- Evidence: information_schema: driver_expenses has amount but no currency column; src/pages/DriverExpenses.jsx:564 formats with the active country currency
- What happens: Driver expense amounts carry no currency of their own.

Impact on selling to a second company, in one line each: MODB-1, 2, 3 stop a new customer running sign-off and job cards with normal roles. MODB-4, 5, 6, 19 cross or collide across tenants. MODB-12 and 13 leave two core modules with no workable first step. MODB-10, 11, 15 are features that would be demonstrated empty.

## 6. Module register

Class: 1 ready, 2 needs customer setup or data, 3 needs repairs, 4 incomplete or future, 5 duplicate, 6 internal or legacy. "(disabled)" after a key means Module Control has it switched off today; see MODULE_RESTORE_LIST for the restore or hide decision.

### Workshop & Maintenance

| Module | Route | Guard and key | Internal | Class | Brand-new empty company | Defects | Remediation | Pri | Area |
|---|---|---|---|---|---|---|---|---|---|
| Work Orders | `/work-orders` | ModuleRoute; key work_orders | at risk | 3 | Empty register with New Work Order. Only the Admin can save; other roles are refused. | MODB-3, MODB-6, MODB-19 | Per-tenant work order numbering (unique on organisation + number, per-org sequence); seed sensible create/edit capability defaults for Manager on tenant creation; hide write controls from users without the capability. | P1 | DB, web |
| Live Control | `/workshop-live` | RoleRoute(Admin,Manager,Director)+ModuleRoute; key workshop_live | at risk | 3 | Empty technician board and kanban. New Job works for Admin only. Technicians appear only when they hold workshop roles or skills rows. | MODB-3, MODB-21, MODB-23 | Same capability fix as Work Orders; show delay cost only when a labour rate is configured, or label the default. | P1 | DB, web |
| Bay Scheduling | `/bay-scheduling` | RoleRoute(Admin); key bay_scheduling (disabled) | ready | 2 | Empty table with an Add button; a new company can start typing records at once. Nothing is prefilled. | MODB-17 | Keep hidden until a customer asks; see restore list. | P3 | web |
| Service Requests | `/service-requests` | RoleRoute(Admin); key service_requests (disabled) | ready | 5 | Empty table with an Add button; a new company can start typing records at once. Nothing is prefilled. | MODB-17 | Overlaps Repair Requests and Report Issue; consolidate before selling. See restore list. | P3 | web |
| Breakdown Callouts | `/breakdowns` | RoleRoute(Admin); key breakdowns (disabled) | ready | 5 | Empty table with an Add button; a new company can start typing records at once. Nothing is prefilled. | MODB-17 | Overlaps Breakdown Register; keep one. See restore list. | P3 | web |
| Repair Requests (RFR) | `/repair-requests` | RoleRoute(Admin,Manager,Director)+moduleKey; key repair_requests (disabled) | ready | 2 | Empty register; drivers and trades raise requests (web or Flutter); conversion to a job card needs the work order capability. | MODB-3, MODB-6 | Restore together with the work order capability fix. RFR number prefix should be per tenant (check next_rfr_no prefix). | P2 | DB, web, Flutter |
| Breakdown Register | `/asset-breakdowns` | RoleRoute(Admin,Manager,Director)+moduleKey; key asset_breakdowns | ready | 2 | Empty register with add form; elevated roles write. | none found | None blocking. | P3 | web |
| Preventive Maintenance | `/pm-programs` | RoleRoute(Admin,Manager,Director)+ModuleRoute; key pm_programs (disabled) | ready | 2 | Empty plans list with templates to start from; record service is an atomic RPC. | MODB-23 | Restore after a pilot with real plans; meter axis needs odometer or hour logs. | P2 | web |
| Maintenance Calendar | `/maintenance-calendar` | RoleRoute(Admin); key maintenance_calendar | at risk | 3 | Empty calendar. Fills only from PM plans and work orders. | MODB-10, MODB-23 | Drop or relabel the estimated tyre events until tyre condition data exists. | P3 | web |
| Predictive Maintenance | `/predictive-maintenance` | ModuleRoute; key predictive_maintenance | ready | 2 | Honest empty overview; needs tyre fitments with meters, job cards and breakdowns. | none found | Name over-promises (it is a rules overview, not prediction); consider renaming. | P3 | web |
| Downtime Tracker | `/downtime` | ModuleRoute; key fleet_analytics (shared) | at risk | 3 | Empty; with job cards only, hours come from open to complete times. | MODB-10 | Remove the severity-based estimated hours path (risk level is never populated) and rely on job card times only. | P3 | web |
| DTC Diagnostics | `/dtc` | RoleRoute(Admin); key dtc (disabled) | ready | 4 | Empty forever unless someone types device readings by hand. No feed exists. | MODB-15 | Do not market; needs an OBD or telematics feed. | P3 | web |
| Vehicle Washing | `/vehicle-washing` | ModuleRoute; key vehicle_washing | ready | 2 | Empty report and quick log; drivers log washes on the phone. Cost defaults to zero (in-house washing). | none found | Make wash interval and cost model a tenant setting. No test file is named after the page (engine tests exist). | P3 | web, Flutter |
| Absence & Attendance | `/workshop-absence` | RoleRoute(Admin,Manager,Director); key workshop_absence (disabled) | ready | 2 | Empty; needs shifts and phone check-ins. | MODB-23 | Restore only with shifts in use. | P3 | web |
| Technician Scorecard | `/technician-scorecard` | RoleRoute(Admin); key technician_scorecard | ready | 2 | Empty leaderboard; skills and certificates matrix empty. | MODB-23 | None blocking. | P3 | web |
| Shift Scheduling | `/shifts` | RoleRoute(Admin)+ModuleRoute; key shifts (disabled) | ready | 2 | Empty table with an Add button; a new company can start typing records at once. Nothing is prefilled. | MODB-23 | See restore list. | P3 | web |
| My Day & Team Reviews | `/workforce-daily` | none (in-page checks); key workforce_daily (no registry row) | ready | 2 | Empty; a supervisor must first create employees and task types. No guided setup. | MODB-23 | Add a first-run setup (task types, employees) and a registry row so it can be switched per tenant. | P2 | web, DB |
| Parts Requests | `/parts-requests` | RoleRoute(Admin,Manager,Director); key parts_requests (disabled) | ready | 3 | Empty; needs parts catalog and open jobs. | MODB-5 | Scope notify_elevated_users (or its caller) to the row organisation before restoring. | P1 | DB |
| Tool & Equipment | `/equipment` | RoleRoute(Admin); key equipment (disabled) | ready | 2 | Empty table with an Add button; a new company can start typing records at once. Nothing is prefilled. | MODB-17 | See restore list. | P3 | web |
| Workshop Analytics | `/workshop-analytics` | RoleRoute(Admin,Manager,Director); key workshop_analytics | at risk | 3 | Empty charts; needs technician activity events from phones. | MODB-21, MODB-23 | Fix the default labour rate disclosure. | P2 | web |
| Maintenance Cost & Tasks | `/maintenance-cost-board` | RoleRoute(Admin,Manager,Director); key maintenance_cost_board | ready | 2 | Empty board; needs job cards and job card lines (ERP import). | none found | None blocking. | P3 | web |
| Workshop Settings | `/workshop-settings` | RoleRoute(Admin,Manager,Director); key workshop_settings | ready | 2 | Shows defaults (0 rows saved live); Admin saves. | MODB-21 | Require a labour rate with currency before cost impact is shown. | P3 | web |

### (no menu item)

| Module | Route | Guard and key | Internal | Class | Brand-new empty company | Defects | Remediation | Pri | Area |
|---|---|---|---|---|---|---|---|---|---|
| Workshop job detail | `/workshop/:jobId` | ModuleRoute; key work_orders | ready | 2 | Reached from a job; nothing to show without jobs. | MODB-3 | As Work Orders. | P3 | web |
| Workshop TV board | `/workshop-tv/:token` | none (token RPC get_workshop_snapshot); key (anonymous token) | ready | 2 | Needs a share link created by an elevated user. | none found | None in this scope; token security is covered by the security audit. | P3 | web |

### Inspections & Compliance

| Module | Route | Guard and key | Internal | Class | Brand-new empty company | Defects | Remediation | Pri | Area |
|---|---|---|---|---|---|---|---|---|---|
| Inspections | `/inspections` | ModuleRoute; key inspections | ready | 3 | Empty workspace with New inspection; needs the fleet register first. Sign-off needs an Admin. | MODB-1, MODB-7, MODB-8, MODB-9, MODB-19, MODB-20 | Move signer roles to a per-tenant setting (or the approval matrix); return the updated row on writes; stamp country from the asset; stop sending created_by on edit. | P1 | DB, web, Flutter |
| AI Tyre Inspection | `/ai-tyre-inspection` | RoleRoute(list incl. custom roles)+ModuleRoute; key inspections (shared) | ready | 3 | Empty register; fills as inspections with photos arrive; AI analysis needs the platform AI key and budget. | MODB-1 | Route allow list names current company roles; AI budget and key are platform wide (see AI audit). | P2 | web, edge fn |
| Inspection Planner | `/inspection-planner` | none (in-page access check); key inspection_planner | ready | 2 | Empty agenda and coverage; needs fleet. | MODB-14 | None blocking. | P3 | web |
| Inspection Intelligence | `/inspection-intelligence` | ModuleRoute; key inspections (shared) | ready | 2 | Empty analytics until inspections exist. | none found | None blocking. | P3 | web |
| DVIR Reports | `/dvir` | RoleRoute(Admin); key dvir (disabled) | ready | 5 | Empty table with an Add button; a new company can start typing records at once. Nothing is prefilled. | MODB-17 | Duplicate of a pre-trip checklist; retire or fold into Checklists. | P3 | web |
| Checklists | `/checklists` | none (ModuleStatusGate only); key checklists | ready | 3 | "No checklists yet". An author must build the first template; nothing is seeded. | MODB-2, MODB-13 | Ship a starter template library per tenant; move approver roles to tenant configuration. | P1 | DB, web, Flutter |

### (no menu item)

| Module | Route | Guard and key | Internal | Class | Brand-new empty company | Defects | Remediation | Pri | Area |
|---|---|---|---|---|---|---|---|---|---|
| Checklist Builder | `/checklist-builder` | RoleRoute(Admin,Manager,Director,Maintenance Supervisor); key checklist_builder | ready | 2 | Blank builder with field presets and file import. | MODB-13 | Starter library. | P2 | web |
| Checklist run and submission view | `/checklists/:templateId/run, /checklists/submission/:id` | none; key checklists | ready | 3 | Needs a published template. | MODB-2 | As Checklists. | P2 | web |
| My Checklists | `/my-checklists` | none; key my_checklists | ready | 2 | Empty due list (no schedules); lists published forms for the user trade. | MODB-13 | None blocking. | P3 | web |

### Inspections & Compliance

| Module | Route | Guard and key | Internal | Class | Brand-new empty company | Defects | Remediation | Pri | Area |
|---|---|---|---|---|---|---|---|---|---|
| Checklist Schedules | `/checklist-schedules` | RoleRoute(author roles); key checklist_schedules | ready | 2 | Empty; first action is New schedule, which needs a published template. | MODB-13 | Pilot one schedule end to end before selling the feature (0 schedules and 0 assignments live). | P2 | web, DB |
| Checklist Insights | `/checklist-insights` | RoleRoute(author roles); key checklist_insights | ready | 2 | Empty until submissions exist. | none found | None blocking. | P3 | web |
| Audit Pack | `/checklist-audit` | RoleRoute(author roles); key checklist_audit (no registry row) | ready | 2 | Empty pack; needs controlled forms and records. | none found | None blocking. | P3 | web |
| Corrective Actions | `/actions` | ModuleRoute; key corrective_actions | at risk | 3 | Empty board with New action. Reporter, Manager and Admin can create; others are refused. | MODB-7, MODB-9, MODB-14, MODB-22 | Return the updated row and show a refusal; align write policy with the roles that use the page; review why 159 actions are open. | P2 | DB, web |
| Root Cause | `/rca` | ModuleRoute; key rca | ready | 2 | Empty list with add form. 1 record live. No page test. | MODB-22 | None blocking. | P3 | web, Flutter |
| Root Cause Engine | `/root-cause` | ModuleRoute; key root_cause_engine | at risk | 3 | Empty; needs removed tyres with a removal reason. | none found | Removal reason quality (brands stored as reasons on UAE rows per project memory) limits the output; clean before selling. | P3 | DB |
| Anomaly Scan | `/anomalies` | ModuleRoute; key tyre_records (shared) | ready | 2 | Empty scan; needs tyre records and job cards. | none found | None blocking. | P3 | web |
| Compliance Dashboard | `/compliance` | RoleRoute(Admin); key compliance | at risk | 3 | All scores N/A until tread and pressure exist on tyre records. | MODB-10 | Feed the board from inspection readings. | P2 | web, DB |
| Certifications | `/certifications` | RoleRoute(Admin,Manager,Director); key certifications (disabled) | ready | 2 | Empty table with an Add button; a new company can start typing records at once. Nothing is prefilled. | MODB-17 | See restore list. | P3 | web |
| Policy Management | `/policies` | RoleRoute(Admin); key policies (disabled) | ready | 2 | Empty table with an Add button; a new company can start typing records at once. Nothing is prefilled. | none found | No page test. See restore list. | P3 | web |
| Emissions Tests | `/emissions` | RoleRoute(Admin); key emissions (disabled) | ready | 2 | Empty table with an Add button; a new company can start typing records at once. Nothing is prefilled. | MODB-17 | See restore list. | P3 | web |
| Hours of Service | `/hours-of-service` | RoleRoute(Admin); key hours_of_service (disabled) | ready | 4 | Empty forever unless someone types device readings by hand. No feed exists. | MODB-15 | Do not market; manual duty log only. | P3 | web |
| Tachograph | `/tachograph` | RoleRoute(Admin); key tachograph (disabled) | ready | 4 | Empty forever unless someone types device readings by hand. No feed exists. | MODB-15 | Do not market; no tachograph download. | P3 | web |
| Speed Limiter | `/speed-limiter` | RoleRoute(Admin); key speed_limiter | ready | 2 | Empty register; coverage against fleet. 1 row live. | none found | None blocking. | P3 | web |
| Alerts | `/alerts` | ModuleRoute; key alerts | at risk | 3 | "All clear" style empty state; alerts are computed in the browser from tyre, inspection, stock and budget rows. The alerts table is unused (0 rows). | MODB-10 | Tyre condition alerts cannot fire without condition data; persist dismissals server side. | P2 | web |
| Alert Thresholds | `/alert-thresholds` | ModuleRoute; key alerts (shared) | at risk | 3 | Empty rules list; first action is New rule. Rules are per user. | MODB-4 | Scope every metric query to the rule owner organisation; remove or repoint the tread_depth metric. | P1 | DB |

### Drivers & Safety

| Module | Route | Guard and key | Internal | Class | Brand-new empty company | Defects | Remediation | Pri | Area |
|---|---|---|---|---|---|---|---|---|---|
| Driver Intelligence | `/driver-management` | ModuleRoute; key driver_management (disabled) + fleet_master | at risk | 3 | Empty; and stays empty because tyre records carry no driver. | MODB-11 | Rebuild on the drivers register or retire. | P3 | web |

### (no menu item)

| Module | Route | Guard and key | Internal | Class | Brand-new empty company | Defects | Remediation | Pri | Area |
|---|---|---|---|---|---|---|---|---|---|
| Driver detail | `/driver-management/:driverId` | ModuleRoute; key fleet_master | at risk | 3 | As Driver Intelligence. | MODB-11 | As Driver Intelligence. | P3 | web |

### Drivers & Safety

| Module | Route | Guard and key | Internal | Class | Brand-new empty company | Defects | Remediation | Pri | Area |
|---|---|---|---|---|---|---|---|---|---|
| Driver workspace | `/driver-workspace` | none (RPC enforces); key driver_workspace | ready | 2 | Empty roster; needs the drivers register (import) and fines entered. 674 drivers, 0 fines live. | none found | Fines workflow is unproven with real data; pilot first. | P2 | web, Flutter |
| Driver Safety | `/driver-safety` | RoleRoute(Admin); key driver_safety (disabled) | ready | 4 | Empty forever unless someone types device readings by hand. No feed exists. | MODB-11, MODB-15 | Do not market; events are typed by hand. | P3 | web |
| Driver Training | `/driver-training` | RoleRoute(Admin); key driver_training (disabled) | ready | 2 | Empty table with an Add button; a new company can start typing records at once. Nothing is prefilled. | none found | See restore list. | P3 | web |
| Driver Coaching | `/driver-coaching` | RoleRoute(Admin); key driver_coaching (disabled) | ready | 4 | Scores (safety, fuel, harsh events) must be typed by hand. | MODB-15 | Do not market without telematics. | P3 | web |
| Driver Documents | `/driver-documents` | RoleRoute(Admin); key driver_documents (disabled) | ready | 2 | Empty table with an Add button; a new company can start typing records at once. Nothing is prefilled. | MODB-17 | Keyed on free-text driver name, not the drivers register. See restore list. | P3 | web |
| Driver Expenses | `/driver-expenses` | RoleRoute(Admin); key driver_expenses (disabled) | ready | 2 | Empty table with an Add button; a new company can start typing records at once. Nothing is prefilled. | MODB-24 | Add a currency column. No page test. | P3 | web, DB |
| Video Telematics | `/video-telematics` | RoleRoute(Admin); key video_telematics (disabled) | ready | 4 | Empty forever unless someone types device readings by hand. No feed exists. | MODB-15 | Do not market. | P3 | web |
| Fuel Theft Alerts | `/fuel-theft` | RoleRoute(Admin); key fuel_theft (disabled) | ready | 4 | Empty forever unless someone types device readings by hand. No feed exists. | MODB-15 | Do not market; "alerts" are hand-entered records. | P3 | web |

### Monitoring & Logistics

| Module | Route | Guard and key | Internal | Class | Brand-new empty company | Defects | Remediation | Pri | Area |
|---|---|---|---|---|---|---|---|---|---|
| Live Fleet Status | `/live-fleet` | RoleRoute(Admin); key live_fleet (disabled) | at risk | 3 | Vehicle grid with no tyre condition; nothing live about it. | MODB-10 | Rename (it is a tyre condition board, not live tracking) and feed from inspections. | P3 | web |
| Daily Ops | `/daily-ops` | ModuleRoute; key daily_ops | ready | 2 | Empty overview tiles and action list; shift handover empty. | none found | None blocking. | P3 | web |
| Workshop Status | `/daily-ops/workshop` | ModuleRoute; key daily_ops:workshop | ready | 3 | Empty tabs; the only way to create records is the daily Excel upload in the current company layout. | MODB-12 | Add manual add-vehicle and a downloadable template; document the file format. | P1 | web, DB, Flutter |
| GPS Tracking | `/gps-tracking` | RoleRoute(Admin); key gps_tracking (disabled) | ready | 4 | Empty forever unless someone types device readings by hand. No feed exists. | MODB-15 | Do not market. | P3 | web |
| Fleet Health Board | `/fleet-health` | ModuleRoute; key fleet_health (disabled) + fleet_intelligence | at risk | 3 | Vehicles shown as not rated. | MODB-10 | Feed from inspections or retire. | P3 | web |
| Trip Replay | `/trip-replay` | RoleRoute(Admin); key trip_replay (disabled) | ready | 4 | Empty forever unless someone types device readings by hand. No feed exists. | MODB-15 | Do not market. | P3 | web |
| Trip History | `/trips` | RoleRoute(Admin); key trips (disabled) | ready | 4 | Empty forever unless someone types device readings by hand. No feed exists. | MODB-15 | Do not market. | P3 | web |
| Journey Log | `/journeys` | RoleRoute(Admin); key journeys (disabled) | ready | 2 | Empty table with an Add button; a new company can start typing records at once. Nothing is prefilled. | MODB-17 | See restore list. | P3 | web |
| Route Optimization | `/route-optimization` | RoleRoute(Admin); key route_optimization (disabled) | ready | 4 | Empty; "optimized" distances are typed by the user. The page says savings are estimates. | MODB-15 | Do not market; there is no optimizer. | P3 | web |
| Geofencing | `/geofencing` | RoleRoute(Admin); key geofencing (disabled) | ready | 4 | Zones can be recorded; nothing evaluates them (no positions, no map). | MODB-15 | Do not market. | P3 | web |
| Dispatch Planning | `/dispatch` | RoleRoute(Admin); key dispatch (disabled) | ready | 2 | Empty table with an Add button; a new company can start typing records at once. Nothing is prefilled. | MODB-17 | See restore list. | P3 | web |
| Load Planning | `/load-planning` | RoleRoute(Admin); key load_planning (disabled) | ready | 2 | Empty table with an Add button; a new company can start typing records at once. Nothing is prefilled. | none found | See restore list. | P3 | web |
| Telematics Devices | `/telematics-devices` | RoleRoute(Admin); key telematics_devices (disabled) | ready | 4 | Device inventory only; no connection to any device. | MODB-15 | Do not market. | P3 | web |
| Cold-Chain Monitor | `/cold-chain` | RoleRoute(Admin); key cold_chain (disabled) | ready | 4 | Empty forever unless someone types device readings by hand. No feed exists. | MODB-15 | Do not market. | P3 | web |
| Weighbridge | `/weighbridge` | RoleRoute(Admin); key weighbridge (disabled) | ready | 2 | Empty table with an Add button; a new company can start typing records at once. Nothing is prefilled. | MODB-17 | See restore list. | P3 | web |
| Proof of Delivery | `/proof-of-delivery` | RoleRoute(Admin); key proof_of_delivery (disabled) | ready | 2 | Empty table with an Add button; a new company can start typing records at once. Nothing is prefilled. | MODB-17 | See restore list. | P3 | web |
| Toll Transactions | `/toll-transactions` | RoleRoute(Admin); key toll_transactions (disabled) | ready | 2 | Empty table with an Add button; a new company can start typing records at once. Nothing is prefilled. | none found | See restore list. | P3 | web |
| Fuel Cards | `/fuel-cards` | RoleRoute(Admin); key fuel_cards (disabled) | ready | 4 | Card register only; no card provider feed, fuel_transactions empty. | MODB-15 | Do not market as fuel card integration. | P3 | web |
| Fuel Delivery | `/fuel-delivery` | RoleRoute(Admin); key fuel_delivery (disabled) | ready | 2 | Empty table with an Add button; a new company can start typing records at once. Nothing is prefilled. | none found | See restore list. | P3 | web |
| Fuel Efficiency | `/fuel-efficiency` | ModuleRoute; key fuel_efficiency (disabled) + fleet_analytics | at risk | 4 | Modelled fuel impact from tyre data; no fuel consumption data exists. Labelled "modelled estimates" in exports. | MODB-10, MODB-15 | Do not market as fuel efficiency measurement. | P3 | web |
| EV Charging | `/charging-sessions` | RoleRoute(Admin); key charging_sessions (disabled) | ready | 4 | Empty forever unless someone types device readings by hand. No feed exists. | MODB-15 | Do not market. | P3 | web |
| IFTA Fuel Tax | `/ifta-reporting` | RoleRoute(Admin); key ifta_reporting (disabled) | ready | 6 | Empty; a North American fuel tax return with no relevance to the target markets. | MODB-15 | Retire. | P3 | web |

## 7. Common facts for the simple ledger modules (VERIFIED on the pattern, ASSUMED per page)

Applies to Bay Scheduling, Service Requests, Breakdown Callouts, DTC, Shifts, Equipment, DVIR, Certifications, Policies, Emissions, Hours of Service, Tachograph, Driver Training, Coaching, Documents, Expenses, Video Telematics, Fuel Theft, GPS Tracking, Trip Replay, Trips, Journeys, Route Optimization, Geofencing, Dispatch, Load Planning, Telematics Devices, Cold Chain, Weighbridge, Proof of Delivery, Toll, Fuel Cards, Fuel Delivery, EV Charging, IFTA.

- One table each, 0 rows live, explicit column lists that match the live schema, client validation of the one required field, values coerced before insert.
- Row security: RESTRICTIVE organisation and country isolation on every one; organisation defaults to the caller organisation; any active signed-in user may insert and update (delete needs Admin). So a tenant cannot see another tenant rows. Route access is Admin only for most.
- Load, save, edit, delete, filter and export exist in code. Lists are capped (MODB-17). KPI tiles come from the loaded rows and show N/A or zero-state text when empty.
- None has a mobile or Flutter counterpart. None has any automated feed. Tests are pure-engine and page smoke tests; they do not exercise the database.
- Not hard-coded to the current company. The risk is what the names promise, not the code.

## 8. Mobile and Flutter counterparts (from `tyre_pulse_flutter/lib/features`)

Present: inspections, approvals, checklists, work_orders, workshop, workshop_status, washing, preventive_maintenance, rca, driver_workspace, alerts, tasks, my_work, report_issue, calendar. The hard-coded approver roles (MODB-1, MODB-2) are mirrored in the Flutter signer lists per project memory (not re-read in this audit). Flutter writes local photo paths into checklist submissions (known gap in project memory, not re-verified here).

## 9. Not verified

- No browser session: page behaviour for an empty company was derived from code, not observed. No second organisation was created (read-only rule), so every "new company" statement is a code and policy reading.
- Whether the 61 country-less inspections were created on the web; whether a trigger protects `created_by` on inspection edit.
- Policies on `wo_assignments`, `wo_tasks`, `tech_activity_events` in detail (whether a Manager can assign even though the job row update is refused).
- The staging upsert overwrite across tenants in MODB-6 (index and sequence verified; overwrite path is PLAUSIBLE).
- Whether `evaluate_alert_thresholds` traps the unknown column error per rule.
- Flutter and Expo code paths were not re-read; AI tyre inspection worker, budget and accuracy are left to the AI audit; Module Control restore decisions are left to the restore list.
- The workshop status database suites and the full vitest suite were not run (8 targeted files were).
