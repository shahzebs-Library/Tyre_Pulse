# Module workflow audit A: Overview, Fleet and Assets, Tyre Management

Date: 2026-11-12. Read-only audit of the working tree on branch `claude/tyrepulse-inspector-build-7rxp2t`
(9 commits ahead of `origin/main`) and of the live database through SELECT only. Machine-readable copy:
`docs/commercial-readiness/audit/modules_A.json`.

## Scope and method

- 53 entries: 5 Overview menu items, 18 Fleet and Assets, 26 Tyre Management, plus 6 routes with no menu item
  (`/asset-management/:assetNo`, `/vehicle/:assetNo`, `/rfid-registry`, `/scan`, `/my-problems`, and the
  redirects `/asset-management`, `/tyre-failure-cpk` noted inside their keeper).
- For each: route and guard in `src/App.jsx`, page, services, tables. Insert and update payloads were compared
  with the live column lists, NOT NULL columns, CHECK constraints, unique indexes and INSERT policies taken
  from the catalog. Select lists in the services were checked against `information_schema` for unknown columns
  (one real hit: `sites.updated_by`).
- Where main differs: on main `/asset-management` and `/tyre-failure-cpk` are separate pages and menu items,
  and "Tyre Time in Service" is still called "Tyre Age Compliance". On the working tree they are views of
  Fleet Master and CPK Intelligence.
- 15 modules in these groups are currently `disabled` in `public.modules` (batteries, combinations, customers,
  fleet_groups, fleet_risk_score, reservations, retread, retread_claims, rotation, rotation_optimizer, tpms,
  tyre_pool, tyre_service_events, vehicle_checkinout, warranty). They are audited briefly; the restore decision
  belongs to MODULE_RESTORE_LIST.
- 10 existing vitest files were run (77 tests, all pass): tyreRecords.api, tyreScrap.api, gatePassPage.api,
  warranty.api, commandCenter, fleetMasterFilters, siteManagementAnalytics, tyreExchange.api, scrapRegister,
  odometerLogs. All service tests mock Supabase, so they cannot see a missing column, a constraint or a policy.

## The two verdicts

**Internal Production Readiness (current company): usable, with one broken function and several unproven
modules.** 29 of 53 entries are ready for daily use. 24 are at risk, almost all because they are switched off
or have no production rows, so nothing has ever proved them. The one function that is broken today for the
current team is editing an existing site (MODA-5). Silent failed saves on Tyre Records for non-writer roles
(MODA-7) and buttons shown to roles the database refuses (MODA-8) are real daily annoyances.

**Commercial SaaS Readiness (a different company from zero): not ready in these three groups.** No module
reaches class 1. Class 2 (works after customer setup or data): 17. Class 3 (needs repair): 14. Class 4
(incomplete): 17. Class 5 (duplicate): 5. Class 6: 0. Six defects block a second tenant outright: shared
scrap marks (MODA-1), shared warranty numbers (MODA-2), three hard-coded countries and currencies (MODA-3),
one company's tyre life ceilings (MODA-4), a tyre form that cannot record size or position (MODA-6), and a
single global logo and settings store (MODA-17, MODA-9).

## Cross-cutting findings

Each finding lists: severity, confidence, evidence, what happens, Internal status, Commercial status, fix,
risk of the fix to the current company, acceptance test, area.

**MODA-1 Scrap and return marks are shared by all tenants. P1. VERIFIED.**
Evidence: unique index `tyre_status_marks_serial_mark_type_key (serial, mark_type)`; `scrap_tyre_by_serial`
is SECURITY DEFINER and ends `on conflict (serial, mark_type) do update` with no organisation test;
`src/lib/api/tyreExchange.js:48` upserts on the same key. What happens: company B scraps serial X that
company A already marked. The definer function overwrites A's reason, actor and date; B's tyre status
changes but B has no mark, so B's scrap register does not show it. From the browser path B gets an RLS
error instead. Internal: ready (one tenant). Commercial: blocker for Scrap Management, Serial Tracker, Tyre
Exchange, Tyre Records bulk scrap. Fix: unique key `(organisation_id, serial, mark_type)`, same conflict
target in the function and the client. Risk to current company: low, existing rows are already unique; the
index, function and client must ship together. Acceptance: two test organisations scrap the same serial and
each sees only its own mark. Area: DB, web.

**MODA-2 Warranty claim numbers are unique across tenants. P1. VERIFIED.**
Evidence: unique index `warranty_claim_no_country_uniq (claim_no, country)`; number built in the browser from
the tenant's own list (`src/pages/WarrantyTracker.jsx:459`). What happens: WAR-2026-00001 in KSA can exist
once for the whole platform. Internal: ready (0 claims). Commercial: blocker for Warranty. Fix: add
organisation_id to the key and mint the number server-side. Risk: none (table is empty). Acceptance: two
organisations each create their first claim in the same country. Area: DB, web.

**MODA-3 Countries and currencies are hard-coded to KSA, UAE, Egypt. P1. VERIFIED.**
Evidence: `src/contexts/SettingsContext.jsx:21-23`; `src/pages/FleetMaster.jsx:1252`;
`src/pages/TyreRecords.jsx:815`; `src/pages/AssetManagement.jsx:326`; ten further `COUNTRY_CURRENCY` copies in
`src/lib`; `tyre_records` CHECK `length(country) <= 10`. What happens: a company in Qatar or India has no
country to choose, and money is labelled SAR, AED or EGP. Internal: ready. Commercial: blocker for any buyer
outside the three countries; cosmetic risk inside them. Fix: an organisation country list with currency
(the `country_currency` table already exists) read by one helper; keep the three as the current tenant's
rows. Risk: low if the helper returns the same three for the current organisation. Acceptance: an
organisation configured for one other country can add a vehicle and a tyre and sees its currency on Fleet
Master, Tyre Records and CPK. Area: web, DB.

**MODA-4 Tyre life ceilings are one company's rule. P1. VERIFIED.**
Evidence: `public.tyre_life_km_cap` and `src/lib/tyreKm.js:18-21` (mixer 80,000; pump 56,000; loader 15,000;
everything else 100,000 km). What happens: a life above the ceiling is treated as bad data and becomes
unknown. Correct for a ready-mix fleet (owner confirmed 2026-11-04). For a long-haul fleet most genuine lives
would be discarded and CPK would read N/A. Internal: ready. Commercial: class 3 for Tyre Lifecycle, CPK
Intelligence, Brand Performance, Warranty candidates. Fix: per organisation ceilings by vehicle type with the
current values as that tenant's rows; SQL and JS read the same table. Risk: medium, this function feeds every
CPK figure; must be proven byte-identical for the current tenant before switching. Acceptance: current
tenant's CPK outputs unchanged; a test tenant with a 250,000 km ceiling keeps a 180,000 km life. Area: DB, web.

**MODA-5 Editing a registered site fails. P1. VERIFIED against the catalog, not executed.**
Evidence: `src/lib/api/sites.js:255` sends `updated_by`; `sites` has no such column; PostgREST rejects the
whole request on an unknown column. Called from `src/pages/SiteManagement.jsx:101` for Edit site and Promote
to register when the name already exists. No test covers `upsertSite`. Internal: broken function inside an
otherwise working page. Commercial: class 3. Fix: drop the key from the payload (or add the column). Risk:
none. Acceptance: edit the region of an existing site and see it saved; add a service test that checks
payload keys against the real column list. Area: web.

**MODA-6 The web tyre form cannot record size or wheel position. P1. VERIFIED.**
Evidence: form fields registered in `src/pages/TyreRecords.jsx` (17 fields, none of size, tyre_position,
vehicle_type, status, removal_date). What happens: a tyre typed in on the web is invisible to running life,
the wheel map, rotation, fitment and size analysis. The current company never noticed because its tyres come
from ERP imports and the phone app. Internal: ready. Commercial: class 3, a new company's first manual tyre
is half a record. Fix: add the fields with the vehicle's own wheel positions. Risk: none (additive).
Acceptance: add a tyre on the web and see it on the vehicle's tyre map and in Running and Remaining. Area: web.

