# 03 - Duplicate Module Report

| Field | Value |
|---|---|
| Deliverable | 3 of 29 |
| Date | 2026-11-10 |
| Status | Partly built. Consolidation has happened for administration (12 legacy admin routes redirect into `/console`), access control, cost (expense grid as the single cost source), vocabularies and status tokens. Large overlaps remain in analytics/KPI pages, data intake, alerts, breakdown/repair intake and asset views. One overlap is a live defect (D1). |
| Evidence | Verified in code: routes and module keys in `src/App.jsx`, nav in `src/components/Layout.jsx`, table reads per page (service imports), readers of `fleet_master` (`grep from('fleet_master')`). Verified live (read-only, 2026-11-10): exact row counts quoted below. Deliberate-keep decisions taken from PROJECT_MEMORY with their dates. |
| Related docs | [02 Inventory](02-module-inventory.md), [04 Merge and retirement](04-merge-and-retirement-recommendations.md), [10 Data model](10-data-model-recommendations.md), `docs/DATA_MODEL_CONSOLIDATION_PLAN.md`, `docs/ROUTE_OWNERSHIP_2026-08-30.md` |

## 1. Classification used

| Class | Meaning |
|---|---|
| DEFECT | Two sources for the same fact and at least one is wrong today |
| DUPLICATE | Same business function, same data, two interfaces |
| OVERLAP | Shared data, different purpose; consolidation would help navigation but not correctness |
| DELIBERATE | Looks duplicate but is a recorded design decision; keep |

## 2. Summary table

| ID | Area | Items | Class | Severity |
|---|---|---|---|---|
| D1 | Asset register | `fleet_master` table (0 rows) vs `vehicle_fleet` (1,622 rows) | DEFECT | High |
| D2 | Asset views | Fleet Master, Asset Management, Asset Detail, Vehicle 360, Vehicle History, Digital Twin | DUPLICATE / OVERLAP | Medium |
| D3 | Claims | Claims Summary, Insurance Claims ledger, Insurance Policies claim register, accident Claim tab | DELIBERATE + unused ledger | Medium |
| D4 | Incidents | Accidents (43) vs Incident Reports (3) vs Accident Cases board | OVERLAP | Low |
| D5 | KPI and analytics | 21 dashboards/KPI pages, 5 share module key `kpi_scorecard` or `analytics` | OVERLAP (DUPLICATE for CPK) | High |
| D6 | Root cause | RCA records (1 row), Root Cause Engine, Continuous Improvement, Anomalies, mobile RCA | OVERLAP | Low |
| D7 | Report builders | 8 builder/report surfaces | DELIBERATE (partly) | Medium |
| D8 | Cost definitions | grid cost vs `cost_per_tyre` sums vs `work_orders.total_cost`; 11 cost pages | DUPLICATE (calculation) | High |
| D9 | "Scrapped" | 4 code definitions | DUPLICATE (definition) | Medium |
| D10 | Admin areas | Main-app System Health, Audit Trail, Usage & Adoption, AI Cost Monitor vs console equivalents | DUPLICATE | Medium |
| D11 | Data intake | 7 web entry points + console Smart Import + Supabase staging tables | OVERLAP | Medium |
| D12 | Breakdown / repair intake | Breakdown Callouts (0), Breakdown Register (30), Service Requests (0), Repair Requests (0), work orders type Emergency | DUPLICATE | Medium |
| D13 | Approvals | Approvals dashboard, Upload Approvals, Approval Matrix (0), Approval Workflows (25 defs), Delegations (0), console four-eyes | OVERLAP | Medium |
| D14 | Alerts | `alerts` (0), `alert_thresholds` (0), due-alert engine, trust alerts, upload-gap notices, Sentry alerts, client `alertEngine` | DUPLICATE (engines) | Medium |
| D15 | Live boards | Command Center, Live Fleet Status, Daily Ops, Fleet Health Board, TV Display, Board Overview | OVERLAP | Low |
| D16 | Tyre views | Tyre Records, Serial Tracker, Tyre Passport, Tyre Lifecycle, Asset Tyre Bay, Scrap | OVERLAP | Low |
| D17 | Workshop | Work Orders, Workshop Management, Live Control, Workshop Status (Daily Ops) | OVERLAP + DELIBERATE | Low |
| D18 | Field apps | Expo app 1.6.0 and Flutter app, same 32 module keys | DUPLICATE (transitional) | Medium |
| D19 | CPK grain | Lifetime CPK (`src/lib/tyreLifetime.js`) vs per-fitment-row CPK in server RPCs and ~40 helpers | DUPLICATE (calculation) | High |
| D20 | Tenant key | `organisation_id` (372 tables) vs `org_id` (8 tables) | DUPLICATE (schema) | Medium |
| D21 | Tyre spec tables | `tyre_specifications` (fitment rules) vs `tyre_spec_catalog` (brand catalogue) | DELIBERATE | none |

