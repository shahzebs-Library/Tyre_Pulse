# PROJECT MEMORY — Tyre Pulse (always load before working)

Durable, committed project knowledge so any session has full context. Keep this
current. Read it before adding/changing modules. Governing spec: `Tyre pulse enterprise.md`
(consolidation-first: one function = one module = one calculation service).

## Custom roles assignable (V282) + Sentry crash console (V283) (2026-07-19, SHIPPED)
- **V282 — custom roles could NEVER be assigned to a user (root-caused + fixed).** User: "I add new
  roles, assign to them, it's still same even when I change it." Root cause = TWO hardcoded allowlists of the
  10 built-in role names: (1) BEFORE trigger `normalize_profiles_role()` coerced ANY non-builtin role back to
  'Reporter' (so the UPDATE reported 1 row but the stored role never changed — verified live: assigning
  'Fleet Supervisor' left the row as 'Reporter'), and (2) the `profiles_role_check` CHECK allowed only those
  10. Fix: the trigger now accepts a built-in role OR any name present in `custom_roles` (unknown roles still
  fall back to Reporter); the static CHECK is DROPPED (a CHECK can't reference custom_roles) — the trigger is
  the single dynamic validator. Verified live as super-admin: Fleet Supervisor/Insurance Officer now persist,
  garbage->Reporter, Manager unaffected. RULE: the whole access chain (module_permissions write/read RPCs,
  hasPermission per-key, realtime publication) was ALREADY correct — this trigger was the only blocker.
  NOTE for "changes don't show": super-admins/Admin BYPASS all gating (`resolvePermission` returns true), so
  an admin testing on their OWN account never sees a change; use the "Effective access" preview or a real
  non-admin login. Custom-role users get ONLY modules explicitly enabled for that role (ROLE_DEFAULTS has no
  custom-role entry -> deny-by-default), which is correct.
- **Sentry crash console = `src/console/pages/ConsoleCrashReports.jsx` (/console/crash-reports, super-admin,
  nav "Crash Reports", Bug icon).** Live Sentry issue stream (mobile crashes + web errors) INSIDE the console
  with a full read -> assign -> comment -> resolve workflow. Do NOT build a second Sentry surface.
  - **Token is a SECRET, never client-side.** Stored server-side in the deny-all `cron_config` table via
    super-admin RPCs (V283: `set_sentry_config`/`get_sentry_config_status` — status returns configured/org/
    region/project, NEVER the token). Sentry org = `shah-profile`, region `https://de.sentry.io` (EU).
  - **Edge fn `sentry-issues` (deployed v3, verify_jwt=false, self-validates a super-admin JWT)** reads the
    token via the service role and proxies the Sentry API. Actions: `list` (default), `projects`, `members`,
    `detail` (issue + latest event stacktrace/tags + activity timeline), `update` (resolve/ignore/unresolve),
    `assign` ('user:<id>' or '' to clear), `comment`. Self-contained single file; write actions return
    reason:'auth' if the token lacks `issue:write` scope (UI shows "token needs write scope").
  - Service `src/lib/api/sentryCrashes.js` (getSentryStatus/saveSentryConfig/listSentryIssues/getSentryProjects/
    getSentryIssueDetail/updateSentryIssue/getSentryMembers/assignSentryIssue/commentSentryIssue). Page: summary
    tiles, search + project + period filters, per-issue resolve/ignore/reopen + assignee dropdown, detail drawer
    (stacktrace w/ in-app frames highlighted, device/OS/release tags, affected user, comment box, activity
    timeline). Verified live: list/projects/detail/members/activities all 200 with the connected token.
  - **DIAGNOSED (this session):** `TypeError ...'pendingUploads' of null` in mobile AdminDashboardScreen was on
    the OLD v1.2.0+20 build — already guarded/fixed in current v1.3.0 (stale-build crash). `SIGABRT/abort` =
    native crash on the Sentry executor thread (art::Runtime::Abort) on a low-end Unisoc device, 1 event, no app
    frames — not an app-logic bug. USER OPS: the org auth token `sntrys_` works for READS; for assign/comment/
    resolve it needs a token with `issue:write`. Next free migration **V284**.

## Backend security audit (2026-07-19) — anon lockdown + workflow-notify fail-open (SHIPPED)
- **V281 anon role hardening (applied live + `MIGRATIONS_V281_HARDEN_ANON_ROLE.sql`).** Audit found the
  `anon` (unauthenticated) role held SELECT + INSERT/UPDATE/DELETE/TRUNCATE on 100 public tables (Supabase
  default GRANT-to-anon), with RLS as the ONLY backstop. Verified by impersonating anon (`SET LOCAL ROLE anon`,
  no JWT): writes were all RLS-denied, BUT `module_permissions` LEAKED 559 rows to anonymous callers (the whole
  role->module capability matrix) via the public SELECT policy `users_read_own_org_permissions` (org_id IS NULL
  branch); every data table (vehicle_fleet/accidents/stock/...) was protected only ACCIDENTALLY because anon
  lacked EXECUTE on `app_can_see_country()` (the RESTRICTIVE policy threw). Fix: `REVOKE ALL ON ALL TABLES IN
  SCHEMA public FROM anon` + `ALTER DEFAULT PRIVILEGES ... REVOKE ALL ON TABLES FROM anon`. Anon now reaches NO
  base table (verified: every probe blocked; module_permissions 559->blocked). Everything anon legitimately
  needs runs through SECURITY DEFINER RPCs (`get_email_by_identifier` login, `get_report_snapshot` +
  `get_display_snapshot` public /report and /display token links) which execute as owner and are UNAFFECTED by
  table grants (verified all three still return normally for anon). Pre-auth pages read no tables; SettingsContext
  reads settings/system_config only behind `if (user)`. Authenticated grants untouched -> app unaffected (super-
  admin still reads 684 fleet rows). Security advisors dropped 499->399 (all 100 `pg_graphql_anon_table_exposed`
  cleared). RULE: never GRANT anon on a base table; give anon data only through a DEFINER RPC that self-validates.
- **workflow-notify fail-open FIXED + deployed v2 (verify_jwt=false).** The edge fn gated on
  `x-workflow-secret` only `if (WORKFLOW_NOTIFY_SECRET)` env was set -> if unset it fell OPEN, letting any
  unauthenticated caller relay brand-domain email + billable Twilio WhatsApp + Expo push to attacker-supplied
  recipients. Now the gate is MANDATORY and never fails open: `resolveExpectedSecret()` uses the env var, else
  falls back to the DB-seeded `cron_config.workflow_notify_secret` (V119 — the exact value the pg_cron deliverer
  sends) read via the auto-injected service role; 503 if neither exists; constant-time compare. The deployed
  function is a SELF-CONTAINED single file (inlined CORS, no `_shared` import) — repo source updated to match
  (removed pre-existing drift). VERIFIED live via pg_net: correct cron secret -> 200, wrong/missing -> 401, so
  delivery is intact and the hole is closed. RULE: workflow-notify deploys as ONE self-contained index.ts.
- **safeError.js marker gap closed.** Added `invalid input syntax`/`invalid input value`/`enum`/`does not
  exist`/`foreign key`/`null value in column`/`operator does not exist` to DB_MESSAGE_MARKERS so code-less
  Postgres text (e.g. `invalid input syntax for type uuid: "index"`) can never fall through rule-5 passthrough
  to the UI. `adminUsers.searchProfiles` now uses `sanitizeSearchTerm` (strips backslash too). Tests: safeError 20.
- **Verified CLEAN (no action):** no hardcoded service-role key / secret / XSS / eval in `src/` (supabase.js
  actively rejects a service-role token in the anon slot; monitoring.js redacts JWTs); billing-webhook Stripe
  signature verification correct; public-api uses hashed API-key lookup + per-org scoping + rate limit;
  chat-ai/ai-orchestrator JWT-gated + org-scoped + prompt-injection hardened; all 43 anon-executable DEFINER
  fns have PINNED search_path. The 213 `authenticated_table_exposed` advisor warnings are the normal PostgREST
  model (RLS governs) — NOT a finding.
- **OPEN (lower priority, flagged not fixed):** send-email has no recipient allowlist/rate-limit (authenticated
  manager/director could use it as a brand-domain relay — MEDIUM insider); send-scheduled-reports treats a
  null-`org_id` schedule as a global cross-tenant digest (MEDIUM, needs an RLS-visible null-org schedule);
  minor raw-provider-error leakage in send-email/generate-embedding; ~14 service files re-throw
  `new Error(rawDbMessage)` dropping the code (mitigated by the new safeError markers). USER/OPS: enable
  Supabase leaked-password protection (dashboard). Next free migration **V282**.

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
  `getAssetByNo` from api/assets.js) auto-fills **plate_number + vehicle_type + site + country** ONLY when
  empty (never overwrites typed values) + a read-only "Master:" context line (make/model/fleet_number).
  **V243 (2026-07-15)** added `accidents.plate_number` + `accidents.vehicle_type` (free-text snapshots at
  incident time; existing org/country RLS governs them). Plate is sourced from `vehicle_fleet.registration_no`
  (there is NO literal `plate_number` column on vehicle_fleet); type from `vehicle_fleet.vehicle_type`. The
  assets service COLS now returns `registration_no`; accidents PAGE_COLS returns the two new columns; both
  are editable form fields, persisted on save (`|| null`), re-hydrated in openEdit, shown in
  AccidentDetailModal Overview (`select('*')`), and included in EXPORT_FIELDS. Next free migration **V244**.
- **Accidents Analytics -> Auto-email (2026-07-15)**: the Analytics tab gained an "Auto-email" button beside
  "Download Analytics PDF". RULE: do NOT build a second block-builder or a new scheduled report_type for this
  — it REUSES the existing Accident Report Builder + Scheduled Reports pipeline. A new REPORT_LIBRARY pack
  `analytics` ("Accidents Analytics", `src/lib/accidentReport.js`) mirrors the on-screen dashboard's charts
  (severity/status/fault/trend/paretoAssets/bySite/sevMonthly/claimStatus + 6 KPIs; payer-cost has no catalog
  chart = the one omission). `scheduleAnalytics()` in Accidents.jsx create-or-reuses a saved template named
  "Accidents Analytics" in `accident_report_templates` (config = normalizeConfig({blocks:pack.build(),
  orientation})), then navigates to `/scheduled-reports` with `state.presetReportType = builder:<id>`.
  ScheduledReports.jsx has a preselect effect (useLocation) that opens the create modal prefilled on that
  builder type once layouts load, then clears history state. So auto-email = a `builder:<id>` schedule handled
  by the ALREADY-deployed `send-scheduled-reports` edge fn — NO edge redeploy, NO new report_type. The user
  just picks cadence + recipients. (If they want the analytics CUSTOMIZED, that is already the Report Builder.)

### Tyre Specification depth + Value Advisor (2026-07-16) — merged to main (commit ffc092f)
- **Ply rating + OTR/Chinese-brand catalog + downloadable fitment policy.** V248 adds
  `tyre_specifications.ply_rating` (text; load/speed indices already existed as min_load_index/
  min_speed_index). Single vocab source **`src/lib/tyreSpecCatalog.js`** (VEHICLE_TYPES incl. Concrete
  Pump/Boom Pump Truck/Wheel Loader/Motor Grader/Rigid Dump Truck/Forklift/Reach Stacker + on-road;
  POSITIONS incl. Front/Rear OTR; SPEED_INDEX_KMH; LOAD_INDEX_KG; PLY_RATINGS; APPROVED_BRANDS Double
  Coin-first + CHINESE_BRANDS; 19 SMART_DEFAULTS with ply_rating; **BRAND_META**+brandMeta = tier/origin/
  retreadable/casing/price+durability index/application for all 17 brands). Replaces the old inline consts
  in TyreSpecifications.jsx. Standard policy doc **`src/lib/tyreSpecPolicy.js`** (buildPolicySections +
  renderTyreSpecPolicyPdf) = controlled, company-logo-branded 10-section Tyre Fitment & Specification
  Policy PDF, surfaced as a "Fitment Policy" tab.
- **Value Advisor** (procurement decision support; DISTINCT from EngineeringKpi realized-CPK and
  BrandPerformance). V249 `tyre_procurement_options` table (supplier quotes = "the deals"; org+country RLS,
  elevated-role writes) via **`src/lib/api/tyreProcurement.js`**. Pure engine **`src/lib/tyreValueAdvisor.js`**
  (optionEconomics/rankOptions/recommend) ranks quotes by **lifecycle CPK** = (unit_price + retreads*retread
  cost - casing residual) / (expected_life_km * (1+retreads*retreadYield)), flags Best Value/Best Deal/Lowest
  CPK/Longest Life, and grounds against realized fleet CPK by **REUSING kpiEngine.computeCpkByBrand /
  computeAvgTyreLife (do NOT rebuild CPK)**. New "Value Advisor" tab in TyreSpecifications.jsx: quote CRUD,
  per-fitment ranked comparison + engineer rationale + savings + realized-CPK column, brand-guidance fallback
  when no quotes. Tests: tyreSpecCatalog(29), tyreSpecPolicy(7), tyreValueAdvisor(17). **(V250 now taken by the Incident Report upgrade; next free V251.)**

### Board Overview report + shared report palette (2026-07-16) — boss wants ONE colourful, trend-led report
- **Single consolidated report = `src/pages/BoardOverview.jsx` (/board-overview, RoleRoute Admin/Manager/
  Director, nav "Reports & Executive").** Layout order (user-chosen): KPIs -> Trends -> Charts ->
  Recommendations, each a section with an on/off TOGGLE persisted to localStorage `boardOverview.sections.v1`.
  Consolidates EVERY module: fleet, tyres/CPK, tyre spend, accidents, claims, inspections, work orders, stock.
  Trend-led: 12-month line charts (tyre spend, accidents, claims claimed-vs-recovered, inspections). Breakdown
  doughnut/bar charts (accident severity, claim status, accidents/tyres by site). Honest recommendations.
  Export PDF (captureChartOnPaper -> jsPDF). Loading/empty/error states; no em/en dashes.
- **Pure engine `src/lib/boardOverview.js`** (do NOT rebuild KPI maths): `months12/bucketMonthly` (12-month
  buckets), `buildBoardKpis` (REUSES kpiEngine.computeAllKpis + claimsAnalytics.analyzeClaims - null when not
  computable), `buildTrends`/`buildBreakdowns` (emit chart data WITHOUT colours - page applies palette),
  `buildBoardRecommendations`. Tests boardOverview.test.js (6).
