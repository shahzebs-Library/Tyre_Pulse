# Tyre Pulse - KPI definitions and audit (Phase 4a, 2026-11-09)

Branch `claude/tyre-phase4-kpi-consumption`. Every KPI below names its formula, unit, source,
exclusions, the data it needs, where it is shown and whether it uses the canonical layer
(`src/lib/tyreLifetime.js` / `v_tyre_lifetime*`, Phase 1). Live numbers are from 2026-11-09.
Rule references (T1-T19) are in `BUSINESS_RULES.md`; the per-helper map is `CALCULATION_SOURCE_MAP.md`.

Status key: **OK** = correct as built. **FIXED** = demonstrably wrong, fixed in this branch (local + tested).
**LISTED** = wrong or incomplete, not fixed here (reason given). **GAP** = not implemented anywhere.

## Data facts that decide what can be measured (live, all 3 countries)
- `tyre_records` 11,410 rows. `risk_level` filled on **0**, `category` 'Scrap'/'Retread' on **0**,
  `supplier` on **0**, `vehicle_type` on the tyre row on only 1,605 (86% blank; the fleet register fills it).
- `status`: Active 4,403 / Removed 6,172 / **Scrapped 835** (760 physical tyres, all KSA).
- `retread_jobs`, `retread_claims`, `warranty_claims`, `tyre_service_events`, `tyre_rotations`: **all empty**.
- 4 KSA tyre rows sit in a second organisation (`a50e2d87...`); a super admin's RLS sees them.

## Reliability

| KPI | Formula / unit | Source | Exclusions / data needed | Shown | Status |
|---|---|---|---|---|---|
| MTBF (asset) | (last dated failure - first dated failure) / (dated failures - 1), **calendar days**; null with < 2 dated failures | `get_asset_disposal_reliability` | failures = emergency/breakdown job cards with a usable business date (~half the cards) | Asset Disposal reliability, deck, workbook | OK (time based, honest null) |
| MTBE (downtime) | mean calendar-hour gap between a vehicle's tyre events | `downtimeTrackerAnalytics.downtimeKpis` | events with asset + issue_date | Downtime Tracker | OK as labelled ("between events", not failures) |
| MTTR (workshop) | mean Workshop In -> Workshop Out hours of closed job cards (`avg_repair_hours`); waiting = Production Out -> Workshop In | `get_daily_job_cards` | open cards excluded; never 0 when nothing closed | Dashboard daily job cards | OK. Platform/trust MTTR (`platformIncidents.mttr`, `trustAlertOps`) are incident KPIs, not fleet |
| SMRBF / MKBF | distance (km assets) or operating hours (hour assets) between failures | none | needs failures joined to meter readings per asset, unit from `cpk_unit_for_asset_type` | nowhere | **GAP**. No implementation exists to fix. Building it is a new KPI (owner decision) |

## Cost per unit

| KPI | Formula / unit | Source | Notes | Status |
|---|---|---|---|---|
| Per-fitment tyre CPK | cost_per_tyre / (km_at_removal - km_at_fitment) per row | `calc_cpk`, legacy helpers | T19 measurement 1 | LISTED: ~40 helpers and the server RPCs still per row (CALCULATION_SOURCE_MAP.md) |
| Physical tyre lifetime CPK | purchase once (T1) / validated km of non-overlapping fitments (T7, T18); FINAL vs PROVISIONAL | `v_tyre_lifetime`, `get_tyre_lifetime_cpk`, JS `toLifetimeTyres` | **canonical** | OK. Note: always km; a PUMPS / loader tyre is measured per km here while `get_fleet_cpk` costs those assets per engine hour (different measurement, T19) |
| Fleet aggregate tyre CPK | sum(cost) / sum(km) of measurable tyres (weighted) | `kpiEngine.computeCpkFleet` (lifetime layer) | | OK |
| Fleet expense per vehicle-km / per engine hour (CPK / CPH) | grid tyre (+ maintenance) cost / km or engine hours by asset unit | `get_fleet_cpk`, `get_cpk_hours_source`, `get_cpk_unit_audit` | unit = `cpk_unit_for_asset_type` (pump, loader, generator... = engine_hours; else km). JS mirror `costIntelligence.cpkUnitForAssetType` agrees | OK on unit. LISTED: km side has no T7 rule (placeholder fitment 1, no class cap) - Phase 1 report, KSA 455.7M km vs 98.9M validated |
| Cost per m3 | (internal + SCO + SANY) / approved m3 | `get_cost_per_m3` | approved quantity only (V523) | OK |
| Tyre expense per vehicle | grid tyre cost by asset (T9) | `get_tyre_cost_by_asset` / `loadGridTyreByAsset` | never sum `cost_per_tyre` | OK. LISTED: `boardOverview.buildBoardKpis.tyreSpend` still sums `cost_per_tyre` (T9 breach; Board Overview "tyre spend") |

