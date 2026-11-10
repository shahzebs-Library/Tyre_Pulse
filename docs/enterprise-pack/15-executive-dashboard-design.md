# 15 - Executive Dashboard Design

| Field | Value |
|---|---|
| Deliverable | 15 of 29 (spec section 10, executive intelligence and Executive Display Mode) |
| Date | 2026-11-10 |
| Status | Partly built. Five executive surfaces exist and work on real data with honest N/A states. They overlap, compute some KPIs separately, and none shows target vs actual with an owner and a due date. A single governed executive dashboard is proposed below. |
| Evidence | Verified in code (2026-11-10): `src/components/commandCenter/CommandCenter.jsx` card titles, `src/lib/boardOverview.js` `buildBoardKpis`, `src/lib/api/commandCenter.js` loaders, `src/lib/api/reportShares.js` `REPORT_PAGES`. Verified live (read-only SQL, 2026-11-10): 12 registered metrics (`accidents_total, avg_tyre_life, claims_recovered, cost_per_m3, failure_rate, fleet_cpk, fleet_size, inspection_compliance, maintenance_cost, open_work_orders, scrap_rate, tyre_spend`), 7 rows in `kpi_targets`, 0 approved FX rates. From PROJECT_MEMORY: data coverage figures (risk_level, tread depth, odometer coverage). |
| Related docs | doc 13 (reporting architecture), doc 14 (exports), doc 11 (calculation audit), `docs/tyre/KPI_DEFINITIONS.md`, `docs/DESIGN_SYSTEM.md` |

## 1. Executive surfaces today

| Surface | Route / file | Audience | Strength | Weakness |
|---|---|---|---|---|
| Command Center (home) | `/` : `src/components/commandCenter/CommandCenter.jsx`, `src/lib/commandCenter.js` | everyone signed in | Fast (per-card loaders, each fails alone), real data, owner mockups light + dark | Operational, not decision-led; no targets |
| Board Overview | `/board-overview` : `src/pages/BoardOverview.jsx`, `src/lib/boardOverview.js` | Admin / Manager / Director | One consolidated report: KPIs, 12-month trends, breakdowns, recommendations, section toggles, PDF | Some KPIs computed locally (section 3); trend uses a different cost source from the headline |
| Executive Report (builder) | `/executive-report` : `src/pages/ExecutiveReport.jsx` | management | Customizable sections and blocks, PDF / PPTX / Excel, white document view | Layout per browser (localStorage); added blocks not in exports |
| KPI Command Center / Scorecard | `src/pages/KpiCommandCenter.jsx`, `src/pages/KpiScorecard.jsx` | engineering, management | kpiEngine KPIs, PM compliance | Overlaps Engineering KPI |
| TV boards | `/report/:token` (`ReportShare.jsx`, 15 pages or custom layout), `/display` (`DisplayDashboard.jsx`), `/workshop-tv/:token` (`WorkshopTv.jsx`) | wall screens, executives without a login | Token, password, expiry, revoke, rotation, filters, logo, visibility-gated refresh | Snapshot RPC uses per-fitment tyre CPK (doc 11 G1); no emergency alert overlay |
| Executive Analytics | `src/pages/ExecutiveAnalytics.jsx` | management | ECharts heatmap / treemap / sankey / risk matrix | Client aggregates over capped reads (50k) |

Do not add another executive page. The proposal in section 5 reshapes Board Overview into the governed
executive dashboard and keeps the others as specialised views.

## 2. KPI inventory and sources

