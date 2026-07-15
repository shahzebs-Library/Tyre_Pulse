# PROJECT MEMORY — Tyre Pulse (always load before working)

Durable, committed project knowledge so any session has full context. Keep this
current. Read it before adding/changing modules. Governing spec: `Tyre pulse enterprise.md`
(consolidation-first: one function = one module = one calculation service).

## Golden rules (from Tyre pulse enterprise.md)
- **Never duplicate a module or a KPI.** If a function exists, extend/merge it — do not
  create a parallel page or a second calc engine. (§1, §8)
- **One centralized calculation service per KPI**, used by every dashboard, report, PDF/PPTX/Excel.
- Related functions live under **one parent nav group**. Don't scatter the same domain.
- Deny-by-default security; hiding a button is not security — enforce in RLS/API/storage too.
- No raw errors to users (central error framework, ref IDs). No mock/fabricated data — honest empty states.

## Canonical "single source of truth" surfaces — DO NOT duplicate these
| Domain | Canonical module / service | Notes |
|---|---|---|
| Engineering KPIs: CPK, tyre life, failure/removal rate, brand/asset CPK, pressure compliance | **`src/pages/EngineeringKpi.jsx`** + engineering-KPI engine + `src/lib/api/engineeringKpi.js` | THE home for CPK/tyre-life/failure. Do NOT add these to Analytics or elsewhere — surface via this module. (A duplicate `tyreIntelligence.js` was added and reverted 2026-07-13.) |
| General fleet cost/risk/trend analytics | `src/pages/Analytics.jsx` | Cost, risk, monthly trend, brand/site tables. Keep engineering KPIs OUT of here. |
| Vendor performance | `src/pages/VendorIntelligence.jsx` | |
| Brand performance | `src/pages/BrandPerformance.jsx` | |
| Position intelligence | `src/pages/PositionIntelligence.jsx` | |
| Pressure/tread | `src/pages/PressureIntelligence.jsx` | |
| Tyre lifecycle | `src/pages/TyreLifecycle.jsx` | |
| KPI scorecards / command center | `src/pages/KpiScorecard.jsx`, `src/pages/KpiCommandCenter.jsx` | |
| Executive | `src/pages/ExecutiveReport.jsx`, `ExecutiveAnalytics.jsx` | |
| Holding-company consolidation | `src/pages/HoldingCompany.jsx` + V201 RPCs | multi-subsidiary rollup |
| Access control (RBAC + security) | `src/pages/MasterAccessControl.jsx` (tabs: Role Permissions=PermissionMatrix + Custom Roles + **Per-User Grants=AccessGrantsManager** + Security=SecurityCenter) | §5 unified home, now **SuperAdminRoute (super-admin only)**. `/permission-matrix` + `/security-center` now REDIRECT into this hub (`?tab=permissions` / `?tab=security`); their components live on only as tabs. Per-user grants = V225 (see below). |
| Claims analytics (over accident-embedded claims) | **`src/pages/ClaimsSummary.jsx`** (/claims-summary) + engine **`src/lib/claimsAnalytics.js`** | Chart-rich dashboard over the `accidents` table's claim fields (claim/approved/deductible/recovered, insurer, gcc_liability_ratio, fault, Najm/Taqdeer, expected/actual release). `analyzeClaims()` is THE claims KPI source — reused by the page, its PDF/Excel export, and the scheduled `claims` report. DISTINCT from `/insurance-claims` (InsuranceClaims.jsx = manual CRUD ledger over the separate `insurance_claims` table). Do NOT merge or duplicate the two. |

## Architecture conventions
- Central wiring: new module = page + `src/lib/api/<m>.js` + optional pure `src/lib/<m>.js` + test + migration.
  Parent wires `src/App.jsx` (lazy route, `<Safe>` + `RoleRoute`/`ModuleRoute`/`FlagRoute`),
  `src/components/Layout.jsx` (NAV_GROUPS item, role/flag gated), barrel `src/lib/api/index.js`.
- Service layer on `src/lib/api/_client.js` (supabase, unwrap, applyCountry, fetchAllPages, ServiceError);
  explicit COLS; missing-relation → `[]`.
- Migrations at repo root `MIGRATIONS_V*.sql`; org isolation via RESTRICTIVE `<t>_org_isolation`
  on `organisation_id = public.app_current_org()`; role gates via `get_my_role()`.
  Apply live via Supabase MCP (project `jhssdmeruxtrlqnwfksc`).
- Exports: `exportToExcel(rows, colKeys, headers, filename)`;
  `exportToPdf(rows, colKeys.map((k,i)=>({key:k,header:headers[i]})), title, filename, 'landscape')`.
- Verify every lucide icon exists before import.
- Security: URL fields go through `src/lib/safeUrl.js` (safeHref/safeImageSrc); user-facing errors
  via `src/lib/safeError.js` (toUserMessage). CSV export sanitized in `exportUtils.js`.

## Accidents, Claims & Reporting (2026-07-14)

### Claims data model + single engine (do NOT re-implement the maths)
- **Accident-embedded claims** are the operational claim source. Claim/case fields live ON the
  `accidents` table: claim_amount / claim_approved_amount / deductible / recovered_amount / insurer /
  policy_no / claim_status + GCC case fields gcc_liability_ratio / fault_status / najm_status /
  taqdeer_status / expected_release_date / release_date / repair_type / workshop_name.
- Single claims engine **`src/lib/claimsAnalytics.js`** (`analyzeClaims`, `hasClaim`, `isClosed`,
  `isDelayed`, `claimNet`) powers ALL claims surfaces:
  1. **`ClaimsSummary.jsx`** (`/claims-summary`, Accident & Insurance nav) — 8-KPI + 9-chart dashboard
     (doughnuts, dual-axis trend, funnel, ageing, insurer/asset/site bars) + delayed-highlight table +
     PDF/Excel export. DISTINCT from `/insurance-claims` (InsuranceClaims.jsx = CRUD ledger over the
     separate `insurance_claims` table) — do NOT merge.
  2. Accidents page "Claims Summary" one-click PDF/Excel export.
  3. Scheduled `claims` report type in `scheduledReports.js` → claims-desk email digest in edge fn
     `send-scheduled-reports` (deployed **v10**; branches on report_type==='claims', org-scoped
     manually since service role bypasses RLS). `fetchReportRows` honours a per-dataset `orFilter`
     (claims uses it to fetch only rows that carry a claim).

### Accidents page (`src/pages/Accidents.jsx`) — enriched
- **Analytics tab** now mixes chart types: severity/status/GCC-fault **doughnuts**, a 12-month incident
  **trend line**, plus the existing bars/stacked/claims-recovery. Registered ArcElement/LineElement/
  PointElement/Filler.
- **Add/Edit incident form** is a wide, sectioned modal that captures the FULL record at creation time
  (Incident · Classification · Liability & Case GCC · Insurance & Claim · Repair & Release), with
  dropdowns matching the AccidentDetailModal V219 vocabulary. `handleSave`/`openEdit` persist &
  re-hydrate every field. These feed the same claim data the dashboard/export/digest read.
- **Report Builder tab** — see below.

### Accident Report Builder (V221, deepened 2026-07-14) — customizable, block-based
- **Catalog + renderer are SHARED LIBS (do NOT re-implement in components):**
  **`src/lib/accidentReport.js`** = single source for CHARTS (12), KPIS (12), TABLE_COLS,
  BLOCK_TYPES/BLOCK_DEFAULTS (8 block types: header, kpis, chart, insights [auto key-findings,
  honest — [] when no data], text, table, divider, pagebreak), CHART_OPTS paper theme,
  STARTER, REPORT_LIBRARY (6 pre-built packs: Executive / Claims Desk / Insurer Submission /
  Safety Review / Monthly Board / Full Register), buildInsights, normalizeConfig.
  Days-Open link-up: caseAgeDays()/cellValue() virtual `days_open` table column, avgDaysOpen/
  avgCaseDuration KPIs, caseAge chart — table renderers MUST read cells via cellValue(), not r[col].
  **`src/lib/accidentReportPdf.js`** = the ONE PDF renderer (`renderAccidentReportPdf`): builder
  passes `chartImageFor` (live canvases); headless callers (Scheduled Reports) get offscreen
  chart.js rendering with the same data+options. Extend these maps for new block/chart types.
- **`src/components/accidents/AccidentReportBuilder.jsx`** (lazy "Report Builder" tab inside
  Accidents) is UI only: WYSIWYG paper preview, block hover toolbar, localStorage draft.
  LESSON: the global `.card` style has `overflow:hidden` — NEVER render dropdown menus inside a
  card (they get clipped/invisible). All pickers are fixed-overlay MODALS: rich "Add block"
  grid (icon+description per block) and a "Library" modal (pre-built packs tab + searchable
  saved-layouts tab with load/delete).
