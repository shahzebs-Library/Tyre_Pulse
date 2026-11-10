# 04 - Merge and Retirement Recommendations

| Field | Value |
|---|---|
| Deliverable | 4 of 29 |
| Date | 2026-11-10 |
| Status | Not built (recommendations). Earlier consolidation work is recorded as Built in doc 03 section 4. Nothing in this document has been executed. |
| Evidence | Each dependency list was produced from code (`src/App.jsx` routes and module keys, `src/components/Layout.jsx` nav, service imports, `src/lib/commandSearch.js`, tests that pin routes) and live read-only row counts (2026-11-10). Standing decisions quoted from PROJECT_MEMORY. |
| Related docs | [03 Duplicates](03-duplicate-module-report.md), [05 Navigation](05-navigation-redesign.md), [10 Data model](10-data-model-recommendations.md), `docs/ROUTE_OWNERSHIP_2026-08-30.md` |

## 1. Rules applied to every recommendation

1. Spec rule: do not remove or merge anything until database dependencies, workflows, permissions, reports, API usage and business purpose are understood. Every item below lists those dependencies.
2. Retire = route becomes a `LegacyRedirect` (pattern already used for 12 admin routes in `src/App.jsx`), nav item removed, page component kept one release, then deleted. Tables are NEVER dropped in the same release; they are renamed with a `_retired` suffix or left with a `COMMENT` (project memory: DROP statements stall the MCP and are avoided; rename + revoke is the house pattern).
3. Module keys stored in `module_permissions` / `user_access_grants` / `modules` are kept as aliases when a page merges, so existing grants keep working.
4. Every change ships behind the existing tests that pin structure: `navRouteAccessParity.test.js`, `commandSearchCoverage.test.js`, `consoleModuleCoverage.test.js`, `platformMap.test.js`, `navTreeParity.test.js`, `rowCapGuard.test.js`. Update them in the same change.
5. One merge to `main` per batch (owner rule: every push is a production build).

## 2. Decisions table

| ID | Item | Decision | Target | Phase | Effort | Migration risk |
|---|---|---|---|---|---|---|
| D1 | `fleet_master` table readers | Fix now, then retire table | `vehicle_fleet` | 1 | S | Low |
| D2 | Fleet Master + Asset Management | Merge | "Fleet Register" (one page, list + detail at `/asset-management/:assetNo`) | 2 | M | Low |
| D2b | Vehicle 360, Vehicle History, Digital Twin | Convert to tabs of Asset Detail | Asset Detail | 3 | M | Low |
| D3 | Insurance Claims ledger (`insurance_claims`, 0 rows) | Retire after owner confirms | Accident Claim tab + Insurance Policies | 2 | S | Low |
| D3b | Claims Summary | Keep (primary claims analytics) | - | - | - | - |
| D4 | Incident Reports | Keep separate if non-vehicle safety events; else merge | Accidents with `event_class` | 3 | M | Medium |
| D5 | KPI Center / KPI Command / Benchmark / Comparison / Advanced Analytics | Merge into fewer surfaces | "KPI Scorecards" (Engineering KPI primary) + "Comparisons" | 2 | L | Medium |
| D6 | RCA + Root Cause Engine + Continuous Improvement + Anomaly Scan | Merge | "Root Cause and Improvement" with tabs Records / Analysis / Anomalies | 3 | M | Low |
| D7 | Report builders | Keep separate UIs, share one block engine + one PDF/PPTX renderer | `src/lib/report/*` shared core | 3 | L | Medium |
| D8 | Cost calculations | Convert to shared service (already partly) | `governedCost.js` + grid RPCs only | 2 | M | Medium |
| D9 | Scrapped definitions | Convert to shared predicate | `src/lib/tyreStatus.js` (new) + `list_scrapped_tyres` | 2 | S | Low |
| D10 | Main-app System Health, Usage & Adoption, AI Cost Monitor, Developer Portal | Move into Admin Console (redirect) | `/console/health`, `/console/analytics`, console AI usage, `/console/api-keys` | 2 | S | Low |
| D10b | Main-app Audit Trail | Keep (Integration Admin needs it outside console) | - | - | - | - |
| D11 | Data intake entry points | Merge into one "Data Intake Centre" with tabs | `/data-intake` | 2 | M | Medium |
| D12 | Breakdown Callouts / Service Requests / Repair Requests / Breakdown Register | Merge into one intake + one register | Repair Request (RFR) intake, Breakdown Register for downtime | 3 | M | Medium |
| D13 | Approval Matrix / Workflows / Delegations | Keep, group under one "Approval Workflows" parent | Administration | 2 | S | Low |
| D14 | Alert engines | Convert to shared service | one `alert_events` feed + rules registry | 4 | L | High |
| D15 | Live Fleet Status | Merge into Command Center / Daily Ops | `/` and `/daily-ops` | 2 | S | Low |
| D17 | Workshop Management | Merge into Work Orders (same table) | `/work-orders` tabs | 3 | M | Low |
| D17b | Workshop Status in Daily Ops | Keep (deliberate, 2026-10-07) | - | - | - | - |
| D18 | Expo app | Retire after Flutter reaches production track | Flutter | 3 | S | Medium |
| D19 | Per-row CPK | Convert to shared server service | lifetime CPK RPCs | 2 | L | High (numbers change) |
| D20 | `org_id` columns | Converge on `organisation_id` | schema | 3 | M | Medium |
| D21 | `tyre_specifications` vs `tyre_spec_catalog` | Keep separate (deliberate) | - | - | - | - |