## Tyre life, failure, scrap, retread, warranty

| KPI | Formula / unit | Source | Status |
|---|---|---|---|
| Average tyre life | mean lifetime km of tyres with known km | `computeAvgTyreLife`, `computeFleetTyreLife` (lifetime layer) | OK; callers guard `validCount` because `_mean([])` is 0 (LISTED: engine still returns 0 not null for an empty set) |
| Failure rate | High+Critical / rated tyres; null when unrated | `computeFailureRate` | OK (reads **not measured** today: 0 rated) |
| **Scrap rate** | scrapped physical tyres / physical tyres; scrapped = status Scrapped OR category Scrap OR Critical premature removal | `computeScrapRate` | **FIXED.** Read `category` only, so it showed **0%** while 760 KSA tyres are scrapped (status is what `scrap_tyre_by_serial` and bulk scrap write). Now counts each physical tyre once (the scrap action stamps every row of the serial). KSA all-time 0% -> **9.7% (760 of 7,817)**. Shown on Engineering KPI, KPI Command Center, Executive Report (also feeds scrap recommendations), vendor scores |
| Retread rate / performance | retread vs new lifetime CPK | `computeRetreadPerformance` | LISTED: keyed on `category` 'Retread' (0 rows) and `retread_jobs` is empty, so it returns null ("Need retread records"). Honest; becomes real when retreads are recorded |
| Warranty recovery | credit issued on warranty claims (Credit Issued / Closed) per tyre | `v_tyre_lifetime.recovery`, Warranty Tracker | OK by rule (T14); `warranty_claims` empty so 0 recovered |
| Tyre removal rate | removals / 1,000 km of the same population | `computeRemovalRate` | **FIXED:** no measured distance returned **0 per 1,000 km** (a perfect fleet); now null. LISTED: km is raw removal - fitment, no T7 rule |
| Tyre replacement frequency | mean fitments per vehicle-month **among months with a fitment** | `computeReplacementRate` | LISTED: counts every fitment row (refits, rotations, transfers, duplicate entries) as a replacement and averages only active months, so it overstates. Use consumption v2 physical tyres per vehicle instead |
| **Fleet availability (tyre)** | (fleet - vehicles with a Critical tyre in 30 days) / fleet | `computeFleetAvailability` | **FIXED:** with 0 risk ratings it read **100%** to every caller (the AI analyst printed it). Now null + `measured:false`; Engineering KPI and Executive Report already guarded |
| Vehicle downtime impact | replacement rows x 2 h (assumed) | `computeVehicleDowntimeImpact` | LISTED: an industry assumption x every fitment row (incl. refits/duplicates). Labelled "estimated" on screen; real downtime is Downtime Tracker / job cards |
| Downtime / availability (asset) | vehicle-days minus downtime hours / 10 h shift | `downtimeTrackerAnalytics` | OK (actual downtime where a job card exists, estimate otherwise, share shown) |

## Usage and consumption

| KPI | Formula | Source | Status |
|---|---|---|---|
| Tyre consumption (v1) | fitment rows by issue_date; kind new / refit_same / transferred / unidentified | `get_tyre_consumption` (unchanged) | OK, kept as is |
| **Consumption v2** | installations vs **physical tyres**, QTD / YTD / same period last year, events, breakdowns | `get_tyre_consumption_v2` (20261110110000) + `src/lib/tyreConsumptionPeriods.js` | **NEW** - see below |
| Tyre usage by asset / class | v1 `by_class`, v2 `vehicle_type` breakdown | as above | OK |
| Stock consumption | stock movements (issue/receipt) | `post_stock_movement`, Stock pages | OK (counts; no money) |

