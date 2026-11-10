# 13 - Reporting Architecture

| Field | Value |
|---|---|
| Deliverable | 13 of 29 (spec section 10, "Reporting and Executive Intelligence") |
| Date | 2026-11-10 |
| Status | Partly built. Many working report surfaces, a governed cost layer, a metric registry with "Explain this number", scheduled e-mail digests, and token-shared TV boards. Gaps: several report surfaces still compute their own aggregates, server RPCs run on an older tyre CPK basis, the metric registry covers 12 KPIs and is mounted on 2 pages, and background generation / object storage for large reports is not built. |
| Evidence | Verified in code (2026-11-10): every path below; `REPORT_TYPES` (13 types), `REPORT_PAGES` (15 share pages), `DATASET_DIGEST` keys in the edge function, `ExplainThisNumber` mount points. Verified live (read-only SQL, 2026-11-10): 12 rows in `metric_registry`, 12 in `metric_versions`, 7 `report_schedules` (1 active), 2 active `report_shares`. From PROJECT_MEMORY: deploy versions of edge functions and historical defects. |
| Related docs | `docs/BRANDING_AND_REPORT_SETTINGS.md`, `docs/EXPORT_GUIDE.md`, `docs/tyre/KPI_DEFINITIONS.md`, `docs/tyre/CALCULATION_SOURCE_MAP.md`, doc 11 (calculation audit), doc 14 (exports), doc 15 (executive dashboard), doc 19 (data governance) |

## 1. Layered model (as built)

```
Sources        parts_consumption (expense grid) | tyre_records | work_orders | inspections | accidents | production_logs | ...
Calculation    governedCost.js + costSummary.js (cost) | kpiEngine.js + tyreLifetime.js (tyre KPIs)
               claimsAnalytics.js (claims) | pmSchedule.js (PM) | workshopLive.js (workshop) | costPerM3 RPCs
Server RPCs    get_parts_expense_snapshot, get_cost_cpk_overview, get_fleet_cpk, get_tyre_lifetime_cpk,
               get_cost_per_m3, get_report_snapshot(_authed), report_* , get_maintenance_snapshot ...
Trust          metric_registry / metric_versions (V473), explain_metric, get_record_provenance,
               dataTrust.js scores (V375), quality / reconciliation (V474), lineage (V475)
Surfaces       dashboards, builders, scheduled e-mail, public share boards, TV kiosk, exports (doc 14)
```

## 2. Report surfaces

| Surface | Route / file | Data path | Exports | Notes |
|---|---|---|---|---|
| Command Center (home) | `/` : `src/pages/CommandCenter.jsx` to `src/components/commandCenter/CommandCenter.jsx`, engine `src/lib/commandCenter.js`, loaders `src/lib/api/commandCenter.js` | per-card loaders (fleet, tyre life, actions, workshop, PM, utilisation, spend, compliance, approvals), each fails alone | none | Spend lists per-country totals on All view |
| Board Overview | `/board-overview` : `src/pages/BoardOverview.jsx`, engine `src/lib/boardOverview.js` | kpiEngine via `buildBoardKpis`, grid cost via `loadGovernedCostSplit` | PDF | Section toggles in localStorage. Tyre spend TREND still sums `cost_per_tyre` (doc 11 G4) |
| Executive Report (builder) | `/executive-report` : `src/pages/ExecutiveReport.jsx` (2,436 lines) | grid cost + kpiEngine; customizable sections + 9 add-on blocks (localStorage `executiveReport.layout.v1`) | PDF, PPTX, Excel | White report view; added blocks are on-screen only |
| Executive Analytics | `src/pages/ExecutiveAnalytics.jsx` | client aggregates, ECharts | none | Forced-light |
| KPI Command Center / KPI Scorecard | `src/pages/KpiCommandCenter.jsx`, `src/pages/KpiScorecard.jsx` | kpiEngine | Excel/PDF | |
| Engineering KPI | `src/pages/EngineeringKpi.jsx` | kpiEngine + lifetime layer | yes | Canonical home for CPK, life, failure (golden rule) |
| CPK Intelligence | `/cpk-intelligence` | `get_fleet_cpk`, `get_cpk_drivers`, `get_brand_size_cpk`, `get_tyre_lifetime_cpk`, km and hours source RPCs (V462/V463) | Excel/PDF | Custom CPK report tab (`src/lib/cpkReport.js`) |
| Expenses and CPK | `/expense-report` : `src/pages/ExpenseReport.jsx` | `get_parts_expense_snapshot`, `get_cost_cpk_overview`, `get_cost_variance`, `get_expense_period_trend` | Excel rows + PDF | Single-country deep report by construction |
| Cost per m3 | `/cost-per-m3` | `get_cost_per_m3`, `_trend`, `get_production_rejections` | yes | Explain-this-number mounted |
| Accident Report Builder | Accidents tab : `src/components/accidents/AccidentReportBuilder.jsx`, engine `src/lib/accidentReport.js` | in-memory accident records | PDF (`accidentReportPdf.js`), PPTX (`accidentReportPptx.js`) | Admin only (reportBuilderAccess); saved layouts in `accident_report_templates` (V221) |
| General Report Builder | `/report-builder` : `src/pages/ReportBuilder.jsx`, `src/lib/reportBuilder.js` | datasets over base tables | PDF with charts, Excel | Admin only |
| Dashboard Builder | `/dashboard-builder` : `src/pages/DashboardBuilder.jsx`, `WidgetRenderer` | widget fetchers, global filters | none | Admin only |
| Report Center / Reports wizard | `src/pages/ReportCenter.jsx`, `src/pages/Reports.jsx` | tyre_records, inspections, PM | Excel/PDF | |
| Presentation Studio | `src/components/present/PresentationStudio.jsx` (inside Board Overview, Expenses, Cost per m3) | host page data | PPTX, Excel | Wrapped in `StudioBoundary` |
| Scheduled Reports | `/scheduled-reports` : `src/pages/ScheduledReports.jsx`, `src/lib/api/scheduledReports.js`; edge fn `supabase/functions/send-scheduled-reports/index.ts` | `REPORT_TYPES` (13) + `builder:<template-id>` | e-mail HTML digest; on-demand PDF/Excel via "Generate now" | pg_cron every 15 min; "Send now" path |
| Report Sharing (public) | `/report-sharing` manager; anon viewer `/report/:token` : `src/pages/ReportShare.jsx` | `get_report_snapshot(token, password, site, country, from, to)` (V251-V264, V279) | none | 15 fixed pages or a custom block layout (`report_shares.layout`, `src/lib/reportShareLayout.js`) |
| TV kiosk (authenticated) | `/display` : `src/pages/DisplayDashboard.jsx`, `src/lib/displayCharts.js`, `src/lib/displayBoard.js` | client reads | none | |
| Workshop TV | `/workshop-tv/:token` : `src/pages/WorkshopTv.jsx` | `get_workshop_snapshot` (V293), PII-free | none | |
| Expense Trends | `/expense-trends` + `src/components/expense/YearlyTrendPanel.jsx` (embedded in 5 pages) | `get_expense_period_trend` (V414) | Excel/PDF | |