## 3. Dependency checklists and safe sequence

### D1 - `fleet_master` readers (do first)
- Dependencies: `src/pages/LiveFleetStatus.jsx:434`, `src/pages/ComplianceDashboard.jsx:237`, `src/lib/api/tyreSpecs.js:67`, `src/lib/ragService.js:118`. Column differences: `fleet_master` has `registration`, `operator_name`; `vehicle_fleet` has `registration_no`, no `operator_name`.
- Tables/RLS: `vehicle_fleet` already org + country + site isolated.
- Sequence: (1) repoint the 4 reads with column aliases (`registration:registration_no`), (2) add `fleet_master` to the row-cap/guard test as "must not be read", (3) next release `COMMENT ON TABLE fleet_master IS 'retired'`, revoke from authenticated, (4) later rename `fleet_master_retired`.
- Verify: Live Fleet Status count equals `vehicle_fleet` scoped count; compliance denominator non-zero.
- Rollback: revert the commit; the table is untouched until step 3; step 3 rollback = re-grant.

### D2 - Fleet Register merge
- Dependencies: routes `/fleet-master`, `/asset-management` (module key `fleet_master` for both), nav entries, `NAV_MODULE_KEY`, command search entries, `src/lib/api/fleetMasterData.js`, `src/lib/api/assetManagement.js`, Data Intake asset import, QR labels links, AssetDetail links `/asset-management/<code>` (vercel redirect for `/assets/<code>` exists).
- Sequence: build tabs (Register / Sites / Groups) on AssetManagement, move FleetMaster-only features (ERP extended columns, ops status filter, Excel export), redirect `/fleet-master` to `/asset-management`, keep module key.
- Rollback: restore route element; no data change.

### D3 - Insurance Claims ledger
- Dependencies: `src/pages/InsuranceClaims.jsx`, `src/lib/api/insuranceClaims*`, route guard Role Admin/Manager/Director, scheduled report types (check `report_schedules.report_type` for any value pointing at it; claims schedules use `accidents`), country isolation policy (V226 added one), command search entry.
- Precondition: owner confirms; `select count(*) from insurance_claims` = 0 at the time.
- Sequence: redirect `/insurance-claims` to `/claims-summary`; remove nav item; comment table as retired.
- Rollback: restore route; table untouched.

### D5 - KPI and analytics consolidation
- Dependencies: module keys `kpi_scorecard`, `analytics`, `fleet_analytics`, `fleet_intelligence`, `site_comparison`, `country_comparison`; scheduled report type `kpi`; Board Overview and Executive Report sections that import page-level helpers; Dashboard Builder widget sources; TV Display boards; tests per page.
- Target structure: Engineering KPI = canonical engineering metrics; KPI Center = targets and scorecards (reads Engineering KPI service); "Comparisons" = Site / Country / Fleet comparison tabs; Advanced Analytics and Benchmark fold into those tabs. Executive layer (Board Overview, Executive Report, Executive Analytics) stays (doc 05 Executive Intelligence group).
- Precondition: D19 done or at least a parity test so the merged page does not change numbers silently.
- Sequence: one page at a time; redirect old route with `?tab=`; keep module keys as aliases in `NAV_MODULE_KEY`.
- Rollback: route revert.

### D8 / D19 - Calculation consolidation
- Dependencies: `src/lib/kpiEngine.js`, `src/lib/tyreLifetime.js`, `src/lib/governedCost.js`, server RPCs `get_fleet_cpk`, `get_cpk_drivers`, `get_brand_size_cpk`, `report_tyre_summary`, `get_cost_cpk_overview`; the inventory in `docs/tyre/CALCULATION_SOURCE_MAP.md`.
- Sequence: (1) add lifetime-CPK server functions beside the old ones (new names, old untouched), (2) dual-read in a hidden comparison panel and record the delta per country, (3) owner signs off on the changed numbers, (4) switch pages, (5) rename old functions `_v1_retired` and revoke (house pattern).
- Rollback: pages switch back to old functions (still present until step 5).

