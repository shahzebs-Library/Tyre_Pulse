# Tyre calculations - source of truth map

## Phase 1 (2026-11-09): lifetime CPK is end to end in the web layer and has a database definition
| Measurement (rule T19) | Canonical | Where shown |
|---|---|---|
| Physical tyre (key, km over non-overlapping fitments, price once, cost status, coverage) | SQL `v_tyre_lifetime_fitments` / `v_tyre_lifetime`; JS `toLifetimeTyres` (MIRROR, Egypt parity 12/12 aggregates) | everywhere below |
| Physical tyre lifetime CPK (purchase-only and full) | SQL `get_tyre_lifetime_cpk(country, from, to, site)`; JS `lifetimeCpk` / `fullLifetimeCpk` | CPK Intelligence "Tyre lifetime" tab, Tyre Passport, Serial Tracker, Tyre Records detail, Tyre Bay |
| Fleet aggregate tyre CPK (weighted, per tyre-km) | JS `weightedCpk` / `lifetimeSummary`; SQL inside `get_tyre_lifetime_cpk` | kpiEngine and every group CPK (brand, site, asset, driver, supplier, size, vendor, workshop) |
| Per-fitment tyre CPK (one stint) | JS `recordCpk` with the price from `withOnePricePerTyre` | Tyre Bay stints, Tyre Records row, Driver Detail table, Passport journey - each labelled per fitment |
| Fleet expense per vehicle-km / CPH | SQL `get_fleet_cpk` (unchanged, production) | CPK Intelligence "Fleet CPK" tab, report snapshot `cost.tyre_cpk` (Flutter management screen) |

Phase 2: expense cost status (`get_expense_cost_status_summary`, Expense Report + Data Reconciliation) and Budget Planner
actual spend from the expense grid - see docs/tyre/FINANCIAL_SOURCE_OF_TRUTH.md.

Helpers moved onto the lifetime layer in Phase 1 (each with refit tests):
- Group A: analyticsEngine (`lifetimeGroups`, `lifetimeMetrics`), brandPerformanceAnalytics, comparisonAnalytics,
  siteComparisonAnalytics, advancedAnalyticsAnalytics, continuousImprovementAnalytics; pages Analytics, SiteComparison,
  CountryComparison load the columns needed.
- Group C: tyrePassport (first price once, DISPUTED flag), serialTrackerAnalytics (was latest price), tyreLifecycleAnalytics,
  vehicle360Analytics, tyreBay, tyreRecordsView (+ api listRecordedLifeKm), tyreScrapManagementAnalytics,
  tyreFailureCpkBoardAnalytics, tyreFailureView, engineeringKpiAnalytics.
- Group D: kpiEngine (group `avgCpk` = weighted, old mean kept as `meanOfRatios`; vendor/workshop collapse first),
  fleetIntelligence, rootCause, driverSafety / Management / Detail, opsIntelligence, fleetRisk, digitalTwin,
  predictiveMaintenance, alertEngine (alerts only on finished tyres with complete km), ragService + agents.
- Group B: supplier, retread, size, cost centre, budget, TCO, combinations (see the Phase 1 PR).
- Mobile: Expo AI context + Overview (`mobile/lib/tyrePurchase.ts`, serial vectors pinned web + mobile).

Deliberately still per fitment (events, not tyres): removals, failures, replacements, fitment counts, downtime,
availability, risk ratings.

STILL per fitment row on the server (kept unchanged on purpose until the new figures are verified - repointing them
changes production numbers): `get_fleet_cpk`, `get_cpk_drivers`, `get_brand_size_cpk`, `get_tyre_running_life`,
`report_tyre_summary`, `report_asset_metrics`, `report_country_metrics`, `get_report_snapshot(_authed)`,
`get_mobile_analytics`. The before/after numbers are in docs/tyre/PHASE1_LIFETIME_CPK.md.


Audit date 2026-11-09 (after PR #470 + migration 20261109150000). **Updated by Phase 1 (migrations
20261109160000 + 170000, branch claude/tyre-lifetime-cpk-phase1)** - see the Phase 1 section first. For each KPI:
the ONE canonical implementation, its mirror, and every place that still computes
it another way. "Per row" = treats each fitment row as a tyre (a refit is bought
again and its km is one stint).

## Canonical implementations

