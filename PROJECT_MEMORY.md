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
| Access control (RBAC + security) | `src/pages/MasterAccessControl.jsx` (tabs: PermissionMatrix + SecurityCenter) | §5 unified home; original routes /permission-matrix, /security-center still live |
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

## Claims & scheduled reporting (2026-07-13)
- **Accident-embedded claims** are the operational claim source (accidents table: claim_amount/
  claim_approved_amount/deductible/recovered_amount/insurer/policy_no/claim_status + case fields
  gcc_liability_ratio/fault_status/najm_status/taqdeer_status/expected_release_date/release_date).
- Single claims engine `src/lib/claimsAnalytics.js` (`analyzeClaims`, `hasClaim`, `isClosed`,
  `isDelayed`, `claimNet`) powers ALL three claims surfaces — do NOT re-implement the maths:
  1. `ClaimsSummary.jsx` (/claims-summary) — chart dashboard + PDF/Excel export.
  2. Accidents page "Claims Summary" one-click PDF/Excel export.
  3. Scheduled `claims` report type in `scheduledReports.js` → claims-desk email digest in edge fn
     `send-scheduled-reports` (deployed v10; branches on report_type==='claims', org-scoped manually).
- `fetchReportRows` honours a per-dataset `orFilter` (claims uses it to fetch claim rows only).
- Full suite 3384 green.
- **Accident Report Builder (V221)** = `src/components/accidents/AccidentReportBuilder.jsx`
  (a "Report Builder" tab inside `Accidents.jsx`). Block-based custom report designer:
  header/logo, KPI rows, charts (reuses the accident + `analyzeClaims` datasets),
  text, detail tables, page breaks — live WYSIWYG white-paper preview, branded PDF
  export (charts rasterised from live canvases via `toBase64Image`, jspdf lazy-loaded),
  and named saved layouts persisted to `accident_report_templates` (V221, org-isolated,
  per-user ownership) via `src/lib/api/accidentReportTemplates.js`, with a localStorage
  draft fallback. Do NOT duplicate — extend this for more block/chart types.
- **V220 (applied): accident-delete FK fix.** Deleting an accident cascade-deletes
  accident_parts; the AFTER DELETE audit trigger `log_accident_part_change()` was
  inserting a `part_removed` row into `accident_audit_log` referencing the accident
  being deleted → FK violation. DELETE branch now guarded to only log when the parent
  accident still exists (a real single-part removal). Latest migration is now **V221**
  (accident_report_templates); next free is **V222**.

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