**MODA-7 Saves that change nothing are reported as saved. P2. VERIFIED.**
Evidence: `src/lib/api/tyreRecords.js:245` update without returning rows; `src/pages/TyreRecords.jsx`
saveRecord, bulk edit (line 344) and the bulk scrap fallback (line 455) do not check results; the page shows
Add and Edit to every role. Under RLS an update by a role without the right touches zero rows and raises no
error. Internal: at risk for Inspector, Tyre Man and other non-writer roles. Commercial: same. Fix: return
the updated ids and show a refusal when none; hide the buttons using the server capability. Risk: none.
Acceptance: an Inspector edits a tyre and is told it was not saved. Area: web.

**MODA-8 Buttons are offered to roles the database refuses. P2. VERIFIED.**
Evidence: `src/pages/FleetMaster.jsx:349,352` against `vehicle_fleet_cap_insert` and `admin_only_delete_guard`;
`src/pages/SiteManagement.jsx:362` against `sites_write`. Internal: at risk (Managers and Directors meet a
permission error after filling the form). Commercial: same, and a new company whose first user is not an
Admin cannot add a vehicle at all. Fix: drive the buttons from `app_user_can` results already loaded in
AuthContext. Risk: none. Area: web.

**MODA-9 Module switches, role matrix and system settings are global. P2. VERIFIED.**
Evidence: `public.modules` has no organisation column; `module_permissions` has 0 of 1,346 rows with an
org_id and `app_user_can` reads `org_id is null`; `system_config` has no organisation column;
`src/components/ProtectedRoute.jsx:199,223` let Admin pass a disabled module. What happens: one switch
changes every tenant, and each company's Admin can still open the 15 unfinished modules listed above.
Internal: ready. Commercial: must be resolved before a second tenant (also covered by the access and restore
audits). Fix: per organisation overrides on top of global defaults; hide disabled modules from tenant Admins
and leave the bypass to super admins. Risk: medium for the bypass change (the current Admins use it); apply
per organisation. Area: DB, web, console.

**MODA-10 Five routes have no guard. P2. VERIFIED.**
`/warranty`, `/scrap`, `/tyre-pool`, `/my-checklists`, `/scan` (`src/App.jsx:694,696,787,770,873`). RLS still
scopes the data. Fix: ModuleRoute with the module key. Risk: low; check the Tyre Data Collector role keeps
Scrap. Area: web.

**MODA-11 A new company gets no first step. P2. VERIFIED.**
The Command Center shows honest empty cards and nothing else (`CommandCenter.jsx:65,125,212,334,385`).
Fix: first-run panel. Risk: none. Area: web.

**MODA-12 Analytics built on empty columns. P2. VERIFIED.**
`tyre_records`: 11,260 rows; risk_level 0, tread_depth 0, pressure_reading 0, supplier 0. Fleet Risk Score,
Rotation Optimizer, Retread eligibility, Position Intelligence risk views, TPMS fallback and the Passport wear
curve have never run on real values. Internal: at risk. Commercial: class 4 until an input path exists.

**MODA-13 Edits rewrite authorship. P3. VERIFIED.** `FleetMaster.jsx:592` (created_by on update),
`TyreRecords.jsx:316-317` (region defaults to 'KSA', uploaded_by on edit).

**MODA-14 Heat Intelligence is Gulf-only and uses a free weather API. P2. PLAUSIBLE** (licence terms not
checked; city list verified in `src/lib/heatIntelligence.js`).

**MODA-15 Fleet Utilization cannot receive data. P2. VERIFIED.** No write path to `asset_utilization` in `src`.

**MODA-16 Approval instances without an organisation. P2. VERIFIED.** 15 of 53 `workflow_instances` rows;
`workflow_act` checks the organisation only when it is set.