| KPI | Canonical source | Registered metric id | Data coverage caveat |
|---|---|---|---|
| Fleet size | `vehicle_fleet` count (paged / exact count) | `fleet_size` | Includes historical (Inactive) assets unless filtered; KSA 615 active / 415 historical (per project memory V508) |
| Tyre spend | expense grid `loadCostSplit().tyre` | `tyre_spend` | Per currency only |
| Maintenance cost | expense grid spare + oil, plus PM records | `maintenance_cost` | Per currency only |
| Fleet CPK | `kpiEngine.computeCpkFleet` (weighted, lifetime) | `fleet_cpk` | Estimated prices pull CPK about 15% low (KSA, per project memory); show estimated share |
| Average tyre life | `kpiEngine.computeAvgTyreLife` | `avg_tyre_life` | km caps by class (doc 11 R2) |
| Failure rate | `kpiEngine.computeFailureRate` on the rated subset | `failure_rate` | `risk_level` populated on almost no tyres (per project memory 2026-08-10), so N/A |
| Scrap rate | `kpiEngine.computeScrapRate` | `scrap_rate` | Several scrap definitions exist (doc 11 G5) |
| Inspection compliance | kpiEngine | `inspection_compliance` | Plans exist for only a fraction of assets (245 planned, per project memory 2026-10-07) |
| Open work orders | `isOpenWoStatus` (`src/lib/workOrderStatus.js`) | `open_work_orders` | Board Overview uses its own regex instead (section 3) |
| Accidents / claims recovered | `claimsAnalytics.analyzeClaims` | `accidents_total`, `claims_recovered` | `repair_cost` on 2 of 35 incidents, police report no on 0 (per project memory 2026-07-28) |
| Cost per m3 | `get_cost_per_m3` (approved m3) | `cost_per_m3` | Region needs site region tagging; rate withheld below 1,000 m3 (`MIN_M3_FOR_RATE`) |
| PM compliance / overdue | `pmSchedule.summarizePmCompliance` | not registered | |
| Fleet availability, downtime | job card stages (`src/lib/jobCard.js`), Workshop Live `computeKpis` | not registered | |
| Running and remaining tyre life (due / overdue) | `get_tyre_running_life` + `measureFor` | not registered | Threshold drift (doc 11 G2) |
| Budget variance | `get_cost_variance` | not registered | |

## 3. Honest N/A rules (as implemented) and defects found

Implemented rules worth keeping:
- A KPI with no measurable input returns `null` and renders "N/A", never a flattering constant
  (SafetyCompliance, TyreScrap, Downtime, Retread and FuelEfficiency fixed 2026-08-02, per project memory).
- Money under the All-countries scope is shown per country or as N/A with a "mixed currencies" note; never a
  blended total (`governedCost.js`).
- Comparisons are withheld when the measured coverage is below 25% (`isComparable`, `MIN_COVERAGE`) and the
  CPK block carries `comparable`.
- Dashboards default to the current year, floored at 3 months, falling back to the latest year with data
  (`src/lib/defaultPeriod.js`), and say which period they show.

Defects found in this audit (verified in `src/lib/boardOverview.js`):

| ID | Defect | Effect | Fix | Phase | Effort |
|---|---|---|---|---|---|
| EX1 | `accidents: accidents.length || null`, `workOrdersOpen: openWo || null`, `claimsCount`, `inspections`, `stockItems` use `|| null` | A real zero renders as "N/A" (zero accidents looks like "no data") | Return 0 when the source read succeeded; null only when it failed | 2 | S |
| EX2 | Open / overdue work orders use `/complete|closed|done/i` | Disagrees with the canonical `isOpenWoStatus` (Cancelled counts as open here) | Use `isOpenWoStatus` | 2 | S |
| EX3 | `tyreSpend` KPI and trend sum `cost_per_tyre * qty` | Disagrees with the grid headline on the same page (T9) | Use `loadCostSplit` totals and `byMonth` | 2 | S |
| EX4 | Overdue compares `toISOString()` dates (UTC) | Off by one day for GCC evenings in rare cases (same class as the 2026-09-13 period bug) | Local date helper | 2 | S |

## 4. What an executive dashboard must show (spec section 10)

Per KPI: target, current value, previous value, percentage change, variance, 12-month trend, risk, cost, saving,
forecast, recommended action, responsible owner, due date. AI output: finding, supporting number, business
impact, recommended action, priority, responsible role. No long narratives.

