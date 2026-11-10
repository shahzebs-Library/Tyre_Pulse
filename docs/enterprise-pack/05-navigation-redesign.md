# 05 - Navigation Redesign

| Field | Value |
|---|---|
| Deliverable | 5 of 29 |
| Date | 2026-11-10 |
| Status | Partly built. The shell (working context vs reporting scope, module rail, global create, command search, role-aware and flag-aware nav, console nav editor) is Built. The 13-group nav is Built but still carries 218 items, 78 of them over empty tables. The spec's final information architecture (section 2 of the master spec) is Not built. |
| Evidence | Verified in code: `src/components/Layout.jsx` (`NAV_GROUPS`, `shouldShowNavItem`), `src/components/shell/*` (TopBar, ModuleRail, WorkingContextSelector, ReportingScopeBar, GlobalCreate, ProfileMenu), `src/components/LegacyLayout.jsx` (rollback behind `system_config.new_shell`), `src/lib/navAccess.js`, `src/lib/navLayout.js`, `src/lib/workingContext.js`, `src/lib/reportingScope.js`, `src/lib/contextRules.js`, `src/lib/commandSearch.js` (246 path entries), `src/console/pages/ConsoleNavigation.jsx`, tests listed in section 3. Item counts generated from `NAV_GROUPS`. Shell history from PROJECT_MEMORY 2026-08-16. |
| Related docs | [02 Inventory](02-module-inventory.md), [04 Merge plan](04-merge-and-retirement-recommendations.md), `docs/UX_NAVIGATION_PLAN.md` (Phase 0, stale: speaks of ~78 pages and 8 workspaces), `docs/ROUTE_OWNERSHIP_2026-08-30.md` |

## 1. Current navigation

### 1.1 Web sidebar groups (`NAV_GROUPS`)

| Group | Items | Of which nav Admin-only | Sub-groups (`parent`) |
|---|---|---|---|
| Overview | 5 | 2 | - |
| Fleet & Assets | 19 | 11 | Registry, Lifecycle, Identification, Meters, Movement |
| Tyre Management | 26 | 11 | Records, Fitment & Rotation, Condition, Lifecycle, Performance |
| Workshop & Maintenance | 23 | 11 | Jobs, Maintenance, People, Parts & Tools, Analysis |
| Inspections & Compliance | 23 | 15 | Inspections, Checklists, Findings, Compliance, Alerts |
| Drivers & Safety | 9 | 8 | - |
| Monitoring & Logistics | 22 | 21 | Live, Journeys, Devices, Logistics, Fuel & Energy |
| Inventory & Procurement | 12 | 5 | Stock, Purchasing |
| Accidents & Claims | 8 | 2 | - |
| Finance & Commercial | 16 | 3 | Cost, Production & Vendor, Modelling, Commercial |
| Analytics & Reports | 29 | 13 | Dashboards, KPIs, Comparison, Intelligence, Reporting, AI |
| Automation | 6 | 5 | - |
| Administration | 20 | 7 | Data, Organisation, System |
| **Total** | **218** | **114** | |

The flat `NAV_CATALOG` export is derived from `NAV_GROUPS` and feeds Module Control (`buildNavModuleCatalog`), the console navigation editor and the Platform Map.

### 1.2 Visibility rules (`shouldShowNavItem` in `src/components/Layout.jsx`)

Order of evaluation, verified in code and recorded in project memory 2026-07-14 / 2026-08-17:
1. Super-admin and Admin see everything.
2. A per-user GRANT shows a keyed item even if the role default hides it; a per-user REVOKE hides it. Exception: report builders stay Admin-only and a grant cannot open them (`src/lib/reportBuilderAccess.js`).
3. Keyed items (`NAV_MODULE_KEY[path]` or `governingModuleKey(path)`) follow `hasPermission` (DB matrix per key, then `ROLE_DEFAULTS`).
4. Custom roles are deny-by-default (only modules enabled for that role).
5. Checklist-only roles (`CHECKLIST_ONLY_ROLES` in `src/lib/checklistAccess.js`: Maintenance Supervisor, Workshop Supervisor) see the checklist path set only.
6. `adminOnly`, `roles` and `flag` attributes on the item.
7. Super-admin layout overrides from the console navigation editor (`nav_layout` in `system_config`, `src/lib/navLayout.js` `applyNavLayout`) reorder, rename, regroup or hide items BEFORE rules 1 to 6. Hiding is cosmetic; RBAC still governs the route.