| KPI | Canonical | Mirror | Rule |
|---|---|---|---|
| Real serial | SQL `tyre_serial_is_strong` | JS `isStrongSerial` (src/lib/tyreLifetime.js) | T6 |
| km of one fitment | SQL `tyre_km_life` | JS `tyreKmAssessment` (src/lib/tyreKm.js) | T7 |
| Physical tyre (price once, km summed) | JS `toLifetimeTyres` | none in SQL yet | T1, T8 |
| Fleet CPK | JS `weightedCpk` via `kpiEngine.computeCpkFleet` | none in SQL yet | T8 |
| Average tyre life | `kpiEngine.computeAvgTyreLife`, `computeFleetTyreLife` (lifetime since 20261109150000) | - | T8 |
| Purchase spend by month | `kpiEngine.computeCostTrend` (one price per tyre since 20261109150000) | - | T1 |
| Tyre / fleet cost TOTAL | expense grid via `loadCostSplit` / `loadGridTyreByAsset` | `get_parts_expense_snapshot`, `get_tyre_cost_by_asset` | T9 |
| Cost status per fitment | SQL view `v_tyre_cost_status` | - | T1, T2 |
| Exceptions | SQL `get_tyre_exceptions` | JS `exceptionRows` (src/lib/tyreExceptions.js) | T1-T6 |

## kpiEngine status (src/lib/kpiEngine.js)
Lifetime-aware: computeCpkFleet, computeCpkByBrand, computeCpkByAsset, computeCpkBySite,
computeAvgTyreLife, computeRetreadPerformance, **computeFleetTyreLife, computeCostTrend,
computeScrapRate (cost)** (last three fixed 20261109150000).
Partly: computeVendorPerformance, computeWorkshopPerformance (group BEFORE collapsing, so a
tyre refitted at another site/brand group is split). Per-row by design (events, not tyres):
removal, failure, replacement rates, downtime, availability.
Per-group `avgCpk` in the by-brand/asset/site helpers is a mean of per-tyre ratios, not weighted.

## NOT lifetime-aware yet (open work, ~40 web helpers + all server RPCs)
Server RPCs (none call `tyre_serial_is_strong` or sum per physical tyre):
`get_fleet_cpk`, `get_cpk_drivers`, `get_brand_size_cpk` (avg cost / avg km per row),
`get_tyre_running_life` (expected life = avg total_km of removed rows), `report_tyre_summary`,
`report_asset_metrics`, `report_country_metrics`, `get_report_snapshot(_authed)`, `get_mobile_analytics`.

Web helpers (per row; consumer page in brackets):
analyticsEngine (Analytics, CountryComparison, SiteComparison, VehicleHistory, BrandPerformance, Dashboard life),
advancedAnalyticsAnalytics, continuousImprovementAnalytics, tyreSizeAnalytics + sizeOptimizerView,
supplierScorecard / supplierDetailAnalytics / supplierManagementAnalytics.avgLife, retreadManagementAnalytics,
tyreLifecycleAnalytics, vehicle360Analytics, fleetIntelligenceAnalytics, tco.js, combinations (blended),
costCenterAnalytics, budgetPlannerAnalytics, rootCauseEngineAnalytics, driverSafety, driverManagement/DetailAnalytics,
opsIntelligence, fleetRisk, digitalTwin, tyreBay (per stint, display), tyreRecordsView, tyreScrapManagementAnalytics,
predictiveMaintenance, alertEngine (high-CPK alerts), ragService (AI context), qaDataAgent,
brandPerformanceAnalytics.avgCost, siteComparison/comparisonAnalytics.avgCost,
tyreFailureCpkBoardAnalytics.removedRegister, tyreFailureView, engineeringKpiAnalytics.avgLifeOf.
Own serial grouping that disagrees with T1: tyrePassport.js (charges a different later price again),
serialTrackerAnalytics.js (takes the LATEST priced row).
Mobile: Expo ai/index.tsx, overview.tsx (sum cost_per_tyre per row). Flutter tyre_record.dart (display).

Recommended order: (1) a SQL `tyre_lifetime` view mirroring `toLifetimeTyres` so the RPCs can read one
definition; (2) repoint get_fleet_cpk / get_brand_size_cpk / report_tyre_summary to it with
before/after reconciliation per country; (3) the web helpers above, page by page, each with a refit test.

## Other reported serial rule
`src/lib/tyreSerialCheck.js` (`serialProblem`, `isRealSerial`) is a DIFFERENT rule used only by the
TyreBoard and SerialCheckSection display flags. It disagrees with T6 on e.g. `AB12`, `NO SERIAL`,
`DOT18E56`, `000000`, `12.00R24`. Fold it onto `isStrongSerial` when those screens are next touched.