## 3. Single calculation services (the rule and how well it holds)

| Measure | Canonical service | Surfaces that use it | Known deviations |
|---|---|---|---|
| Cost totals (tyre / maintenance / combined) | `loadCostSplit`, `loadGovernedCostSplit` (`src/lib/api/costSummary.js`), `governedCost.js` | Dashboard, Analytics, Board Overview headline, Executive, Cost Center, PM, Engineering KPI, Vendor, Brand, Vehicle History | Board Overview trend line (doc 11 G4); share board cost comes from `_report_cost_block` (V522, grid, same rule, separate SQL) |
| Tyre CPK / life | `kpiEngine.js` + `tyreLifetime.js` | web pages | server RPCs listed in doc 11 G1 are per fitment row |
| Claims | `claimsAnalytics.analyzeClaims` | Claims Summary, accident exports, `claims` digest | none known |
| Accident open/closed | `accidentVocab.isIncidentClosed`, `isCaseSettled` | register and report builder (aligned 2026-07-28) | `accidents.closure_status` is a dead column (all 'open') |
| Cost per m3 | `get_cost_per_m3` (approved m3 only, V523) | Cost per m3, share board `cost_unit` | the board computes m3 from `production_logs` in its own SQL |
| Expense variance | `get_cost_variance` (Bennet split, closes exactly, V378) | Expenses "Why it changed" | none |

## 4. Currency rule (never blended)

- `src/lib/governedCost.js`: `money(amount, currency)`, `addMoney` throws `CurrencyMismatchError`,
  `CountryCostSet` exposes no scalar total, `MIXED_CURRENCY` marker, `perUnitCost`, `isComparable`
  (`MIN_COVERAGE = 0.25`).
- Server side: `get_expense_by_country` (V344), `_report_cost_block` returns a scalar only when one currency is
  in scope, else NULL plus `mixed_currency` (V522).
- FX: `currency_rates`, `fx_rate_for`, `fx_convert`, `fx_coverage`, `system_config.fx_policy` (V380). Enter vs
  approve enforced server-side. No rate has been approved (per project memory), so no combined-country total
  is shown anywhere. This is correct behaviour, not a defect.
- History of the defect this prevents: the All-countries view once rendered "SAR 138,443,319" =
  EGP + SAR + AED added (per project memory V379 era); Board Overview, Executive, share board and several
  pages were fixed individually before the governed layer existed.

## 5. Explain this number, metric registry, trust scores