Current coverage of that list:

| Element | Available today |
|---|---|
| Target | `kpi_targets` (7 rows live); not shown on any executive page |
| Current / previous / change | Expenses period comparison, Command Center "against the same span last year" |
| Variance | `get_cost_variance` (cost only) |
| Trend | 12-month series on Board Overview, Expense Trends |
| Forecast | `expenseTrends.forecast`, `tyreDemandForecast.js` |
| Risk | partly (accident severity, tyre due bands) |
| Saving | Value Advisor (procurement), ROI calculator; not on the dashboard |
| Action / owner / due date | `corrective_actions` and Action Center have owner + due date; not linked to KPIs |

## 5. Proposed final executive dashboard

Reshape Board Overview (route kept) into a governed dashboard driven by `metric_registry`:

```
Header: company, scope chip (country / region / site), period (named, e.g. "2026 to date"), data freshness
Row 1  Decision strip: up to 8 KPI tiles. Each tile = metric_id, value, target, delta vs previous,
       status (on track / at risk / off track), Explain button, trust badge
Row 2  Exceptions: the 5 largest negative variances with owner and due date (from corrective_actions)
Row 3  Trends: cost per currency, CPK, availability, accidents (12 months, forecast dashed)
Row 4  Drivers: "why it changed" (get_cost_variance), worst sites, worst assets
Row 5  Actions: open recommendations (finding, number, impact, action, priority, role)
Footer Basis and coverage notes; Export (Current view / Executive PDF / PPTX)
```

Rules:
1. Every tile is a registered metric; no tile without a `metric_id`. Explain this number on every tile.
2. Targets come from `kpi_targets`, extended with `country`, `site`, `period`, `owner_role` and an effective date.
3. Status thresholds are part of the metric definition (on track / at risk / off track), not page code.
4. Each exception row links to a `corrective_actions` record so owner and due date are real, not text.
5. The same payload feeds the PDF / PPTX export and the TV board page `exec_summary`, so the three match.
6. Recommendations are rule-based first (as `buildBoardRecommendations` does); AI summarises only what the
   rules found, in the six-field structure.
7. The dashboard is scope-aware through RLS only; no client-side filtering for security.

Executive Display Mode additions: an emergency alert overlay sourced from critical `alerts` / `trust_alerts`,
and a per-token audit of views (view_count exists; viewer identity does not).

## 6. Effort and phasing

| Work | Phase | Effort |
|---|---|---|
| EX1-EX4 fixes | 2 | S |
| Extend `kpi_targets` (scope, period, owner role, effective date) + admin screen | 3 | M |
| Register the remaining executive KPIs (PM compliance, availability, downtime, due tyres, budget variance) | 3 | M |
| Decision strip + exceptions row on Board Overview from the registry | 4 | L |
| Shared payload for dashboard, PDF/PPTX and TV `exec_summary` | 4 | M |
| Emergency alert overlay on share boards | 4 | M |

## 7. Decisions recorded

- Command Center is the home page; the old Dashboard is lazy-mounted behind "Detailed analytics" (2026-09-28).
- Report builders are Admin only.
- TPMS "live via telematics" may be promised on marketing; the app has no TPMS readings yet (`tpms_readings`
  empty, per project memory) so no TPMS KPI is shown.
- Maps are deferred until a maps API key is supplied (owner, 2026-10-05).

## Open decisions for the owner

1. Approve Board Overview as THE executive dashboard (other executive pages become specialised views).
2. Which 8 KPIs go on the decision strip, and their targets per country.
3. Who owns each KPI (role), so exceptions can be assigned.

## Next actions

| Action | Phase | Effort |
|---|---|---|
| Fix EX1-EX4 | 2 | S |
| Targets model and admin screen | 3 | M |
| Registry-driven decision strip, exceptions, shared export payload | 4 | L |