- **Saved layouts** persisted to `accident_report_templates` (V221, org-isolated RESTRICTIVE RLS +
  per-user ownership) via **`src/lib/api/accidentReportTemplates.js`** (list/get/create/update/delete,
  + barrel), with a localStorage draft fallback.
- **Saved layouts are schedulable app-wide**: `report_schedules.report_type = 'builder:<template-id>'`
  (NO schema change). `src/lib/api/scheduledReports.js` exports BUILDER_TYPE_PREFIX,
  isBuilderType/builderReportType/builderTemplateId, `listSchedulableLayouts()`, and
  `datasetFor('builder:*')` → full accidents projection. ScheduledReports.jsx shows custom layouts
  in an optgroup; "Generate now" on a builder schedule renders the template's EXACT block PDF via
  the shared headless renderer (Excel = tabular accidents projection). Edge fn
  `send-scheduled-reports` updated (builder:* → claims-desk digest + "Custom Accident
  Report" subject) and **deployed v11 (ACTIVE, 2026-07-14)** via Supabase MCP.
  Tests: `accidentReport.test.js` (13), `scheduledReportsBuilder.test.js` (4).
- **Shipped 2026-07-14**: merged to main (`e9408ab`, branch `claude/accident-builder-report-ui-2bkwb5`);
  Vercel production deploy VERIFIED READY on that exact commit (build clean). Full suite 3406 green at merge.

### V220 — accident-delete FK fix (applied)
- Deleting an accident cascade-deletes `accident_parts`; the AFTER DELETE audit trigger
  `log_accident_part_change()` inserted a `part_removed` row into `accident_audit_log` referencing the
  accident being deleted → `accident_audit_log_accident_id_fkey` violation (users could not delete).
  DELETE branch now guarded to only log when the parent accident still exists (a real single-part
  removal); an accident-level cascade skips the audit insert. Mirrors `log_accident_change()`.

### V222 — chk_accident_type widened (applied 2026-07-14)
- `accidents.chk_accident_type` originally allowed only collision/rollover/tyre_failure/
  mechanical/near_miss/property_damage/other (lowercase), but the web form sent display labels
  ('Collision', 'Rear-end', 'Fire'…) → EVERY non-empty accident type failed the CHECK and the
  incident could not be saved. V222 widened the constraint to the union vocabulary (adds
  rear_end/side_swipe/reversing/fire/vandalism/weather) and Accidents.jsx now maps label ↔ token
  via `toDbAccidentType`/`canonAccidentType` (mirrors toDbSeverity/toDbStatus; canonicalised in
  loadRecords + openEdit). RULE: accidents.severity/status/accident_type are CHECK-constrained
  lowercase tokens — NEVER write a UI label straight to these columns; always go through the toDb* maps.

### Accidents UX + case-day intelligence (2026-07-14, 4-agent batch)
- **Inline incident form**: the New/Edit Incident form is NO LONGER a popup modal — it renders as a
  full-width in-page `.card` below the tabs (`showForm` state; tab sections gated on `!showForm`,
  ArrowLeft/X to return, submit via `form="accident-inline-form"`). Presentation-only; handleSave/
  fields unchanged. Delete-confirm + Bulk Upload remain modals.
- **Save path PROVEN**: full schema/CHECK audit + two rolled-back live inserts (risky + opposite
  vocabulary) pass. Extra fix: accidents.accident_type is NOT NULL → payload uses
  `toDbAccidentType(v) || 'other'` (empty selection used to fail). Only 3 CHECKs exist:
  accident_type/severity/status — all mapped via toDb* helpers.
- **Days Open calculated field** (Accidents list): `caseAgeDays(r)` = whole days incident_date →
  now (open) or → release_date (closed); traffic-light badge (green ≤15d / amber 16–30d / red >30d),
  numeric sorting, `filterAge` quick filter (open cases), included in EXPORT_FIELDS/PDF_KEYS/CLAIMS_KEYS.
- **Case timeline (days per step, automatic)**: `accident_audit_log` already logs every status
  change (`action='status_change'`, old/new JSONB, changed_at) via the existing trigger — NO new
  table. **V223** added a SELECT policy for authenticated gated by EXISTS on the parent accident
  (inherits org/country RLS; previously admin-only). Engine `src/lib/accidentTimeline.js`
  (`buildCaseTimeline` → ordered steps with per-step days, current step live "days so far", honest
  single-step fallback; 12 tests) + api `src/lib/api/accidentTimeline.js` (`listStatusTransitions`,
  lean `old_values->>status` projection) + "Case timeline" stepper in AccidentDetailModal Overview.
  NOTE: `get_accident_audit` RPC is SECURITY DEFINER/LIMIT 100 — do NOT use it as the timeline source.
- **Builder orientation-true preview**: paper max-w 860px portrait / 1120px landscape (animated),
  KPI grid 3-per-row portrait / 6-per-row landscape (matches PDF `perRow`), chart preview height
  ×0.85 in landscape, "A4 · Portrait · 210×297mm" format hint under the orientation select.

### Migrations & tests
- Latest migration is **V225** (user_access_grants + per-user capability helpers); V224 =
  report_schedules super-admin/dedupe/org-scoped policies; V223 = accident_audit_log member read
  policy; V222 = chk_accident_type widened; V221 = accident_report_templates; V220 = delete-trigger
  fix; next free **V226**.
- New tests: `claimsAnalytics.test.js` (12), `scheduledReports.api.test.js` (4),
  `accidentReportTemplates.api.test.js` (5), `accessGrants.test.js` (5), `accessEnforcement.test.js`
  (6). Full suite green (3477 at V225 merge).

## Console-centralized administration (2026-07-14) — ALL admin/RBAC lives behind `/console`
- **`/console` (src/console/*, isolated ConsoleAuthProvider + 2FA, super-admin only) is now THE home
  for administration + access control.** Main-app admin routes REDIRECT into it: /master-access-control
  ->/console/access, /users->/console/users, /admin->/console, /ai-administration->/console/ai-admin,
  /org-hierarchy + /holding-company->/console/organisations, /sso-configuration->/console/security,
  /permission-matrix->/console/access?tab=roles, /security-center->?tab=security. Those nav items were
  REMOVED from `src/components/Layout.jsx` (single super-admin "System Console" link added). Do NOT
  re-add admin pages to the main-app nav.
- **`src/console/ConsoleAuthBridge.jsx`** renders the main-app `AuthContext.Provider` with a super-admin
  value derived from `useConsoleAuth().admin`, so existing admin pages (PermissionMatrix, AccessGrantsManager,
  CustomRolesManager, SecurityCenter, UserManagement, AiAdministration, SsoConfiguration) render VERBATIM
  inside the console. `AuthContext` is now exported for this. New console routes are bridge-wrapped.
- **Access Control hub = `src/console/pages/ConsoleAccessControl.jsx`** (/console/access, `?tab=`):
  roles(PermissionMatrix) · custom(CustomRolesManager) · grants(AccessGrantsManager) · **effective** ·
  **country** · **bulk** · **audit** · security(SecurityCenter). The 4 NEW viewers live in
  `src/console/pages/access/` (EffectivePermissions/CountryScope/BulkOperations/AccessAudit). Do NOT
  build a second access-control surface. ConsolePermissions.jsx is retired -> redirects to ?tab=roles
  (single canonical role x module matrix).
- **Advanced access model (V228-V231, applied live):**
  - **V228 access_audit** = immutable trail; AFTER definer triggers on user_access_grants/module_permissions/
    custom_roles/profiles(role,country,locked,approved,is_super_admin). Super-admin SELECT only; trigger-only writes.
  - **V229 capability enforcement** = 3-arg `user_has_capability(uid,key,cap)` + `get_my_capabilities()`
    + `app_user_can(key,cap)` (server resolver: Admin/super>revoke>role>grant>deny). Client side:
    AuthContext loads get_my_capabilities + exposes `hasCapability(moduleKey,cap)`; pure
    `resolveCapability` in permissionMatrix.js; `useCapability()` hook. RULE: capability gating is
    VIEW-enforced server-side; create/edit/delete/export/approve are CLIENT-UI gates only until RLS
    consumes app_user_can on pilot tables (backlog). Keep the honest "(stored only)" labels.
  - **V230 admin RPCs** (super-admin gated, service `src/lib/api/adminAccess.js`): admin_get_effective_access,
    admin_set_user_country, admin_bulk_set_grant, admin_bulk_set_role (LAST-super-admin lockout guard;
    never demotes a super via role change), admin_clone_role, admin_list_access_audit.
  - **V231** revokes default PUBLIC execute on all the above definer fns (authenticated keeps it; self-gates
    are the real boundary). Next free migration **V237**.

## UX cleanup batch (2026-07-14)
- **Universal Back button**: `src/components/ui/PageHeader.jsx` now renders a history-aware "Back"
  control by default (props `showBack` default true, `onBack` override) - every page using PageHeader
  gets it, no per-page change. `navigate(-1)`.
- **Executive reports default to WHITE** (user: "they are black"): `ExecutiveReport.jsx` reportMode
  defaults ON (white printed-document view + paper chart options); `ExecutiveAnalytics.jsx` wrapped in
  `.tp-exec-paper` (flips card/surface/text CSS vars light) + forced-light ECharts palette. App chrome
  unchanged. NOTE: user also wants Executive to become an ADVANCED CUSTOMIZABLE builder (real charts,
  add blocks) - BACKLOG (bigger than theming).
- **AI panel/token fixes**: `AiCostMonitor.jsx` guarded groupByDay null-date crash + split honest
  empty vs error+Retry states (ai_token_logs + chat-ai edge fn were already correct; the page just
  looked broken). `CopilotCard.jsx` AI answer now renders on a WHITE panel with dark text, parsed into
  concise Observation/Root cause/Risk/Actions sections + loading/error/placeholder. (User later clarified
  the "black" complaint was the Executive report, not this - both fixed regardless.)
- **Data Intake decluttered**: removed the per-module navigate-to-`/data-intake` "Import" buttons (+ import
  hint paragraphs, dead navigate/Upload imports) from FleetMaster, Inspections, StockManagement,
  TyreSpecifications, WarrantyTracker, WorkOrders, DriverManagement, SupplierManagement, GatePass. Bulk
  upload now lives ONLY in the central Data Intake Center; Excel/PDF DOWNLOADS kept everywhere. RULE:
  do NOT re-add per-module bulk-import entry points; uploads go through /data-intake only. (Accidents
  bulk-upload intentionally left for now - parallel session actively editing accident files.)
- **Multi-session note**: a parallel Claude session works this same branch (PR #27 accident cleanup,
  Access Manager, TV boards). Reconcile via fetch+rebase / --no-ff merge; keep waves small; do accident/
  accidentVocab changes ON TOP of their latest to avoid clobbering.
- **BACKLOG from user (2026-07-14)**: (1) Executive = advanced customizable report builder; (2) accident
  creation form: picking an asset_no auto-populates plate_number/asset_type from vehicle_fleet master;
  (3) standardize + de-duplicate severity (Minor/Moderate/Major) + current-condition (Running/Waiting for
  approval/Repair started...) dropdowns in accidentVocab; (4) all reports customizable like the builder;
  (5) TV/executive shareable public links + live tiles (daily open job cards, daily tyre replacement).
  The accident detail-table filter (Open/Closed claims + status/severity/fault) ALREADY exists (ffbef29).

## Advanced batch 2 (2026-07-14) — exec builder, TV tiles, dashboard, accident data
- **Executive report is now a CUSTOMIZABLE builder** (`ExecutiveReport.jsx`): Customize drawer to
  show/hide + reorder the 7 built-in sections, ADD 9 data-bound blocks (trend/RCA/site/brand/risk charts,
  top-cost table, wins/concerns, free text, divider), localStorage `executiveReport.layout.v1`. PDF/PPTX/
  Excel exports honour the visible+ordered built-in sections (added blocks/notes are on-screen/print only).
  White document theme. Do NOT import the accident report engine here (self-contained).
- **TV wallboard** (`DisplayDashboard.jsx`): new "Today at a Glance" board (default, in BOARDS + rotation)
  with live tiles - open job cards today, tyre replacements today (tyre_changes removal_date), inspections/
  accidents today, critical alerts, tyres needing attention, fleet availability. Uses only data load()
  already fetches; `isToday` = String(v).slice(0,10)===todayStr. DisplayShare.jsx (snapshot share) untouched.
- **Main dashboard** (`Dashboard.jsx`): 6-KPI row (adds Fleet Vehicles), a Site filter that flows through
  the central `tyres` memo to every surface, and a concise number-led "Priority Recommendations" panel
  (derived only from loaded data; "All clear" empty). CPK/accidents/WO KPIs omitted (not in dashboard.js
  service) rather than fabricated.
- **Accidents severity vocab STANDARDIZED (single source `accidentVocab.js`)**: `SEVERITIES =
  ['Minor','Moderate','Major']`; `toDbSeverity` Minor/Moderate/Major -> minor/moderate/severe (chk_severity
  allows minor/moderate/severe/fatal); legacy 'Total Loss'/'severe'/'fatal' fold onto **Major** via
  SEVERITY_ALIAS/canonSeverity. Three competing lifecycle lists merged into ONE `CURRENT_CONDITION_OPTS`
  (Running/Waiting for approval/Under Repair/Repair Completed/Released/Closed); `WORKFLOW_STAGE_OPTS`/
  `CASE_STAGE_OPTS` retained as ALIASES (backward-compatible imports). RULE: 'Total Loss' is retired as a
  severity label - do NOT reintroduce it; use the 3-band ladder. accidentReport/accidentVocab tests updated.
- **Accident form asset auto-fill** (`Accidents.jsx`): debounced asset_no lookup (loaded fleet list, then
  `getAssetByNo` from api/assets.js) auto-fills site/country ONLY when empty (never overwrites typed values)
  + a read-only "Master:" context line (vehicle_type/make/model/fleet_number). NOTE: vehicle_fleet has NO
  plate_number column and accidents has no vehicle_type/plate column - nothing fabricated/persisted to
  non-existent columns. If a plate/asset-type field is ever wanted on accidents, add the columns first.

## Access matrix now ENFORCED in nav + module_permissions integrity (2026-07-14)
- **Root cause of "I change access and it goes back"**: `module_permissions` held 518 DUPLICATE/
  conflicting global rows per (role, module_key) (e.g. Tyre Man dashboard true AND false). The reader
  `get_user_module_permissions` overwrites per row -> last-row-wins -> nondeterministic. **V239** dedupes
  to ONE row per (role, module_key, coalesce(org_id, zero-uuid)) keeping the most-recent, + a UNIQUE INDEX
  `module_permissions_role_module_org_uidx` so toggles now STICK. **V240** reseeds the standard roles to the
  app's canonical ROLE_DEFAULTS (dedup exposed unreliable survivors); custom roles left as-is. Next free **V241**.
- **hasPermission is now PER-KEY** (`src/contexts/AuthContext.jsx`): a module explicitly present in the DB
  matrix uses that value (enabled=false -> denied/hidden); a module NOT configured falls back to ROLE_DEFAULTS
  (so a sparse matrix never mass-hides). Precedence still Admin/super > revoke > matrix/role > grant > deny.
- **Nav now enforces the matrix for ALL built-in roles** (`src/components/Layout.jsx` shouldShowNavItem): any
  keyed nav item (NAV_MODULE_KEY) is gated by `hasPermission` - a module turned OFF for a role, or revoked for
  a user, is HIDDEN from the sidebar (previously only custom roles consulted the matrix; built-in roles
  defaulted to show). Inspector/DMO/checklist special nav rules unchanged; Admin/super always see all.
  RULE: to give a role a module, enable it in Console > Access Control > Role Permissions (it sticks now);
  changes reach an affected user on refresh/refocus (V227), NOT the admin's own account (admins see all).

## Capability enforcement Phase 2 (pilot) + general Report Builder blocks (2026-07-14)
- **V238 capability enforcement PILOT (additive/SAFE)**: PERMISSIVE write policies consuming
  `app_user_can(module, cap)` added to tyre_records / inspections / work_orders for create/edit/delete.
  Per-user create/edit/delete GRANTS are now SERVER-ENFORCED on these 3 tables (verified live: a
  Reporter's app_user_can('tyre_records','edit') flips false->true on grant). PERMISSIVE => ORs with the
  existing role policies, so it ONLY adds access to granted/admin users; existing writers unaffected;
  org/country RESTRICTIVE isolation still scopes a granted user. NOT yet done: revoke of a role-inherent
  capability (needs a RESTRICTIVE policy) + the other ~45 tables + export/approve (export is a client
  download, not a DB write). CAPABILITIES.enforced flags in permissionMatrix.js still say false globally
  (honest for the majority); the 3 pilot tables are the exception. Next free migration **V239**.
- **General Report Builder is now MULTI-BLOCK** (`src/pages/ReportBuilder.jsx` + `src/lib/reportBuilder.js`,
  DISTINCT from the Accident/Executive block builders - do NOT merge). Config carries `charts:[{id,type,
  metric,title}]` (<=6) + `kpis:[{id,fn,col}]` (<=8) over any DATASETS entry (tyres/fleet/...); add/reorder/
  remove; legacy single `chart` folds into a one-element array (backward-compatible, validateConfig still
  emits `chart`). KPI tiles compute over raw queried rows; PDF composites tiles + all charts on white paper
  via exportToPdf opts.leadImage (no exportUtils change). Engine tests: reportBuilder(33)+reportBuilderChart(16).

## Country data visibility - the ORG boundary sits ABOVE country (2026-07-14)
- **CRITICAL model fact**: RLS = org isolation (outer wall) AND country isolation (inner). `app_can_see_country`
  only shares WITHIN the same organisation. `app_current_org()` = `profiles.org_id` (NOT organisation_id);
  data rows are scoped by their `organisation_id`. Two same-country users in DIFFERENT orgs do NOT see each
  other's data - country never even comes into play.
- **Live fix applied (data, not code)**: all fleet data (1419 tyres/15 accidents/604 fleet) lives in org
  `00000000-0000-0000-0000-000000000001` (Company A), but 9 approved KSA users were in a different org
  (b4a4ba35). They saw ZERO. Moved those 9 (+ any org-null) into Company A (set BOTH org_id AND
  organisation_id) so every approved KSA user now sees all KSA data (verified: a KSA Manager went 0 -> 1419).
  Egypt users (org e340fa7a) intentionally left isolated.
- **V237 new-user default**: `handle_new_user()` now stamps org_id + organisation_id = Company A and
  country = [region] (KSA default), approved=false. So a NEW signup is pre-scoped to the data's company +
  their country and only sees data once an admin APPROVES them. (org_id column default was already Company A;
  organisation_id + country were NULL, which would have made a newly-approved user see ALL countries.)
- RULE: to make same-country users share data, they must be in the SAME org. Create new staff inside
  Company A (console user editor sets company/country/approval). Next free migration **V238**.

## Advanced batch 3 (2026-07-14) — reports customization + accident fault/severity accuracy
- **Reports.jsx** (3-step report wizard, 5 report types over tyre_records/inspections) gained persisted
  customizable columns (`reports.layout.v1`, per report type) + All/None/Reset + a real error/Retry state +
  disabled empty exports. It is a REAL report page, not a shell. (General ReportBuilder.jsx already exists;
  do NOT duplicate the block builder here.)
- **Accident fault/severity accuracy (single source, `accidentVocab.js`)**: fault classification was
  TRIPLICATED and mis-bucketed 'No Fault'/'not at fault' as FAULTY (string contains "fault"). `canonFault`
  is now THE one resolver (non-faulty patterns tested BEFORE the faulty catch-all; folds Fault/No Fault/
  Non-Fault/at fault/under review); the fault chart + KPI classify through it, so faulty/non-faulty counts
  are correct. Added `toDbFault`. `FAULT_STATUS_OPTS = ['Faulty','Non-faulty','Under review']` (single).
  Removed a stale parallel `canonSev` in accidentReport.js (Minor/Major/Total Loss) - now an alias of
  `canonSeverity` (Minor/Moderate/Major); severity chart/sevMonthly/insights all classify through the one
  resolver. NO other genuine catalog duplicates (status doughnut vs statusPolar, topAssets vs paretoAssets,
  recovery funnel vs waterfall, aging vs caseAge are DISTINCT - deliberately kept).
- **Already-optimized (do NOT redo)**: front-end bundle (vite.config manualChunks + heavy libs jspdf/xlsx/
  pptxgenjs are dynamic-imported; only test files import them statically); general ReportBuilder.jsx exists.
- **Still open (user backlog)**: PUBLIC shareable links for reports/executive (TV token-share infra exists =
  V103 `/display/:token` + getDisplaySnapshot; extend to reports needs a small DB build - NOT yet done).
  AI concise output tuning (CopilotCard DISPLAY fixed; the edge-fn prompt could be tuned for KPI+root-cause+
  recommendation brevity - backend deploy, not done). Executive/all-reports as full block builders beyond
  Executive+Accident. Capability enforcement Phase 2 (RLS consumes app_user_can). multiple_permissive_policies.

## Performance + Data Reconciliation (2026-07-14)
- **App-slowness root cause = RLS re-running helper fns PER ROW**, not data volume (tiny: 1419 tyres/604
  fleet). **V233** = 7 covering FK indexes + drop 1 duplicate index. **V234** (20 hot tables) + **V236**
  (all remaining base tables) wrap the zero-arg STABLE helpers (is_super_admin/app_current_org/get_my_role/
  app_role/app_is_active/app_is_org_admin/app_is_elevated) in `(select ...)` so the EXPENSIVE ones (each does
  a profiles lookup) run ONCE per query, not per row. Access verified unchanged via impersonation.
  CAVEATS: (a) `app_can_see_country(country)` is row-dependent and intentionally NOT wrapped (still per-row;
  optimizing it needs a policy rewrite, not a wrap - backlog). (b) the `auth_rls_initplan` advisor lint stays
  ~273 because it counts cheap `auth.uid()/auth.role()` calls, NOT our custom helpers - the meaningful win is
  still real. (c) V236's guard uses `ILIKE '%( select %'` (pg_get_expr renders `( SELECT `); the 20 V234
  tables got double-wrapped `( SELECT ( SELECT fn()))` - harmless, still an initplan. Do NOT re-run a bare
  wrap pass without a correct already-wrapped guard. `multiple_permissive_policies` (~199) still open (backlog).
- **Data Reconciliation** = `src/pages/DataReconciliation.jsx` (/data-reconciliation, Admin/Manager/Director,
  nav under Administration & Data) + engine RPCs **V232/V235** (`recon_*`, app_is_elevated + org-scoped, in
  `src/lib/api/dataReconciliation.js`). RULE: a DUPLICATE = every column identical (except id/created_at/
  updated_at) - `recon_duplicate_tyres` (strict) + `recon_merge_duplicate` (byte-identical guard, refuses
  otherwise). Same serial on a DIFFERENT vehicle = legitimate tyre MOVEMENT, surfaced read-only by
  `recon_serial_conflicts`, NEVER removed. Orphan assets (tyres whose asset is missing from vehicle_fleet) =
  the real gap - `recon_orphan_assets` + `recon_backfill_asset`/`recon_backfill_all_orphan_assets`. Live
  findings at build: 0 true duplicates, 80 orphan assets. All fixes are user-approved (no silent add/delete).
- ConsoleUsers.jsx gained: full role set (ACCESS_ROLES + live custom_roles), per-user country editor,
  bulk role/grant, "Manage grants" link. Tests: capability.test.js (7). Full suite 3513 green at merge.

## Late-session batch (2026-07-14) — Report Builder PPTX/tables, country RLS, live access, perf, reconciliation
**Migration pointer: latest applied = V235, next free = V236.** V226 country visibility; V227 live access
refresh; V228-V231 console access model (above); V232+V235 data reconciliation; V233 FK indexes + dup index;
V234 RLS initplan perf fix.

### Report Builder — advanced formatting + tables + PowerPoint (code only, no migration)
- **Single engine drives PDF + PPTX + Excel — do NOT duplicate.** Shared catalog `src/lib/accidentReport.js`
  now exports 12 palettes (`PALETTES` + ordered `PALETTE_KEYS`: default/cool/warm/mono/contrast/pastel +
  forest[green]/slate[gray]/ocean/sunset/earth/vibrant), pure `styleChartData(data,block)` (palette + border
  colour/width), `chartOptionsFor(block,baseOpts)` (legend/grid/label colour+size/valueLabels-enabled), and
  table helpers `tableRows(records,block)` (filter claims/status/severity/fault/date + sort + density),
  `tableExportMatrix` (Excel rows keyed by colKey), `tableFilterLabel`, `TABLE_FILTER_OPTS`. BLOCK_DEFAULTS.chart
  gained borderColor/borderWidth/labelColor/labelSize/showLegend/showGrid; chart `width` includes 'quarter'.
- **PDF** `src/lib/accidentReportPdf.js`: `distributeFill(blankMm,blockType)` grows charts/rows/KPIs to fill
  pages (no empty space); density-keyed table font; renders `tableRows`.
- **PowerPoint** NEW `src/lib/accidentReportPptx.js` (`renderAccidentReportPptx({config,records,company,currency,
  chartImageFor,filename,subtitle,save})`) mirrors the PDF renderer, reuses the same engine, WYSIWYG charts via
  live-canvas `chartImageFor` (native pptx-chart fallback), KPI/insights/text/filtered-table slides (paginated),
  16:9, pptxgenjs stays lazy. AccidentReportBuilder has an "Export PPTX" button beside Export PDF.
- Advanced chart-formatting controls are Admin/Super-Admin only (`canFormat`); page-end guides in the preview.
- `src/lib/chartCapture.js` `captureChartOnPaper` re-renders dark charts on white so PNG/PDF exports are legible.
- Tests: accidentReport.test.js (58), accidentReportPptx.test.js (12).

### Accidents — claim open/edit + open-claims register filter
- **Fixed "admin cannot open/edit a claim"**: `AccidentDetailModal` `load()` used `Promise.all` over
  accidents+remarks+parts, so any aux-query rejection hung the loader forever. Now `Promise.allSettled` +
  try/catch: accidents query is authoritative, aux queries best-effort ([] + non-fatal banner), loading always
  clears. Test accidentDetailResilientLoad.
- **Open-claims filter**: URL-linkable `?claims=open` chip + header link in the Accidents register (reuses
  claimsAnalytics `hasClaim`/`isClosed`); composes with country/status/search.

### V226 — country visibility (audit + close gaps)
- Goal: anyone WITH access sees their own country's data. `accidents.active_select_accidents` was the ONLY
  role-gated PERMISSIVE SELECT blocking same-country users (was Admin/Manager/Director/Inspector) -> widened to
  `app_is_active()`; RESTRICTIVE accidents_country_isolation + org_isolation still scope reads. Added RESTRICTIVE
  `<t>_country_isolation = app_can_see_country(country)` to 16 fleet BASE tables (insurance_claims, incident_reports,
  retread_claims, drivers, tyre_service_events, tyre_pool, checklist_submissions, dvir_reports, handover_reports,
  breakdown_callouts, service_requests, odometer_logs, engine_hours_logs, fitment_validations, goods_receipts,
  requisitions). `app_can_see_country` is null-safe (null row country = visible to all; empty user country = sees
  all; admins/super see all). RULE: to share a table by country, ensure a permissive SELECT reaches the user
  (widen role gates to app_is_active()) and let the RESTRICTIVE country+org policies scope; NEVER country-isolate
  a view (tyre_changes is a VIEW), profiles, or shared reference tables (suppliers/customers/sites).

### V227 — live access refresh (no re-login) + V229 capability client wiring
- `AuthContext.refreshAccess()` re-pulls module perms + grants; fires on tab refocus + realtime on
  `user_access_grants`(self) and `module_permissions`; both added to realtime publication; `module_permissions`
  got an authenticated SELECT policy (capability flags not sensitive). So Master Access Control / Console changes
  reach an affected user's OPEN session without re-login (access previously loaded only at login). Client
  capability layer: `resolveCapability` (permissionMatrix.js), AuthContext `hasCapability(moduleKey,cap)` +
  `capabilities`, `useCapability()` hook. Enforcement note (unchanged): VIEW is server-enforced; create/edit/
  delete/export are UI gates until RLS consumes `app_user_can` on pilot tables (backlog).

### Performance — RLS initplan fix (the app-slowness root cause)
- Slowness was NOT data volume (tiny) but RLS re-evaluating auth/org helper functions PER ROW. Performance
  advisor: 273 auth_rls_initplan + 198 multiple_permissive_policies + 7 unindexed_foreign_keys + 1 duplicate_index.
- **V233**: 7 covering FK indexes + drop duplicate index `report_schedules_next_run_idx`.
- **V234**: on 20 HOT operational tables (tyre_records, vehicle_fleet, accidents, inspections, work_orders,
  stock_records, alerts, warranty_claims, corrective_actions, budgets, purchase_orders, rca_records,
  tyre_rotations, gate_passes, recalls, insurance_claims, drivers, incident_reports, tyre_specifications,
  tyre_status_marks) wrap zero-arg STABLE RLS helpers (is_super_admin/app_current_org/get_my_role/app_role/
  app_is_active/app_is_org_admin/app_is_elevated) in `(select ...)` so they evaluate ONCE per query. Access
  verified unchanged by impersonation. RULE: NEVER wrap `app_can_see_country(country)` (row-dependent). Backlog:
  same initplan/multiple-permissive on the ~48 non-hot tables + 434 unused_index (low priority).

### V232/V235 — Data Reconciliation (canonical surface, do NOT duplicate)
- Page `src/pages/DataReconciliation.jsx` (/data-reconciliation, Admin/Manager/Director, nav under
  "Administration & Data") + service `src/lib/api/dataReconciliation.js` + RPCs (app_is_elevated + org-scoped):
  recon_orphan_assets, recon_duplicate_tyres, recon_serial_conflicts, recon_backfill_asset,
  recon_backfill_all_orphan_assets, recon_merge_duplicate.
- **RULES (user-confirmed data semantics)**: a DUPLICATE = EVERY column identical (except id/created_at/updated_at)
  -> V235 strict definition; `recon_merge_duplicate` refuses to delete unless byte-identical. Same serial on a
  DIFFERENT asset = a tyre that MOVED between vehicles = legitimate history, shown read-only, NEVER removed.
  Live findings: 0 true duplicates, 80 orphan assets (tyres whose asset is missing from vehicle_fleet -> the real
  "data not entered everywhere" gap; one-click backfill). tyre_records has dead legacy columns
  (serial_number/tyre_serial/asset_number, all empty) - canonical are serial_no/asset_no. Tests:
  dataReconciliation.test.js (6). Full suite 3531 green at merge.

## Super-Admin Access Control + Per-User Grants (2026-07-14) — RBAC per-user overrides
- **Canonical RBAC home = `src/pages/MasterAccessControl.jsx`, guarded by `SuperAdminRoute` (super
  admin ONLY).** Do NOT add a second access-control page. Tabs reuse existing components verbatim:
  Role Permissions (PermissionMatrix), Custom Roles (CustomRolesManager), **Per-User Grants
  (AccessGrantsManager, NEW)**, Security (SecurityCenter). `/permission-matrix` + `/security-center`
  routes now `<Navigate replace>` into the hub tabs (components retained only as tabs).
- **Per-user grant primitive (the "give ONE user more/less than their role" feature) — V225:**
  table `user_access_grants` (user_id, module_key, capability default 'view', effect grant|revoke,
  expires_at, note, granted_by, org_id). RESTRICTIVE org-isolation + super-admin-only writes.
  SECURITY DEFINER helpers (do NOT re-implement the maths): `user_has_capability(uid,key)` reads ONLY
  the grants table (no profiles ref -> no RLS recursion); `get_my_access_grants()` -> jsonb
  `{module_key: 'grant'|'revoke'}` (revoke wins, expiry-aware); `set_user_access_grant(...)` /
  `revoke_user_access_grant(id)` super-admin-only writers. Service = `src/lib/api/accessGrants.js`
  (listUserGrants/getMyAccessGrants/setUserAccessGrant/revokeUserAccessGrant) + barrel.
- **Enforcement is BOTH layers.** App: `AuthContext` selects `is_super_admin`, loads
  `get_my_access_grants` (FAIL-CLOSED to `{}`, never blocks login), exposes
  `isSuperAdmin`/`grantOverrides`/`grantedModules`, and resolves module access via pure exported
  `resolvePermission({role,isSuperAdmin,roleAllows,override})` used inside `hasPermission` — precedence
  **Admin/super > revoke > roleAllows > grant > deny**. `ModuleRoute`/nav inherit it; `Layout`
  `shouldShowNavItem` shows a nav item when its `NAV_MODULE_KEY` is in `grantedModules` (additive,
  before the adminOnly reject) and treats super-admins like Admin. `useCapabilities()` hook =
  ergonomic reader. DB: RLS is the real boundary. RULE: capability enforcement today is VIEW-only
  (module reach); create/edit/delete/export are STORED and honestly labelled "(stored only)" in the
  UI — do NOT pretend they gate anything until per-table RLS consumes `user_has_capability`.
- **Lockout guard**: only ONE Admin exists and it IS the super-admin, so the super-admin-only flip
  locked out nobody. Never inline `select is_super_admin from profiles` in a grants policy (recursion);
  always use the existing SECURITY DEFINER `is_super_admin()`/`app_current_org()`. `/console/*` is the
  independent break-glass.

## Scheduled Reports super-admin fix (2026-07-14) — V224
- BUG "super admin cannot create/see scheduled reports": `report_schedules` write policies allowed only
  role IN (Admin,Manager,Director) with a TAUTOLOGICAL org check and ignored `is_super_admin()`; two
  overlapping policy sets existed (report_schedules_* AND rs_*). V224 consolidates to ONE clean set:
  super-admin can always manage; else Admin/Manager/Director scoped to their OWN org (real org scope);
  SELECT also lets super-admin see every org. Flag `report_scheduling` was already ON; the pipeline
  (pg_cron + edge fn v13) was healthy — this was purely the RLS gap.

## Report Builder auto-layout + per-chart formatting (2026-07-14)
- **Chart styling model (shared engine, do NOT re-implement)**: `src/lib/accidentReport.js` exports
  `PALETTES` (default/cool/warm/mono/contrast/pastel) + pure `styleChartData(data, block)` (applies
  palette + border toggle per chart, non-mutating, empty->unchanged). `BLOCK_DEFAULTS.chart` gained
  `showLabels`/`showBorders`/`palette`. VALUE_LABELS_PLUGIN skips when
  `chart.config.options.plugins.valueLabels.enabled === false`. Both preview (AccidentReportBuilder)
  and PDF (accidentReportPdf renderOffscreenChart) call styleChartData + set that enabled flag, so
  preview == export.
- **Quarter width + packing**: chart `width` now 'full'|'half'|'third'|'quarter'. `chartWidthFraction`
  (1/0.5/1/3/0.25) + pure `packChartRows` (greedy, new row when accumulated fraction > 1.0) drive the
  PDF row-packer (quarters = 4-up).
- **Auto-fill (no empty PDF space)**: `grownHeight()` in accidentReportPdf.js grows a chart/row that is
  LAST on its page to consume trailing blank (>40mm), clamped margin-safe, so pages read full not
  top-loaded.
- **Formatting panel is Admin/Super-Admin only**: AccidentReportBuilder derives
  `canFormat = profile?.is_super_admin === true || profile?.role === 'Admin'` and only then renders the
  Data labels / Borders / Palette-swatch controls; everyone still SEES the styled charts. Preview also
  draws **page-end guide lines** (A4 geometry self-scaled to rendered width/orientation) + a distinct
  manual page-break banner.
- **Readable chart downloads**: NEW `src/lib/chartCapture.js` `captureChartOnPaper` re-renders
  dark-theme charts on a white paper canvas so exported PNG/PDF charts are never black/transparent;
  used by ChartModal "Download PNG" and the Accidents analytics PDF.
- Tests: `accidentReport.test.js` now 36 (PALETTES/styleChartData/label-flag/quarter packing).

## Report Builder charts + Accidents form unification (2026-07-14)
- **Advanced charts**: `src/lib/accidentReport.js` CHARTS now includes paretoAssets (kind 'pareto'),
  costTrend ('combo', dual axis), typeRadar ('radar'), statusPolar ('polar'), recoveryWaterfall
  ('waterfall', floating bars). CHART_OPTS/CHART_JS_TYPE carry every kind (catalog-integrity test
  enforces it). Value labels: makeValueLabelsPlugin handles radar vertices + floating-bar step
  magnitude; polar/doughnut use doughnutLegendCounts. AccidentReportBuilder registers
  RadialLinearScale/RadarController/PolarAreaController + Radar/PolarArea and maps them in
  CHART_COMPONENT.
- **Shrink-to-grid**: chart block gains `width` 'full'|'half'|'third' (BLOCK_DEFAULTS.chart). Preview
  uses flex-wrap (half 2-up, third 3-up, compact heights); accidentReportPdf.js row-packs consecutive
  shrinkable chart blocks side by side (full charts + non-chart blocks break the row).
- **Report numbers**: VALUE_LABELS_PLUGIN draws values on every mark (baked into the rasterized PDF);
  summarizeChartData prints a "Total: N | Top: X (n)" line under each PDF chart; buildInsights adds
  needs-attention completeness lines; KPIS.pendingActions. Days-Open link-up (caseAgeDays/cellValue
  virtual days_open column, avgDaysOpen/avgCaseDuration KPIs, caseAge chart).
- **One create/edit form**: AccidentDetailModal's three hidden update paths removed; an Edit Incident
  action routes (navigate('/accidents',{state:{editId}})) into the SINGLE inline form in Accidents.jsx
  which carries every field. All option vocabularies consolidated into `src/lib/accidentVocab.js`
  (canon*/toDb* + all *_OPTS; two competing current_status lists merged into WORKFLOW_STAGE_OPTS).
- **Clean filenames**: `reportFileName(...parts)`/`reportDateLabel()` in exportUtils.js (regex
  /[^A-Za-z0-9 ()]+/g -> space) produce space-joined names with NO _ - -- ('TyrePulse Accident Report
  14 Jul 2026.pdf'); used by accidentReportPdf, ScheduledReports, AccidentReportBuilder, Accidents
  analytics PDF, and the internal exportUtils savers.
- **claimsAnalytics delayedDetail**: overdueDays() + analyzeClaims().delayedDetail (valueAtRisk,
  avg/max overdue, 1-7/8-30/31+ buckets, byInsurer, worst-10); ClaimsSummary Delay Intelligence section.
- Edge fn `send-scheduled-reports` **v13**: Send Now + asciiSafe (dash-free e-mails). Analytics tab has
  a Download Analytics PDF (<=2 pages, KPI strip + chart digests).

## Scheduled report e-mails + Send Now (2026-07-14)
- **Why e-mails "stopped"**: pipeline was healthy (pg_cron job 1 every 15 min, Resend fine) - all 5
  schedules were simply PAUSED (active=false) since 07-11. Reactivated via SQL (next_run_at NULL =>
  sends on next tick). One historical Resend 429 (2 req/s limit) => cron loop now paces sends 650ms.
- **Edge fn `send-scheduled-reports` v13 (ACTIVE)**: dual-mode - (a) cron via x-cron-secret as before;
  (b) on-demand "Send now": authenticated POST {schedule_id}, role gate Admin/Manager/Director,
  schedule fetched via the CALLER's RLS client (org/country isolation inherited), sends e-mail,
  bumps last_sent_at only (never next_run_at/active), logs `<name> (send now)` to report_send_log.
  CORS helpers inlined from _shared/auth.ts (single-file MCP deploy). Frontend: Send icon button on
  every ScheduleCard -> supabase.functions.invoke('send-scheduled-reports', {body:{schedule_id}}).
- **RULE - NO dash punctuation in report output** (user preference): em/en dashes, middle dots,
  arrows and curly quotes are banned from e-mails/PDF/Excel. Empty values render "N/A" (not a dash),
  ranges use "0 to 30d", separators ":" or "|". Edge fn sanitizes subject+html via asciiSafe();
  frontend cleaned in accidentReport(.Pdf).js, exportUtils.js, scheduledReports.js, ScheduledReports.jsx,
  AccidentReportBuilder.jsx. Keep new report strings ASCII-only.

## Status (2026-07-13)
- 88 modules ported from fleet_IQ/tyre_saas (batches 1–19). Migrations V127–V206.
- Full security remediation applied (V202) + Holding Company (V201) + SSO last-mile (Login signInWithSSO).
- Enterprise phases landed additively: §5 Master Access Control, §6 Approval Delegations (V203),
  §7 Admin Console `/admin`, §11 Notification Preferences (V204), §12 AI Administration (V205),
  §3 P1 Organization Hierarchy (V206). All wired + tested; 3018+ tests green.
- Vercel deploys green (root cause of prior ERROR: a non-schema `_comment` key in `vercel.json` header — never add keys other than key/value to header entries).
- Branch: `claude/port-fleetiq-tyresaas` → merged to `main` per batch.

### Canonical enterprise-phase surfaces — DO NOT duplicate
- **§12 AI Administration** = `src/pages/AiAdministration.jsx` (/ai-administration, Admin + `ai_tools` flag).
  Tables `ai_models`/`ai_prompts`/`ai_budgets`/`ai_feedback` (V205) are admin CONFIG/audit only —
  they do NOT change runtime AI; edge fns keep authoritative fallbacks. Usage still from
  `ai_token_logs`/`ai_usage_log` (do NOT add a 3rd usage table; converging those two is a later item).
- **§3 Organization Hierarchy** = `src/pages/OrgHierarchy.jsx` (/org-hierarchy, Admin/Manager/Director).
  `org_units` (self-FK tree) + `user_org_assignments` (V206). P1 = tables+tree UI. **P2 (done)** =
  members/assignments UI in the SAME page (select a unit → assign users, role-at-unit, primary,
  effective window; counts on tree/table). Assignment CRUD lives in `src/lib/api/orgUnits.js`;
  active-window logic is `assignmentsActive()` in `src/lib/orgUnits.js`. **P3 groundwork (done)** =
  pure scope resolver `effectiveUnitIdsForUser()` + `coverageByUser()` (assigned unit + all
  descendants, active-window aware) in `src/lib/orgUnits.js`, surfaced as a read-only "User coverage"
  card in the page. NO RLS/DB change yet. Do NOT add `org_unit_id` to operational tables and do NOT
  enforce location-scoped RLS until the remaining §3 P3–P4 opt-in, default-open step.

## Mobile inspector app — recent additions (do NOT duplicate)
- **Checklist approval + signature** (V212): drawn signatures (`mobile/components/SignaturePad.tsx`
  emits self-contained SVG; `SignatureView.tsx` renders it) + supervisor approval queue
  (`app/(app)/checklists/approvals/*`), offline-safe via `CHECKLIST_APPROVAL` queue command; RLS
  gates UPDATE to Admin/Manager/Director/Maintenance Supervisor.
- **`profiles.country` is `text[]` (V114), NOT scalar.** Mobile normalises it to a single scalar via
  `normaliseCountry()` in `lib/types.ts` (applied in AuthContext). NEVER feed the raw array into a
  PostgREST `country.eq.${...}` filter or stamp it on a text column — empty→"" hid all assets; multi→
  broken filter. V114 RESTRICTIVE RLS is the authoritative country boundary; client filters are a
  redundant convenience only.
- **Forgiving asset scan**: `lib/assetLookup.ts` (`extractScanCode` unwraps URL/JSON/paren payloads;
  `lookupAssetByCode` = exact→ilike asset_no→fleet_number). Scanner + inspection preselect use it.
- **Daily Meter Log** (V213) = `app/(app)/meter-logs.tsx` + `lib/meterLogs.ts` + `ODOMETER_LOG`/
  `ENGINE_HOURS_LOG` queue commands. Drivers photograph the gauge + enter km/hours for no-telematics
  fleets (Egypt). REUSES existing `odometer_logs` (V162) / `engine_hours_logs` (V161) — do NOT make new
  tables. V213 added `photos`/`client_uuid` to both + a SECURITY-DEFINER trigger
  `sync_asset_current_km` on odometer_logs that advances `vehicle_fleet.current_km` (monotonic,
  org-scoped) from ANY odometer source. Migrations now through **V213**; next free is **V214**.

## Mobile navigation + roles (2026-07-13, minimal role-first redesign)
- **Bottom tab bar = max 5, primary-flagged.** `TAB_BAR` in `mobile/lib/permissions.ts` carries a
  `primary` flag; `_layout.tsx` renders only `primary && visible` tabs (`href: null` otherwise). Primary
  set: Home, Inspect, Records, Accidents, Profile — plus a **driver-only** Meter Log tab. Everything else
  (Work Orders, Analytics, Reports, Fleet AI, Admin) is reached from the Home quick-actions hub, NOT the bar.
  RULE: any screen file under `app/(app)/` that is neither a `primary` tab nor declared `<Tabs.Screen href:null>`
  LEAKS as a stray/broken auto-tab — always declare new screens `href:null` in `_layout.tsx`.
- **New `driver` role** (UserRole + `normaliseRole` in `lib/types.ts`): Home, Profile, Meter Log only. Home
  CTA + scan shortcut are gated to `canInspect` so Driver/Reporter get a clean Home. To assign it, a `driver`
  role must also be added to the WEB role pickers (follow-up).
- **Per-role access (permissions.ts)**: Inspector = New Inspection, Scan, Serial Search, Checklists, Stock
  count, Accidents (file+review). Tyre Man = New Inspection, Scan, Serial Search, Checklists (no accidents/
  stock). `canReportAccident`/`canCountStock` re-scoped accordingly; manager/director/reporter kept working.
- **New `serial-search.tsx`** screen — find a tyre by serial (reuses `lookupTyreBySerial`), links into inspection.

## ACTIVE INITIATIVE (2026-07-13): Module-depth remediation
User feedback: the modules ported from fleet_IQ/tyre_saas are "normal data only without the deep
modules" — my Supabase re-implementations flattened the rich logic that lived in the originals'
**Python backends** (`tyre_saas/backend/{routes,services}`, `fleet_IQ/backend`). Task: deepen ALL
ported modules to match their originals, module-by-module, merged in verified batches. §3 P3–P4 RLS
work is ON HOLD until this is done.
- **Source of truth (depth reference)** — original apps re-cloned (public) at:
  `…/scratchpad/fleet_IQ` (frontend/src/pages, 73 pages; Python backend) and
  `…/scratchpad/tyre_saas` (frontend/src/pages, 102 pages; Python backend). NOTE: different stack
  (React frontend + Python/FastAPI backend), so depth ≠ line count — the analytics live in backend
  routes/services. Re-clone from github.com/ws123na-afk/{fleet_IQ,tyre_saas} if the scratchpad is gone.
- **Process**: per module → gap-analysis (read original page + its backend routes/services + my port)
  → rebuild port to full depth wired to Tyre Pulse Supabase (HONEST data/empty states, NO fabrication),
  Tyre Pulse conventions (VERIFY every lucide icon via `node -e` before import — see the Lock outage;
  correct export signatures; org-RLS; safeHref) → `vite build` + tests → commit → batch-merge to main.
- **Batch 1 status**:
  - ✅ **TyrePassport** DONE (commit 593bbbd) — health-score engine + wear intelligence + wear curve +
    positions/km + stats + tabs, on real tyre_records with honest "no data" degradation. Engines +
    13 tests in src/lib/tyrePassport.js.
  - ✅ **RotationOptimizer** DONE (commit b997bb4) — CV wear-balance score, impact-scored swaps
    (1.5mm gate, size guard, 10000 km/mm benefit), violations (below-1.6mm exact + steer heuristic),
    deterministic narrative, chart.js Bar. Engine + 34 tests in src/lib/rotationOptimizer.js.
  - ✅ **TechnicianScorecard** DONE (commit 46a2255, V207) — skills matrix + cert-expiry +
    lifecycle score; existing leaderboard kept as tab 1. Engine in src/lib/technicianScorecard.js.
  - ✅ **FitmentValidation** DONE (commit 2330e25, V208) — validateFitment engine (size/tread/
    lifecycle enforced; age/retread/pair honestly "not evaluated" — no source data). Rules CRUD +
    validations ledger + existing size-audit kept as a tab. src/lib/fitmentValidation.js.
  - ✅ **TyrePool** DONE (commit e981088, V209) — hot-spare pool manager (add/deploy/return,
    utilisation, replenishment) + existing analytics kept as a tab. Transfers stay in TyreExchange.
- **BATCH 1 COMPLETE** (5 modules). Migrations V207/V208/V209 applied.
- **BATCH 2 COMPLETE** (5 modules): FleetRiskScore (per-tyre safety engine, 5956a83),
  TCO (real Fleet Actuals engine, 64cb027), RoiCalculator (net-series fix, 112b34b),
  CarbonTracker (lifecycle ESG + V210 carbon_offsets/carbon_initiatives, b085a35),
  OpsIntelligence (Fleet Health Pulse + anomaly feed + financial, 3d18ccd).
- **BATCH 3 COMPLETE** (3 modules): Combinations (combined-unit CPK rollup, f8749b8),
  HeatIntelligence (GCC blowout-risk + Gay-Lussac, 728c89f), DriverSafety (weighted score +
  driver↔tyre correlation, 5d1a2e0).
- **Migrations applied through V210.** Next free is **V211**.
- **13 modules deepened total** (5+5+3). All wired to real data with HONEST degradation.
  KEY LEARNING: several originals FABRICATE data (driver `_hash_pct` synthetic trends, heat
  daily-exposure hash, correlation synthesis) — these were deliberately NOT ported; honest empty
  states used instead (no-mock-data rule). Full suite 3290 green after batch 3.
- **REMEDIATION ESSENTIALLY COMPLETE**: the remaining ported pages are already LARGER/deeper than
  their originals (VendorIntelligence 1684, PressureIntelligence 1367, StockReplenishment 1375,
  WarrantyTracker 1426, RetreadManagement 1640, InspectionIntelligence 1183, PredictiveMaintenance
  1121, PositionIntelligence 1121, CostCenter 1164, FuelEfficiency 1338, DriverManagement 951) —
  deepening them would be invention, not restoration. Do NOT manufacture work there. Only revisit a
  module if the USER points at a specific screen that still feels thin.
- **§3 P3–P4 location-scoped RLS remains ON HOLD** (user paused it before remediation).

## Open items needing USER/OPS action
- Register SAML/OIDC providers in Supabase Auth (Management API) per SSO-config domain.
- Rotate anon key out of historical migrations V61/V98/V119.
- Move mobile publishable key/DSN to EAS secrets. Redeploy remaining edge fns for CORS allowlist.
- Nav: 8 orphaned pages surfaced + Engineering KPI/KPI Command surfaced (done). Master Access Control unified (§5 done).
- Admin Console hub `/admin` = §7 landing (searchable grouped links to existing admin pages; live user/company counts). `src/pages/AdminConsole.jsx`.
- Remaining enterprise phases (large, do deliberately not silently — touch live data):
  §3 P3–P4 (unit-scope resolver → opt-in location RLS → wire approvals+notifications; P2 assignments UI done),
  §9 Data Intake Centre deepening, generalizing the notification bus to honor `notification_preferences`,
  `ai_permissions` enforcement, converging `ai_token_logs`/`ai_usage_log`.
- Nav labels render via t(`nav.items.<route>`) with fallback to item.label; add en+ar keys for new items.

## Admin-control + reporting + accident batch (2026-07-14, this session)
Branch `claude/accident-builder-report-ui-2bkwb5`. All build-clean; new tests green.

### AI operations visibility + error safety (Migrations V236, V237)
- **V236**: `ai_token_logs` gains `status`/`error`/`http_status`/`latency_ms` (CHECK status in
  success/error/rate_limited/blocked) so FAILED AI requests are real; seeds `ai_models` pricing
  (USD per 1M) for all 4 orgs as the SINGLE pricing source (haiku default). **V237**: admin-scoped
  SELECT policy on `report_send_log`.
- Edge fns `chat-ai` + `ai-orchestrator` now log failures (rate-limit/missing-key/upstream/fatal)
  best-effort into ai_token_logs; both REDEPLOYED (chat-ai v16, ai-orchestrator v3). Files deploy as
  `_shared/auth.ts` + `source/index.ts`.
- **Single reader `src/lib/api/aiOps.js`** (getUsageOverview/summarizeUsage/listJobRuns/summarizeJobs/
  getModelPricing/estimateRowCost) powers: AiAdministration NEW tabs **Operations** (usage/spend/model+
  feature breakdown/failed requests) and **Delivery & Jobs** (report_send_log history+failures), the
  ScheduledReports per-schedule delivery-status + history panel, and AiCostMonitor (now reads ai_models
  pricing, added Cost-by-Model). Do NOT re-query these tables elsewhere — reuse aiOps.
- **ErrorBoundary** no longer leaks message/stack to users (dev-only) and shows a copyable reference ID;
  `captureError` returns the Sentry event id. 18 pages routed through `safeError.toUserMessage`.

### Severity/fault/defect/VOR single source — `src/lib/severity.js`
- Canonical operational ladder Critical>High>Medium>Low(+Info); `normalizeSeverity` folds all ~25
  variants (case/synonyms/1-5/Minor-Major-Total Loss); rank/sort/badge/colour helpers;
  `severityFromAccidentDamage` bridge; first-class **VOR** (isVehicleOffRoad, honest — never inferred
  from severity). Adopted in InspectionPlanner/FleetHealthBoard/AssetDetail ranking. `notifications.js`
  keeps its inverted display-order helper intentionally. Display palettes adopt incrementally.

### Reports / dashboards / TV
- **ExecutiveReport**: white "Report view" toggle (class-scoped var overrides, dark stays default) +
  WYSIWYG PDF and NEW PPTX embedding on-screen KPI cards + charts (chartCapture.paperChartOptions keeps
  screen==export). accidentReportPptx untouched.
- **ReportBuilder**: chart output (Bar/Line/Pie/HBar) of grouped aggregates, persisted in saved-report
  config, embedded in PDF (exportToPdf gained optional leadImage). Pure `buildReportChartData`.
- **DashboardBuilder**: global date/site/country filters drive all widgets (per-table application,
  widgets ignore unsupported filters), persisted per layout. Pure `resolveDashboardFilters`.
- **DisplayDashboard** (TV/kiosk): 4 new boards (Open Job Cards, Tyre Replacements, Accidents,
  Approvals) via pure `displayBoard.js` shapers; real RLS-scoped data, honest empty states.

### Navigation + data intake
- `src/components/ui/Breadcrumbs.jsx` + global Back button in Layout shell (derived from NAV_GROUPS).
- Bulk/CSV upload REMOVED from Accidents/FleetMaster/TyreSpecifications inline; each now redirects to
  the Data Intake Center (single home). SerialTracker lookup + ChecklistBuilder template import kept.

### Easy Access Manager (every module + sub-module) — NO schema change
- `moduleCatalog.js` gains `SUBMODULES` + `FULL_REGISTRY` (composite `parent:child` keys for the tabs
  of accidents/ai/user-management/reports/fleet-master/analytics/work-orders). New
  **`src/console/pages/access/AccessManager.jsx`** = the easy one-screen editor (FIRST tab in
  ConsoleAccessControl): pick role OR user, searchable tree group>module>sub-module, big View ON/OFF +
  Advanced caps disclosure, presets (No/Viewer/Editor/Manager/Full), per-group bulk, per-user
  reset-to-role-default, live Effective preview. Role view -> set_module_permissions(+overrides);
  per-user -> user_access_grants (composite keys, module_key is free text). HONEST: only base-module
  View is server-enforced; sub-modules + non-view caps are STORED for progressive enforcement (labeled).

### Accidents cleanup (no schema change)
- Register table trimmed to Date/Asset/Site/Severity/Status/Days Open/Cost/Actions (extras live on the
  `/accidents/:id` detail page); duplicate Delayed badge removed; empty=N/A; one date formatter. Pills
  unified into `accidentVocab.accidentSeverityPill/accidentStatusPill` (via severity.js); duplicated
  SEVERITY_BADGE/STATUS_BADGE deleted in Accidents.jsx + AccidentDetailModal (fixes list-vs-detail
  colour drift). Form: Incident section header, 3-up grids, merged duplicate action fields, controlled
  selects (existing values preserved). Correctness: export net cost via single claimsAnalytics engine;
  Avg Days to Close = incident_date to release_date over closed cases; closed-no-release stops growing
  (N/A); shadowed hasClaim removed; GCC/fault/najm/repair/damage canonicalized on save.

### AI data access rule (user question, 2026-07-14)
- The copilot uses DIRECT DB tools (count_records/get_exec_digest/list_recent_events) for operational
  data (vehicles/tyres/accidents/KPIs) — NOT RAG. RAG (`search_knowledge_base` embeddings) is used ONLY
  for free-text documents (SOPs/manuals/policies/PDFs) with no structured table. Structured-first,
  RAG-for-documents. Keep this split.

### Next free migration = V238. Still open (need migrations, do deliberately)
- Single accident WORKFLOW pipeline (report>repair>insurance>release>closure) unifying the two status
  columns; Asset Master merge FleetMaster+AssetManagement + enrich (plate/asset code/type/category/VIN/
  site/dept/odometer+hour meter/tyre setup/maintenance plan/conditional-by-type); full KPI-formula
  centralization through kpiEngine (~30 inline sites); secure share-links for saved reports/dashboards;
  duplicate-module consolidation (claims/incidents/RCA/KPI clusters).

## Super-Admin control center - rules enforced + preview/override (2026-07-14)
- **V241** extends capability enforcement (permissive app_user_can create/edit/delete) from the 3-table
  V238 pilot to 8 more core tables: accidents(accidents), vehicle_fleet(fleet_master), stock_records(stock),
  gate_passes(gate_pass), budgets(budgets), corrective_actions(corrective_actions), alerts(alerts),
  rca_records(rca). So per-role/per-user create/edit/delete RULES now govern 11 tables (additive/safe).
- **V242** status-change governance: `app_cap_revoked(key,cap)` (false for admin/super) + BEFORE UPDATE
  trigger `enforce_status_change_capability(module_key)` on accidents + work_orders blocks a STATUS change
  only when the user is explicitly REVOKED 'approve' for that module. Nobody blocked by default (safe).
- **Preview & Override** = `src/console/pages/access/AccessPreviewOverride.jsx` (/console/access?tab=preview):
  pick a role OR user, see their module access + reason, and Allow/Deny/Clear each module inline (user ->
  setUserAccessGrant grant/revoke; role -> saveModulePermissions). Admin/super locked. Next free **V243**.