### D10 - Admin pages into console
- Dependencies: `/system-health` (Admin), `/tenant-health` (Admin), `/ai-cost-monitor` (flag `ai_tools`), `/developer-portal` (Admin, Manager, Director, Integration Admin). Developer Portal is used by Integration Admin and Manager, who cannot enter the console.
- Decision: redirect `/system-health`, `/tenant-health`, `/ai-cost-monitor` (Admin-only today; super-admin owns these views). Keep `/developer-portal` and `/audit` in the main app for non-super roles.
- Rollback: route revert.

### D11 - Data Intake Centre
- Dependencies: routes `/data-intake`, `/upload`, `/erp-import`, `/erp-intake`, `/expense-import`, `/upload-approvals`, `/cleaning`; flags `data_intake`; roles UPLOAD_ROLES / CLEANING_ROLES; staging tables; promotion RPCs (V415); fingerprint guard (V363); `system_config.max_upload_rows`.
- Target: `/data-intake` tabs = Upload (auto-detect, uses ErpIntake engine) / ERP staging review (ErpImport) / Expenses / Production, SCO, SANY, Sites (already tabs) / Approvals / History / Cleaning.
- Precondition: no change to the import ENGINE (`src/lib/import/*`); only entry points move.
- Rollback: routes revert; engine unchanged.

### D12 - Breakdown and repair intake
- Dependencies: tables `breakdown_callouts` (0), `service_requests` (0), `repair_requests` (0), `asset_breakdowns` (30); RPCs `next_rfr_no`, `convert_repair_request_to_job_card`; mobile modules `reportIssue`, `repairRequest`; disposal page uses `breakdownsByAsset`.
- Target: one intake (Repair Request RFR, converts to job card) and one downtime register (Breakdown Register). Retire Breakdown Callouts and Service Requests (both empty).
- Rollback: route revert; tables untouched.

### D14 - Alert engines (later)
- Dependencies: 8 dedupe tables and 7 cron jobs listed in doc 03 D14; notification delivery (`notifications`, `workflow_notifications`, `workflow-notify` edge fn).
- Target: keep each detector, write findings to one `alert_events` table with source, severity, dedupe key, acknowledged state; one inbox.
- High risk: notification fan-out and dedupe semantics differ per engine. Do last.

### D18 - Expo retirement
- Preconditions: Flutter on Play production track; parity checklist from `docs/flutter-migration/09-migration-matrix.md` complete (phases 11 and 12 still open per project memory); `mobile_min_version` raised so Expo users see update prompt pointing to the Flutter listing (different package names: Expo `com.shahzebrahman.tyrepulseinspector`, Flutter `com.shahzebrahman.tyrepulse`).
- Rollback: keep Expo OTA workflow until 30 days after cut-over.

### D20 - Tenant key convergence
See doc 10 section 5.

## 4. Recommended order

| Batch | Items | Why first |
|---|---|---|
| 1 (Phase 1) | D1, D10, D15, D3 (if confirmed) | Fix a live defect; low-risk redirects; reduce nav by ~6 items |
| 2 (Phase 2) | D2, D9, D11, D13 grouping, D8 remaining totals | Navigation clarity, single cost path |
| 3 (Phase 2) | D19 then D5 | Numbers must converge before pages merge |
| 4 (Phase 3) | D6, D12, D17, D4, D7 shared engine, D20 | Process merges needing owner input |
| 5 (Phase 3 to 4) | D18, D14 | Depends on Flutter rollout and alert redesign |

## 5. Standing decisions that constrain merges

| Decision | Source |
|---|---|
| Claims Summary and Insurance Claims models stay distinct (only the empty ledger is proposed for retirement) | project memory 2026-07-14 |
| Accident Report Builder and general Report Builder stay separate UIs | project memory 2026-07-14 |
| Workshop Status is not a job-card workflow and lives in Daily Ops | project memory 2026-10-07 |
| Report builders are Admin-only, including embedded ones | project memory 2026-08-16 |
| No per-module bulk upload buttons; uploads go through intake | project memory 2026-07-14 |
| `tyre_specifications` = fitment rules, `tyre_spec_catalog` = brand catalogue | project memory 2026-09-29 |
| Empty-table modules accepted as-is; no seeding or fake data | project memory 2026-10-05 |
| No mobile builds without owner request; Flutter only | project memory 2026-08-19 / 09-27 |

## Open decisions for the owner

- Approve batch 1 (D1, D10, D15, D3).
- D4 and D12 business meaning (see doc 03).
- Accept that D19 will change CPK figures (weighted lifetime instead of per row) before D5 starts.
- Target date for Flutter production track (gates D18).

## Next actions

| Action | Phase | Effort |
|---|---|---|
| Implement batch 1 in one PR with updated parity tests | 1 | S |
| Write lifetime-CPK server functions + comparison panel (D19 steps 1 to 2) | 2 | L |
| Fleet Register and Data Intake tab consolidation | 2 | M |
| Owner workshop on D4, D12, D14 | 3 | S |