## 3. Detail

### D1 - `fleet_master` vs `vehicle_fleet` (DEFECT)
- `fleet_master` is a real table (`relkind = r`) with **0 rows**; `vehicle_fleet` holds **1,622** assets.
- Still read by: `src/pages/LiveFleetStatus.jsx:434` (fleet grid and count), `src/pages/ComplianceDashboard.jsx:237` (the DENOMINATOR of inspection compliance), `src/lib/api/tyreSpecs.js:67` (`getFleetMaster`, fitment coverage), `src/lib/ragService.js:118` (AI asset context).
- Effect today: Live Fleet Status shows no fleet; inspection compliance and spec coverage compute over an empty register; the AI assistant gets no vehicle details.
- Naming trap: the permission module key `fleet_master` gates the `vehicle_fleet` pages (`/fleet-master`, `/asset-management`, `/sites`), so the key name and table name disagree.

### D2 - Asset views
- `/fleet-master` (FleetMaster) and `/asset-management` (AssetManagement) both read `vehicle_fleet` under the same module key `fleet_master`.
- Per-asset: `/asset-management/:assetNo` (AssetDetail, Tyre Bay), `/vehicle/:assetNo` (Vehicle360, flag `vehicle_360`), `/vehicle-history`, `/digital-twin/:assetNo`, plus Asset Master cross-country view (`get_asset_master`, V356) on Data Reconciliation.
- Project memory backlog (2026-07-14): "Asset Master merge FleetMaster + AssetManagement + enrich". Not done.

### D3 - Claims (DELIBERATE, but one ledger is unused)
- Operational claims live ON `accidents` (claim_amount, approved, deductible, recovered, insurer...). `src/lib/claimsAnalytics.js` is the single claims engine; `/claims-summary` is its dashboard.
- `/insurance-claims` is a CRUD ledger over `insurance_claims`: **0 rows**.
- `/insurance-policies` (V466/V526) carries the insurer's own register `insurance_claim_register` and policies (23 rows).
- Decision recorded 2026-07-14: "DISTINCT from /insurance-claims, do NOT merge". The decision was about not merging the two models; the evidence now is that the ledger has never been used.

### D4 - Incidents vs accidents
- `accidents` (43 rows) is the vehicle accident case with 7 workstreams (`accident_case_workstreams`).
- `incident_reports` (3 rows, V138) is a generic safety incident register at `/incidents`.
- `/accident-cases` is an analytics board over the same `accidents` rows (not a duplicate).
- Overlap: both capture an event with severity, site, and corrective action; only `accidents` has workflow, SLA and notifications.

### D5 - KPI and analytics pages
21 pages present overlapping fleet/tyre metrics: Command Center `/`, Board Overview, Executive Report, Executive Analytics, Analytics, Advanced Analytics, KPI Center (`/kpi`), Engineering KPI (`/kpi-engine`), KPI Command Center (`/kpi-command`), Performance Benchmark, SLA Dashboard (`sla_records` 0), Site Comparison, Country Comparison, Comparison, Fleet Analytics, Fleet Intelligence, Ops Intelligence, Forecasting, Fleet Optimizer, Continuous Improvement, Display.
- `/kpi`, `/kpi-engine`, `/kpi-command` share module key `kpi_scorecard`; `/analytics`, `/advanced-analytics`, `/comparison`, `/benchmark`, `/continuous-improvement` share `analytics`.
- Rule (project memory): Engineering KPI is THE home for CPK, tyre life, failure/removal rate; a parallel `tyreIntelligence.js` was reverted 2026-07-13.
- Real duplication: several pages compute failure rate, avg life and CPK client-side over `tyre_records` with `kpiEngine` while others call server RPCs (`get_fleet_cpk`, `report_tyre_summary`). Their scopes differ (null-country rows, site filters), so numbers can differ between pages (documented in project memory 2026-08-02 for `report_tyre_summary.failure_rate`).

