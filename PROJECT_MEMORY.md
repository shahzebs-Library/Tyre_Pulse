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
  - ⏳ **TechnicianScorecard** — NEEDS new tables technician_skills + technician_certs (skills matrix,
    cert-expiry days<0 expired/<60 warning, lifecycle score=(min(done,500)/500)*40+(pass/100)*50+
    min(certs,5)*2). KEEP existing cost/ranking leaderboard as one tab. SLA breach derivable now.
  - ⏳ **FitmentValidation** — NEEDS tables fitment_rules, fitment_validations, wheel_positions,
    vehicle_axles. Port pure validateFitment engine (size/tread/age/retread/lifecycle/pair rules).
    Keep existing fleet-size-audit as a 2nd tab.
  - ⏳ **TyrePool** — NEEDS table tyre_pool (add/deploy/return lifecycle, utilisation,
    replenishment=max(4,round(active_vehicles*4*0.10))). Fold swap/transfer into existing
    TyreExchange (NO dup). Migrations continue from V206 → next free is V207.
- Migration numbering: next free is **V207** (V206 was org hierarchy).

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