| Piece | Built | Evidence |
|---|---|---|
| `metric_registry` + `metric_versions` | Yes, 12 KPIs, each with v1 (live count 2026-11-10) | V473 |
| `explain_metric(metric_id, country, from, to)` | Yes | V473 |
| `get_record_provenance(table, id)` | Yes, whitelisted tables | V473 |
| `ExplainThisNumber` component | Yes | `src/components/trust/ExplainThisNumber.jsx`; mounted only in `src/pages/EngineeringKpi.jsx` and `src/pages/CostPerM3.jsx` |
| Metric Catalogue console | Yes | `src/console/pages/ConsoleMetricCatalogue.jsx` (legacy `/console/metric-catalogue` now redirects to `/console/analytics?tab=metrics`) |
| Trust scores per KPI domain | Yes | `src/lib/dataTrust.js` (17 checks, 5 dimensions, 5 domains), `TrustBadge.jsx` used in `DataTrustSection.jsx` and `ConsoleControlCenter.jsx`; a domain with nothing measurable returns null |
| Lineage graph and impact | Yes | V475 `get_lineage_graph`, `get_downstream_impact`; `ConsoleLineageExplorer.jsx` |

Gap: the registry is not yet the contract the dashboards are built from. A KPI shown on Board Overview, the
share board or the Command Center has no metric id and no Explain button.

## 6. Spec section 10 checklist

| Requirement | Status |
|---|---|
| Exports use same data, filters, sort, columns, KPIs, charts, branding | Built for EnterpriseTable exports (doc 14); partly for page-specific PDFs |
| Three export modes (current view, full filtered, executive) | Current / filtered / selected built in `src/lib/report/tableReport.js` + `ExportMenu.jsx`; "executive" is a separate per-page report, not a mode |
| ECharts for executive dashboards | Built (Executive Analytics, share boards, TV) |
| Playwright HTML-to-PDF | Built as an optional service `services/report-engine/` (routed when `VITE_REPORT_SERVICE_URL` is set; client fallback). Deployment state not verified |
| PptxGenJS | Built |
| Background workers + object storage for large reports | Not built (all client-side; scheduled e-mails are HTML digests without attachments) |
| Executive content: target vs actual, previous, change, trend, forecast, action, owner, due date | Partly; targets exist in `kpi_targets` (7 rows, per project memory) but no report shows owner and due date per finding |
| AI concise structured output | Partly; `CopilotCard` renders Observation / Root cause / Risk / Actions |
| Executive Display Mode (token, expiry, fullscreen, refresh, rotation, branding, filters, revocable) | Built (`report_shares`, password, expiry, revoke, site/country/date filters, logo, rotation, visibility-gated refresh). Emergency alerts: not built |

## 7. Known reporting defects and risks

| ID | Finding | Recommendation | Phase | Effort |
|---|---|---|---|---|
| RA1 | Scheduled digests for `executive` and `claims` do not honour the schedule period; dataset digests do (fixed 2026-09-13) | Pass period bounds into `buildDigest` / `buildClaimsDigest` | 2 | S |
| RA2 | Scheduled e-mails carry no PDF/Excel attachment; builder layouts are e-mailed as a claims digest | Server rendering (report-engine) + storage link in the e-mail | 4 | L |
| RA3 | Share board and Flutter read `get_report_snapshot`, which uses per-fitment tyre CPK | Repoint after doc 11 G1 | 2 | M |
| RA4 | Explain-this-number on 2 pages only | Give every headline KPI tile a metric id; mount `ExplainThisNumber` by id | 3 | M |
| RA5 | Several builders (Executive, Accident, General, Dashboard, share layout) each have their own block model | Keep them (they target different outputs) but share one KPI catalogue sourced from `metric_registry` | 4 | L |
| RA6 | 6 of 7 scheduled reports are paused (live 2026-11-10) | Owner review; the pipeline is healthy | 1 | S |
| RA7 | `report_schedules.org_id` was NULL on all rows until a 2026-09-13 backfill; `createSchedule` still writes `profile.org_id ?? null` | Fall back to `organisation_id`; NOT NULL after backfill | 2 | S |

## 8. Decisions recorded

- Report builders are Admin only, including embedded panels (owner, 2026-08-16).
- The old `/display/:token` executive token share was retired in favour of `report_shares` (2026-07-16).
- Public share boards expose aggregates only through an anon DEFINER RPC; no table is granted to anon (V281).
- Washing is never shown as a cost driver.
- AI runs on the model fixed server-side in `chat-ai`; the client cannot choose a model.

## Open decisions for the owner

1. Approve a background report service (report-engine deployment plus storage) so scheduled reports can carry
   real PDF/Excel attachments.
2. Which KPIs become the official registry set for executive surfaces (today 12 are registered).
3. Re-activate or delete the 6 paused schedules.

## Next actions

| Action | Phase | Effort |
|---|---|---|
| RA1, RA6, RA7 | 1-2 | S |
| Fix Board Overview trend source (doc 11 G4) | 2 | S |
| Metric ids on every headline tile + Explain button (RA4) | 3 | M |
| Repoint snapshot RPCs to lifetime CPK (RA3) | 2 | M |
| Deploy report-engine, add storage-backed attachments (RA2) | 4 | L |