**MODA-17 One logo for every tenant. P1. VERIFIED.** `system_config.company_logo` is global;
`src/pages/QrLabels.jsx:193` prints it. A second company's labels would carry the current company's logo.
Fix: organisation-scoped branding. Risk: low (keep the global value as the current tenant's). Area: DB, web.

**MODA-18 Duplicates to consolidate. P3. VERIFIED.** Two RFID pages; five per-vehicle views; three tyre
history views; four vehicle movement modules.

## Module register

| Group | Module | Route | Guard and key | Internal | Commercial class | Defects | Priority |
|---|---|---|---|---|---|---|---|
| Overview | Command Center | / | none (HomeRoute: role redirect, executiveHomeAllowed else MyWorkspace); key dashboard | ready | 2 | MODA-11, MODA-3 | P2 |
| Overview | Action Center | /action-center | RoleRoute ['Admin']; key action_center | ready | 2 | MODA-A1 | P3 |
| Overview | Approvals | /approvals | FlagRoute automation_platform (nav: Admin/Manager/Director); key approvals | ready | 3 | MODA-16 | P2 |
| Overview | My Checklists | /my-checklists | none; key my_checklists | ready | 2 | MODA-10, MODA-B1 | P2 |
| Overview | Message the Team | /broadcast | RoleRoute ['Admin','Manager','Director'] moduleKey broadcast; key broadcast | ready | 2 | MODA-C1 | P3 |
| Fleet & Assets | Fleet Master | /fleet-master | ModuleRoute fleet_master; key fleet_master | ready | 3 | MODA-3, MODA-8, MODA-13 | P1 |
| Fleet & Assets | Site Management | /sites | ModuleRoute fleet_master; key fleet_master (shared) | at risk | 3 | MODA-5, MODA-8, MODA-D1 | P1 |
| Fleet & Assets | Fleet Groups | /fleet-groups | RoleRoute ['Admin']; key fleet_groups | at risk (disabled, 0 rows, never used) | 4 | MODA-9, MODA-E1 | P3 |
| Fleet & Assets | Combinations | /combinations | RoleRoute ['Admin']; key combinations | at risk (disabled, 0 rows) | 4 | MODA-9 | P3 |
| Fleet & Assets | Customers | /customers | RoleRoute ['Admin']; key customers | at risk (disabled, 0 rows) | 4 | MODA-9 | P3 |
| Fleet & Assets | Vehicle History | /vehicle-history | ModuleRoute fleet_master (menu Admin only); key fleet_master (shared) | ready | 2 | MODA-3, MODA-F1 | P3 |
| Fleet & Assets | Asset Disposal | /asset-disposals | RoleRoute ['Admin','Manager','Director'] moduleKey asset_disposals; key asset_disposals | ready | 3 | MODA-3, MODA-G1 | P2 |
| Fleet & Assets | Fleet Renewal | /fleet-renewal | RoleRoute ['Admin','Manager','Director']; key fleet_renewal | ready | 2 | MODA-H1, MODA-3 | P3 |
| Fleet & Assets | Battery Lifecycle | /batteries | RoleRoute ['Admin']; key batteries | at risk (disabled, 0 rows) | 4 | MODA-9 | P3 |
| Fleet & Assets | QR Labels | /qr-labels | RoleRoute ['Admin'] + ModuleRoute qr_labels; key qr_labels | ready | 3 | MODA-17, MODA-I1 | P1 |
| Fleet & Assets | RFID Registry | /rfid | RoleRoute ['Admin']; key rfid | at risk (1 row, effectively unused) | 4 | MODA-18 | P3 |
| Fleet & Assets | RFID Registry (old page, no menu item) | /rfid-registry | ModuleRoute tyre_records; key tyre_records (shared) | at risk | 5 | MODA-18 | P3 |
| Fleet & Assets | Engine Hours | /engine-hours | RoleRoute ['Admin']; key engine_hours | ready | 2 | MODA-J1 | P3 |
| Fleet & Assets | Odometer Logs | /odometer-logs | ModuleRoute odometer_logs; key odometer_logs | ready | 2 | none | P3 |
| Fleet & Assets | Fleet Utilization | /fleet-utilization | RoleRoute ['Admin','Manager','Director']; key fleet_utilization | ready (static snapshot of 556 rows) | 4 | MODA-15 | P2 |
| Fleet & Assets | Vehicle Check In/Out | /vehicle-checkinout | RoleRoute ['Admin']; key vehicle_checkinout | at risk (disabled, 0 rows) | 5 | MODA-9, MODA-18 | P3 |
| Fleet & Assets | Vehicle Handover | /handovers | RoleRoute ['Admin','Manager','Director','Fleet Supervisor','Fleet Incharge']; key handovers | at risk (live but 0 rows in production) | 2 | MODA-K1 | P2 |
| Fleet & Assets | Vehicle Reservations | /reservations | RoleRoute ['Admin']; key reservations | at risk (disabled, 0 rows) | 4 | MODA-9 | P3 |
| Fleet & Assets | Gate Pass | /gate-pass | ModuleRoute gate_pass; key gate_pass | at risk (2 rows in production) | 2 | MODA-L1, MODA-L2 | P3 |
| Fleet & Assets | Asset detail (no menu item) | /asset-management/:assetNo | ModuleRoute fleet_master; key fleet_master (shared) | ready | 5 | MODA-18, MODA-3 | P3 |
| Fleet & Assets | Vehicle 360 (no menu item) | /vehicle/:assetNo | FlagRoute vehicle_360; key vehicle_360 (flag) | ready | 5 | MODA-18 | P3 |
| Tyre Management | Tyre Records | /tyres | ModuleRoute tyre_records; key tyre_records | ready | 3 | MODA-6, MODA-7, MODA-3, MODA-13, MODA-1 | P1 |
| Tyre Management | Serial Tracker | /serial-tracker | RoleRoute ['Admin'] + ModuleRoute serial_tracker; key serial_tracker | ready | 3 | MODA-1, MODA-3 | P1 |
| Tyre Management | Tyre Passport | /tyre-passport (and /:serial) | ModuleRoute tyre_passport; key tyre_passport | ready | 2 | MODA-M1 | P3 |
| Tyre Management | Tyre Specifications | /tyre-specs | RoleRoute ['Admin'] (no module key on the route; gate uses the slug); key tyre_specs | ready | 3 | MODA-N1, MODA-N2 | P2 |
| Tyre Management | Tyre Exchange | /tyre-exchange | RoleRoute ['Admin']; key tyre_exchange | ready | 3 | MODA-1, MODA-O1 | P2 |
| Tyre Management | Rotation Schedule | /rotation | RoleRoute ['Admin']; key rotation | at risk (disabled, 0 rows) | 4 | MODA-9 | P3 |
| Tyre Management | Rotation Optimizer | /rotation-optimizer | RoleRoute ['Admin','Manager','Director']; key rotation_optimizer | at risk (disabled; input tread depth is empty) | 4 | MODA-9, MODA-12, MODA-P1 | P3 |
| Tyre Management | Fitment Validation | /fitment-validation | RoleRoute ['Admin','Manager','Director']; key fitment_validation | at risk (live, 0 rules and 0 validations) | 2 | MODA-12 | P3 |
| Tyre Management | Size Optimizer | /tyre-size | ModuleRoute tyre_records (menu Admin only); key tyre_records (shared) | ready | 2 | MODA-3, MODA-Q1 | P3 |
| Tyre Management | Pressure Intelligence | /pressure-intel | ModuleRoute pressure_intelligence; key pressure_intelligence | ready | 2 | MODA-R1 | P3 |
| Tyre Management | TPMS | /tpms | RoleRoute ['Admin']; key tpms | at risk (disabled, 0 rows) | 4 | MODA-9, MODA-12 | P3 |
| Tyre Management | Position Intelligence | /position-intelligence | ModuleRoute position_intelligence (menu Admin only); key position_intelligence | at risk | 3 | MODA-12 | P2 |
| Tyre Management | Tyre Time in Service | /tyre-age-compliance | RoleRoute ['Admin','Manager','Director']; key tyre_age_compliance | ready | 2 | MODA-S1 | P3 |
| Tyre Management | Heat Intelligence | /heat-intelligence | RoleRoute ['Admin','Manager','Director']; key heat_intelligence | at risk (0 temperature readings) | 3 | MODA-14, MODA-12 | P2 |
| Tyre Management | Tyre Lifecycle | /tyre-lifecycle | ModuleRoute tyre_records (menu Admin only); key tyre_records (shared) | ready | 3 | MODA-4, MODA-T1 | P1 |
| Tyre Management | Tyre Service Events | /tyre-service-events | RoleRoute ['Admin','Manager','Director']; key tyre_service_events | at risk (disabled, 0 rows) | 4 | MODA-9, MODA-18 | P3 |
| Tyre Management | Tyre Pool | /tyre-pool | none; key tyre_pool | at risk (disabled, 0 rows) | 4 | MODA-9, MODA-10 | P3 |
| Tyre Management | Scrap Management | /scrap | none; key scrap | ready | 3 | MODA-1, MODA-10, MODA-U1 | P1 |
| Tyre Management | Retread Management | /retread | RoleRoute ['Admin']; key retread | at risk (disabled, 0 rows) | 4 | MODA-9, MODA-12 | P3 |
| Tyre Management | Retread Claims | /retread-claims | RoleRoute ['Admin']; key retread_claims | at risk (disabled, 0 rows) | 4 | MODA-9, MODA-3 | P3 |
| Tyre Management | Warranty Tracker | /warranty | none; key warranty | at risk (disabled, 0 rows) | 4 | MODA-2, MODA-9, MODA-10, MODA-V1 | P2 |
| Tyre Management | Brand Performance | /brand-perf | ModuleRoute brand_performance; key brand_performance | ready | 2 | MODA-4 | P3 |
| Tyre Management | CPK Intelligence (hosts Tyre Failure and CPK as ?tab=failures on the working tree) | /cpk-intelligence | RoleRoute ['Admin','Manager','Director'] + ModuleRoute cpk_intelligence; key cpk_intelligence | ready (with stated caveats: 4895 of 11260 tyres priced) | 3 | MODA-4, MODA-3, MODA-W1, MODA-W2 | P1 |
| Tyre Management | Fleet Risk Score | /fleet-risk-score | RoleRoute ['Admin','Manager','Director']; key fleet_risk_score | at risk (disabled; main inputs empty) | 4 | MODA-9, MODA-12 | P3 |
| Tyre Management | Digital Twin | /digital-twin (and /:assetNo) | RoleRoute ['Admin','Manager','Director']; key digital_twin | ready | 5 | MODA-18 | P3 |
| Tyre Management | Tyre Scan (no menu item) | /scan | none; key none | at risk | 4 | MODA-10 | P3 |
| Overview | My Problems (no menu item) | /my-problems | none; key none | ready | 2 | MODA-X1 | P3 |

## Module detail

### Command Center (/)
- Page: src/pages/CommandCenter.jsx -> src/components/commandCenter/CommandCenter.jsx
- Services: api/commandCenter.js, lib/commandCenter.js, tyreRunningLife, actionCenter, pmPrograms, assetUtilization, governedCost, approvalsQueue
- Tables: vehicle_fleet, tyre_records, work_orders, inspections, action_items, asset_utilization, parts_consumption
- New empty company: Loads; every card shows its own honest empty text (No vehicles registered yet, No expense data, N/A). No link or guided first step. Map only plots 10 named countries (lib/commandCenter.js:222).
- Defects: MODA-11 [P2, VERIFIED] A brand-new company lands on a board of empty cards with no guided first action (add a site, add a vehicle, import); MODA-3 [P1, VERIFIED] Countries (KSA, UAE, Egypt) and their currencies are hard-coded; a company in any other country cannot register a vehicle or tyre under its own country or see its own currency
- Fix: Add a first-run panel (add site, add vehicle, import, invite) shown while the fleet is empty; derive map points and currency from an org country table. (area: web)
- Tests: commandCenter.test.js (pure engine, real logic)

### Action Center (/action-center)
- Page: src/pages/ActionCenter.jsx
- Services: api/actionCenter.js (transition_action_item RPC)
- Tables: action_items, action_item_history
- New empty company: Empty list with empty state; items arise from corrective actions, checklists and manual entry.
- Defects: MODA-A1 [P3, PLAUSIBLE] Any signed-in user of the tenant may insert action items by API; history rows depend on the writer supplying the org (trigger or RPC). Write path through the RPC was not executed.
- Fix: Keep; confirm the history writer stamps the org for a second tenant with a rolled-back test on a staging copy. (area: DB)
- Tests: actionCenter.test.js, actionCenterAnalytics.test.js, actionCenterLoadingContract.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Approvals (/approvals)
- Page: src/pages/Approvals.jsx
- Services: api/approvalsQueue.js, api/workflows.js, api/userSignature.js
- Tables: workflow_instances, checklist_submissions, inspections, user_signatures
- New empty company: Tabs show zero counts and an empty queue. Nothing to set up for inspections and checklists; workflow definitions must exist for other approval types.
- Defects: MODA-16 [P2, VERIFIED] Approval instances without an organisation are visible and actionable across tenants
- Fix: Backfill or close the 15 organisation-less workflow instances; make workflow_act and the read policy require an organisation match. (area: DB)
- Tests: approvalsDashboard.test.jsx, approvalsBulk.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### My Checklists (/my-checklists)
- Page: src/pages/MyChecklists.jsx
- Services: api/checklists.js, api/checklistSchedules.js
- Tables: checklist_templates, checklist_assignments, checklist_schedules, checklist_submissions
- New empty company: Honest "nothing assigned" state (MyChecklists.jsx:486). A new company has no templates; the 12 current templates belong to the current organisation, so the first action is building a template, which only Admin authors can do.
- Defects: MODA-10 [P2, VERIFIED] Pages are reachable by any signed-in role by URL; only the menu and RLS limit them; MODA-B1 [P2, VERIFIED] The due list has never been exercised with real schedules in production
- Fix: Ship a small starter template library per industry that a new organisation can copy. (area: web, DB)
- Tests: myChecklistsAnalytics.test.js, myChecklistsRoleFilter.test.jsx (mock-based (supabase mocked); pure engine tests exercise real logic)

### Message the Team (/broadcast)
- Page: src/pages/Broadcast.jsx
- Services: api/broadcast.js (broadcast_audience, broadcast_send RPCs)
- Tables: broadcast_messages, broadcast_recipient_receipts, broadcast_replies
- New empty company: Empty history with a compose form; works as soon as the company has more than one user. Phone delivery needs registered devices.
- Defects: MODA-C1 [P3, VERIFIED] Sample text names a site of the current company
- Fix: Replace the placeholder with neutral wording. (area: web)
- Tests: broadcast.test.js, broadcastAnalytics.test.js, broadcastAudience.test.js, broadcastPage.render.test.jsx (mock-based (supabase mocked); pure engine tests exercise real logic)

### Fleet Master (/fleet-master)
- Page: src/pages/FleetMaster.jsx (hosts AssetManagement as ?tab=analysis on the working tree; on main /asset-management is its own page)
- Services: api/assets.js, api/billing.js (org_can_add), api/fleetMasterData.js
- Tables: vehicle_fleet, sites
- New empty company: Empty table with an Add button; plan limit is checked before insert. Only an Admin (or a user with an explicit grant) can save, so the first user of a new company must be an Admin. Country list offers only KSA, UAE, Egypt.
- Defects: MODA-3 [P1, VERIFIED] Countries (KSA, UAE, Egypt) and their currencies are hard-coded; a company in any other country cannot register a vehicle or tyre under its own country or see its own currency; MODA-8 [P2, VERIFIED] Buttons are offered to roles the database refuses; the user fills a form and is then told they have no permission; MODA-13 [P3, VERIFIED] Editing a record rewrites who created it, and a tyre saved by a user without a region is stamped KSA
- Fix: Country list from an org table; align canEdit/canDelete with app_user_can results; stop sending created_by on update. (area: web, DB)
- Tests: fleetMasterFilters.test.jsx, fleetMasterSearch.api.test.js, assetManagement.api.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Site Management (/sites)
- Page: src/pages/SiteManagement.jsx
- Services: api/sites.js, api/siteOperations.js
- Tables: sites, vehicle_fleet
- New empty company: Empty directory with Add site; a new site can be created by Admin or Manager. Editing it afterwards fails.
- Defects: MODA-5 [P1, VERIFIED] Editing an existing registered site sends a column that does not exist, so the whole update is rejected; only creating a new site works; MODA-8 [P2, VERIFIED] Buttons are offered to roles the database refuses; the user fills a form and is then told they have no permission; MODA-D1 [P3, VERIFIED] The site uniqueness rule falls back to the current company's organisation id
- Fix: Remove updated_by from the update payload (or add the column); add a service test that runs against the real column list; drop the COALESCE once organisation_id is NOT NULL. (area: web, DB)
- Tests: siteManagementAnalytics.test.js only (pure). No test covers upsertSite, which is why the unknown column was not caught.

### Fleet Groups (/fleet-groups)
- Page: src/pages/FleetGroups.jsx
- Services: api/fleetGroups.js, api/fleetGroupSignals.js
- Tables: fleet_groups
- New empty company: Empty state with create form; payload matches the table and its CHECK (group_type).
- Defects: MODA-9 [P2, VERIFIED] Module on/off, the role matrix and system_config (logo, palette, nav layout) are global to all tenants, and every company Admin can still open modules that were switched off as unfinished; MODA-E1 [P3, VERIFIED] A group does not actually own vehicles; the count is a typed number
- Fix: See restore list. Do not market until membership is real. (area: web)
- Tests: fleetGroups.test.js, fleetGroupsAnalytics.test.js, fleetGroupsView.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Combinations (/combinations)
- Page: src/pages/Combinations.jsx
- Services: api/combinations.js
- Tables: asset_combinations, vehicle_fleet, tyre_records
- New empty company: Empty state; create payload matches columns and CHECKs.
- Defects: MODA-9 [P2, VERIFIED] Module on/off, the role matrix and system_config (logo, palette, nav layout) are global to all tenants, and every company Admin can still open modules that were switched off as unfinished
- Fix: See restore list. (area: web)
- Tests: combinations.test.js, combinationsAnalytics.test.js, combinationManagerView.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Customers (/customers)
- Page: src/pages/Customers.jsx
- Services: api/customers.js, api/customerPortal.js, api/contracts.js
- Tables: customers, customer_accounts, contracts
- New empty company: Empty state; accounts and contracts are linked by exact name only (project memory).
- Defects: MODA-9 [P2, VERIFIED] Module on/off, the role matrix and system_config (logo, palette, nav layout) are global to all tenants, and every company Admin can still open modules that were switched off as unfinished
- Fix: See restore list. The word Customers will confuse a SaaS buyer (these are the tenant's own customers). (area: web)
- Tests: customers.test.js, customersAnalytics.test.js, customersView.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Vehicle History (/vehicle-history)
- Page: src/pages/VehicleHistory.jsx
- Services: api/vehicleHistory.js, api/vehicleHistoryExtra.js, api/assetHistory.js, api/costSummary.js, api/governedCost.js
- Tables: work_orders, tyre_records, parts_consumption, vehicle_fleet, odometer_logs, inspections, accidents
- New empty company: Asset picker is empty until vehicles exist; timeline fills from job cards, tyres and expenses, which a new company only has after imports.
- Defects: MODA-3 [P1, VERIFIED] Countries (KSA, UAE, Egypt) and their currencies are hard-coded; a company in any other country cannot register a vehicle or tyre under its own country or see its own currency; MODA-F1 [P2, VERIFIED] Menu and route disagree: non-admins with Fleet Master access can open it by URL
- Fix: Decide one access rule; give the page its own module key. (area: web)
- Tests: vehicleHistory.api.test.js, vehicleHistoryAnalytics.test.js, vehicleHistoryRework.test.js, vehicleHistoryView.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Asset Disposal (/asset-disposals)
- Page: src/pages/AssetDisposals.jsx
- Services: api/assetDisposals.js (3 RPCs, upsert on org,country,asset), api/assetBreakdowns.js
- Tables: asset_disposals, asset_breakdowns, asset_replacement_costs
- New empty company: Empty register with add and import. Import mapper is written for the current company's committee workbook.
- Defects: MODA-3 [P1, VERIFIED] Countries (KSA, UAE, Egypt) and their currencies are hard-coded; a company in any other country cannot register a vehicle or tyre under its own country or see its own currency; MODA-G1 [P2, VERIFIED] Currency falls back to SAR and the import expects the current company's sheet layout
- Fix: Generic import template; currency from org settings. (area: web)
- Tests: assetDisposal*.test.js(x), assetDisposals.api.test.js, assetDisposalsPage.render.test.jsx, assetDisposalWorkflow.test.jsx (mock-based (supabase mocked); pure engine tests exercise real logic)

### Fleet Renewal (/fleet-renewal)
- Page: src/pages/FleetRenewal.jsx
- Services: api/fleetRenewal.js, api/fleetRenewalSignals.js (get_fleet_renewal_signals)
- Tables: fleet_renewal_plans, vehicle_fleet, asset_utilization, asset_breakdowns
- New empty company: Works from the fleet register alone. Score uses an ASSUMED planning life (default 10 years, labelled as an assumption) because useful life is not recorded; model year is present on 600 of 1622 current vehicles, purchase value on 0.
- Defects: MODA-H1 [P2, VERIFIED] Renewal ranking is an estimate from an assumed life and partial model years; it is labelled, but budget figures stay empty; MODA-3 [P1, VERIFIED] Countries (KSA, UAE, Egypt) and their currencies are hard-coded; a company in any other country cannot register a vehicle or tyre under its own country or see its own currency
- Fix: Keep the label; add model year and purchase value to the vehicle form and import template. (area: web)
- Tests: fleetRenewal.test.js, fleetRenewalRegister.test.js, fleetRenewalScore.test.js, fleetRenewalView.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Battery Lifecycle (/batteries)
- Page: src/pages/Batteries.jsx
- Services: api/batteries.js
- Tables: batteries
- New empty company: Empty state with add form; payload matches table. Life is an assumed 36 months (project memory), no type or charge fields.
- Defects: MODA-9 [P2, VERIFIED] Module on/off, the role matrix and system_config (logo, palette, nav layout) are global to all tenants, and every company Admin can still open modules that were switched off as unfinished
- Fix: See restore list. (area: web)
- Tests: batteries.test.js, batteriesAnalytics.test.js, batteryLifecycleView.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### QR Labels (/qr-labels)
- Page: src/pages/QrLabels.jsx (queries tyre_records and vehicle_fleet directly)
- Services: api/brandLogo.js, direct supabase in page
- Tables: vehicle_fleet, tyre_records, qr_print_jobs, system_config
- New empty company: Nothing to print until vehicles or tyres exist; then works without setup. The header logo is the single global logo.
- Defects: MODA-17 [P1, VERIFIED] Every tenant's QR labels (and any other document that reads company_logo) carry the one global logo, i.e. the current company's logo; MODA-I1 [P3, VERIFIED] Print history has not been used in production
- Fix: Move company_logo (and palette, nav layout) to an org-scoped settings row; fall back to the Tyre Pulse wordmark. (area: DB, web)
- Tests: qrLabelLayout.test.js, qrBulkMatch.test.js, qrBulkPageWiring.test.js, qrLabelsAnalytics.test.js, qrLabelsView.test.js, qrPrintJobs.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### RFID Registry (/rfid)
- Page: src/pages/Rfid.jsx
- Services: api/rfid.js
- Tables: rfid_tags, rfid_tag_events
- New empty company: Empty state with add tag; unique per organisation (uq_rfid_tags_org_tag). Needs handheld reader hardware used as a keyboard; no reader integration.
- Defects: MODA-18 [P3, VERIFIED] Several pages answer the same question for the same record; they need one owner each before being sold
- Fix: Keep off the price list until a customer has readers; retire /rfid-registry. (area: web)
- Tests: rfid.test.js, rfidAnalytics.test.js, rfidTagEvents.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### RFID Registry (old page, no menu item) (/rfid-registry)
- Page: src/pages/RfidRegistry.jsx
- Services: direct supabase in page
- Tables: rfid_tags, rfid_readers, rfid_read_events, rfid_alerts
- New empty company: Second page over the same tags table, reachable only by URL, guarded by the tyre records key.
- Defects: MODA-18 [P3, VERIFIED] Several pages answer the same question for the same record; they need one owner each before being sold
- Fix: Redirect to /rfid. (area: web)
- Tests: rfidRegistryAnalytics.test.js, rfidRegistryView.test.js, rfidRegistryPage.render.test.jsx (mock-based (supabase mocked); pure engine tests exercise real logic)

### Engine Hours (/engine-hours)
- Page: src/pages/EngineHours.jsx
- Services: api/engineHours.js, api/assets.js, api/assetUtilization.js, api/pmPrograms.js
- Tables: engine_hours_logs, vehicle_fleet
- New empty company: Empty log with add form; insert open to any signed-in user of the tenant (policy), page is Admin only. Readings normally arrive from the phone app.
- Defects: MODA-J1 [P3, VERIFIED] Two entry points for hour readings
- Fix: Fold into Odometer Logs as one Meter Readings page. (area: web)
- Tests: engineHours.test.js, engineHoursView.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Odometer Logs (/odometer-logs)
- Page: src/pages/OdometerLogs.jsx
- Services: api/vehicleMeters.js (save_vehicle_meter_readings, correct_vehicle_meter_reading, vehicle_meter_permissions)
- Tables: odometer_logs, engine_hours_logs, vehicle_fleet
- New empty company: Lists the fleet with no readings; first action is to add vehicles, then log a reading. Server RPC handles validation and stale-save conflicts.
- Defects: none found
- Fix: None blocking. (area: web)
- Tests: odometerLogs.test.js (run, pass), odometerLogsAnalytics.test.js, odometerLogsView.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Fleet Utilization (/fleet-utilization)
- Page: src/pages/FleetUtilization.jsx
- Services: api/assetUtilization.js (read only)
- Tables: asset_utilization
- New empty company: Permanently empty: there is no screen, import or integration that writes utilisation.
- Defects: MODA-15 [P2, VERIFIED] Fleet Utilization has no way to receive data in the product; current rows were loaded by hand from telematics exports
- Fix: Either build a telematics import or keep it internal. (area: web, DB)
- Tests: fleetUtilization.test.js, fleetUtilizationAnalytics.test.js, fleetUtilizationTable.test.js, fleetUtilizationView.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Vehicle Check In/Out (/vehicle-checkinout)
- Page: src/pages/VehicleCheckInOut.jsx
- Services: api/vehicleCheckInOut.js
- Tables: vehicle_checkinout
- New empty company: Empty state with form; overlaps Handover and Gate Pass.
- Defects: MODA-9 [P2, VERIFIED] Module on/off, the role matrix and system_config (logo, palette, nav layout) are global to all tenants, and every company Admin can still open modules that were switched off as unfinished; MODA-18 [P3, VERIFIED] Several pages answer the same question for the same record; they need one owner each before being sold
- Fix: See restore list; merge into Handover. (area: web)
- Tests: vehicleCheckInOut.test.js, vehicleCheckInOutAnalytics.test.js, vehicleCheckInOutView.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Vehicle Handover (/handovers)
- Page: src/pages/VehicleHandover.jsx
- Services: api/handoverReports.js (decide_handover_approval), api/assets.js, api/engineHours.js
- Tables: handover_reports
- New empty company: Empty register with a five-step form; has a Flutter counterpart (features/handover). Two custom roles named in the guard must exist in the new company.
- Defects: MODA-K1 [P2, VERIFIED] The full flow including two-stage sign-off has no production record yet
- Fix: Run one real handover end to end on web and phone before selling. (area: web, Flutter)
- Tests: handoverApproval.test.js, handoverGating.test.js, handoverReports.test.js, handoverSignoffService.test.js, handoverPanel.render.test.jsx, vehicleHandover*.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Vehicle Reservations (/reservations)
- Page: src/pages/VehicleReservations.jsx
- Services: api/vehicleReservations.js
- Tables: vehicle_reservations, vehicle_reservation_events
- New empty company: Empty calendar with create form.
- Defects: MODA-9 [P2, VERIFIED] Module on/off, the role matrix and system_config (logo, palette, nav layout) are global to all tenants, and every company Admin can still open modules that were switched off as unfinished
- Fix: See restore list. (area: web)
- Tests: vehicleReservations.test.js, vehicleReservations.page.test.jsx, vehicleReservationsAnalytics.test.js, vehicleReservationsView.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Gate Pass (/gate-pass)
- Page: src/pages/GatePass.jsx
- Services: api/gatePassPage.js
- Tables: gate_passes, inspections, vehicle_fleet
- New empty company: Empty day view; clearance looks for an inspection of the asset, so it depends on inspections being done. Direction, driver and times are kept in custom_data.
- Defects: MODA-L1 [P3, VERIFIED] Update result is not verified; minor; MODA-L2 [P2, VERIFIED] Barely used in production
- Fix: Pilot internally before selling. (area: web)
- Tests: gatePassPage.api.test.js (run, pass), gatePassAnalytics.test.js, gatePassView.test.js, gatePassWorkflow.test.jsx, gatepassAdapter.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Asset detail (no menu item) (/asset-management/:assetNo)
- Page: src/pages/AssetDetail.jsx (queries vehicle_fleet and work_orders directly)
- Services: api/assetManagement.js, api/assetMaster.js, api/assetOwnership.js, api/costSummary.js, api/pmPrograms.js
- Tables: vehicle_fleet, work_orders, tyre_records
- New empty company: Opens only from a vehicle row.
- Defects: MODA-18 [P3, VERIFIED] Several pages answer the same question for the same record; they need one owner each before being sold; MODA-3 [P1, VERIFIED] Countries (KSA, UAE, Egypt) and their currencies are hard-coded; a company in any other country cannot register a vehicle or tyre under its own country or see its own currency
- Fix: Pick one vehicle page (this, Vehicle 360 or Digital Twin). (area: web)
- Tests: assetDetailAnalytics.test.js, assetDetailHistoryTab.test.jsx (mock-based (supabase mocked); pure engine tests exercise real logic)

### Vehicle 360 (no menu item) (/vehicle/:assetNo)
- Page: src/pages/Vehicle360.jsx
- Services: api/assetHistory.js, api/vehicleInsurance.js, api/vehicleMeters.js
- Tables: vehicle_fleet, tyre_records, work_orders, insurance_policy_assets
- New empty company: Opens only from links.
- Defects: MODA-18 [P3, VERIFIED] Several pages answer the same question for the same record; they need one owner each before being sold
- Fix: As above. (area: web)
- Tests: vehicle360Analytics*.test.js, vehicle360Page.render.test.jsx, vehicle360TyreMetrics.test.js, vehicle360View.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Tyre Records (/tyres)
- Page: src/pages/TyreRecords.jsx
- Services: api/tyreRecords.js, api/tyreExchange.js, api/tyrePassport.js, api/tyreRunningLife.js
- Tables: tyre_records, tyre_status_marks
- New empty company: Empty grid with Add. The form cannot capture size or wheel position, so a new company can only build a useful tyre register by import or from the phone app.
- Defects: MODA-6 [P1, VERIFIED] The web Add Tyre form has no size, wheel position, vehicle type, status or removal date, so a manually entered tyre cannot feed running life, the tyre map, rotation or fitment; MODA-7 [P2, VERIFIED] A role that RLS does not allow to update tyre_records gets a silent zero-row update that the page reports as saved; MODA-3 [P1, VERIFIED] Countries (KSA, UAE, Egypt) and their currencies are hard-coded; a company in any other country cannot register a vehicle or tyre under its own country or see its own currency; MODA-13 [P3, VERIFIED] Editing a record rewrites who created it, and a tyre saved by a user without a region is stamped KSA; MODA-1 [P1, VERIFIED] Scrap / returned / written-off marks collide across tenants: a second company scrapping a serial another company already marked overwrites that company's reason, actor and date and gets no mark of its own
- Fix: Add size, position, vehicle type, status and removal fields to the form; return affected rows from update and show a refusal; gate buttons on app_user_can. (area: web)
- Tests: tyreRecords.api.test.js (run, pass), tyreRecordsView.test.js, tyreRecordsView.lifetime.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Serial Tracker (/serial-tracker)
- Page: src/pages/SerialTracker.jsx
- Services: api/serialTracker.js, api/tyreExchange.js, api/tyreRecords.js, api/assetMaster.js
- Tables: tyre_records, tyre_status_marks
- New empty company: Search returns nothing until tyres exist. Scrap marking is where tenants collide.
- Defects: MODA-1 [P1, VERIFIED] Scrap / returned / written-off marks collide across tenants: a second company scrapping a serial another company already marked overwrites that company's reason, actor and date and gets no mark of its own; MODA-3 [P1, VERIFIED] Countries (KSA, UAE, Egypt) and their currencies are hard-coded; a company in any other country cannot register a vehicle or tyre under its own country or see its own currency
- Fix: Fix the mark key; currency from org. (area: DB, web)
- Tests: serialTrackerAnalytics.test.js, serialTrackerAnalytics.lifetime.test.js, serialTrackerView.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Tyre Passport (/tyre-passport (and /:serial))
- Page: src/pages/TyrePassport.jsx
- Services: api/tyrePassport.js, api/tyrePassportInspections.js, api/serialTracker.js, api/assets.js
- Tables: tyre_records, inspections, tyre_service_events, warranty_claims, tyre_status_marks, retread_claims
- New empty company: Search with honest empty and N/A states; needs tyre history.
- Defects: MODA-M1 [P3, VERIFIED] Wear curve is empty for the current company
- Fix: None blocking. (area: web)
- Tests: tyrePassport.test.js, tyrePassport.lifetime.test.js, tyrePassportView.test.js, tyrePassportViewShapers.test.js, tyreScrapPassport.render.test.jsx (mock-based (supabase mocked); pure engine tests exercise real logic)

### Tyre Specifications (/tyre-specs)
- Page: src/pages/TyreSpecifications.jsx
- Services: api/tyreSpecs.js, api/tyreSpecCatalog.js, api/tyreProcurement.js, api/engineeringKpi.js
- Tables: tyre_specifications, tyre_spec_catalog, tyre_spec_catalog_events, tyre_procurement_options
- New empty company: Empty catalogue and rules with add forms. Built-in defaults (vehicle types, brand list led by specific brands, a ready-made fitment policy PDF) are the current company's choices.
- Defects: MODA-N1 [P2, VERIFIED] Starter content is one company's policy and brand ranking, presented as product defaults; MODA-N2 [P3, VERIFIED] Page itself is untested
- Fix: Make defaults a neutral template the tenant edits; remove brand ranking metadata that is opinion. (area: web)
- Tests: tyreSpecCatalog.api.test.js, tyreSpecs.api.test.js, tyreSpecCoverage.test.js, tyreSpecView.test.js (mock-based (supabase mocked); pure engine tests exercise real logic); no page test

### Tyre Exchange (/tyre-exchange)
- Page: src/pages/TyreExchange.jsx
- Services: api/tyreExchange.js, api/tyreServiceEvents.js
- Tables: tyre_records, tyre_service_events, tyre_status_marks
- New empty company: Register is built from tyre history, so it is empty until tyres exist. Saving an exchange writes one service event and does not move the tyre record (stated in project memory).
- Defects: MODA-1 [P1, VERIFIED] Scrap / returned / written-off marks collide across tenants: a second company scrapping a serial another company already marked overwrites that company's reason, actor and date and gets no mark of its own; MODA-O1 [P2, PLAUSIBLE] Recording an exchange does not update the fitted tyre, and the save path has no production rows
- Fix: Route exchanges through the tyre_move / replacement RPC so the register changes. (area: web, DB)
- Tests: tyreExchange.api.test.js (run, pass), tyreExchangeAnalytics.test.js, tyreExchangeView.test.js, tyreExchangeWorkflow.test.jsx (mock-based (supabase mocked); pure engine tests exercise real logic)

### Rotation Schedule (/rotation)
- Page: src/pages/RotationSchedule.jsx
- Services: api/rotations.js, api/assets.js, api/workshopLive.js
- Tables: tyre_rotations
- New empty company: Empty schedule with create form; CHECK on rotation_type matches the page vocabulary per project memory.
- Defects: MODA-9 [P2, VERIFIED] Module on/off, the role matrix and system_config (logo, palette, nav layout) are global to all tenants, and every company Admin can still open modules that were switched off as unfinished
- Fix: See restore list. (area: web)
- Tests: rotations.api.test.js, rotationScheduleAnalytics.test.js, rotationScheduleView.test.js, rotationWorkflow.test.jsx (mock-based (supabase mocked); pure engine tests exercise real logic)

### Rotation Optimizer (/rotation-optimizer)
- Page: src/pages/RotationOptimizer.jsx
- Services: api/rotationOptimizer.js
- Tables: tyre_records
- New empty company: No recommendations: it needs tread depth per wheel, which nothing in the product records today. Benefit figure uses a fixed 10,000 km per mm (lib/rotationOptimizer.js:31).
- Defects: MODA-9 [P2, VERIFIED] Module on/off, the role matrix and system_config (logo, palette, nav layout) are global to all tenants, and every company Admin can still open modules that were switched off as unfinished; MODA-12 [P2, VERIFIED] Several analytics are built on columns that are empty in production, so they have never been proven on real data; MODA-P1 [P2, VERIFIED] Benefit is an assumed constant shown as kilometres recovered; legal minimum is one region's
- Fix: See restore list; do not market. (area: web)
- Tests: rotationOptimizer.test.js, rotationOptimizerPage.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Fitment Validation (/fitment-validation)
- Page: src/pages/FitmentValidation.jsx
- Services: api/fitmentValidation.js
- Tables: fitment_rules, fitment_validations, tyre_specifications, tyre_spec_catalog
- New empty company: Empty rules and history; the tenant must write its rules first. Age, retread and pair checks are reported as not evaluated when data is missing.
- Defects: MODA-12 [P2, VERIFIED] Several analytics are built on columns that are empty in production, so they have never been proven on real data
- Fix: Pilot with real rules before selling. (area: web)
- Tests: fitmentValidation.test.js, fitmentValidation.engine.test.js, fitmentValidationAnalytics.test.js, fitmentValidationView.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Size Optimizer (/tyre-size)
- Page: src/pages/TyreSizeAnalysis.jsx (queries tyre_records directly)
- Services: api/sizeOptimizer.js, api/governedCost.js
- Tables: tyre_records
- New empty company: Empty until tyres with price and distance exist; recommendations are session only.
- Defects: MODA-3 [P1, VERIFIED] Countries (KSA, UAE, Egypt) and their currencies are hard-coded; a company in any other country cannot register a vehicle or tyre under its own country or see its own currency; MODA-Q1 [P3, VERIFIED] Page untested
- Fix: None blocking. (area: web)
- Tests: sizeOptimizerView.test.js (pure)

### Pressure Intelligence (/pressure-intel)
- Page: src/pages/PressureIntelligence.jsx
- Services: api/pressureIntelligence.js
- Tables: inspections (tyre_conditions), tpms_readings
- New empty company: Empty until inspections with pressure readings exist; compares against each vehicle's own median because no target pressure is stored.
- Defects: MODA-R1 [P3, VERIFIED] Compliance bands are not a customer setting
- Fix: Expose the bands as a setting. (area: web)
- Tests: pressureIntelligenceAnalytics.test.js, pressureIntelligenceView.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### TPMS (/tpms)
- Page: src/pages/Tpms.jsx
- Services: api/tpms.js
- Tables: tpms_readings, tyre_records
- New empty company: No sensor integration; page falls back to tyre_records.pressure_reading, which is also empty.
- Defects: MODA-9 [P2, VERIFIED] Module on/off, the role matrix and system_config (logo, palette, nav layout) are global to all tenants, and every company Admin can still open modules that were switched off as unfinished; MODA-12 [P2, VERIFIED] Several analytics are built on columns that are empty in production, so they have never been proven on real data
- Fix: See restore list; do not market as live TPMS. (area: web, DB)
- Tests: tpms.test.js, tpmsPageAnalytics.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Position Intelligence (/position-intelligence)
- Page: src/pages/PositionIntelligence.jsx (queries tyre_records directly)
- Services: none
- Tables: tyre_records
- New empty company: Empty until tyres with positions exist. Risk based views rest on risk_level, which is empty in production.
- Defects: MODA-12 [P2, VERIFIED] Several analytics are built on columns that are empty in production, so they have never been proven on real data
- Fix: Define where risk level comes from (inspection result) or remove the risk views. (area: web)
- Tests: positionIntelligenceAnalytics.test.js (pure)

### Tyre Time in Service (/tyre-age-compliance)
- Page: src/pages/TyreAgeCompliance.jsx
- Services: api/tyreAgeCompliance.js
- Tables: tyre_records
- New empty company: Empty until tyres have fitment or issue dates. Age is time since fitment, not manufacture date (no DOT field); the working tree renames the page accordingly, main still says Tyre Age Compliance.
- Defects: MODA-S1 [P2, VERIFIED] On main the page is titled as age compliance while measuring time in service
- Fix: Merge the rename; add a manufacture date field if real age compliance is to be sold. (area: web)
- Tests: tyreAge.test.js, tyreAgeComplianceAnalytics.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Heat Intelligence (/heat-intelligence)
- Page: src/pages/HeatIntelligence.jsx
- Services: api/heatIntelligence.js, api/weather.js (Open-Meteo)
- Tables: tyre_temperature_readings, tyre_records
- New empty company: Shows climate and weather for a fixed list of Gulf cities; fleet risk section is empty without tyres. Useless outside the Gulf.
- Defects: MODA-14 [P2, PLAUSIBLE] Heat Intelligence only knows Gulf cities and uses a free weather API whose terms for commercial use were not checked; MODA-12 [P2, VERIFIED] Several analytics are built on columns that are empty in production, so they have never been proven on real data
- Fix: City list from the tenant's sites with coordinates; confirm the weather provider licence. (area: web, owner action)
- Tests: heatIntelligence.test.js, heatBlowout.test.js, heatWeather.test.js, heatAirQuality.test.js, heatIntelligenceAnalytics.test.js (pure)

### Tyre Lifecycle (/tyre-lifecycle)
- Page: src/pages/TyreLifecycle.jsx (queries tyre_records directly)
- Services: api/tyreRunningLife.js (get_tyre_running_life, SECURITY INVOKER)
- Tables: tyre_records, tyre_life_targets, vehicle_fleet, engine_hours_logs
- New empty company: Empty until fitted tyres and meter readings exist; expected life needs targets per size or type (8 to 12 rows exist for the current company only).
- Defects: MODA-4 [P1, VERIFIED] Tyre life ceilings are the current company's own rule and are hard-coded; any tyre life above 100,000 km is treated as invalid and dropped, which would blank life and CPK for a long-haul fleet; MODA-T1 [P2, VERIFIED] A new company sees Unknown for most tyres until it sets targets or builds history
- Fix: Org level life ceiling and targets with a setup step. (area: DB, web)
- Tests: tyreLifecycleAnalytics*.test.js, tyreLifecycleEvents*.test.js, tyreLifecycleHardening.test.js, tyreLifecycleView.test.js, tyreRunningLife*.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Tyre Service Events (/tyre-service-events)
- Page: src/pages/TyreServiceEvents.jsx
- Services: api/tyreServiceEvents.js
- Tables: tyre_service_events
- New empty company: Empty log with add form; CHECK on event_type respected by the service per tests.
- Defects: MODA-9 [P2, VERIFIED] Module on/off, the role matrix and system_config (logo, palette, nav layout) are global to all tenants, and every company Admin can still open modules that were switched off as unfinished; MODA-18 [P3, VERIFIED] Several pages answer the same question for the same record; they need one owner each before being sold
- Fix: See restore list. (area: web)
- Tests: tyreServiceEvents.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Tyre Pool (/tyre-pool)
- Page: src/pages/TyrePool.jsx
- Services: api/tyrePool.js
- Tables: tyre_pool, tyre_records
- New empty company: Empty pool; insert is Admin/Manager/Director by policy while the route is open to all roles.
- Defects: MODA-9 [P2, VERIFIED] Module on/off, the role matrix and system_config (logo, palette, nav layout) are global to all tenants, and every company Admin can still open modules that were switched off as unfinished; MODA-10 [P2, VERIFIED] Pages are reachable by any signed-in role by URL; only the menu and RLS limit them
- Fix: See restore list; add a guard. (area: web)
- Tests: tyrePool.test.js, tyrePoolAnalytics.test.js, tyrePoolManager.test.js, tollTripTyrePoolPages.render.test.jsx (mock-based (supabase mocked); pure engine tests exercise real logic)

### Scrap Management (/scrap)
- Page: src/pages/TyreScrapManagement.jsx
- Services: api/tyreScrap.js, api/tyreExchange.js (scrap RPCs)
- Tables: tyre_status_marks, tyre_records, tyre_disposals, audit_log_v2
- New empty company: Empty register with Mark a tyre as scrap; works once tyres exist. Disposal log has 0 production rows.
- Defects: MODA-1 [P1, VERIFIED] Scrap / returned / written-off marks collide across tenants: a second company scrapping a serial another company already marked overwrites that company's reason, actor and date and gets no mark of its own; MODA-10 [P2, VERIFIED] Pages are reachable by any signed-in role by URL; only the menu and RLS limit them; MODA-U1 [P2, VERIFIED] Scrap register and disposal log are two unconnected halves
- Fix: Fix the mark key before a second tenant; add a route guard. (area: DB, web)
- Tests: tyreScrap.api.test.js (run, pass), scrapRegister.test.js (run, pass), tyreScrapManagementAnalytics*.test.js, tyreScrapView.test.js, tyreScrapWorkflow.test.jsx (mock-based (supabase mocked); pure engine tests exercise real logic)

### Retread Management (/retread)
- Page: src/pages/RetreadManagement.jsx (queries tyre_records directly)
- Services: api/retreadJobs.js
- Tables: retread_jobs, tyre_records
- New empty company: Empty; eligibility uses risk level and tread depth, both empty.
- Defects: MODA-9 [P2, VERIFIED] Module on/off, the role matrix and system_config (logo, palette, nav layout) are global to all tenants, and every company Admin can still open modules that were switched off as unfinished; MODA-12 [P2, VERIFIED] Several analytics are built on columns that are empty in production, so they have never been proven on real data
- Fix: See restore list. (area: web)
- Tests: retreadManagement.render.test.jsx, retreadManagementAnalytics*.test.js, retreadView.test.js, retreadWorkflow.test.jsx (mock-based (supabase mocked); pure engine tests exercise real logic)

### Retread Claims (/retread-claims)
- Page: src/pages/RetreadClaims.jsx
- Services: api/retreadClaims.js
- Tables: retread_claims
- New empty company: Empty with add form; currency falls back to SAR (RetreadClaims.jsx:200).
- Defects: MODA-9 [P2, VERIFIED] Module on/off, the role matrix and system_config (logo, palette, nav layout) are global to all tenants, and every company Admin can still open modules that were switched off as unfinished; MODA-3 [P1, VERIFIED] Countries (KSA, UAE, Egypt) and their currencies are hard-coded; a company in any other country cannot register a vehicle or tyre under its own country or see its own currency
- Fix: See restore list. (area: web)
- Tests: retreadClaims.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Warranty Tracker (/warranty)
- Page: src/pages/WarrantyTracker.jsx
- Services: api/warranty.js
- Tables: warranty_claims, warranty_claim_events, tyre_records
- New empty company: Empty with candidate list from removed tyres. First claim of a second tenant can fail on the global claim number.
- Defects: MODA-2 [P1, VERIFIED] Warranty claim numbers WAR-YYYY-00001 are unique per country across ALL tenants, so the first claim of a second company in the same country fails with a duplicate error; MODA-9 [P2, VERIFIED] Module on/off, the role matrix and system_config (logo, palette, nav layout) are global to all tenants, and every company Admin can still open modules that were switched off as unfinished; MODA-10 [P2, VERIFIED] Pages are reachable by any signed-in role by URL; only the menu and RLS limit them; MODA-V1 [P2, VERIFIED] An unclaimed-recovery figure is produced from fixed assumed percentages
- Fix: See restore list; fix the key and label or remove the assumed figure. (area: DB, web)
- Tests: warranty.api.test.js (run, pass), warrantyAdapter.test.js, warrantyTrackerAnalytics.test.js, warrantyWorkflow.test.jsx (mock-based (supabase mocked); pure engine tests exercise real logic)

### Brand Performance (/brand-perf)
- Page: src/pages/BrandPerformance.jsx (queries tyre_records directly)
- Services: api/brandSizeCpk.js, api/governedCost.js, api/warranty.js
- Tables: tyre_records, parts_consumption, warranty_claims
- New empty company: Empty until tyres with brand, price and distance exist.
- Defects: MODA-4 [P1, VERIFIED] Tyre life ceilings are the current company's own rule and are hard-coded; any tyre life above 100,000 km is treated as invalid and dropped, which would blank life and CPK for a long-haul fleet
- Fix: None blocking beyond the life ceiling. (area: web)
- Tests: brandPerformance.render.test.jsx, brandPerformanceAnalytics*.test.js, brandPerformanceView.test.js, brandSizeCpk.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### CPK Intelligence (hosts Tyre Failure and CPK as ?tab=failures on the working tree) (/cpk-intelligence)
- Page: src/pages/CpkIntelligence.jsx
- Services: api/fleetCpk.js, api/cpkDrivers.js, api/brandSizeCpk.js, api/tyrePriceBackfill.js, api/sites.js
- Tables: tyre_records, parts_consumption, engine_hours_logs, vehicle_fleet
- New empty company: N/A everywhere until tyres have prices and distance. Cost comes from the expense grid, which a new company can only fill through an import built around the current ERP export.
- Defects: MODA-4 [P1, VERIFIED] Tyre life ceilings are the current company's own rule and are hard-coded; any tyre life above 100,000 km is treated as invalid and dropped, which would blank life and CPK for a long-haul fleet; MODA-3 [P1, VERIFIED] Countries (KSA, UAE, Egypt) and their currencies are hard-coded; a company in any other country cannot register a vehicle or tyre under its own country or see its own currency; MODA-W1 [P2, VERIFIED] One CPK tab is tied to the current company's master upload; MODA-W2 [P2, VERIFIED] Unit per vehicle type is a hard-coded name match
- Fix: Org level settings for unit by vehicle type and life ceiling; hide the KSA master tab for other tenants. (area: DB, web)
- Tests: cpkIntelligence.render.test.jsx, cpkPanels.render.test.jsx, cpkModule.test.js, cpkDrivers.test.js, fleetCpk.api.test.js, cpkSiteFilter.api.test.js, cpkSourceScan.test.js and others (mock-based (supabase mocked); pure engine tests exercise real logic)

### Fleet Risk Score (/fleet-risk-score)
- Page: src/pages/FleetRiskScore.jsx
- Services: api/fleetRisk.js
- Tables: tyre_records, inspections
- New empty company: Score has little to work on: tread, pressure and risk level are empty.
- Defects: MODA-9 [P2, VERIFIED] Module on/off, the role matrix and system_config (logo, palette, nav layout) are global to all tenants, and every company Admin can still open modules that were switched off as unfinished; MODA-12 [P2, VERIFIED] Several analytics are built on columns that are empty in production, so they have never been proven on real data
- Fix: See restore list; do not market. (area: web)
- Tests: fleetRisk.test.js, fleetRisk.lifetime.test.js, fleetRiskScoreAnalytics.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Digital Twin (/digital-twin (and /:assetNo))
- Page: src/pages/DigitalTwin.jsx
- Services: api/digitalTwin.js, api/tyreRunningLife.js
- Tables: tyre_records, vehicle_fleet
- New empty company: Asset picker empty until vehicles exist; it is another per vehicle tyre view.
- Defects: MODA-18 [P3, VERIFIED] Several pages answer the same question for the same record; they need one owner each before being sold
- Fix: Fold into the single vehicle page. (area: web)
- Tests: digitalTwin.test.js, digitalTwin.lifetime.test.js, digitalTwinAnalytics.test.js (mock-based (supabase mocked); pure engine tests exercise real logic)

### Tyre Scan (no menu item) (/scan)
- Page: src/pages/TyreScan.jsx
- Services: none
- Tables: none (history kept in browser storage)
- New empty company: Scan history lives only in the browser (TyreScan.jsx:13).
- Defects: MODA-10 [P2, VERIFIED] Pages are reachable by any signed-in role by URL; only the menu and RLS limit them
- Fix: Remove or finish. (area: web)
- Tests: tyreScanAnalytics.test.js (pure)

### My Problems (no menu item) (/my-problems)
- Page: src/pages/MyProblems.jsx
- Services: api/userIssues.js (RPCs)
- Tables: user_issues
- New empty company: Empty list of the user's own reported problems.
- Defects: MODA-X1 [P3, VERIFIED] Raw error text can reach the user on this page
- Fix: Use toUserMessage. (area: web)
- Tests: none found

## Modules that must not be marketed yet

Fleet Groups, Combinations, Customers, Battery Lifecycle, RFID Registry, Fleet Utilization, Vehicle Check
In/Out, Vehicle Reservations, Rotation Schedule, Rotation Optimizer, TPMS, Heat Intelligence (outside the
Gulf), Tyre Service Events, Tyre Pool, Retread Management, Retread Claims, Warranty Tracker, Fleet Risk Score,
Tyre Scan, and Digital Twin / Vehicle 360 as separate products. Position Intelligence and Fitment Validation
should not be shown in a demo until they have real inputs.

## Not verified

- No write was executed (read-only brief), so MODA-5 and MODA-7 are proven from code and catalog, not observed.
- No page was rendered in a browser; empty-account behaviour is read from the code paths.
- Flutter counterparts were identified by feature folder only (handover, tyres, tyre_exchange, records,
  meter_logs, scanning, assets); their code was not traced.
- Action Center, Approvals, Broadcast, Vehicle Handover, Reservations, Retread and Rotation write paths were
  checked at payload, constraint and policy level, not line by line through every RPC body.
- Storage bucket policies for handover photos and spec catalogue files were not inspected.
- Open-Meteo licence terms were not checked (MODA-14).
- Feature flag scoping (`automation_platform`, `vehicle_360`) per organisation was not traced.