## Supplier and brand

| KPI | Source | Status |
|---|---|---|
| Brand CPK / life | `computeCpkByBrand`, `computeAvgTyreLife.byBrand`, `get_brand_size_cpk` | JS OK (lifetime). LISTED: `get_brand_size_cpk` per fitment row, no T7 |
| Supplier / vendor performance | `computeVendorPerformance` | LISTED: "vendor" is the BRAND (supplier is empty on every tyre). Its failureRate counts 0 when nothing is rated, so the composite score treats an unrated brand as perfect quality (30% of the score). Not changed: the score drives the ranking on Vendor Intelligence and needs an owner decision on what replaces the quality term |
| Supplier breakdown of consumption | v2 `supplier` | shows "Not recorded" honestly until `tyre_records.supplier` is captured |

## Consumption v2 definitions (migration 20261110110000)
- Physical tyre = Phase 1 `tyre_key` (country + serial for a real serial, T6; otherwise the row).
- Business dates only: fitment = `coalesce(issue_date, fitment_date)`, removal = `removal_date`,
  retread = `retread_jobs.returned_at` / `tyre_service_events.event_date`,
  warranty = `warranty_claims.removal_date` / fitment priced 0 by warranty backfill. Never `created_at`.
- Each real-serial fitment vs the previous fitment of the same tyre: `new`, `duplicate_entry`
  (same vehicle, wheel and date - the same fitment entered twice), `rotation` (same vehicle, other wheel),
  `reinstalled` (same wheel, later), `transferred` (other vehicle). Unreadable serials: `unidentified`; a second
  identical one (vehicle, wheel, date, serial text) is a `duplicate_entry`.
- Installations = every fitment except duplicate entries, quantity honoured.
  Physical tyres consumed = `new` (one per tyre) + unreadable rows de-duplicated (largest quantity).
- Periods anchored on the period end: QTD from the quarter start, YTD from 1 January, last year = both ends
  minus one calendar year (29 Feb -> 28 Feb). JS mirror: `periodWindows`, `shiftYear`.
- Scoped to the caller's organisation (like v1); a country the caller cannot see is refused.

### Proof a repeated import cannot create consumption (live, KSA, read-only simulation)
The whole KSA tyre history (8,346 rows) was fed through the v2 classification twice in a CTE (no write):

| | Rows | Physical tyres (new) | Physical (unreadable) | Installations |
|---|---|---|---|---|
| Loaded once | 8,346 | 6,027 | 1,773 | 8,279 (67 duplicate entries already in the data) |
| Loaded twice | 16,692 | **6,027** | **1,773** | **8,279** (8,413 duplicate entries ignored) |

Before the unreadable-serial duplicate rule was added, installations rose to 10,086 on the second load; that rule
is in the migration. Already in live data: 50 KSA duplicate entries in Aug-Oct 2025 alone, 63 in Jan-Oct 2025;
v1 counts each as a fitment.

### Live figures (super admin, Company A)
| KSA | Installations | Physical tyres | Last year installations | Last year physical |
|---|---|---|---|---|
| Selected 1 Aug - 31 Oct 2026 | 245 (= v1 245) | 208 | 4,373 | 4,145 |
| QTD 1 - 31 Oct 2026 | 22 | 13 | 1,639 | 1,527 |
| YTD 1 Jan - 31 Oct 2026 | 2,295 | 2,117 | 4,930 | 4,688 |

UAE YTD 1,336 installations / 1,213 physical (last year 586 / 559); Egypt YTD 275 / 253 (165 / 164).
Aug-Oct 2026 has no UAE or Egypt fitments yet (their files stop earlier), so those windows read 0 honestly.
The v2 selected window matches v1 exactly (245 fitments: 200 new + 7 same-vehicle + 30 transferred + 8
unreadable); v2 splits the 7 into rotations.
KSA removals in 2026 (4,893 events) far exceed fitments because the 2026-11-09 reconciliation closed
earlier fitments with their real removal dates; they are real removal events, not new consumption.

Performance: 0.8 - 1.3 s per call (the fleet register is hash-joined; `enable_nestloop = off` on the function
because the org/country filter sits above the view's window and the planner otherwise loops 8,346 x 1,031).