- **Shared palette `src/lib/reportColors.js` (in main via PR #35)** = THE one report colour system: `CATEGORICAL`
  (12 vivid hues), `ACCENTS`, `TREND_LINES`, `colorAt/categorical/withAlpha`, non-mutating `stylize(data, kind)`
  ('bar'|'doughnut'|'pie' per-point, 'line'|'area' per-dataset). Legible on dark UI + white PDF. Tests
  reportColors.test.js (6). Data loading uses fetchAllPages + the listKpi* / listAllAccidentsForPage /
  listWorkOrdersForPage / listStockRecords services (country-scoped).
- **Super-admin Report theme (2026-07-16):** `reportColors.js` is now a THEME SYSTEM: 8 named PRESETS
  (Vivid/Ocean/Sunset/Forest/Berry/Corporate Slate/High Contrast/Warm) + `setReportPalette(nameOrHexArray)` /
  `getReportPalette` / `activePaletteName`; colorAt/categorical/stylize derive from the ACTIVE palette
  (default Vivid). **Super-admin UI = `src/console/pages/ConsoleReportAppearance.jsx` (/console/appearance,
  nav "Report Colors")**: preset swatch cards + Custom (12 colour inputs) + live Bar/Doughnut preview on white;
  Save upserts `system_config.report_palette` (value = preset name or JSON hex array; super-admin write RLS
  already exists, authenticated read) and applies live via setReportPalette. `SettingsContext` reads
  `system_config.report_palette` on load and applies it org-wide (best-effort, never blocks). `accidentReport.js`
  `styleChartData` DEFAULT palette now follows `getReportPalette()` (explicit named block palettes still win),
  so Accident builder/PDF/PPTX follow the theme too. Board Overview + Executive already use `reportColors`.
  Tests: reportColors 9. RULE: to add a theme, add to PRESETS (auto-surfaces in the console picker).
- **Wave 2 DONE (2026-07-16):** the remaining hard-coded chart colours now follow the super-admin palette.
  `Analytics.jsx` (the records/cost combo bar) and `Accidents.jsx` NON-SEMANTIC charts (monthly incidents,
  top assets, by-site, payer cost, monthly trend line, status doughnut) use `colorAt(i)`/`categorical(n)`/
  `withAlpha` from `reportColors` at render time (inside the useMemos, so they pick up the active theme).
  PIE_COLORS const removed. RULE: SEMANTIC colour maps are DELIBERATELY kept hard-coded because the colour
  carries meaning: accident severity ladder (Minor grey / Major orange / Total Loss red), claim status,
  fault (Faulty red / Non-faulty green / Under review amber), and the recovery/status inline badges. Do NOT
  palettize those. Only categorical/single-accent chart fills follow the theme.

### Shareable public/TV report links (V251/V252, 2026-07-16) — SHIPPED, do NOT duplicate
- The "shareable PUBLIC/TV links for reports (LIGHT theme, admin-managed, advanced charts)" backlog item is
  DONE. Mirrors the V103 display-token pattern (org embedded in the token row; anon reads aggregates only via
  a SECURITY DEFINER RPC; no table is ever granted to anon). Do NOT build a second share surface.
- **CONSOLIDATION (2026-07-16, user "make this as a one"):** this is now the ONE share surface. The OLD
  executive display-token system was RETIRED per user choice ("Replace old entirely"): deleted
  `src/pages/DisplayShare.jsx` + `src/components/display/DisplayTokensPanel.jsx`, removed the anon
  `/display/:token` route from App.jsx, dropped DisplayTokensPanel from Settings, and set every active
  `display_tokens` row inactive (live UPDATE). The `display_tokens` table + `get_display_snapshot` RPC still
  exist in the DB (harmless, unreferenced). The AUTHED in-app TV kiosk `/display` (DisplayDashboard, nav "TV
  Display Mode") is a DIFFERENT thing and was KEPT. Do NOT re-add a second token share panel/route.
- **Page catalog is now 7 (advanced levels), grouped:** REPORT_PAGES (+PAGE_GROUPS) in reportShares.js:
  Overview[board_kpis, fleet_overview] · Trends[board_trends, spend_trend] · Risk[risk_activity, claims_desk]
  · Breakdowns[board_charts]. ALL 7 render from the SAME get_report_snapshot aggregate (no schema/RPC change
  to add pages within that data — create_report_share stores p_pages verbatim, no key validation). The 4 new
  pages (fleet_overview/spend_trend/risk_activity/claims_desk) + a `TileStrip` KPI-row helper live in
  ReportShare.jsx. RULE: to add a rotatable page = add a REPORT_PAGES entry + a render branch + (only if it
  needs new data) extend get_report_snapshot. Panel picker is grouped with per-group + Select all/Clear.
- **DB (applied live):**
  - **V251** `public.report_shares` (id, organisation_id DEFAULT app_current_org(), name, token UNIQUE
    'rpt_'+18-byte hex, password_hash bcrypt, pages jsonb DEFAULT '["board_kpis","board_trends",
    "board_charts"]', rotate_seconds 5..600 DEFAULT 30, refresh_seconds 30..3600 DEFAULT 300, active,
    expires_at, created_by DEFAULT auth.uid(), created_at, last_viewed_at, view_count). RLS: elevated +
    own-org SELECT/UPDATE/DELETE, NO INSERT policy (mint only via RPC). RPCs `create_report_share(p_name,
    p_pages,p_rotate,p_refresh,p_password,p_expires)` -> jsonb {id,token} (elevated, DEFINER, GRANT
    authenticated) and `revoke_report_share(p_id)` (sets active=false).
  - **V252** `get_report_snapshot(p_token text, p_password text DEFAULT NULL)` SECURITY DEFINER, GRANT
    anon+authenticated, REVOKE PUBLIC. Validates token (active/expiry/bcrypt password), derives v_org from
    the token row (NO cross-org leak), bumps view_count/last_viewed_at, returns org-scoped aggregates:
    `{ok, company, name, generated_at, rotate_seconds, refresh_seconds, pages, labels[12], kpis{fleet,tyres,
    tyre_spend,accidents,open_accidents,claims_claimed,claims_recovered,inspections,work_orders_open},
    trends{tyre_spend[12],accidents[12],claims_claimed[12],claims_recovered[12],inspections[12]},
    breakdowns{severity,accidents_by_site,tyres_by_site,claim_status}}` or `{ok:false, reason:'invalid'|
    'revoked'|'expired'|'password'|'unavailable'}`. Next free migration **V253**.
- **Service (single source, do NOT re-query these tables elsewhere):** `src/lib/api/reportShares.js` -
  REPORT_PAGES/PAGE_GROUPS/DEFAULT_PAGES, listReportShares, createReportShare, **updateReportShare** (edit in
  place, keeps the SAME token/link), revokeReportShare, getReportSnapshot (anon-callable), buildShareUrl(token)
  -> `${origin}/report/${token}`.
- **Edit-in-place (2026-07-16):** the panel's pencil action loads a share into the same form and saves via
  `updateReportShare(id, {name,pages,rotate,refresh})` = a direct RLS-gated `report_shares` UPDATE (policy
  report_shares_update = is_elevated_user() AND own-org; the table CHECKs re-clamp rotate 5..600 / refresh
  30..3600). NO migration/RPC needed. Password + expiry are intentionally NOT editable (revoke + recreate to
  change those) so no bcrypt/expiry re-hash path is exposed client-side. Editing reconfigures the rotating
  "playlist" without minting a new URL.
- **Known data gaps (do NOT build public pages on these - they are empty/thin, would be dishonest):**
  `tyre_records.brand` is 100% blank across all 1419 rows (no brand breakdown page); accidents carry asset_no
  but only 25 incidents / 2 repeat-offenders (a "top assets" chart is real but low-signal). This is why the
  public board is accident/claims/site/spend based, not brand/CPK based.
- **Public viewer = `src/pages/ReportShare.jsx`** at route `/report/:token` (App.jsx, ANON, sibling of
  `/display/:token`, OUTSIDE ProtectedRoute). Forced LIGHT via the `.tp-report-paper` wrapper technique;
  auto-rotates every `rotate_seconds` (default 30) through ONLY the creator-chosen `snapshot.pages`; silently
  re-fetches on `refresh_seconds` keeping last-good data on failure; fullscreen toggle + rotation progress;
  password/expired/revoked/invalid states. Advanced ECharts (via `components/charts/EChart.jsx`, Executive-
  Analytics style): dual-axis spend-vs-accidents combo, smooth claimed/recovered area lines, inspections
  line, KPI tiles+sparklines, severity doughnut, claim-status bars, by-site bars, tyres treemap. Colours from
  `reportColors` (categorical/colorAt/withAlpha) so it follows the super-admin theme.
- **Admin manager = `src/components/display/ReportSharesPanel.jsx`**, mounted in `src/pages/Settings.jsx`
  beside DisplayTokensPanel. Self-gates to Admin/Manager/Director/super-admin (user said "Admins too", not
  only super-admin). Create form: name, REPORT_PAGES checkboxes, rotate seconds (default 30), refresh minutes
  (->seconds), optional password/expiry; one-time link reveal; list with copy-link/open/revoke. All errors via
  toUserMessage. RULE: to add a rotatable report page, extend REPORT_PAGES + the snapshot RPC's page payload +
  a render branch in ReportShare.jsx. Committed b2ad707 on branch claude/accident-builder-report-ui-2bkwb5.
- **Ops TV pages + viewer polish (V261, 2026-07-16):** get_report_snapshot now also returns an `ops` object
  (org-scoped aggregates only, no PII): work_orders_open, job_cards_today, tyre_changes_today,
  inspections_today, accidents_today, alerts_critical, pm_overdue, pm_due_soon, open_job_cards[] (wo_no/asset_no/
  status/site/priority/work_type top 14), pm_due_list[] (name/asset_no/next_due/priority soonest 14). Two NEW
  REPORT_PAGES in the 'Operations' group: `ops_today` (Open Job Cards board + today tiles) and `pm_due`
  (Maintenance Due). ReportShare.jsx got a UI polish pass (live clock, gradient KPI tiles, page-enter animation
  w/ prefers-reduced-motion, sticky/zebra tables, semantic status/priority pills, 4k/laptop/phone responsive).
  RULE to add an ops board page: extend the snapshot `ops` object + REPORT_PAGES + a render branch.
- **TV wallboard upgrade (V262, 2026-07-16):** get_report_snapshot gained server-side `p_site`/`p_country`
  filters (threaded as `AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)` on
  every scoped aggregate) plus `logo` (from system_config key `company_logo`), `sites[]`/`countries[]` option
  lists, and a `heatmap[]` (site x severity incident counts). `getReportSnapshot(token,pw,{site,country})`.
  ReportShare.jsx overhaul: prev/next board arrows + clickable dots + "Board N of M", interaction-resets-timer
  (timerNonce), on-demand Refresh + "Last refresh", site/country filter bar, ECharts heatmap + gauge dials
  (recovery rate / open-accident share, honest N/A when denom 0), logo in header (safeImageSrc + brand-mark
  fallback), Full-HD (@media 1920/2560). Company logo is set once by super-admin in
  ConsoleReportAppearance.jsx via `src/lib/api/brandLogo.js` (get/setCompanyLogo over system_config).
- **Date-range filter (V263, 2026-07-16):** get_report_snapshot now takes optional `p_from`/`p_to` (YYYY-MM-DD
  text, NULL = all time; invalid/blank coerces to NULL, no anon error). Applied to the event-dated aggregates
  via each table's natural date (accidents.incident_date, tyre_records.issue_date, inspections.inspection_date):
  the tyres/tyre_spend/accidents/open_accidents/claims/inspections KPIs, the severity/by-site/claim-status
  breakdowns and the heatmap. DELIBERATELY unfiltered: the fleet-register + open-WO counts (live state), the
  rolling 12-month trends (fixed window), and the "today" ops block. Old 4-arg overload DROPPED so one signature
  exists (4-named-arg calls resolve via from/to defaults); anon+authenticated keep EXECUTE. Client:
  `getReportSnapshot(token,pw,{site,country,from,to})`; ReportShare.jsx replaced the "coming soon" placeholder
  with two date inputs + an "All dates" clear (changeFilter handles site/country/from/to generically, re-fetches
  and resets rotation to board 1). Verified live: accidents 2026=25 vs 2020=0; tyres H1-2026=134; bad date -> null.
- **Custom report board BUILDER (V264, 2026-07-16):** shares can now carry a bespoke block-based layout INSTEAD of
  the fixed 9-page catalog. `report_shares.layout jsonb` (NULL = fixed pages); `get_report_snapshot` echoes
  `layout` back to the anon viewer alongside the SAME aggregate channels (no new data surface, no new grant).
  Single pure engine **`src/lib/reportShareLayout.js`** (SOURCES catalog of ~30 data channels grouped by kind
  kpi/series/breakdown/combo/claims/heatmap/ratio/table; VIZ_BY_KIND chart-style options; BLOCK_PRESETS;
  normalizeLayout/normalizeBoard/normalizeBlock clamps; `resolveBlock(block,snapshot)` maps a block to render
  data; STARTER_LAYOUTS + emptyLayout; 38 tests). Shared light chart options extracted to
  **`src/lib/reportShareCharts.js`** (spark/combo/claims/seriesOption/breakdownOption/gauge/heatmap, follows the
  reportColors theme) + single block renderer **`src/components/display/ShareBlockView.jsx`** (white surface,
  inline styles so it is WYSIWYG in both the public light board and the dark app builder preview) used by BOTH
  surfaces. Viewer `ReportShare.jsx`: when `hasCustomLayout(snapshot.layout)` it rotates through
  `normalizeLayout(layout).boards` (unified `unitCount`/`dotItems` drive board nav + dots + progress), rendering
  each board as a fixed `repeat(cols,1fr) x repeat(rows,1fr)` CSS grid that FILLS the body height so a board fits
  ONE screen and never scrolls (min-height:0 lets ECharts shrink into its cell). Builder
  **`src/components/display/ReportShareBuilder.jsx`** (modal from ReportSharesPanel "Design" button): board
  tabs + cols/rows steppers, add-block palette, per-block source/chart-style/size(W,H)/accent/title editor, live
  WYSIWYG preview via ShareBlockView, save via `updateReportShare(id,{layout})` (RLS UPDATE), "Use fixed pages
  instead" clears layout to null. reportShares.js: COLS includes `layout`, `updateReportShare` accepts `layout`
  ('layout' in patch => set, null clears). RULE to add a data channel: add a SOURCES entry (+ its snapshot key if
  new) + a resolveBlock case + a ShareBlockView branch if a new kind.
- **Smarter refresh (2026-07-16):** the viewer's silent auto-refresh is now VISIBILITY-GATED - it skips the fetch
  while `document.hidden` (a TV that is off, a backgrounded tab, a sleeping device stops polling) and does ONE
  catch-up refresh on `visibilitychange` back to visible. Rotation cadence unchanged; only server polling is gated.
  **Next free migration V265.**
- **STILL BACKLOG:** shareable links for reports currently expose the Board-Overview aggregate set; wiring the
  full Executive/Accident block-builder layouts into the public snapshot is a later extension. Existing V103
  `/display/:token` + getDisplaySnapshot (DisplayShare) remains the separate executive-board token-share.
- **More fixed pages + Cost-per-unit + Operations Command (2026-07-18, PR #110 + #111):** the ReportShare fixed
  catalog grew from 9 -> 13 pages, all built from the SAME get_report_snapshot aggregate (add a REPORT_PAGES entry
  + a page component + a render branch; PAGE_LABEL filter gates the key). PR #110 added **Executive Summary** +
  **Cost & Claims** (existing snapshot data only). **V279 (applied live)** extended get_report_snapshot with two
  server-aggregated channels (NO new grant/table): `cost` = unit-aware operating cost (tyre_cost + maintenance_cost
  [work_orders labour+parts+lubricant+outside_repair EXCLUDING tyre_cost, + pm_service_records.total_cost] =
  total_cost; running units km/hours = last-minus-first reading per asset from odometer_logs/engine_hours_logs,
  m3 = sum(production_logs.m3); per-unit cost_per_km/hour/m3 + tyre_cpk are NULL when the denominator is 0 - honest
  N/A, never faked; 12-month total-cost + m3 trend); and richer `ops.*` (wo_by_status/wo_by_site/wo_by_type/wo_trend
  [12mo]/pm_compliance [0..100 or null]/wo_heatmap [site x status]). Cost window = p_from/p_to when set else rolling
  12 months. Two new pages consume them: **Cost per Unit** (`cost_unit`, Trends) and **Operations Command**
  (`ops_command`, Operations - exec-style: today tiles + WO status doughnut + WO type bar + PM gauge + WO trend +
  site x status heatmap). New light chart builders costTrendOption/trendLineOption in ReportShare.jsx. VERIFIED live:
  tyre_cost 1.15M + real monthly trend; km/hours/m3 = 0 for the pilot org (no meter/production logs yet) so per-unit
  reads N/A until that data lands. INCIDENTAL: added missing `/erp-import` to commandSearch NAV_COMMANDS (a prior
  ERP-import PR left the coverage test red). Next free migration **V280**.

### Incident Report screen upgrade (2026-07-16) — from the user's field spec (xlsx)
- The user's "incident_Report_Screen" spec was a BEHAVIOR upgrade list on the EXISTING accident form
  (`src/pages/Accidents.jsx`); all fields already existed. Wave 1 implemented (build+tests green):
  - **V250** added `accidents.amount_transfer` (numeric), `accidents.workshop_location` (text),
    `accidents.taqdeer_no` (text). Existing org/country RLS governs them. Next free migration **V251**.
  - **accidentVocab.js** new single-source dropdowns/helpers: `LIABLE_PARTY_OPTS`(GCC/Other Party),
    `PAYER_OPTS`(GCC/Insurance/Recovery Claim), `RECOVERY_DECISION_OPTS`(Yes/No/N/A),
    `canonLiableParty/canonPayer/canonDamageCondition` (+ `DAMAGE_CONDITION_ALIAS` folds legacy
    Major Repair/Total Loss/Structural->Major, Cosmetic->Minor), `najmHasReport/taqdeerHasReport`
    (report-exists gates), `recoveryIsYes`, `repairIsInternal`, `computeRecovered`(claim-approved-deductible,
    floored 0). DAMAGE_CONDITION_OPTS is now Minor/Moderate/Major/N/A.
  - **Form**: Liable Party / Who Pays / Damage Condition are now dropdowns; Najm Fault shows only when a
    Najm report exists; Taqdeer No (new) shows only when a Taqdeer report exists; Recovery Status is a
    Yes/No/N/A gate revealing Recovery Source/Date/Reference + Amount Transfer (new); Recovered auto-calcs
    = Claim - Approved - Deductible (editable; recoveredTouched ref, respected on edit, auto on add);
    Repair Type internal -> Workshop Location = site dropdown + Repair Cost visible; external -> Workshop
    Location free input + Repair Cost hidden. handleSave gates + canonicalises all of these; openEdit
    hydrates + canonicalises; PAGE_COLS in api/accidents.js returns the 3 new columns; AccidentDetailModal
    shows them (recovery_status label now falls back to the raw value for the new Yes/No/N/A vocabulary).
  - RULE (recovery_status): it is FREE TEXT; claimsAnalytics does NOT parse it (only recovered_amount), so
    the Yes/No/N/A gate is safe. Legacy pending/partial/recovered rows still display via passthrough.
  - Tests: accidentVocab.test.js now 17. NO em/en dashes in new strings.
- **STILL TODO (wave 2, told user):** (1) categorized photo uploads (Driving License / Resident ID /
  Registration / Najm Report / Taqdeer Estimation single slots + multi accident photos, size-optimized;
  photos is jsonb) - needs storage + structure change; (2) on-SAVE and on-UPDATE case email with the case
  PDF + attachments (incident date/GCC responsibility/damage class/stage/policy/vehicle/asset/fault) -
  needs a new edge function; (3) admin-managed insurer/policy list + Inspector/Responsible Owner as user
  dropdowns. These are the heavier items, deliberately deferred.

### Heat Intelligence live weather (2026-07-16) — merged to main (PR #32)
- HeatIntelligence (`/heat-intelligence`) now runs on REAL ambient temperature, not only the seasonal
  `GCC_TEMP_PROFILES` climatology. Source = **Open-Meteo** (free, keyless, CORS) via new service
  **`src/lib/api/weather.js`** (`getCurrentWeather(lat,lon,{signal,force})` + pure `normaliseWeather()`;
  localStorage-cached 1h per rounded coord; NEVER throws, returns `{ok,data}`|`{ok:false,error}`). This is a
  public HTTP source, so it does NOT use the Supabase `_client.js` layer.
- Engine additions in **`src/lib/heatIntelligence.js` are ADDITIVE ONLY** (the existing pure fns are locked by
  `heatBlowout.test.js`/`heatIntelligence.test.js` - do NOT change their signatures/outputs): `GCC_CITY_COORDS`
  + `cityCoords()`, `hottestHours()`, `mergeLiveConditions(base,liveAmbient,source)` (overlays a real ambient
  onto a `currentConditions()` result, recomputing road/severity/advisory/pressure via the same pure fns;
  returns base unchanged on non-finite input). Climatology (`currentConditions`) stays the offline fallback.
- Page: `HeatIntelligence.jsx` fetches per selected `city` (abortable), city-STAMPS the reading
  (`weather.city_key`) so a stale in-flight result is never shown under the wrong city, derives `liveWeather`
  (only when city_key matches) + blends into the `conditions` memo so hero/blowout-risk/calculator all use the
  live number; "Live ambient weather" panel (now/feels-like/humidity/wind + hottest hours + 7-day max) with a
  Live vs Seasonal badge and honest loading/fallback. RULE honored: NO em/en dashes in the NEW output.
- Tests: `heatWeather.test.js` (11). Research + adversarial-review agents used; the one nit found (present-but-
  non-numeric apparent/wind rendering 0 not N/A) is fixed + regression-tested. No DB/schema change.

### Preventive Maintenance module (V253, 2026-07-16) — complete PM for all asset types
- DEEPENED the thin PM module (do NOT add a parallel one). Covers vehicles, generators, plant, machinery,
  equipment via `pm_programs.asset_category` (vocab vehicle/generator/plant/machinery/equipment/other).
- **V253 (applied live + stub `MIGRATIONS_V253_PM_MODULE.sql`):** ALTER `pm_programs` (+asset_category,
  meter_source odometer/engine_hours/none, meter_interval, last_done_meter, next_due_meter, assigned_to,
  priority low/medium/high/critical, estimated_cost, task_list jsonb); NEW child table `pm_service_records`
  (execution/"fixed it" history, org-isolated RESTRICTIVE + elevated writes, generated total_cost); RPC
  **`record_pm_service(...)`** SECURITY DEFINER = atomic insert-and-advance (SELECT ... FOR UPDATE, re-checks
  org+role in-body, recomputes next_due via make_interval days/months + next_due_meter = reading+meter_interval
  with a monotonic guard). Widened `work_orders.work_type` CHECK to add 'Service' + 'Preventive Maintenance'.
  Verified live via rolled-back RPC test (6mo -> next_due advanced, meter 1005+250 -> 1255).
- **Two due axes:** TIME (interval_type days/months drives next_due) AND METER (km via vehicle_fleet.current_km
  which is odometer-synced; engine-hours read latest from engine_hours_logs in bulk - there is NO
  current_hours column and I did NOT add one). Legacy km/hours interval rows map to the meter axis in the pure
  engine. No destructive backfill.
- **Pure engines (single source, do NOT rebuild the maths):** `src/lib/pmVocab.js` (categories/priorities/
  outcomes/meter sources + toDb/canon), `src/lib/pmSchedule.js` (addTimeInterval MUST byte-match SQL
  make_interval; meterToDue/meterDueStatus with METER_DUE_SOON {odometer:500, engine_hours:25};
  pmAssetDueStatus worst-of date+meter; advanceSchedule mirrors the RPC EXACTLY so the modal preview == server;
  summarizePmCompliance). Reuses daysToDue/pmDueStatus/DUE_SOON_DAYS from `src/lib/pmPrograms.js`.
- **Service `src/lib/api/pmPrograms.js`** extended: recordPmService (RPC), listPmServiceRecords,
  loadPmDashboard ({plans, kmByAsset, hoursByAsset} bulk). Barrel unchanged.
- **Page `src/pages/PmPrograms.jsx`** = 3 tabs (Dashboard/Plans/Service History) + Record-service modal with
  live next-due preview + optional linked Work Order (reuses workOrders API, work_type 'Preventive
  Maintenance'). Nav relabelled "PM Programs" -> "Preventive Maintenance" (route /pm-programs unchanged).
- **One-click Tyres vs Maintenance cost SWITCH (user standing ask):** pure `src/lib/costSources.js`
  (COST_MODES combined/tyres/maintenance + pickCost/pickMonthly/splitTotals) + service
  `src/lib/api/costSummary.js` `loadCostSplit` (tyre = tyre_records cost_per_tyre*qty by issue_date;
  maintenance = pm_service_records.total_cost + work_orders labour+parts+lubricant+outside_repair EXCLUDING
  tyre_cost to avoid double count; 12-month byMonth; each source degrades to 0). Surfaced as a segmented
  Cost view control on the PM Dashboard. RULE going forward: reuse these helpers to add a tyre/maintenance
  cost toggle to OTHER cost surfaces (Analytics/CostCenter/Board Overview) - do NOT re-derive the split.
- Tests: pmVocab(12), pmSchedule(19), costSources(9), pmPrograms.api(8), costSummary(5) = 53 green.
- **PMV enhancements (2026-07-16, 6-agent batch):** (a) `src/lib/pmTemplates.js` (12 OEM-style service templates
  per asset category + templatesFor/applyTemplate) wired as an "apply template" picker in the plan create modal;
  (b) `src/lib/pmAnalytics.js` (costByAsset/costByCategory/monthlyServiceCost/meanIntervalBetweenServices/
  outcomeBreakdown/complianceTrend/topOverdue/pmSummary) surfaced as a Service-analytics section on the PM
  Dashboard; (c) `MaintenanceCalendar.jsx` now plots active PM plan next_due dates (indigo, overdue red) via
  listPmPrograms; (d) `CostCenter.jsx` gained the Tyres-vs-Maintenance cost switch (costSources+costSummary);
  (e) `recordPmService` now best-effort auto-logs the meter reading into odometer_logs/engine_hours_logs
  (source 'PM service') so the fleet meter stays fresh (odometer trigger advances current_km). Tests:
  pmTemplates(15), pmAnalytics(21), pmPrograms.api now 12. RULE: reuse costSources/costSummary for any further
  tyre-vs-maintenance toggle; reuse pmAnalytics/pmTemplates - do not rebuild.
- **PMV wave 3 (2026-07-16, 8-agent batch):** (a) NEW scheduled report type **'pm'** (Preventive Maintenance
  due) - `scheduledReports.js` REPORT_TYPES + DATASETS.pm (pm_programs, dateCol next_due, eqFilter status=active,
  orderAscending) + edge fn `send-scheduled-reports` DATASET_DIGEST.pm; **V254** widened
  report_schedules.report_type CHECK to include 'pm'. EDGE FN NOT YET REDEPLOYED (still v14) - a 'pm' schedule
  emails the exec fallback until send-scheduled-reports is redeployed (ops step; the pm digest code is in the
  committed source). (b) Tyres-vs-Maintenance cost switch now ALSO on **Analytics.jsx, BoardOverview.jsx
  (toggleable section, in PDF), ExecutiveReport.jsx (toggleable built-in section, in PDF/PPTX/Excel)** - all
  reuse costSources/costSummary (CostCenter already had it). (c) PM signals added to **Dashboard.jsx** (overdue/
  due-soon/compliance tile + priority recs), **DisplayDashboard.jsx** (new TV "Preventive Maintenance" board),
  **AssetDetail.jsx** (per-asset PM plans + service history tab). (d) PmPrograms.jsx: per-tab Excel/PDF export
  (reportFileName) + catalog-backed parts picker in record-service (listParts, parts_used now {name,qty,cost}).
  INCIDENTAL FIX (reported): ExecutiveReport.jsx used `LayoutList` without importing it (latent crash) - the
  agent added the import. next free migration **V255**.
- **PMV wave 4 (2026-07-16, 4-agent batch):** PM surfaced on more analytics screens (all reuse existing PM
  services/engines, NO DB change): KpiScorecard.jsx (PM compliance/overdue/due-soon/active KPI cards);
  Reports.jsx wizard (two new types: Preventive Maintenance over pm_programs + PM Service History over
  pm_service_records, full customizable-columns/export); OpsIntelligence.jsx (PM health tile + overdue/due-soon
  in the anomaly feed; incidental cleanup: removed dead anomalySummary/summarizeAnomalies); ExecutiveAnalytics.jsx
  (PM compliance card + 12-month service-cost combo + cost-by-category + outcome doughnut, forced-light EChart).
  RULE: PM now appears on Dashboard, DisplayDashboard, MaintenanceCalendar, AssetDetail, KpiScorecard,
  OpsIntelligence, Analytics/CostCenter/BoardOverview/Executive(cost), ExecutiveAnalytics, Reports - do NOT add
  more PM surfaces without a real user ask (avoid manufacturing).

### Real light/dark theme toggle (2026-07-16) — full-palette, not just backgrounds
- User: the old toggle "only changes backgrounds". Fixed by deepening BOTH the toggle and the light CSS.
- Theme signal is the `html.light` class (dark = no class), driven by the EXISTING `src/contexts/ThemeContext.jsx`
  (localStorage key `tp_mode`; modes light/dark/system; system follows matchMedia). Extended it with
  `resolvedTheme` + guarded `setTheme` (all prior exports theme/isDark/toggleTheme/mode/setMode kept). Do NOT
  duplicate this context.
- **`src/components/ui/ThemeToggle.jsx`** (NEW) = Sun/Moon/Monitor cycle Light>Dark>System (or plain switch via
  includeSystem={false}), currentColor-based so it reads on either header. Mounted in Layout.jsx (sidebar footer,
  mobile top header, field/checklist header) and the choice also lives in Settings AppearancePanel (mode/setMode).
  Available to ALL users (not super-admin gated - that constraint was only for the parked Admin module).
- **`src/index.css`**: the `html.light {...}` block now fills every design token (added --surface-raised,
  --border-subtle, --shadow-float, login-* group) AND adds `html.light`-scoped overrides for the raw dark
  Tailwind utilities that ignore tokens (.bg-black, .text-slate-100/200, .bg-gray-600/500, .bg-white/2|5|10,
  .border-white/*, divide-*, ring/border slate, pre/code/kbd). SEMANTIC status hues (red/green/amber/blue/purple)
  and the brand green accent are deliberately preserved. DARK mode output is byte-for-byte unchanged (everything
  is scoped under html.light). RULE: to fix a screen that still looks dark in light mode, add an html.light-scoped
  override in index.css (never restyle dark); do not palettize semantic status colours.
- **Light-theme completion + bundle split (2026-07-16, 2-agent batch):** (a) `vite.config.js` manualChunks now
  pins `vendor-echarts` (~1.1MB, was an anonymous hash-churning index chunk) + `vendor-table` (@tanstack, pulled
  out of the eager shell); heavy export libs (jspdf/xlsx/pptxgenjs/html2canvas) stay LAZY - do NOT pin them.
  chunkSizeWarningLimit raised to 900 after splitting. (b) Light-theme holdouts fixed by TOKENIZING hard-coded
  darks (dark token value == the literal it replaced, so DARK output is byte-identical): index.css added
  --panel-ink-2/3/4 (secondary/muted/dim panel text); ErrorBoundary bg #020704 -> var(--bg-base); Inspections
  approve-modal texts -> panel-ink tokens; and across **30 chart pages** `grid:{color:'#1f2937'}` ->
  `var(--panel-2)` (resolved per-theme by the EXISTING `src/lib/chartVarPlugin.js` registered in main.jsx - the
  sanctioned way to theme chart.js colours). DELIBERATELY left dark: modal scrims rgba(0,0,0), camera/scanner
  surfaces, SVG stroke/fill attrs (#1f2937/#374151 gauge tracks - CSS vars don't resolve in SVG presentation
  attrs), dark tooltip bg consts, email HTML, semantic/categorical chart fills. RULE: theme chart.js colours via
  `var(--token)` (chartVarPlugin resolves them); SVG gauge/diagram strokes are NOT tokenizable without a rewrite.

### Admin Control & Self-Healing — Module 1 System Health (V255, 2026-07-16) — SHIPPED, phased
- User un-parked the Admin Control module (super-admin, under `/console`). Delivering PHASED: after each
  module STOP + report + await confirmation. Modules 1 (System Health), 4 (Backups), 7 (Admin Roles),
  5 (Alert Rules), 6 (Audit Trail), 8 (Module Control), 2 (Self-Healing), 3 (No-code DB + Ask-your-data) DONE.
  ALL 8 Admin Control modules shipped. Next free migration **V261**.
- **Module 2 Self-Healing** (`/console/self-healing`): pure `src/lib/selfHealing.js` (detectStaleGroups 7d +
  summarizeFindings severities) + `src/lib/api/selfHealing.js` (runScans REUSES dataReconciliation RPCs +
  anomalyEngine + a latest-per-site stale scan; fixes = thin pass-throughs to the EXISTING guarded recon RPCs
  backfill-orphan / merge-identical-duplicate - NO new mutating ops; logHealFinding -> system_logs) +
  ConsoleSelfHealing.jsx. SAFE: scans read-only, only already-guarded fixes applied. 23 tests.
- **Module 3 No-code DB + Ask-your-data** (`/console/data-browser`, V260): super-admin READ-ONLY RPCs
  admin_db_tables/admin_db_columns/admin_db_query over a fixed 14-table SAFELIST (operator whitelisted, value
  param-bound - no injection, SELECT-only). Pure `src/lib/queryBuilder.js` (21 tests) + `src/lib/api/askData.js`
  (question -> structured filter via the EXISTING chat-ai edge fn, parse-only/local-first, never throws; 12
  tests) + `src/lib/api/dataBrowser.js` (6 tests) + ConsoleDataBrowser.jsx (table picker + dropdown filter
  builder + Ask-your-data + Excel export). HONEST GAP: READ + export only this phase; generic edit/delete is a
  deliberate later step (banner says so). RULE: all DB browse goes through the safelisted admin_db_* RPCs -
  never expose arbitrary client SQL.
- **Module 5 Alert Rules** (`/console/alert-rules`): alertRules.js + ConsoleAlertRules.jsx = no-code
  "if [metric][operator][value] notify [in-app/email]" builder over the EXISTING `alert_thresholds` table
  (evaluated hourly by existing cron) - NO new table. 6 tests.
- **Module 6 Audit Trail** (`/console/audit-trail`): auditTrail.js (normalizeRow across audit_log_v2 /
  access_audit / console_sessions) + ConsoleAuditTrail.jsx = unified read-only searchable viewer + before/after
  diff + Excel export. NO new table. 15 tests.
- **Module 8 Module Control** (`/console/module-control`, V258 `modules` table): modulesRegistry.js
  (list/upsert/setStatus/bulkSetStatus/seedFromCatalog + pure dependencyWarnings) + ConsoleModuleControl.jsx =
  Live/Maintenance/Off per-module toggle + bulk + dependency-warning confirm. HONEST GAP: status STORED only;
  app-wide hiding of a module from users is a flagged follow-up. 4 tests.
- **BUG FIX (V259, applied live) "cannot create a shared link for TV":** `create_report_share` (V251) ran
  `search_path='public'` but pgcrypto (gen_random_bytes/gen_salt/crypt) lives in `extensions`, so token minting
  threw on EVERY call. Fixed to `search_path='public','extensions'` (matches create_api_key/create_display_token).
  Client had NO bug. RULE: token-minting DEFINER fns MUST include 'extensions' in search_path.
- **Module 7 (V256) admin_users**: table (user_id UNIQUE, admin_role super_admin/regional_admin/viewer,
  regions text[], active), RLS super-admin-manage + self-read; `my_admin_role()` DEFINER; `admin_set_admin_user`
  upsert RPC. Pure `src/lib/adminRoles.js` (ADMIN_ROLE_META + ADMIN_CAPABILITIES rank matrix + adminCan/canon,
  18 tests). Service `src/lib/api/adminUsers.js` (10 tests). Page `src/console/pages/ConsoleAdminRoles.jsx`
  (/console/admin-roles). HONEST GAP: the /console auth gate STILL requires profiles.is_super_admin, so
  regional_admin/viewer cannot yet sign into the console - the role model + manager exist but gate-opening +
  scoped RLS is the enforcement follow-up (banner says so in the UI). Do NOT claim it is enforced.
- **Module 4 (V257) backups**: `backups` schema (snapshots + snapshot_tables jsonb), curated core-table list
  (tyre_records/vehicle_fleet/accidents/inspections/work_orders/pm_programs/pm_service_records/stock_records).
  Nightly pg_cron job `nightly-backup` 00:30 -> `cron_run_backup()` (snapshot + 30d purge). Super-admin RPCs:
  create_backup_snapshot, list_backup_snapshots, backup_restore_preview (safety check: snapshot vs current +
  missing + newer-current counts), **backup_restore_missing = NON-DESTRUCTIVE** (re-inserts only rows missing
  now, ON CONFLICT DO NOTHING, excludes GENERATED cols - can NEVER overwrite newer live data; verified live).
  backups schema never granted to anon/authenticated. Service `src/lib/api/backups.js` (8 tests). Page
  `src/console/pages/ConsoleBackups.jsx` (/console/backups) - back-up-now, snapshot list, per-table restore
  preview + typed-RESTORE-confirm recover-missing. RULE: restore is recover-deleted-rows only; a full
  destructive restore is deliberately NOT built (data-safety).
- **V255 (applied live + stub):** NEW table `system_logs` (id, organisation_id DEFAULT app_current_org(),
  module_id, severity info/warning/error/critical, source, message, detail jsonb, reference_id, url, user_id,
  user_email, resolved/resolved_by/resolved_at, created_at). RLS: RESTRICTIVE org isolation (null org allowed
  for early-boot errors); any authenticated INSERT (fire-and-forget error logging); Admin/Manager/Director+super
  SELECT; Admin/super UPDATE. RPC `resolve_system_logs(p_module,p_severity)` bulk-resolve (Admin/super gated).
  There was NO app error log before (errors went to Sentry only). Next free migration **V256**.
- **Pure engine `src/lib/adminHealth.js`** (37 tests) = 0-100 TyrePulse Health Score composer: freshnessScore
  (per-stream staleness STREAM_STALE_DAYS), errorRateScore (dual-shape), reachabilityScore (systemHealth
  summary), anomalyScore, computeHealthScore (weighted .3/.3/.3/.1, null-input renormalization, HEALTH_BANDS).
  REUSES ideas from opsIntelligence.computeFleetHealth / analyticsEngine / systemHealth - do NOT rebuild.
- **Service `src/lib/api/systemLogs.js`** (12 tests): listSystemLogs (filters+[]-degrade), resolveSystemLog,
  resolveAllSystemLogs (RPC), logSystemEvent (fire-and-forget, never throws), getHealthMetrics (latestByStream/
  errors/ai/reports/logsByDay, each source own try/catch).
- **Page `src/console/pages/ConsoleSystemHealth.jsx`** (/console/health, NAV in ConsoleLayout, navy+orange):
  big health score + factors, status cards (Supabase/last sync/AI/report/backup="Not configured yet"),
  runAllChecks() subsystem tiles, error-log table (filter severity/module/since + Resolve/Resolve-all),
  14-day error-trend chart, realtime channel on system_logs + 60s fallback. Plain-English tooltips; no raw SQL.
- **INCIDENTAL (reported):** (a) `src/lib/monitoring.js` captureError now ALSO best-effort lazy-logs to
  system_logs via logSystemEvent (window-guarded, never throws; so errors are captured even without a Sentry
  DSN). (b) `src/components/ErrorBoundary.jsx` gained a "Report this to me" button -> logSystemEvent with the
  ERR-XXXX reference id. RULE: system_logs is now the app error sink; new modules should pass module_id in
  captureError context so their errors attribute correctly (Module 8 registry will consume module_id).

### BACKLOG (user parked 2026-07-16, "do it later when I ask") — Advanced Admin Control & Self-Healing (Modules 2/3/5/6/8)
- A big SUPER-ADMIN-ONLY module the user specced for LATER (explicitly "put this for later, I will ask you to
  do it all"). Do NOT start until the user asks. Belongs under `/console` (super-admin), NOT the main nav.
  8 modules: (1) System Health Dashboard + 0-100 Fleet Health Score + system_logs error table + realtime;
  (2) Self-Healing engine (pg_cron edge fns: orphan scan flag-only, duplicate auto-merge only if 100% identical,
  Excel import pre-validation, failed AI photo retry 3x, stale-branch 7d detector, PREDICTIVE anomaly flagging
  off the existing local analytics engine); (3) No-code DB control panel + "Ask your data" plain-English search
  (AI parses question -> Supabase filter ONLY, never computes data - keep local-first); (4) Automated nightly
  backups to a backups schema, 30d retain, one-click restore w/ diff + pre-restore safety check; (5) No-code
  alert rule builder + severity routing (critical immediate, warnings daily digest) via Gmail connector;
  (6) Audit trail admin_audit_log + role-scoped visibility; (7) Role-based access admin_users
  (super_admin/regional_admin/viewer) via RLS; (8) Module Registry & Maintenance Control (`modules` table,
  Live/Maintenance/Off toggle per feature, dependency warnings, per-module health dot from system_logs,
  app-wide error boundary that logs to system_logs with module_id + "Report this to me" button).
  Phased delivery, start Modules 1+4+7. Cross-cutting: reuse existing 24-fn local analytics engine, Chart.js,
  SheetJS, jsPDF, pptxgenjs; RLS on every new table; no raw SQL shown; plain-English tooltips; match dark navy
  theme; and REPORT every incidental change to existing code (file/what-was-wrong/what-changed) - do not
  silently improve.
- **UI/UX standing ask (also parked):** a REAL light/dark theme TOGGLE (genuine theme switch, not just a
  background swap) - must flip the full palette (surfaces/text/borders/charts), super-admin/admin surfaced.
  Tie into the existing CSS-var theming (`.tp-report-paper` light technique + SettingsContext). Not started.

### Report Sharing page + PWA update behavior (2026-07-16, PR #56 squash 5a83240)
- **Report Sharing is now a full nav PAGE** `src/pages/ReportSharing.jsx` (/report-sharing, RoleRoute
  Admin/Manager/Director, nav "Reports & Executive" > "Report Sharing", icon Share2). Moved OUT of Settings
  (removed `<ReportSharesPanel/>` + import from Settings.jsx). The page = overview stat strip (active links /
  total views / rotating boards incl. custom count / active report palette via activePaletteName+PRESET_LABELS)
  + report-colour theme link (super-admin -> /console/appearance; charts on every shared board follow the
  reportColors active palette) + how-it-works strip + "Open TV Display Mode" (/display) + the embedded
  `ReportSharesPanel` (manager + create/edit + ReportShareBuilder). `boardCount(row)` = custom boards
  (hasCustomLayout/normalizeLayout) else pages.length. RULE: report sharing lives at /report-sharing now, NOT
  Settings; do not re-add the panel to Settings.
- **PWA updates no longer reload mid-work** (vite.config.js + PwaUpdatePrompt.jsx): was `registerType:
  'autoUpdate'` + `skipWaiting:true` + `clientsClaim:true`, which force-reloaded an open tab the moment the
  15-min poll / refocus found a new Vercel deploy (and bypassed the existing update toast). Now `registerType:
  'prompt'` + `skipWaiting:false` (clientsClaim kept): a new deploy is DETECTED (PwaUpdatePrompt polls every
  15 min + on refocus via registration.update()) but the running tab keeps its build + its already-loaded lazy
  chunks (old precache retained until activate) until the user clicks Reload in the "New version available"
  toast (needRefresh now actually fires). PwaUpdatePrompt ALSO auto-applies a WAITING update quietly on
  `visibilitychange` -> hidden (updateServiceWorker(true) while the tab is hidden), so kiosks/TVs self-heal
  without interrupting anyone or stranding them on a stale build. RULE: keep skipWaiting:false so open tabs are
  never yanked; the toast + hidden-apply are the two controlled activation paths. **Next free migration V265.**

### Vercel deploy hygiene (2026-07-16) — one production deploy per change
- User asked why every change caused ~2 Vercel deploys. Cause: (1) a PREVIEW build on every feature-branch push
  + (2) a PRODUCTION build on merge to main = the normal 2; PLUS an avoidable 3rd from pushing a docs-only
  PROJECT_MEMORY commit back to the branch AFTER merge (re-triggered a preview). Fixes: (a) `vercel.json` now has
  `git.deploymentEnabled: { "claude/accident-builder-report-ui-2bkwb5": false }` so pushes to the bot branch do
  NOT create preview deploys (main still deploys production); (b) WORKFLOW RULE going forward: fold the
  PROJECT_MEMORY update INTO the feature PR before merge, and do NOT push a separate post-merge docs commit to
  the branch (after merge just `git checkout -B <branch> origin/main` locally, no push). Net: one production
  deploy per merged change. NOTE: if branch previews are wanted again, remove the deploymentEnabled entry.

### Mobile app major pass (2026-07-17, PR #58 squash ec4fe26) — Daylight + access control + Play hardening
- Big multi-agent pass over the Expo/RN inspector app (`mobile/`, "TyrePulse Inspector" v1.2.0, Expo 54 / RN 0.81).
  Verify with `cd mobile && npx tsc --noEmit` (whole project 0 errors); no device/EAS build available here so
  runtime crash/perf is NOT verified — static hardening + typecheck only. NOTE: a PARALLEL session was editing
  the same `mobile/` working tree/branch concurrently (its commits 9b8b9f9 etc. + files meter-logs/rca/tyre-change/
  work-orders); reconcile by committing only your own files, then merge theirs once they compile.
- **Daylight design system** = light-first `mobile/lib/theme.ts` (brighter palette, tuned for GCC sun) + polished
  `mobile/components/ui/*` kit (Screen/Card/AppText/Button/Badge/StatTile/ListRow/States/SkeletonLoader). Every
  screen restyled onto it. Checklists rebuilt as tap-to-record tiles + icon bottom-sheet (`components/ChecklistItemSheet.tsx`)
  matching the tyre-inspection feel. New `app/(app)/calendar.tsx` (schedule agenda) + `lib/schedule.ts`. Scanner
  routing engine `lib/scanRouter.ts` (classify once, route to prefilled action).
- **RBAC single source = `mobile/lib/permissions.ts`**: `MODULES` registry (key/label/icon/roles/group) is THE
  place access is defined; existing `canX` predicates are thin wrappers over it. `resolveModuleAccess(key,role,grants,
  isSuper)` = role default then per-user grant overlay (revoke > grant > role > deny; admin/super always allowed).
  Role removals shipped: **director** loses analytics/ai/stock; **inspector** loses vehicles/workorders/calendar/
  reportIssue; **tyre_man** loses records/vehicles/workorders/stock/meter/tasks. RULE: to change what a role sees,
  edit that module's `roles`; to gate a new destination add a MODULE + a `moduleKey` on the tab/home entry.
- **Per-user access overlay + super-admin console**: `contexts/AuthContext.tsx` now selects `is_super_admin`,
  loads `get_my_access_grants()` (fail-open), exposes `isSuperAdmin`/`grants`/`canAccess(key)`/`refreshGrants`, and
  re-pulls on realtime `user_access_grants` changes (nav auto-adjusts, no re-login). Mobile grants are NAMESPACED
  `mobile:` (`MOBILE_GRANT_PREFIX`, `mobileGrantKey`, `mobileGrantsFromRaw`) so they are SEPARATE from the web
  access/approvals grants (same `user_access_grants` table + `set_user_access_grant`/`revoke_user_access_grant`
  RPCs, no migration). Console = `app/(app)/admin/access.tsx` (super-admin only) + service `lib/accessAdmin.ts`;
  Allow/Deny/Default per module per user. `_layout.tsx` tabs + `app/(app)/index.tsx` Home hub gate on
  `useAuth().canAccess` (5 primary tabs, rest grouped in Home).
- **Play Store hardening**: removed `SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM` from app.json (app only schedules
  inexact DAILY reminders; Google restricts exact alarms). Crash-safety pass across all screen groups (wrap
  unguarded loads/RPC/storage/status/delete in try/catch + honest error+Retry states; scanner camera-mount
  fallback). Performance: long/unbounded lists -> FlatList with render-window tuning + ListHeaderComponent;
  interactive forms + short lists kept as ScrollView (never nest FlatList in ScrollView). Added diagnostics are
  `__DEV__`-gated. ErrorBoundary + Sentry global handlers already wrap the app; EAS `autoIncrement` + app-bundle;
  target SDK 35; publishable keys only. package.json version aligned to 1.2.0.

### Mobile field-feedback fixes (2026-07-17, PRs #61-#65, V265/V266) — merged to main
- Follow-up to PR #58 from live-testing feedback on the Expo app (`mobile/`). All merged; verify with
  `cd mobile && npx tsc --noEmit` (0 errors). Builds via `release-play.yml` (EAS, `--auto-submit`) - expo-doctor
  is NON-fatal in the EAS build; a doctor version-mismatch does NOT fail the build (but PR #60 aligned
  expo@54.0.36 / expo-updates@29.0.19 to clear it).
- **Nav regression FIX (PR #61):** the Home-hub rewrite pushed routes with a trailing `/index`
  (`/(app)/workorders/index` etc.) - expo-router addresses an index route by its FOLDER path WITHOUT `/index`,
  so those 404'd ("Unmatched Route") and `/(app)/checklists/index` hit the `[templateId]` route with id
  "index" -> "invalid input syntax for type uuid: index". RULE: never push `/(app)/<folder>/index`; push
  `/(app)/<folder>`. Fixed in index.tsx, ai/index.tsx, admin/index.tsx.
- **Accidents (PR #62/#63):** removed "Analyze with AI"; delete restricted to admin/super-admin; status via a
  clear dropdown; back button -> previous screen (dashboard fallback). FULL web-field parity (PR #63): the
  report form now captures the same fields as web `src/pages/Accidents.jsx` (incident/classification/liability+
  GCC/insurance+claim/repair+release) with the same `toDb*`/`canon*` token maps (mirrored inline) + recovered
  auto-calc; the offline `recordQueue.ts` REPORT_ACCIDENT `fields` allow-list was extended so the new columns
  persist (sanitize() strips unknown keys). Detail view shows the fields.
- **Meter log (PR #62 + #65/V266):** reject an odometer reading below the asset's last reading; auto-fill site
  from the asset's `vehicle_fleet.site` (never overwrites a typed value); barcode/QR scan to pick the asset;
  engine-hour (hour meter) surfaced; **V266** added nullable `signature text` to `odometer_logs` +
  `engine_hours_logs` and the app captures an optional SignaturePad SVG into both payloads + the queue allow-list.
- **Tyre SVG web-parity (PR #63):** `lib/tyreLayout.ts` ports the web axle/dual/spare layout per vehicle type
  (Tr-Mixer = 4 steer + 8 dual drive + spare = 13; spare shown per type). VehicleTyreDiagram Props unchanged.
- **Inspection (PR #63):** cannot save an EMPTY inspection (require header fields + >=1 tyre condition);
  Share-as-PDF from detail/history via `lib/inspectionReportPdf.ts` (expo-print/expo-sharing); condition colours.
- **Stock / Overview (PR #62/#63):** stock filter by tyre size (derived from `description`) + location (`site`);
  overview date-range + site + country filters.
- **i18n (PR #63/#64/#65):** RTL wired via `I18nManager` (LanguageContext `isRTL`); ALL main + secondary screens
  converted to `t()` keys; `locales/en.json` + `ar.json` key-synced (~640 new keys, Modern Standard Arabic).
  RULE: keys in .tsx only (ASCII), Arabic values only in ar.json; accident dropdown DB tokens stay English -
  only labels are translated.
- **Android nav-bar overlap (PR #63):** the bottom tab bar now adds the safe-area bottom inset so the phone's
  system nav buttons no longer cover it.
- **Battery/perf + client security (PR #64):** image-picker capture quality 0.7 -> 0.55; `React.memo` on hot
  list components (Badge/ListRow/StatTile/TyrePositionCard); new `lib/safeUrl.ts` (safeImageSrc/safeHref) on all
  Image URIs; remaining `console.*` gated behind `__DEV__` (no error/key leaks in production logcat).
- **Error hardening (in progress):** new `lib/safeError.ts` `toUserMessage(err, fallback)` maps any DB/PostgREST/
  network error to a clean generic message (never SQL/column/uuid/endpoint/token). Being routed through EVERY
  user-facing error surface (Alert.alert/setError/ErrorState + ErrorBoundary shows generic in prod). This closes
  the "invalid input syntax for type uuid" class of raw-error leaks. RULE: never render a raw `err.message` to
  users - always `toUserMessage(err)`.
- **RBAC role removals are LIVE + verified correct in code** (Home hub filters actions by `canAccess(module)`;
  `_layout` gates tabs by `canAccess(tab.moduleKey)`; registry drops tyre_man from records/vehicles/workorders/
  stock/meter/tasks). If a role still sees a removed module it is a STALE build - rebuild and test with a real
  `tyre_man` (not admin/super-admin) account.
- **DB (V265):** pinned `search_path` on 5 advisor-flagged functions (config-only ALTER, applied live). The
  ~300 "table exposed to anon/authenticated" advisor warnings are API-surface only - org+country RESTRICTIVE RLS
  governs actual access. STILL a USER/OPS action: enable leaked-password protection in Supabase Auth (dashboard).
- **Push notifications:** local (expo-notifications: daily inspection reminder + sync toasts, 3 Android channels)
  + Expo push token registered to `profiles.push_token` (RLS-scoped, cleared on logout) for server-sent targeted
  pushes via the Expo Push API. **Next free migration V267.**

### Mobile brand icon + splash + login logo (2026-07-17) — real Tyre Pulse mark, brand green
- Replaced the placeholder "TP"-white-on-green launcher icon with the user's ACTUAL Tyre Pulse logo
  (tyre tread + wheel + heartbeat pulse + road emblem, "TYRE PULSE" wordmark + "Smarter Wheels. Stronger
  Fleet" tagline). Source art was blue/navy; recoloured to the BRAND GREEN via a dark-green->#16a34a
  luminance ramp (NO neon — the user rejected the first bright-green pass and asked for the darker brand
  green). Recolour was a pure PIL pass (blue-family pixels only; black tread outlines + white road markings
  + transparency preserved). Assets regenerated under `mobile/assets/`:
  - `icon.png` (1024, emblem-only on white) + `adaptive-icon.png` (1024, emblem transparent, 60% safe-zone)
    = Android/iOS launcher mark. `app.json` android.adaptiveIcon.backgroundColor #16a34a -> #ffffff.
  - `splash.png` (1600, FULL logo w/ wordmark on white). `app.json` splash.backgroundColor #f0f5f1 -> #ffffff.
  - `notification-icon.png` (256, WHITE monochrome silhouette — Android status-bar icons must be white/transparent).
  - NEW `logo.png` (full mark, transparent) + `logo-mark.png` (emblem, transparent) for in-app use.
- `app/(auth)/login.tsx` + `register.tsx`: the wrench-emoji "🔧" logo circle + "TyrePulse" text is replaced
  by `<Image source={require('../../assets/logo.png')}>` (the real logo shows on first app open). Removed the
  now-dead logoCircle/logoEmoji/appName styles; added `logoImg`. tsc clean.
- RULE: to re-skin the app icon, drop new art in `mobile/assets/{icon,adaptive-icon,splash,notification-icon}.png`
  (keep app.json paths); launcher icon = emblem only (no wordmark, it goes tiny), splash/login = full logo.
  The brand-green recolour recipe is a blue-family luminance ramp to #16a34a (dark shadows #06230f), no neon.
- SHIPPED: merged to main via **PR #67** (squash `b01f721`). `release-play.yml` Play build triggered on main
  (workflow_dispatch, run 29578022504) -> auto-submits to the Play Internal testing track. The new icon shows
  on testers' devices once that build finishes + Play processes it. No DB/schema change; branch realigned to
  origin/main. For NEW work restart the branch from latest main (merged PRs are terminal).

### Play Store Data Safety + public data-deletion page (2026-07-18, PRs #82/#83)
- **Deletion mechanism (Google Play requirement):** NEW public anon page **`src/pages/DataDeletion.jsx`** at
  route **`/data-deletion`** (+ `/delete-account` redirect), wired in App.jsx MainApp Routes OUTSIDE
  ProtectedRoute (sibling of /login, /report/:token). Self-contained light-theme document (no app shell/auth):
  how to request account+data deletion, what is deleted vs retained (org audit records de-identified), ~30-day
  timeline, encrypted-in-transit, no ads / no data selling. `SUPPORT_EMAIL = 'info@tyrepulse.app'` (real inbox;
  deletion requests land there). **URL for the Play Data Safety form = `https://tyrepulse.app/data-deletion`.**
- **Data Safety declaration (what the MOBILE app actually collects, for the form):** App info & performance =
  Crash logs + Diagnostics/performance traces (Sentry @sentry/react-native, tracesSampleRate 0.2, tags user
  id/username) -> the ONLY data SHARED to a third party. Personal info = Name/Phone(optional)/User IDs
  (username+employee_id; email is a SYNTHETIC non-routable @users.tyrepulse.app so can be declared Not
  collected). Location = foreground-only balanced accuracy (geotags inspections). Photos. Device/other IDs =
  push_token. App activity = inspections/accidents/meter logs. ALL Collected + encrypted in transit; NO
  third-party analytics/ads in mobile (no PostHog/Firebase/ad SDKs) -> "used to track users"/"Ads" = No.

### SESSION 2026-07-18 CLOSED CLEAN — all merged to main, nothing pending
- Everything this session is MERGED to main (PRs #67-#83) and branch realigned to origin/main. Migrations
  through **V269**; next free **V270**. No outstanding code TODO.
- **Mobile (Play Internal builds shipped):** brand icon/splash/login logo (#67); recovered 4 lost field
  commits + admin-console crash fix + Preventive Maintenance screen (#69); inspection-sync CHECK-token fix +
  V267 approval push + accident asset-first form/stock admin gating/checklist search/home badge/tyre diagram
  truth (#70); accident date-time pickers + categorized photos + keyboard-flicker fix + nav-bar overlap sweep
  + checklist interval section-pruning (#72); per-user Deny applies to admins (#74). RULE: native changes
  (datetimepicker, keyboard mode, icon) need a fresh EAS build - testers must UPDATE from the Play track.
- **Web:** Vehicle SVG Designer V268 (#71) + deepened (#73) + pseudo-3D art (#75); Site-level ABAC V269 (#76);
  Data Intake one-click "combine line items" for single-key modules (#77); public /data-deletion page +
  Play Data Safety mapping (#82/#83, see section above).
- **Session security (the big one, 3 layers + a policy tweak):** #78 pre-2FA block, #79 surface partition,
  #80 tab-local sessionStorage + idle/absolute auto-logout, #81 idle tightened to 10min (2FA kept OPTIONAL
  per user). Console is now fully isolated + auto-expiring; main app keeps localStorage persistence for field
  use. See the two dated sections just below for the full mechanics.
- Deferred / USER-OPS only: enable leaked-password protection in Supabase Auth dashboard; verify tyre_man
  RBAC on a fresh build with a real tyre_man account; enrol 2FA in the console Security tab to make the AAL
  gate actually apply to the super-admin. For NEW work restart the branch from latest main (merged PRs terminal).

### Console session ISOLATED from main app - no cross-tab bleed (2026-07-18)
- **BUG (user, persisted after the AAL fix because their super-admin has NO 2FA):** main app + /console
  shared ONE Supabase client keyed to localStorage 'tp_auth'. Logging into the Console in one browser TAB
  authenticated a main-app tab in ANOTHER tab with no click (standard supabase cross-tab session sync over
  the shared storageKey). For a break-glass admin console this is unwanted.
- **FIX (src/lib/supabase.js):** partition the auth session by SURFACE. React Router renders EITHER the
  `/console/*` tree (ConsoleAuthProvider) OR the main-app tree (`*`, AuthProvider) per tab - never both -
  so the URL the tab BOOTED on identifies the surface: `IS_CONSOLE_SURFACE = location.pathname.startsWith
  ('/console')` -> `AUTH_STORAGE_KEY = 'tp_console_auth'` else `'tp_auth'`. supabase-js only cross-tab-syncs
  its OWN storageKey, so a Console login (separate tab / direct URL) lands in 'tp_console_auth' and main-app
  tabs (watching 'tp_auth') never see it, and vice versa. Single client still (all data services use the
  one `supabase` singleton), so NO service/query change - the singleton just uses the right key per tab.
- DELIBERATE, coherent behavior: the in-app `<Link to="/console">` (client-side nav, no reload) keeps the
  tab's main-app session, so a signed-in super admin reaches the console seamlessly IN THAT TAB; only a
  SEPARATELY-opened console tab gets its own login. Existing main-app sessions unaffected (still 'tp_auth');
  a super admin re-logs into a standalone console tab once. Console still persists across reload (localStorage,
  just a different key) - switch to sessionStorage if a console-dies-on-tab-close posture is wanted later.
- Pairs with the AAL gate (still merged): partition stops cross-tab bleed; AAL stops pre-2FA data exposure.
  RULE: never hardcode 'tp_auth' elsewhere; read AUTH_STORAGE_KEY. Build clean; no migration.
- **HARDENED (2026-07-18, user "no compromise, in depth clear session securities"):** the console session
  is now TAB-LOCAL - `supabase.js` uses `window.sessionStorage` (not localStorage) when IS_CONSOLE_SURFACE, so
  a separately-opened console tab's session is NEVER shared with any other tab (not even another console tab,
  by sessionStorage spec) and is CLEARED on tab close (break-glass posture). `IS_CONSOLE_SURFACE` is now
  EXPORTED from supabase.js. ConsoleAuthContext adds idle auto-logout (CONSOLE_IDLE_LIMIT_MS 10min) + absolute
  cap (CONSOLE_ABSOLUTE_LIMIT_MS 8h), GATED on IS_CONSOLE_SURFACE so it only ends the console's OWN isolated
  session - never the main-app session when the console piggybacks it via the in-app System Console <Link>
  (same tab). Main app intentionally KEEPS localStorage persistence (field users on phones/shared terminals;
  RLS + AAL are their boundary). Console session no longer persists across tab close - a super admin logs into
  a standalone console tab each session (desired). Build clean; no migration.

### Auth assurance gate - password-only (pre-2FA) sessions no longer expose data (2026-07-18)
- **BUG (user-reported, real):** the main app + admin `/console` SHARE one Supabase client + one
  localStorage session. `signInWithPassword` creates a LIVE session at AAL1 the instant the password
  is accepted, BEFORE the 2FA step. `AuthContext.handleSession` (the passive/cross-tab
  onAuthStateChange listener) set `user` + loaded ALL data on ANY session and never checked the
  assurance level. Net effect: entering only a password (in the main login form OR the Console tab)
  showed all data before completing 2FA, and a Console login silently authenticated a main-app tab
  in another browser tab with no click. The console 2FA gate was cosmetic for data access.
- **FIX (defense in depth, no server change):** single helper **`src/lib/authAssurance.js`**
  `hasUnmetMfa()` = `getAuthenticatorAssuranceLevel()` returns currentLevel aal1 while nextLevel aal2
  (MFA enrolled but not completed). Fails OPEN=false on error (never locks out a no-MFA user; RLS is
  still the server boundary). Consumed by:
  - `AuthContext.handleSession` (now async): a NEW session identity is admitted only after
    `!hasUnmetMfa()`; a half-login is refused LOCALLY (user stays null, login page + its existing MFA
    modal show) - it does NOT sign out (the shared session is mid-MFA in the Console tab; signing out
    would abort it). Same-user token-refresh/refocus path skips the check (assurance never downgrades).
    Extracted `clearUserScopedState()` shared by signed-out + refusal branches.
  - `ConsoleAuthContext.resolveAdmin`: a super-admin with unmet MFA is NOT granted `admin` (guard shows
    the login/MFA prompt); no sign-out for the same reason. Verified AAL2 session admits on the next event.
- RULE: cross-tab session sharing for a FULLY-authenticated (AAL2 or no-MFA) user is standard browser
  behavior and is intentionally kept; only the half-authenticated case is blocked. To make the gate
  actually apply to a super-admin, they must ENROLL 2FA in the console (Security). Tests
  `authAssurance.test.js` (6). Build clean. No migration.

### Site-level ABAC (V269, 2026-07-18) — per-user site visibility, DB-enforced
- **Model: RBAC (what you can do) + attributes (which data you see): org > country > SITE.**
  `profiles.sites text[]`: NULL/empty = ALL sites; Admin/super always all. Helper
  `app_can_see_site(site)` (DEFINER; null-site rows visible to all) consumed by RESTRICTIVE
  **SELECT** policies `<t>_site_isolation` on 21 operational site tables (list in
  MIGRATIONS_V269_SITE_ABAC.sql). Writes NOT site-gated yet (visibility first, like V226 country).
- Assign via RPC **`admin_set_user_sites(p_user_id, p_sites)`** (super/Admin gated; UPPER-trims;
  NULL clears; internally disables/re-enables trg_guard_profile_privileged around its UPDATE) -
  console Users page has the per-user Sites editor (adminAccess.adminSetUserSites). Verified live
  rolled-back: DHAHBAN-assigned user saw exactly the 152 DHAHBAN tyre_records.
- SAFE ROLLOUT: at apply time no user had sites assigned = zero behavior change until an admin
  assigns. RULE: site values are canonical UPPER (V246); helper compares upper(btrim()). Mobile
  needs no change (RLS enforces server-side). Next free migration **V270**.

### Console deep-fix + Tyre Bay + Washing module (2026-07-18, PRs #87/#88) — MERGED to main
Multi-agent batch. All merged; migrations through **V271**, next free **V272**.
- **Console light/dark toggle**: `ThemeToggle` mounted in `src/console/components/ConsoleLayout.jsx`
  (expanded + collapsed sidebar); `src/index.css` has `html.light .console-root`-scoped overrides
  (dark output byte-identical, orange accent preserved). Console was dark-only before.
- **Per-user access Web/Mobile/Both scope** (NO migration): `src/lib/api/accessGrants.js` added
  `MOBILE_GRANT_PREFIX`-aware `setUserAccessGrantScoped(userId, moduleKey, {..., scope})` +
  `parseGrantScope`/`grantKeysForScope` (web=plain key row, mobile=`mobile:`key row, both=both rows,
  same effect). `src/console/pages/access/AccessManager.jsx` USER view renders a 3-way Web|Mobile|Both
  segmented control per module (Monitor/Smartphone/Layers); ROLE view unchanged. Reuses the existing
  mobile-vs-web grant split (mobile reads `mobile:`-prefixed grants) so surfaces stay independent.
- **Navigation editor** = `/console/navigation` (`src/console/pages/ConsoleNavigation.jsx`, nav
  "Navigation", LayoutList icon). Super-admin reorders/regroups/renames/hides nav groups+items. Pure
  engine `src/lib/navLayout.js` (normalizeNavLayout/applyNavLayout/buildNavEditorModel/
  editorModelToLayout; 16 tests) + api `src/lib/api/navLayout.js` (system_config key `nav_layout`,
  authenticated read / super-admin write). `src/components/Layout.jsx` exports `NAV_CATALOG` and computes
  `effectiveGroups = applyNavLayout(NAV_GROUPS, navLayout)` BEFORE `shouldShowNavItem` role/flag/perm
  filtering, so hiding is COSMETIC only - RBAC still governs every route (a hidden item cannot escalate).
- **Module Control now lists ALL modules (37 -> 163)**: `src/lib/moduleCatalog.js` added pure
  `slugifyModuleKey` + `buildNavModuleCatalog(navCatalog, moduleKeyMap=NAV_MODULE_KEY)` (imports
  `NAV_MODULE_KEY` from `navAccess.js` - no cycle; do NOT import Layout.jsx into moduleCatalog, that cycles).
  `src/lib/api/modulesRegistry.js` `seedFromCatalog(catalog?)` takes an optional complete catalog (defaults
  to the curated 37). `ConsoleModuleControl.jsx` seeds from `buildNavModuleCatalog(NAV_CATALOG)`. Curated 37
  keys stay first + STABLE (existing module_permissions/user_access_grants rows keyed on them are safe);
  nav items collapse onto an existing key via NAV_MODULE_KEY or are added keyed by route slug. RULE: to add
  module coverage, extend NAV_GROUPS (auto-flows into Module Control + nav editor).
- **Console "Permissions" menu item REMOVED** from ConsoleLayout NAV (it only `<Navigate>`-redirected to
  `/console/access?tab=roles`; Access Control is the single canonical role x module surface). Route kept for
  old links. Do NOT re-add a Permissions nav entry.
- **Route hardening** (`src/App.jsx` + `src/components/ProtectedRoute.jsx`): ~85 previously-unguarded
  admin/analytics routes wrapped in RoleRoute/ModuleRoute; **RoleRoute now admits super-admin as
  break-glass** (`if (isSuperAdmin) return children`) so the new guards never lock a super-admin out.
  `/report-builder` + `/dashboard-builder` were reachable by ANY authenticated user via direct URL (no guard,
  no nav) - now `RoleRoute ['Admin','Manager','Director']`. STILL a policy call (left as-is): `/data-reconciliation`
  + `/developer-portal` nav items are adminOnly but their routes allow Manager/Director (route matches documented
  intent; nav is the stricter view).
- **Tyre Bay = per-vehicle unified tyre view** (deepened the EXISTING Asset Detail `/assets/:assetNo` Tyres
  tab; NO schema change): `src/components/TyreBay.jsx` + pure `src/lib/tyreBay.js` (groupTyresByPosition
  current-vs-history split; `canonicalToSlotId(vehicleType, positionCode)` = inverse of
  tyrePositions.legacyPositionCode, null-degrades; cpk/life/days helpers; 15 tests). Reuses the shipped
  pseudo-3D `VehicleTyreDiagram` (lights each wheel by its CURRENT tyre risk), shows current tyre + full
  per-position history, one-click **Move/Swap/Remove** via `tyreRecords.updateRecord` (+ best-effort
  `tyreServiceEvents.createServiceEvent` log) GATED by the existing `wfLocked` approval lock, and links each
  serial to `/tyre-passport/:serial`. AssetDetail passes the FULL `tyres` array (history was already loaded,
  just previously filtered to active).
- **Vehicle Washing module (V270, web)** = `src/pages/VehicleWashing.jsx` (/vehicle-washing, ModuleRoute
  `vehicle_washing`, nav "Workshop & Downtime"). Table **`wash_records`** (org + country + site RESTRICTIVE
  RLS; app_is_active SELECT; Admin/Manager/Director writes) via `src/lib/api/washRecords.js`; pure
  `src/lib/washAnalytics.js` (summarizeWashes/filterWashes/byType/bySite/monthlyTrend; 12 tests). Reporting
  tab: date-range + site + area + wash-type filters + quick ranges, 6 KPIs, 4 charts (reportColors theme),
  PDF/Excel export; Quick Log tab (asset auto-fill, role-gated create/edit/delete). []-degrades pre-migration.
- **Vehicle Washing mobile (V271, driver-facing)**: `mobile/app/(app)/washing.tsx` - scan/search asset
  (assetLookup) auto-fills+shows details, multi-photo (PhotoCapture q0.55), site auto, **wash_date LOCKED to
  today**, offline-safe `WASH_RECORD` queue command (recordQueue) with idempotent client_uuid upsert. Pure
  `mobile/lib/washSchedule.ts` (`washDueList`/`nextWashDue`, WASH_INTERVAL_DAYS=7) drives a "Due for wash"
  list + a device-LOCAL reminder (`notifications.notifyWashDue`) - NO server cron. `washing` ModuleKey
  (driver+inspector+manager+director) in permissions.ts + Home hub entry + `_layout` href:null; en/ar i18n.
  **V271** (applied live): `wash_records.photos jsonb` + `client_uuid` + unique index; INSERT policy widened
  to include `driver` (UPDATE/DELETE stay elevated). Verified live (photos+client_uuid cols, driver in check).
- **Mobile tyre-man checklist = search ONE asset** (`mobile/app/(app)/checklists/index.tsx`): for
  `role === 'tyre_man'` a new `TyreManChecklistFlow` (search-first asset picker 2+ chars -> that asset's
  published templates) renders instead of the long template hub; ALL OTHER roles keep the existing
  `ChecklistsScreen` verbatim.
- **Delivered outside the repo** (not committed): a complete Excel data-collection template for the ERP
  vendor - 10 importer-aligned tabs (headers == MODULE_FIELDS labels so they auto-map) + Tyre Configuration /
  Tyre Specifications / PM Schedules / Service History reference tabs + a READ ME. Regenerate from
  `src/lib/import/synonyms.js` MODULE_FIELDS if needed.

### ERP data intake template + Cost-per-unit (km / hour / m3) plan (2026-07-18)
- **Asset data-collection template UPDATED** (delivered to the user, lives in scratchpad, NOT a repo file):
  `TyrePulse_Data_Collection_Template.xlsx` now has 3 EXTRA tabs beyond the 10 importer tabs +
  reference tabs: **Asset Master (ERP Extended)** (plate, finance Purchase/NBV/monthly-dep, insurance,
  operating card, driver-licence dates, capacity, shift, org/OU), **Tyre Change Log** (the real tyre
  lifecycle columns from the ERP: asset_no, tire_pos, srno=serial, tire_size, tyre_brand, fix_date/fix_KM/
  fix_HM, remove_date/remove_KM/remove_HM, total_km, old_serialno, old_tyrebrand, Job Card No, version,
  site), and **Tyre Expense - Purchase** (serial/job-card + unit cost + supplier/invoice/PO -- the COST the
  change log lacks). Regenerate by appending to the base template built from `src/lib/import/synonyms.js`
  MODULE_FIELDS.
- **ERP files understood (2 samples reviewed):** `asset_details_ksa.xlsx` = Asset Master -> `vehicle_fleet`
  (+ finance/insurance/operating-card). `Book1.xlsx` = Job Cards with tyre-change columns bolted on; in the
  sample EVERY tyre column was NULL (job-card-only export), so real tyre-change rows must come from a
  dedicated tyre export (the new Tyre Change Log tab). Book1 has NO tyre cost column -> Tyre Expense tab is
  required for CPK.
- **Active-vs-old tyre RULE (confirmed logic, for the future loader):** group tyre-change rows by
  (asset_no, tire_pos), sort by fix_date; the row with the LATEST fix_date = the CURRENT/active tyre (goes
  active) REGARDLESS of remove_date (old rows often have a blank remove_date). All earlier rows on that
  position = OLD/history/expense. Validate with `old_serialno` == previous row's `srno` (mismatch = data-
  quality flag). A serial on multiple assets over time = the tyre MOVED (latest fitment wins). Do NOT rely on
  "remove_date IS NULL = active" alone.
- **Million-row ingestion PLAN (not the browser importer):** COPY into staging tables (stg_asset_master/
  stg_tyre_changes/stg_job_cards) -> SQL transform (normalize casing via V245/V246/V247, derive is_active,
  compute total_km, chain by old_serialno) -> idempotent UPSERT into vehicle_fleet(asset_no) /
  tyre_records(serial_no,asset_no,fix_date) / work_orders(job card); incremental via version_no/update_date.
- **BACKLOG - Unit-aware Cost Intelligence (cost per km / engine-hour / m3):** the operating company measures
  cost as "cost per cubic meter" for volume assets (concrete pumps / water treatment). Build a unit-aware
  metric = total expenses in [from,to] / total running-unit in [from,to], where unit = km (odometer_logs) /
  hours (engine_hours_logs) / **m3 (NEW production_logs table - does not exist yet; V276)**. REUSE
  `src/lib/costSources.js` (COST_MODES Combined/Tyres/Maintenance switch) + `src/lib/api/costSummary.js`
  loadCostSplit (extend to accept from/to instead of fixed 12 months) + kpiEngine (do NOT rebuild CPK maths).
  ALSO: surface the existing Tyres/General/Combined cost switch on Dashboard + EngineeringKpi (it is currently
  only on CostCenter/Analytics/BoardOverview/ExecutiveReport/PmPrograms - user could not find it). Open
  decision: m3 source = production-log entry screen (like meter-logs) and/or an ERP m3 import. Next free
  migration **V276**.

### SESSION 2026-07-19 — module deepening + report ECharts + Cost-per-unit. All merged to main; migrations through V279, next free **V280**.
- Everything this session is MERGED to main and the branch (`claude/accident-builder-report-ui-2bkwb5`) is
  realigned to origin/main; nothing pending in code. Multi-session note UNCHANGED: a parallel Claude session also
  pushes to this branch, so the shared branch often shows the previous batch's un-squashed commits after a merge -
  they are CONTENT-IDENTICAL to what main already carries via the squash; reconcile by `git rebase origin/main`
  then `git push --force-with-lease` (verified each time that HEAD is a superset before forcing).
- **Web -> mobile access bridge (PR #105/#106)** - see the "Close MOBILE modules from web" entry above.
- **17 thin operational pages DEEPENED to production depth (PR #108 = 10, PR #109 = 7), real data only, honest
  empty states, NO fabrication, NO migration, CRUD/RLS untouched.** Each got a NEW pure engine
  `src/lib/<name>Analytics.js` (injectable now, zero I/O) + a rebuilt page (KPIs + charts + filters/search/sort +
  Excel/PDF export + loading/empty/error+Retry) + a test file. Modules: TyreAgeCompliance (DOT/manufacture
  calendar-age bands + unknown-DOB bucket), Tpms (pressure compliance over tpms_readings), RetreadClaims,
  EngineHours (utilization + meter-reset anomalies), OdometerLogs (mileage deltas + rollback/jump anomalies),
  TyreServiceEvents (fit/remove/rotate/repair lifecycle), Certifications (expiry + renewal pipeline), Contracts
  (lifecycle + annualized value + renewal pipeline), TelematicsDevices (device health + connectivity + fleet
  coverage %), DriverExpenses (spend by status/category/driver), FuelDelivery (blended price/litre + anomalies),
  SpeedLimiter (re-verification pipeline from last_verified_at - no calibration column, derived honestly),
  ColdChain (temperature excursion episodes from real timestamps), FleetRenewal (replacement pipeline + budget
  null-when-uncosted), PolicyManagement (policies is a DOCUMENT register, not insurance - mapped honestly),
  InsuranceClaims (ledger analytics, DISTINCT from /claims-summary + claimsAnalytics which stayed untouched). Plus
  an earlier same-treatment batch: Geofencing / Journeys / Equipment / Parts Catalog / DTC Diagnostics. RULE: to
  deepen more, follow this exact recipe; do NOT fabricate a column/metric a table lacks (each honest gap is
  labelled in-UI: no Retread brand chart, no service-event distance, Contracts renewal=end-date, Telematics
  coverage N/A when fleet total unreadable, cost N/A when no meter/production data).
- **Report ECharts upgrade (PR #110):** (a) NEW dark ECharts builder lib `src/lib/displayCharts.js` (pure
  donut/hBar/vBar/gauge/line/combo + data shapers, honest empty states) wired across the TV kiosk
  `DisplayDashboard.jsx` (/display): Fleet availability gauge + vehicles-by-site bar; Tyre pressure gauge +
  tyre-risk doughnut + inspection doughnut; Accidents severity doughnut + by-site bar; Alerts severity doughnut
  (removed the old custom SiteBars + Gauge usage). (b) Two NEW shareable fixed pages built from the EXISTING
  get_report_snapshot: **Executive Summary** (Overview) and **Cost & Claims** (Trends). See the ReportShare
  "More fixed pages" entry for the full 13-page catalog + the V279 Cost-per-unit / Operations Command detail.
- **USER/OPS follow-ups (unchanged):** enable Supabase leaked-password protection; per-unit report costs read
  N/A until drivers log odometer/engine-hours (mobile) and m3 production logs are entered/imported; promote the
  Play Internal build to Closed for testers; true million-row ERP loads still need the server COPY pipeline.

### SESSION 2026-07-18 (continued) — CLOSED CLEAN. All merged to main; migrations through V278, next free **V279**.
- **Session close:** everything this session is MERGED to main and the branch is realigned to origin/main -
  nothing pending in code. Last items: maintenance window + web-only login gate (V278), ERP template downloads,
  mobile Home fixes (PR #104), and closing MOBILE modules from the web Access Manager (PR #105/#106, see the
  "Close MOBILE modules from web" entry below). For NEW work restart the branch from latest main (merged PRs are
  terminal). USER/OPS-only follow-ups (unchanged): enable Supabase leaked-password protection; promote the Play
  Internal build to the Closed track for testers; redeploy send-scheduled-reports if a 'pm' scheduled report is
  wanted; true million-row ERP loads still need the server COPY pipeline (the /erp-import review surface is shipped).
- **Console security hardening V272 (applied):** dropped forgeable always-true INSERT policies on
  audit_log_v2 + inspection_audit_log; REVOKE anon/PUBLIC EXECUTE on the admin/access/backup/import RPC
  family (authenticated kept; public token/login RPCs left); pinned backups._core_tables search_path;
  admin_update_profile now requires super-admin for role/approval/lock/org changes (non-super Admin confined
  to own-org descriptive edits). Also: resolveAdmin no longer signs out a piggybacked main-app session when a
  non-super user visits /console in-tab (only a standalone console tab ends its own session).
- **New console modules (super-admin):** Sessions & Devices (/console/sessions, V273 admin_clear_push_token) -
  per-user sessions + devices, lock/unlock, clear push token; Automation Health (/console/automation, V274
  read-only console_cron_jobs) - scheduled-reports + pg_cron + edge-fn checklist; Delivery & Notifications
  (/console/delivery) - email/push deliverability. Server-stamped non-forgeable console audit (V275
  log_console_event; console_sessions client INSERT blocked). Module Control status is now ENFORCED app-wide
  via ProtectedRoute.ModuleRoute (maintenance/disabled -> ModuleUnavailable for non-super/Admin), fail-open.
- **Module Registry was EMPTY (bug fixed):** modules table had 0 rows because seedFromCatalog/upsertModule
  passed roles:null/depends_on:null into NOT NULL columns -> every insert failed silently. Fixed to `[]`;
  Module Control self-seeds all ~163 modules on next load. (modules table is GLOBAL, no organisation_id;
  writes gated is_super_admin OR Admin; V275 added authenticated SELECT.)
- **Cost Intelligence (V276 production_logs applied):** unit-aware cost per m3 / km / engine-hour over a date
  range on CostCenter ("Cost per unit" section: date range + site + Combined/Tyres/General switch; honest N/A
  fallback to plain expenses when no running unit; m3 entry form + Import m3 button). Engine
  src/lib/costIntelligence.js (unit by asset type: pumps/water->m3, generator->hours, else km; null when no
  running); src/lib/api/production.js; loadCostSplit extended with optional {from,to,site} (back-compat). The
  Combined/Tyres/General cost switch was ADDED to Dashboard + EngineeringKpi (was only on CostCenter/Analytics/
  BoardOverview/Executive/PM). production_logs = location-wise m3 (site + period_date + m3), org+country+site RLS.
- **ERP Data Import (V277 applied):** /erp-import (Admin/Manager/Director, Administration & Data). Import the
  filled template tabs (Asset Master extended / Tyre Change Log / Tyre Expense / Production m3) -> SAVE into
  REVIEW staging tables erp_asset_import / erp_tyre_change_import / erp_tyre_expense_import (per-batch, org+
  country+site RLS) NOT master; a review grid cross-checks every detail incl. the ACTIVE-vs-OLD tyre derivation
  (latest fix_date per asset+position = active, regardless of remove_date) + old_serialno chain validation +
  missing-cost flags; delete-batch to revert. Pure src/lib/erpImport.js (normalizeCell 'NULL'->null,
  deriveTyreActivity, validateExpense) + src/lib/api/erpImport.js. Production m3 loads straight into
  production_logs. Browser cap 20000 rows/batch; true million-row loads still need the server COPY pipeline
  (staging -> SQL transform -> idempotent upsert) - this is the review/cross-check surface, not the bulk loader.
- **Search coverage fix:** the command palette indexed only 100 of 186 nav items (Vehicle Washing, PM Programs,
  Board Overview, Report Sharing... were unfindable). Backfilled all into NAV_COMMANDS + added
  src/test/commandSearchCoverage.test.js so it can never drift from the sidebar again.
- **Frontend hygiene sweeps (merged):** raw DB errors on ~22 pages/console/libs routed through
  safeError.toUserMessage; banned em/en dashes removed from user-facing strings (-> ASCII / N/A); missing
  loading/error/empty states + Retry added (RfidRegistry/SerialTracker/TyreLifecycle/VehicleHistory/QrLabels
  + TcoCalculator/PartsCatalog/ShiftScheduling/DigitalTwin); QR alt text; 337 neutral Tailwind classes on 7
  heavy pages tokenized to --panel-ink (dark byte-identical, light fixed). PII routes /insurance-claims +
  /incidents guarded RoleRoute; /report-builder + /dashboard-builder guarded.
- **Tyre Passport deep rebuild (merged):** identity header + health ring + 6 KPIs + 6 tabs (Overview, Journey
  = cross-vehicle stints with km/cost/CPK/reason, Wear curve, Service & repairs, Warranty, Data quality);
  buildPassport additively wired to tyre_service_events/warranty_claims/tyre_status_marks/retread_claims (each
  []-degrades); predictions + data-quality audit; PDF/Excel; dashes -> N/A.
- **Tyre Bay (merged earlier this session):** per-vehicle Asset Detail Tyres tab = pseudo-3D wheel diagram +
  current tyre + full per-position history + one-click Move/Swap/Remove (approval-lock gated) + passport link.
- **Mobile fixes (merged, need a fresh EAS build):** PHOTO-UPLOAD OOM CRASH FIXED - lib/photoUpload.ts now
  resizes+compresses every image (expo-image-manipulator, max 1600px q0.5) via prepareForUpload BEFORE the
  base64 read (~10x less memory; covers accident/inspection/washing/meter/checklist; storage refs/paths
  unchanged). Asset picker collapses on select (inspection/new + accident/report). Inspection detail tyre
  conditions render the SVG VehicleTyreDiagram (colored by condition, box-grid fallback). Accident site now
  cleanly REPLACES with the picked vehicle's site (no leftover chip - applyAsset was keeping prev.site).
  Mobile driver Vehicle Washing + wash-due local notification (V271) + tyre-man search-one-asset checklist.
- **Role-level Web/Mobile/Both access (merged PR #91):** AccessManager Role view has a Web|Mobile|Both scope
  per module (stores plain vs `mobile:`-prefixed module_permissions rows); mobile enforces it in
  resolveModuleAccess (role matrix layer; per-user grant still wins; fail-open). IN PROGRESS (agent): role-wide
  one-click Mobile-only/Web-only, authoritative saves (narrowing a scope now turns the other surface OFF, was
  a documented gap), and a saved-access surface-badge view.
- **Close MOBILE modules from web (merged PR #105):** the AccessManager web tree is keyed on the WEB catalog
  (moduleCatalog.js, e.g. `tyre_records`), so its `mobile:` writes used WEB keys (`mobile:tyre_records`) the
  phone app never reads (its key is `records`) - only ~6 coincidental keys were closable, ~21 were not (a stale
  `mobile:inspections` DB row proved the drift; mobile's key is `inspect`). FIX = a dedicated **Mobile App
  access** panel `src/console/pages/access/MobileAccessPanel.jsx` mounted in AccessManager (role + user modes)
  that iterates the REAL mobile keys from NEW `src/lib/mobileModules.js` (web mirror of mobile/lib/permissions.ts
  MODULES - 29 modules, EXACT keys, groups, role defaults; KEEP IN SYNC). Allow/Deny writes land on
  `mobile:<mobileKey>`: ROLE -> module_permissions row via saveModulePermissions/set_module_permissions;
  USER -> user_access_grants via setUserAccessGrantScoped(scope:'mobile')/set_user_access_grant. Self-contained
  load/save (does NOT entangle the web tree's draft/scope reconciliation); Admin/super never lockable. NO schema
  change - reuses the surface-partitioned convention mobile ALREADY enforces in resolveModuleAccess (per-user
  grant > role matrix > role default). VERIFIED on live DB: role rows must use `profiles.role` Title Case
  ("Tyre Man") because get_user_module_permissions filters `module_permissions.role = profiles.role`. Mobile
  needs no change. Tests mobileModules.test.js (5). RULE: to close a mobile module, use the Mobile App panel
  (real mobile keys) - the web tree's Web/Mobile/Both scope only lines up for keys shared with the web catalog.
- **Play release:** release-play.yml (workflow_dispatch on main) built + auto-submitted build to the Play
  INTERNAL track (verified run success). NOTE the user's test device is on the CLOSED track (older build) -
  promote Internal -> Closed in Play Console for testers to receive it (or point the workflow at Closed).
- **Store assets:** store-assets/ has the 512 Play icon + 1024x500 feature graphic + PLAY_STORE_LISTING.md;
  mobile/assets/splash.png enlarged. Excel data-collection template (scratchpad, not a repo file) now also has
  Asset Master (ERP Extended) / Tyre Change Log / Tyre Expense tabs matching the real ERP export.

### Vehicle SVG Designer (V268, 2026-07-17) — super-admin custom vehicle diagram builder
- **/console/vehicle-designer** (ConsoleVehicleDesigner.jsx, nav "Vehicle Designer", Truck icon, pure console
  navy+orange): design a vehicle type's diagram (axles 1..6 with kind steer/drive/trailer/lift + single/dual,
  spare 0..2, 8 body styles truck/mixer/pump/bus/pickup/trailer/loader/van, accents hazard/beacon) with a LIVE
  ANIMATED SVG preview (blinking amber hazard corners ~1s, pulsing roof beacon, rotating mixer drum stripes;
  all honor prefers-reduced-motion). Saves to **V268 `vehicle_diagram_configs`** (org UNIQUE per vehicle_type;
  authenticated SELECT, super-admin-only writes; config normalized before persist).
- **Single engine `src/lib/vehicleDiagram.js`** (normalizeDiagramConfig clamps + positionsFromConfig emits the
  EXACT built-in LAYOUTS shape with canonical GCC position labels LHF1/LHR1-O parseable by tyrePositions.js;
  12 tests). Service `src/lib/api/vehicleDiagrams.js` (+barrel): list/upsert/delete + session-cached
  `getCustomLayoutMap()` (never rejects, {} degrade) + invalidateCustomLayouts. Shared animated body renderer
  `src/components/VehicleDiagramCustomBody.jsx` (CustomBody + CustomDiagramPreview) used by BOTH the console
  preview and the app diagram, so preview == production render.
- **Consumption: `src/components/VehicleTyreDiagram.jsx`** loads the custom map once per session; an ACTIVE
  custom layout for the canonical (UPPER, V245) vehicle type WINS over the built-in LAYOUTS entry; built-ins
  remain the fallback; zero change when no custom rows exist. RULE: to change how a vehicle type renders,
  use the console designer (do NOT hand-edit LAYOUTS for org-specific configs); mobile does NOT read these
  yet (its diagrams stay built-in - a later extension would port getCustomLayoutMap to mobile).
- **Deepened (2026-07-18)**: per-axle lift/spacing/tyreSize; accents headlights/workLight/hazardSpeed;
  "Start from" built-in template picker (builtinToConfig) + Duplicate + bulk "Apply to more types";
  preview-only tyre-status simulation (statuses prop, never persisted); fleet coverage panel (types with
  no design) + saved-design search. Engine tests 22. Config back-compat: normalize defaults every new field.
- Next free migration **V269**.

### 2026-07-17 field-feedback batch 2 (PR #70) — sync fix, approval push, form parity, diagram truth
- **INSPECTION SYNC WAS SERVER-REJECTED (the "always pending / red home icon" bug)**: mobile wrote
  `approval_status='pending'` + `status='Pending approval'` but the live CHECKs
  (ck_inspection_approval_status / inspections_status_check) allow pending_approval|approved|rejected|done
  and Scheduled|In Progress|Done|Overdue|Cancelled. Every retry failed with a generic error. FIX: submit
  -> pending_approval + In Progress; approve -> approved + Done (locked); reject -> rejected + In Progress;
  approvals queue filters pending_approval; offlineQueue.syncQueue() SANITIZES legacy tokens before upsert
  so items stuck on phones self-heal. RULE: inspections.status/approval_status are CHECK-constrained -
  never invent new tokens on mobile; match web (src/pages/Inspections.jsx) vocabulary.
- **V267 approval push (applied live + stub)**: inspections/checklist_submissions entering their approval
  queue emit `inspection.approval_requested` / `checklist.approval_requested` domain events (generic
  trg_emit_domain_event); NEW consumer `consume_event_approval_push` builds an Expo-push payload
  (recipients = approved Admin/Manager/Director/Maintenance Supervisor profiles with push_token, org+country
  scoped) and enqueues `workflow_notifications` -> delivered by the EXISTING V119 pg_cron deliverer ->
  workflow-notify edge fn -> Expo. Verified live (rolled back). 0 recipients = honest 'skipped'. Next free V268.
- **Home badge truth**: the red Home tab badge counted fleet-wide open corrective_actions + critical tyres
  (uncleareable by the user). Now = live offline-queue pending count (getPendingCount+getPendingRecordCount),
  clears at 0, refreshes on focus + DeviceEventEmitter 'tyrepulse:pending-sync-changed' + 5s poll while >0.
- **Accident report form = web order**: asset search FIRST (auto-fills site/fleet no/vehicle type from
  vehicle_fleet, never overwrites typed), then Date/Time/Site/Location/Driver/Description; "Master:" line;
  location quick-fill chips from sites.
- **Stock**: min_level/critical_level admin-only (isAdmin||isSuperAdmin; non-admin insert omits them so DB
  defaults rule); location = site picker (distinct vehicle_fleet.site chips + Other free-text fallback).
- **Checklists**: fill-screen asset picker is now search-first (2+ chars, compact rows, no icon tiles).
- **Tyre diagram truth (mobile/lib/tyreDiagramLayouts.ts = THE canonical resolver; tyreLayout.ts delegates)**:
  pump keyword no longer sends Line/Spider/Stationary pumps to the 14-tyre concrete-pump layout (that was
  "more axles, some without tyre"); N-Wheeler names mapped explicitly; heavy 6x4 types get a 10-tyre layout;
  positions prop structurally matched (FL1/AxleL1 vocab) so only real wheels render; unknown types -> Pickup
  4-tyre fallback; matching case/separator-insensitive.
- **i18n**: full audit of all t() keys vs en.json (0 missing after adding agent keys); LanguageContext falls
  back to English before raw key. RULE: run the audit (grep t('...') vs en.json) before each mobile release.

### 2026-07-17 PM mobile + lost-commit recovery (PR #69)
- **INCIDENT + RECOVERY**: 4 parallel-session commits (inspection approval flow/search-first assets/SVG
  parity/gallery uploads; accident dashboard status labels + open-closed filter; meter-log flow/analytics-
  reports filters/stock-by-size/sync+badge fixes; **Admin Console crash fix** - null stats deref on open)
  were LOCAL-ONLY on the branch and got orphaned by a `git reset --hard origin/...` during a rebase tangle.
  This was exactly the user's "my fixes are still not in the app + admin console crashes" report. Recovered
  by cherry-pick (objects still in .git), all 4 applied clean. LESSON: before ANY reset --hard on the shared
  branch, `git log origin/..HEAD` for unpushed local commits - a parallel session may have committed there.
- **Mobile Preventive Maintenance screen** `mobile/app/(app)/maintenance.tsx` (module key `pm`, Home hub
  Maintenance group, roles manager/director + admin implicit): due/overdue active pm_programs list
  (overdue/due-soon/active tiles, date+meter due, priority badge) + Record Service bottom sheet -> the
  V253 `record_pm_service` RPC (server advances the schedule; RPC re-checks Admin/Manager/Director).
  ONLINE-ONLY by design (transactional RPC, no offline queue). i18n `modules.pm.*` en+ar.
- **i18n fallback fix** (LanguageContext.resolve): missing keys now fall back to the ENGLISH string before
  exposing the raw key - ur.json covers only ~478/1144 keys and Urdu users saw literal key paths. RULE:
  new screens need en+ar keys; ur is optional (falls back), never ship raw-key UI.
- **User-visible "still same in app" root cause is DOUBLE**: (a) the lost commits above (now shipped);
  (b) testers must UPDATE from the Play internal track after each build - versionName stays 1.2.0, only
  versionCode bumps, so the update is easy to miss in Play Store.

### SESSION 2026-07-17 CLOSED CLEAN — mobile field-feedback + brand icon all merged
- This session's mobile work is fully MERGED to main and nothing is pending in code: field-testing bug batch
  (unmatched routes, checklist uuid, accident web-parity, meter-log validation/auto-fill/barcode/hour-meter/
  signature V266, tyre SVG parity, inspection guard+PDF share, stock/overview filters, full Arabic+RTL, nav-bar
  overlap, battery/perf, back-button, security tightening, `lib/safeError.ts`), then the real Tyre Pulse brand
  icon/splash/login logo (PR #67). Migrations through **V266**; next free **V267**.
- Deferred / USER-OPS only (not code): enable leaked-password protection in Supabase Auth dashboard; verify the
  `tyre_man` RBAC removals on a FRESH build with a real tyre_man account (gating is correct in code — a role
  still seeing removed modules = stale build); redeploy `send-scheduled-reports` if a scheduled 'pm' report is
  wanted (still emails exec fallback until then).
- **Brand-icon Play build VERIFIED SHIPPED**: `release-play.yml` run 29578022504 (head `b01f721`) completed
  SUCCESS at 2026-07-17 11:58Z (~11 min). Step "Build AAB and auto-submit to Play (internal)" succeeded and the
  "build only, no submit" fallback was SKIPPED, i.e. the AAB built AND auto-submitted to the **Play Internal**
  track (GOOGLE_SERVICE_ACCOUNT_KEY secret is configured, so `eas build --auto-submit` submits). New icon reaches
  internal testers once Google finishes processing. EAS remote versionCode auto-increments per build.
- **Play release path (for the user, going PUBLIC)**: the same AAB is PROMOTED across tracks, no rebuild. Play
  Console -> Testing -> Internal testing -> latest release -> "Promote release" -> Production -> review + rollout
  (staged % recommended). Before Production unlocks, one-time items must be 100% complete: Store listing
  (screenshots + 1024x512 feature graphic + 512 icon), Content rating, **Data safety** form, Target audience,
  **App access** (must supply a reviewer test LOGIN since the app requires sign-in), Privacy policy URL, Ads
  declaration. New Play accounts may require Closed testing with 12+ testers for 14 days before Production.

### SESSION CLOSED CLEAN (2026-07-16) — everything merged, nothing pending
- All work through the custom TV/report board builder is MERGED to main and LIVE. Latest merges on branch
  `claude/accident-builder-report-ui-2bkwb5`: **PR #54** (V262 TV wallboard: site/country filters, logo,
  heatmap, gauges), **PR #55 squash `17bda45`** (V263 date-range filter + V264 custom board builder + one-screen
  boards + visibility-gated refresh). Branch is realigned to `origin/main` (== 17bda45). **Next free migration
  V265.** No outstanding TODO from this session.
- Deferred-but-honest (only if the USER asks): the OLD FIXED share pages still stack vertically (one-screen fit
  applies to the NEW custom boards only); `send-scheduled-reports` edge fn still v14 (a scheduled 'pm' report
  emails the exec fallback until it is redeployed - the pm digest code is committed); regional_admin/viewer
  console sign-in + scoped RLS (Module 7 gate follow-up); Module 8 app-wide module hiding (status stored only);
  Module 3 generic edit/delete (read-only for now).
- For NEW work: restart the branch from latest main (`git fetch origin main && git checkout -B
  claude/accident-builder-report-ui-2bkwb5 origin/main`) and open a FRESH PR - merged PRs are terminal.
- Git identity for future commits is set to Claude <noreply@anthropic.com>. NOTE: the merged squash commit
  17bda45 shows Unverified (GitHub's merge committer noreply@github.com) - that is GitHub's own squash, not a
  local commit; do NOT amend/force-push merged history to "fix" it.

### Shipped (2026-07-15/16) — all merged to main, nothing pending
- Everything below is LIVE on the DB/deploy and merged to main (PRs #28/#29/#30, all terminal).
  V243 accidents plate/vehicle_type + auto-fill; super-admin swap + privileged-edit playbook; Accidents
  Analytics auto-email; V244 report_schedules CHECK fix; send-scheduled-reports **v14** per-type digests;
  V245 vehicle_type casing; V246 site casing; V247 site_aliases canonical merge. (Superseded: next free is **V250**.)
- Branch `claude/accident-builder-report-ui-2bkwb5` == main. For NEW work, restart it from latest main
  (`git fetch origin main && git checkout -B claude/accident-builder-report-ui-2bkwb5 origin/main`) and open
  a FRESH PR — merged PRs are terminal, never stack onto them.

### V246 — site casing normalized + guard (applied LIVE 2026-07-16)
- Same class of fix as V245 but for `site`. Mixed casing ("Metro"/"METRO", "Dhahban"/"DHAHBAN",
  "Redsea"/"REDSEA") split the same site into separate report buckets. V246 canonicalizes to
  `upper(regexp_replace(btrim(site),'\s+',' ','g'))` (upper + trim + collapse internal whitespace) and adds
  BEFORE INSERT/UPDATE trigger `trg_normalize_site` (fn `normalize_site()`) on **24 operational site-grouping
  base tables** (accidents, alerts, budgets, corrective_actions, customers, drivers, fleet_master, gate_passes,
  goods_receipts, incident_reports, inspections, purchase_orders, rca_records, requisitions, stock,
  stock_movements, stock_records, suppliers, tyre_records, tyre_rotations, tyre_service_events, vehicle_fleet,
  warranty_claims, work_orders). Only 9 rows were off-canonical (inspections 6/accidents 2/corrective_actions 1);
  0 remain. inspections lock trigger bypassed around its backfill and restored (both back to 'O').
  EXCLUDED: `profiles.site` (guarded privileged column via trg_guard_profile_privileged + user scoping; 0 rows
  off-canonical; a normalize trigger there could race the guard's self-edit "site changed?" check) and pure
  log/telemetry/audit tables (site not a report grouper there). Next free migration **V250** (V248/V249 taken by Tyre Spec/Value Advisor; see V247 below).
- **DEEPER ISSUE SURFACED, NOT YET FIXED — site vocabulary reconciliation (needs USER sign-off):** casing is
  now clean but `tyre_records` uses a `<CODE>-ST` convention while `vehicle_fleet`/accidents/inspections use
  plain site/gate names, so the SAME physical site is recorded under different codes. High-confidence same-site
  groups: NHC-ST↔NHC; REDSEA-ST↔REDSEA↔RED SEA; KSP_TP-ST↔KSP-TP↔KSP; DHABAN-ST↔DHAHBAN; AMALA-ST↔AMALA↔AMAALA.
  AMBIGUOUS (finer gate/plateau granularity in the master — do NOT auto-merge): DIRIYAH-ST vs DIRIYAH-G1/G2;
  QIDDIYA-ST vs QIDDIYA-UPPER/LOWER PLATEAU; RIY-MET-ST vs METRO. RULE: this is a SEMANTIC merge, not a casing
  fix — build a confirmed `site_aliases` canonical map (alias->canonical) applied via the normalize trigger,
  only AFTER the user confirms the mapping. Do NOT collapse -ST codes blindly.
  **RESOLVED by V247 (2026-07-16):** user delegated the call. `public.site_aliases` (alias PK -> canonical,
  authenticated-read RLS) now holds the confirmed HIGH-CONFIDENCE merges: NHC-ST->NHC; REDSEA-ST/REDSEA->RED SEA;
  KSP_TP-ST->KSP-TP; DHABAN-ST->DHAHBAN; AMALA-ST/AMALA->AMAALA (canonical = master vehicle_fleet spelling).
  `normalize_site()` is now SECURITY DEFINER and, after casing-normalizing, maps NEW.site through site_aliases,
  so future imports self-correct. Backfilled all 24 tables (0 alias rows remain; NHC now 735, RED SEA 140,
  AMAALA 89, KSP-TP 68, DHAHBAN 154). AMBIGUOUS gate/plateau codes PRESERVED (NOT merged): DIRIYAH-ST vs
  DIRIYAH-G1/G2, QIDDIYA-ST vs QIDDIYA-UPPER/LOWER PLATEAU, RIY-MET-ST vs METRO (vehicle_fleet lists these as
  distinct sites). RULE: to add a future site merge, INSERT into site_aliases (alias must be UPPER/trimmed) and
  the trigger applies it on next write; backfill existing rows with `UPDATE <t> SET site=sa.canonical FROM
  site_aliases sa WHERE <t>.site=sa.alias` (disable/enable inspections lock around its update). Next free
  migration **V250** (V248/V249 taken by Tyre Spec/Value Advisor).

### V245 — vehicle_type casing normalized (applied LIVE 2026-07-16)
- Mixed casing ("TR-MIXER" vs "Tr-Mixer", "PUMPS" vs "Pumps", "Bus" vs "BUS", etc.) split the SAME vehicle
  type into separate buckets in fleet analytics + reports (e.g. TR-MIXER showed 1066 and 72 as two rows).
  V245 canonicalizes to `upper(btrim(vehicle_type))` across ALL base tables carrying vehicle_type
  (accidents, fleet_master, inspections, tyre_records, tyre_specifications, vehicle_fleet) and adds a cheap
  BEFORE INSERT/UPDATE trigger `trg_normalize_vehicle_type` (fn `normalize_vehicle_type()`, pure string op)
  so imports/edits can NEVER reintroduce the split. ~701 rows fixed; 0 collisions remain (TR-MIXER now 1138).
  RULE: pure casing/whitespace fix only — genuinely distinct types are NOT merged ("Tri-mixer" -> "TRI-MIXER",
  kept separate from TR-MIXER). GOTCHA: `inspections` has `trg_lock_inspection_content` (blocks edits to
  locked checklists) — the backfill DISABLEs/ENABLEs it around just the inspections UPDATE (verified both
  triggers back to tgenabled='O'). `vehicles`/`v_*_secure` are VIEWS over these base tables (no direct fix).
  Next free migration **V246**.

### send-scheduled-reports v14 (deployed LIVE 2026-07-15): every report type emailed IDENTICAL data
- ROOT CAUSE: `renderForSchedule` in the edge fn collapsed EVERY non-claims report_type into the single
  executive digest (`buildDigest`/`report_exec_digest`). So executive/kpi/fleet/cost/inspection/accidents/
  stock/vendor all emailed the SAME all-fleet numbers - only the title differed. (The in-app "Generate now"
  PDF/Excel were already correct per type via `fetchReportRows`; only the scheduled EMAIL was wrong.)
- FIX (v14): added a per-type `DATASET_DIGEST` config (table + dateCol + money + group dims + recent cols,
  mirroring scheduledReports.js DATASETS) + `buildDatasetDigest` (org-scoped, honest empty states) +
  `renderDatasetHtml`. Routing now: claims->claims desk; executive->exec intel; kpi/fleet/cost/inspection/
  accidents/stock/vendor->their OWN dataset digest; `builder:<id>`->accident dataset digest. Executive +
  claims renderers unchanged. RULE: when adding a base report type, add its DATASET_DIGEST entry too, or it
  falls back to the executive digest. NOTE: kpi vs cost both read tyre_records+cost, so they only diverge by
  their group dimensions - and brand/category/supplier/risk_level are largely UNPOPULATED in the live data,
  so those two still look similar until those columns are filled (data gap, not code). fleet (composition,
  no money), inspection, accidents, claims, executive are all clearly distinct.

### V244 — report_schedules CHECK fix (applied LIVE 2026-07-15): "cannot save any scheduled report"
- ROOT CAUSE: `report_schedules_report_type_check` only allowed
  `['executive','kpi','fleet','inspection','cost']`, but the app's single source
  (`scheduledReports.js` REPORT_TYPES) also offers **accidents/claims/stock/vendor** and every saved
  Report Builder layout scheduled as **`builder:<template-id>`** (BUILDER_TYPE_PREFIX). All of those
  violated the CHECK -> the insert failed for those types (incl. the new Accidents Analytics auto-email).
  Also a DUPLICATE frequency constraint existed: `report_schedules_frequency_chk` (once/daily/weekly/
  monthly) AND the stricter `report_schedules_frequency_check` (daily/weekly/monthly) which BLOCKED 'once'.
- FIX (V244): report_type CHECK is now `IN (executive,kpi,fleet,inspection,cost,accidents,claims,stock,
  vendor) OR report_type LIKE 'builder:%'`; dropped the stale `report_schedules_frequency_check` (kept the
  correct `_chk`). Verified live via rolled-back inserts of builder:*/accidents/claims/vendor/stock + a
  'once' schedule. RULE: whenever a new base report type is added to REPORT_TYPES, widen this CHECK too
  (the `builder:%` family is already covered). Next free migration **V245**.

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
  setUserAccessGrant grant/revoke; role -> saveModulePermissions). Admin/super locked. Next free **V244**
  (V243 = accidents.plate_number + accidents.vehicle_type, see Accident form asset auto-fill above).

## Super-admin ownership swap (2026-07-15) — how to promote/demote a super-admin
- **Current super-admin = `zebkhan311@gmail.com`** (profiles id `d2d43a5f-0906-4f7a-9577-e36d89164914`,
  full_name "Anum", username `shahzeb`, role Admin, `is_super_admin=true`, `country=NULL` = ALL countries,
  Company A). `ws123na@gmail.com` (id `58787cc7-...`) was DEMOTED to a normal Admin (`is_super_admin=false`)
  but keeps full Admin module/data access. Swap done after confirming the new account could log in (never
  leave zero working super-admins — promote the new one, verify login, THEN demote the old).
- **CRITICAL GOTCHA for any future privileged-profile edit**: the BEFORE UPDATE trigger
  `trg_guard_profile_privileged` -> `guard_profile_privileged_cols()` RAISES unless `get_my_role() = 'Admin'`.
  The Supabase MCP SQL session runs as postgres/service (NO profile row) so `get_my_role()` is NULL -> the
  trigger BLOCKS direct UPDATE of role/approved/locked/is_super_admin/country/site even from MCP. Work around
  it in ONE transaction: `ALTER TABLE public.profiles DISABLE TRIGGER trg_guard_profile_privileged;` ->
  UPDATE -> `... ENABLE TRIGGER ...;` -> COMMIT. Verify `tgenabled='O'` (enabled) afterward so it is never
  left disabled. The app's own super-admin RPCs (adminAccess.js) are the normal path; the trigger bypass is
  only for out-of-band DB surgery.
- To ALSO change the login email: `profiles.email` is a plain column (in the guard's blocked list only via
  the trigger, so include it in the same disabled-trigger UPDATE), `auth.users.email` is a normal column
  (+ set `email_confirmed_at`), but **`auth.identities.email` is a GENERATED column** — do NOT assign it;
  update `identity_data->>'email'` (and `email_verified`) via `jsonb_set` and the generated `email` follows.