### D6 - Root cause
- `/rca` (RcaRecords, `rca_records` 1 row) = recorded investigations.
- `/root-cause` (RootCauseEngine) = client analysis over `tyre_records`.
- `/continuous-improvement`, `/anomalies` (Anomaly Scan) and mobile `rca` module overlap in purpose.

### D7 - Report builders
Surfaces: `/report-builder` (general block builder, `src/lib/reportBuilder.js`), Accident Report Builder (tab in `/accidents`, `src/lib/accidentReport.js`, `accidentReportPdf.js`, `accidentReportPptx.js`), Executive Report customise drawer, `/dashboard-builder`, Report Share builder (`src/lib/reportShareLayout.js`), Reports wizard (`/reports`), Report Center (`/report-center`), Presentation Studio (Board Overview / Expenses / Cost per M3).
- DELIBERATE: accident builder and general builder are recorded as distinct ("do NOT merge", 2026-07-14). All builders are Admin-only (owner rule 2026-08-16, `src/lib/reportBuilderAccess.js`).
- Duplication that is NOT deliberate: three PDF renderers and two chart-option stacks (`reportShareCharts.js` ECharts, accident chart.js options) with separate palettes partly unified by `src/lib/reportColors.js`.

### D8 - Cost definitions
- Authoritative: expense grid `parts_consumption` (220,425 rows) through `src/lib/governedCost.js`, `src/lib/api/costSummary.js` (`loadCostSplit`, `loadGridTyreByAsset`) and server RPCs (`get_cost_cpk_overview`, `get_expense_by_country`, `get_tyre_cost_by_asset`).
- Competing: sums of `tyre_records.cost_per_tyre` (project memory 2026-07-27 counted ~105 such sites of 361 inline cost sites), `work_orders.total_cost` (generated from labour + parts only), report snapshot cost (fixed V522).
- Cost pages: Cost Center, Budgets & Cost, Budget Planner, Expenses & CPK, Expense Trends, Cost Scenario Planner, Maintenance Cost & Tasks, TCO, ROI, Cost per M3, Workshop Analytics delay cost. Budgets, Budget Planner and Cost Center share module key `budgets`.

### D9 - "Scrapped"
Four definitions (project memory 2026-07-27): `tyre_status_marks.mark_type = 'scrap'` (720 rows; Serial Tracker, mobile, Scrap Register), `REMOVED_STATUS_RE` on `tyre_records.status` (tyrePool/fleetRisk/tco), `risk_level = 'Critical' or category = 'Scrap'` (TyreScrapManagement analysis tabs), and `TyreLifecycle.jsx` variant. `list_scrapped_tyres` (V383/V384) unifies the REGISTER but not the analytics.

### D10 - Admin areas in two places
- Redirected (done): `/admin`, `/users`, `/master-access-control`, `/permission-matrix`, `/security-center`, `/org-hierarchy`, `/holding-company`, `/sso-configuration`, `/ai-administration`.
- Still duplicated: `/system-health` (main) vs `/console/health`; `/audit` (main, AUDIT_ROLES) vs `/console/audit-trail`; `/tenant-health` vs `/console/analytics`; `/ai-cost-monitor` vs console AI usage; `/developer-portal` vs `/console/api-keys`; `/brand-assets` and `/onboarding-wizard` vs console Organizations.
- Note: `/audit` stays in the main app on purpose for Integration Admin (AUDIT_ROLES) who cannot enter the console.

### D11 - Data intake
Web: `/data-intake` (DataIntakeCenter with production/SCO/SANY/sites tabs), `/upload`, `/erp-import` (staging tables `erp_*_import` with promotion RPCs V415), `/erp-intake` (Ramco auto-detect), `/expense-import`, `/upload-approvals`, `/cleaning`. Console: Smart Import, Import History, Duplicates. Database: 39 staging tables (`stg_*`, per-country `stg_*_ksa|uae|egypt`, `expenses_ksa|uae|egypt`, `*_country_upload_template_staging`).
- Rule (project memory): one import ENGINE (`src/lib/import/*`), several entry points. Per-module bulk upload buttons were removed (2026-07-14); bulk upload lives in intake surfaces only.

### D12 - Breakdown and repair intake
`breakdown_callouts` (0), `asset_breakdowns` (30, V539), `service_requests` (0), `repair_requests` (0, V608 RFR with conversion to job card), plus `work_orders.work_type = 'Emergency'` (ERP "Break Down"). Five ways to say "this machine is down and needs work".