### 1.3 Shell (2026-08-16 rebuild)

| Element | File | Behaviour |
|---|---|---|
| Top bar (52 px) | `src/components/shell/TopBar.jsx` | Search, global create, theme, language, profile menu |
| Module rail | `src/components/shell/ModuleRail.jsx` | Icon rail of workspaces; "All modules" shows the full tree |
| Working context | `WorkingContextSelector.jsx` + `src/lib/workingContext.js` | ONE place: Company to Country to Region to Site tree (ARIA tree, keyboard, RTL-mirrored). Writes through to legacy `activeCountry` via `contextToCountry`, so 212 files needed no change. Not in the URL. |
| Reporting scope | `ReportingScopeBar.jsx` + `src/lib/reportingScope.js` | Multi-country set for reports (URL-borne, shareable). Used by Expense Trends, Board Overview, Expenses. Money never blended across currencies. |
| Context rules | `src/lib/contextRules.js` | Module shows a notice (never hides) when a country has no data; `structural` vs `not_rolled_out` |
| Global create | `GlobalCreate.jsx` | Six create targets, each gated by the same predicate as the sidebar; hidden below 2 options; no builder entries |
| Legacy shell | `src/components/LegacyLayout.jsx` | Frozen pre-rewrite shell, only when `system_config.new_shell` is explicitly off (fail-forward) |
| Field header | Layout field mode | Simplified header for Tyre Man / field roles (home redirect: Tyre Man to `/inspections`, checklist-only roles to `/checklists`) |

### 1.4 Search

`src/lib/commandSearch.js` `NAV_COMMANDS` (246 entries) powers Ctrl/Cmd+K. `isCommandVisible` mirrors `shouldShowNavItem`, so search never offers a page the sidebar would hide (fixed PR #261). Keywords include ERP vocabulary (job card, plate, chassis, hour meter, GRN).

### 1.5 Console navigation

`src/console/components/ConsoleLayout.jsx`: 5 areas (Monitor, Platform, Trust, Runtime, Engineering), 35 entries grouped into sections, searchable, collapsible. Many former console pages are now tabs reached through `ConsoleTabRedirect` (Module Control, Navigation editor, Vehicle Designer, Smart Import, Sessions, Delivery, AI admin and others). Console is not linked from the main app (owner rule 2026-08-05).

### 1.6 Mobile navigation

Flutter and Expo: max 5 primary tabs per role plus a Home hub of module tiles from the module registry (32 keys). Field roles see Home / Inspect / Accidents / Washing / Profile (Expo, 2026-07-26); drivers get Meter Log. Data-heavy management modules are admin-only on mobile by rule.

## 2. Guard rails already in place (tests)

| Test | Pins |
|---|---|
| `src/test/navRouteAccessParity.test.js` | Every nav item's visibility matches its route guard in both directions (reads source, not the icon-free catalog) |
| `src/test/navTreeParity.test.js` | Nav tree structure |
| `src/test/commandSearchCoverage.test.js` | Every sidebar route is searchable |
| `src/test/consoleModuleCoverage.test.js` | Every routed page appears in the console access catalog or is justified |
| `src/test/platformMap.test.js` | Every console nav entry has a plain-English description |
| `src/test/webI18nKeyCoverage.test.js` | Every `t('...')` key resolves in en (and ar where namespace exists) |
| `src/test/shellI18nKeys.test.js` | Shell strings exist in en and ar |

## 3. Gaps against the spec (section 2 of the master spec)

| Spec requirement | Current state | Gap |
|---|---|---|
| Related functions under one parent | Mostly true; analytics spread over Analytics & Reports, Finance, Tyre Performance and Workshop Analysis | KPI and cost pages duplicated across groups (doc 03 D5, D8) |
| Do not show modules a user cannot access | Enforced (parity tests) | Admin sees 218 items including 78 over empty tables |
| Role-aware, country-aware, location-aware | Role and flag aware; country/site affect DATA not nav; context rules show notices | No per-tenant "module in use" filter on nav; Module Control Off status exists but is set manually |
| Searchable | Yes (command palette + sidebar filter) | Search does not cover records (assets, serials) from the palette uniformly; Global Search exists separately |
| Consistent across Web, PWA, Mobile | Web and PWA share the shell; mobile uses its own 32-key registry | Names differ (web "Work Orders" vs mobile admin-only "workorders"; web "Tyre Records" vs mobile "records") |
| Home and Intelligence: Personal Workspace, Tasks, Notifications | Command Center, Action Center, My Checklists, `/workforce-daily`, notification center in top bar | No single "My Work" page on web (Flutter has `my_work`) |
| Administration incl. Locations, Countries, Business Rules, Themes, API Management | Split between main-app Administration and console | Doc 04 D10 moves remaining platform pages into console |

## 4. Proposed final information architecture

Principles: (1) at most 12 top-level groups, each with at most 4 sub-groups; (2) one primary page per function, secondary views become tabs; (3) modules over empty tables stay reachable but are OFF by default per tenant in Module Control until first use; (4) every route keeps working via `LegacyRedirect` with `?tab=`.

| # | Group (spec name) | Primary pages (route) | Absorbs (becomes tab or redirect) |
|---|---|---|---|
| 1 | Home and Intelligence | Command Center `/`, My Work (new, web port of Flutter `my_work`), Approvals `/approvals`, Action Center `/action-center`, Message the Team `/broadcast` | My Checklists (tab), workforce daily (tab) |
| 2 | Fleet Operations | Fleet Register `/asset-management` (+ detail), Sites `/sites`, Drivers `/driver-management`, Utilization `/fleet-utilization`, Movement (Gate Pass, Check In/Out, Handover, Reservations as tabs), Documents and Compliance | `/fleet-master`, Vehicle 360, Vehicle History, Digital Twin (detail tabs), Fleet Groups, Combinations |
| 3 | Tyre Management | Tyre Register `/tyres`, Tyre Passport, Fitment and Rotation, Running and Remaining Life `/tyre-lifecycle`, Scrap and Disposal `/scrap`, Retread and Warranty, CPK and Performance `/cpk-intelligence` | Serial Tracker (tab of register), Tyre Exchange, Rotation Optimizer, Size Optimizer, Pressure/Position/Heat/Age intelligence as tabs of "Condition" |
| 4 | Maintenance and Workshop | Work Orders `/work-orders`, Live Control `/workshop-live`, Preventive Maintenance `/pm-programs`, Repair Requests `/repair-requests`, Breakdown Register `/asset-breakdowns`, Technicians and Attendance | Workshop Management, Service Requests, Breakdown Callouts, Bay Scheduling, Maintenance Calendar, Downtime, DTC |
| 5 | Inspections | Inspections `/inspections`, Checklists `/checklists`, AI Tyre Inspection, Inspection Planner, Corrective Actions `/actions`, Root Cause and Improvement | DVIR, Checklist Schedules/Insights/Audit Pack (tabs), RCA, Root Cause Engine, Anomalies |
| 6 | Inventory and Store | Stock `/stock`, Material Issue `/store-material-issue`, Goods Receipt, Parts Catalog and Materials | Stock Replenishment (tab) |
| 7 | Procurement and Vendors | Requisitions, Purchase Orders `/procurement`, Suppliers and Contracts, Vendor and Brand Performance | Marketplace (off), Vendor Intelligence |
| 8 | Accident and Insurance | Accidents `/accidents` (case workspace), Claims Summary, Insurance Policies, Accident Workflow settings | Accident Cases board (tab), Incident Reports (per doc 04 D4), Insurance Claims ledger (retired), Recall Tracker |
| 9 | Finance and Cost | Expenses and CPK `/expense-report`, Cost per M3, Budgets, Cost Scenario Planner, Production and Vendor ledgers | Cost Center, Budget Planner, Expense Trends, Maintenance Cost board, TCO and ROI (Modelling tab) |
| 10 | Reports and Analytics | Report Center `/report-center`, Scheduled Reports, Report Builder, Report Sharing, Comparisons, Smart Analytics (AI) | Reports wizard, Analytics, Advanced Analytics, Site/Country/Fleet comparison, Forecasting, Benchmark |
| 11 | Executive Intelligence | Board Overview, Executive Report, Executive Analytics, KPI Scorecards (Engineering KPI primary), TV Display | KPI Center, KPI Command Center, SLA Dashboard, Ops/Fleet Intelligence |
| 12 | Administration (tenant) | Data Intake Centre `/data-intake`, Data Reconciliation and Cleaning, Approval Workflows (Workflows, Matrix, Delegations), Integrations and API, Custom Data, Audit Trail, Settings, Help | ERP Import, ERP Intake, Expense Import, Upload, Upload Approvals, Event Stream, Automation Rules (tabs) |
| - | Platform (System Console, super-admin, separate tab) | Monitor / Platform / Trust / Runtime / Engineering | System Health, Usage and Adoption, AI Cost Monitor, Brand Assets, Onboarding Wizard (redirect from main app) |

Monitoring and Logistics (22 items, 21 Admin-only, almost all over empty tables) becomes an optional module pack "Telematics and Logistics" that is OFF per tenant until telematics data exists; it appears under Fleet Operations when enabled.

Estimated result: about 85 to 95 visible primary pages for an Admin (from 218), with every old route still resolving.

## 5. Naming convention

| Layer | Rule | Example |
|---|---|---|
| Nav label | Business noun, Title Case, no "Intelligence" unless analytical | "Fleet Register" |
| Route | kebab-case of the label; old routes kept as redirects | `/fleet-register` (later) |
| Module key | snake_case, stable, never renamed (aliases instead) | `fleet_master` stays as alias |
| i18n key | `nav.items.<route>` | existing convention |
| Mobile key | camelCase in registry, mapped to web key by `webModuleKeyAliases` (Flutter) | `records` to `tyre_records` |

## 6. Rollout plan

| Step | Change | Phase | Effort |
|---|---|---|---|
| 1 | Apply tenant module defaults: set Module Control status Off for empty logistics/telematics modules (data-driven list from doc 02 section 7) | 1 | S |
| 2 | Redirect batch 1 routes (doc 04) and remove their nav items | 1 | S |
| 3 | Introduce sub-group tabs pattern (one shared `PageTabs` with `?tab=`) and convert Fleet Register, Data Intake Centre, Root Cause | 2 | M |
| 4 | Regroup `NAV_GROUPS` to the 12 target groups; keep `parent` sub-groups; update i18n en/ar | 2 | M |
| 5 | Web "My Work" page mirroring Flutter `my_work` | 2 | M |
| 6 | Align mobile labels with web labels (registry `defaultLabel`) | 3 | S |
| 7 | Retire `LegacyLayout.jsx` once the new shell has run one quarter without rollback | 3 | S |

## Open decisions for the owner

- Approve the 12-group target and the "Telematics and Logistics" optional pack.
- Whether Admin should see modules that are OFF for the tenant (proposal: visible only in Module Control, not in the sidebar).
- Whether to rename routes (e.g. `/fleet-master` to `/fleet-register`) or keep current routes and change labels only (lower risk).

## Next actions

| Action | Phase | Effort |
|---|---|---|
| Data-driven default of Module Control status per tenant | 1 | S |
| Regroup `NAV_GROUPS` with parity tests updated | 2 | M |
| Shared tabbed page pattern + first three consolidations | 2 | M |
| Update `docs/UX_NAVIGATION_PLAN.md` to point here (owner to approve edit outside this pack) | 1 | S |