### D13 - Approvals
`/approvals` (approval_dashboard RPC: inspections, checklists, accident closures, uploads), `/upload-approvals` (pending_uploads), `/approval-matrix` (`approval_matrix` 0 rows), `/workflow-settings` (`workflow_definitions` 25, `workflow_instances` 52), `/approval-delegations` (0), console Approvals (four-eyes for admin ops, OFF by default; DELIBERATE, different purpose).

### D14 - Alert engines
`alerts` (0) + client `src/lib/alertEngine.js`; `alert_thresholds` (0) evaluated hourly by cron `evaluate-alert-thresholds` and edited in two places (`/alert-thresholds` and console Alert Rules); `due_alert_rules` + `scan_due_alerts` (cron `due-alerts-scan`); `trust_alerts` (`scan_data_trust`); `upload_gap_notices`; `sentry_alert_log`; `workshop_status_notices`; `accident-sla-scan`. Each has its own dedupe table.

### D15 to D17 - Boards, tyre views, workshop (OVERLAP)
- Live boards share the same metrics; Live Fleet Status is additionally broken by D1.
- Tyre views are distinct lenses on `tyre_records` (register, serial history, passport, running life); scrap actions exist in both Serial Tracker and Scrap Management (same RPCs, so no data divergence).
- Workshop Status lives inside Daily Ops on its own `workshop_status_*` tables with NO job-card workflow (DELIBERATE, 2026-10-07). Work Orders and Workshop Management are two lists over `work_orders`.

### D18 - Two field apps
Expo 1.6.0 (production phones, OTA only) and Flutter (Play Closed testing). Same module keys, two offline queues, two copies of rules (checklist one-sign close, tyre layouts, km rules) marked "change ALL" in project memory.

### D19 - CPK grain
`src/lib/tyreLifetime.js` computes weighted lifetime CPK (one price per tyre, lifetime km); all server CPK RPCs and ~40 web helpers still compute per fitment row (project memory 2026-11-09, `docs/tyre/CALCULATION_SOURCE_MAP.md`).

### D20 - Tenant key split
`org_id` only on: `alert_thresholds`, `audit_log_v2`, `module_permissions`, `module_permissions_archive`, `report_schedules`, `tenant_export_jobs`, `user_access_grants`. `profiles` carries both, synced by trigger `tr_sync_profile_org` (V311).

## 4. What has already been consolidated (do not redo)

| Item | Where | Date |
|---|---|---|
| Admin and RBAC pages into console | redirects in `src/App.jsx` | 2026-07-14 |
| One access resolver | `src/lib/accessResolver.js` | 2026-07-20 |
| Severity ladder | `src/lib/severity.js` | 2026-07-14 |
| Accident vocab (severity, fault, status) | `src/lib/accidentVocab.js` | 2026-07-14 |
| Work order status | `src/lib/workOrderStatus.js` + V294/V497 | 2026-07-20 / 08-10 |
| Cost from expense grid | `governedCost.js`, `costSummary.js` | 2026-07-27 |
| Share links (old display tokens retired) | `report_shares`, `/report/:token` | 2026-07-16 |
| Smart Analytics AI (`/ai` redirected) | `/ai-command-center` | 2026-08-03 |
| Data trust surfaces | console Database Center (legacy routes redirect) | 2026-08-03 onward |

## Open decisions for the owner

- D3: confirm the `insurance_claims` ledger can be retired now that it has 0 rows (reverses the 2026-07-14 keep only for the empty ledger, not for Claims Summary).
- D4: are `incident_reports` meant for non-vehicle safety events (keep) or should they fold into accidents?
- D12: which single intake should field staff use for "machine down" (Repair Request RFR or Breakdown Register)?
- D10: should `/system-health` and `/tenant-health` leave the main app (they are Admin-only already)?

## Next actions

| Action | Phase | Effort |
|---|---|---|
| D1: repoint the 4 `fleet_master` readers to `vehicle_fleet` and mark `fleet_master` deprecated | 1 | S |
| D5/D19: make every CPK, life and failure figure come from one server function set; add a test that pages show the same number for the same scope | 2 | L |
| D8: replace remaining `cost_per_tyre` totals with `loadGridTyreByAsset` / grid RPCs | 2 | M |
| D9: one `isScrapped` predicate shared by register and analytics | 2 | S |
| D11/D12/D13/D14: follow the merge plan in doc 04 | 2 to 3 | M to L |
| D20: plan the `org_id` to `organisation_id` convergence (doc 10) | 3 | M |
