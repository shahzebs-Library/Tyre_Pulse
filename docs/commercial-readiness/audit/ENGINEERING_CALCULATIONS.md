# Engineering accuracy and data integrity audit

Date: 2026-11-12. Scope: every shared tyre and maintenance KPI, where it is computed, whether SQL and JS agree,
how gaps are handled, and whether the calculations would be right for a different company.
Method: read the code on the current working tree, read the LIVE function bodies with `pg_get_functiondef`
(SELECT only), measured live data with SELECT aggregates, ran the JS engines against hand-worked cases in the
scratchpad (nothing added to the repo), and reconciled three live aggregates against independent SQL.
No write, no DDL, no deploy. Companion file: `calculation_test_cases.md` (36 cases, 26 pass, 9 fail, 1 not run).

## 1. Two verdicts

**Internal Production Readiness (current company): AT RISK, usable with care.**
The arithmetic is sound: all three live reconciliations matched to the cent, the km rule and the serial rule
agree between SQL and JS on every vector tested, double-active wheels are 0, a real serial active on two
assets is 0, reversed dates and reversed km are 0, and mixed currencies are refused everywhere tested.
The risks are definitional and data-coverage risks: two screens report a "cost per km" that differ by 12.6
times for the same country and year, the expected-life baseline is inflated by unverified odometers, downtime
figures rest on assumptions, and 57% of fitments have no price.

**Commercial SaaS Readiness (a new company from zero): class 3, needs functional repairs, with class 4
elements.** The calculation core is hard-wired to this customer's fleet vocabulary, countries, currencies,
ERP codes and business (ready-mix concrete). A fleet with water tankers, low loaders or cranes would be
measured in the wrong unit on day one, with no setting to correct it. Several KPIs (failure rate, MKBF,
supplier performance, tread wear, retread, warranty recovery) have no data path that a new customer could
fill from the standard imports.

Counts: P0 0, P1 5, P2 13, P3 2.

## 2. Live integrity snapshot (all organisations visible to the service role, 2026-11-12)

| Check | KSA | UAE | Egypt | Note |
|---|---|---|---|---|
| Fitment rows | 8,371 | 2,341 | 548 | 11,260 total; 4 KSA rows sit in a second organisation |
| Active / Removed / Scrapped | | | | 4,354 / 5,930 / 976; no blank status; `status = 'Active'` and `tyre_status_is_active` agree |
| Two active tyres on one wheel | 0 | 0 | 0 | rule T3 holds |
| Real serial active on two assets | 0 | 0 | 0 | rule T5 holds |
| Real serial active twice on the same asset | 9 | 5 | 3 | unclosed rotations |
| Removal before fitment, removal km below fitment km, future dates, negative km | 0 | 0 | 0 | |
| Removed or scrapped with no removal date | 451 | 4 | 0 | life in days not measurable |
| Fitment odometer = 1 (placeholder) | 566 | 93 | 31 | km unknown by rule |
| Fitment odometer = 0 (factory) | 139 | 0 | 0 | real by rule |
| Fitment odometer missing | 257 | 0 | 1 | |
| Recorded total_km above the class cap (row type) | 351 | 62 | 22 | nulled by `tyre_km_life`, still stored |
| No price on the row | 4,454 (53%) | 1,771 (76%) | 140 (26%) | 6,365 of 11,260 = 57% |
| Real serial priced on more than one row | 32 | 0 | 1 | docs/tyre says 1 remained; live is 33 |
| Weak serial (not a unique tyre) | 1,791 | 44 | 7 | |
| Vehicle type blank on the tyre row | 6,732 | 2,341 | 548 | 85%; fleet register is the fallback, 447 of 1,622 fleet rows are blank too |
| Supplier filled | 0 | 0 | 0 | |
| Risk level filled / tread depth filled | 0 / 0 | 0 / 0 | 0 / 0 | |
| Removal reason on removed rows | 3,778 of 5,806 | 12 of 971 | 0 of 129 | see ENG-10 |
| Fitted before 2025-01-01 | 14 | 0 | 74 | 88 rows; 170 undated |
| Evidence classes (view) | | | | VERIFIED 3,984, PARTIALLY_VERIFIED 5,648, CONFLICTING 736, PROVISIONAL 534, UNDATED 170, LEGACY 88, DUPLICATE 79, MISSING_EVIDENCE 21 |
| Expense lines | 118,205 | 60,020 | 40,551 | one currency per country, no null event date |
| Expense lines with `import_uid` | 117,662 | 8,474 | 2,100 | content hash (`reupload_hash`) is on 100% |
| Spend classified by the fallback rule | 32.6% | 38.1% | 50.5% | by value |
| Work orders with opened date before 1990 / completed before opened / longer than 365 days | 10,790 / 977 / 1,025 | 0 / 0 / 5 | 0 / 2 / 0 | 364 KSA opened in the future |
| Inspections | 2,569 | 0 | 0 | 61 with no country; 29,332 wheel entries, pressure on 27,936, tread on 0 |
| Empty tables | | | | tyre_service_events, warranty_claims, retread_jobs, tyre_rotations, suppliers, currency_rates all 0 rows |

## 3. KPI register: single source, mirrors, divergent copies, both statuses

Status columns: Internal = ready / at risk / broken. Commercial = class 1 to 6 from the brief.

| KPI | Authoritative implementation | Mirror, agreement | Other places that recompute it | Missing input handling | Actual vs estimated shown | Internal | Commercial |
|---|---|---|---|---|---|---|---|
| km of one fitment | SQL `tyre_km_life` + `tyre_life_km_cap`; JS `src/lib/tyreKm.js:43` | Agree on 11 vectors (C01 to C10) | `src/lib/tyreBay.js:89`, `src/lib/fleetRisk.js:105`, `src/lib/opsIntelligence.js:353`, `src/lib/expenseReportAnalytics.js:76`, `src/lib/predictiveMaintenance.js:605` and `:720`, `src/lib/assetHistory.js:684` and `:1425`, `src/lib/tyreScrapView.js:146`, `src/components/cpk/KmSourcePanel.jsx:423`, `mobile/app/(app)/records/index.tsx:444`, SQL `calc_cpk`, SQL `get_tyre_running_life` baseline | null, status label (`KM_STATUS_LABEL`) | yes on Tyre Records, Warranty, Scrap; not on the copies | ready | 3 (caps are customer constants, ENG-3) |
| Physical tyre lifetime (price once, km summed, overlap dropped) | SQL `v_tyre_lifetime`; JS `toLifetimeTyres` `src/lib/tyreLifetime.js:187` | Documented parity; C15, C16, C18 pass in JS; SQL view not re-run here | none found beyond the per-fitment copies above | null cost, null km, coverage flag | ACTUAL / ESTIMATED / CONFIRMED_ZERO / DISPUTED / MISSING, but only when the row carries `price_source` | ready | 2 |
| Per-fitment CPK | JS `fitmentCpk` `src/lib/tyreLifetime.js:101` | SQL `calc_cpk` DISAGREES (C29: 0.0098 for a placeholder) | `tyreBay.js:109` (labelled stint), `fleetRisk.js:118`, `opsIntelligence.js:353` (`tyreNetCpk`, no caller found), `tyreScrapView.js:146` | null | labelled per fitment on Tyre Bay | ready | 2 |
| Fleet aggregate tyre CPK (lifetime, weighted) | JS `weightedCpk` / `kpiEngine.computeCpkFleet` `src/lib/kpiEngine.js:164`; SQL `get_tyre_lifetime_cpk`, `get_brand_size_cpk` | C14, C17 pass | `expenseReportAnalytics.js:76-93` builds site and brand CPK from raw `total_km` and per-row price | null; null on mixed currency | estimated share reported | ready | 2 |
| "Fleet CPK" per km and per engine hour (CPK Intelligence) | SQL `get_fleet_cpk` over `fleet_tyre_km_by_asset` and `fleet_hours_by_asset`; JS `costIntelligence.assetCpk` | unit rule agrees SQL vs JS; reconciled exactly (test file section I) | `_cost_cpk` inside `get_cost_cpk_overview` computes a different cost per km on a different denominator (ENG-1) | null when denominator 0, coverage % shown | no | at risk | 3 |
| Cost per km on Expenses and CPK | SQL `_cost_cpk` (grid cost of measured assets / odometer span from `fleet_km_by_asset`) | none | see row above | null, `comparable` flag at 25% coverage | no | at risk | 3 |
| Running and remaining life, due list | SQL `get_tyre_running_life`; JS `measureFor` `src/lib/tyreRunningLife.js:225` | band thresholds agree (C21, live recount 358 = 358) | baseline inside the RPC does not use `tyre_km_life` (ENG-2) | unknown band, not due | basis label manual / measured_type / measured_size | at risk | 3 |
| Tyre and fleet spend totals | expense grid `parts_consumption` via `loadGovernedCostSplit` (`src/lib/governedCost.js`) | SQL trigger `classify_parts_consumption` vs JS `classificationBrain` (documented mirror) | fallbacks that sum `cost_per_tyre`: `src/lib/boardOverview.js:70`, `src/lib/displayBoard.js:90`, `src/lib/vehicleHistoryAnalytics.js:101`, `src/lib/ragService.js:371`, `src/lib/tyrePool.js:87`, `src/lib/anomalyEngine.js:413`, `src/lib/continuousImprovementAnalytics.js:154` | zero rows read 0 | "Cost basis" column on the expense export; estimated lines flagged (`filled_cost`, 1,068 lines) | ready | 3 (classifier is customer specific, ENG-3, ENG-5) |
| Cost by site | SQL `get_site_operating_cost` (through the asset) | none | grid `site` is the issuing store; `get_cost_per_m3` joins region by that store site | coverage published | n/a | ready | 2 (body not re-read in this pass) |
| Cost per m3 | SQL `get_cost_per_m3` | JS `costPerM3.js` guards thin denominators | none found | null when no approved m3 (October 2026 reads null, production data stops 2026-08-09) | approved vs supplied separated | ready | 6 for non concrete customers (ENG-19) |
| Average tyre life | `kpiEngine.computeAvgTyreLife` `:297` (lifetime layer) | n/a | `assetHistory.js:1425` (raw total_km mean), running-life baseline | null | no | ready | 2 |
| Failure rate | `kpiEngine.computeFailureRate` `:376` | n/a | vendor score uses its own `failureRate` that returns 0 (`:867`) | null, with rated count | "not measured" | ready (reads not measured) | 4 (no input path, ENG-10) |
| Scrap rate | `kpiEngine.computeScrapRate` `:659` | n/a | vendor `scrapRate` per fitment row | per docs | no | ready | 2 |
| Removal rate, replacement frequency | `kpiEngine.computeRemovalRate` `:351`, `computeReplacementRate` `:426` | n/a | none | removal rate null; replacement counts every fitment row including refits and duplicates | no | at risk | 3 |
| Pressure compliance | `kpiEngine.computePressureCompliance` `:510` | same judgement in the inspection PDF | none | null under 4 readings | basis text says consistency | at risk | 3 (ENG-9) |
| Inspection compliance | `kpiEngine.computeInspectionCompliance` `:565` | not audited in depth | | | | ready | 2 |
| MTTR | SQL `get_daily_job_cards` (`avg_repair_hours`, Workshop In to Workshop Out, per day); JS `downtimeTrackerAnalytics.workOrderHours` `:67` (opened to completed) | two different definitions | | null when nothing closed (SQL); JS has no plausibility cap | no | at risk | 3 (ENG-7) |
| MTBF | SQL `get_asset_disposal_reliability`, calendar days between dated breakdown job cards; JS `assetDisposalReliability.js` | n/a | Downtime Tracker "MTBE" is a different thing (gap between tyre fitment events, `downtimeTrackerAnalytics.js:155`) | null under 2 dated failures | n/a | at risk | 3 |
| MKBF / mean hours between failures | does not exist | | | | | not available | 4 |
| Downtime hours, availability, downtime cost | `downtimeTrackerAnalytics.downtimeKpis` `:140`; `kpiEngine.computeVehicleDowntimeImpact` `:737`; `computeFleetAvailability` `:764` | n/a | three unrelated definitions | assumed 2 to 4 hours per event when no job card; availability null with no vehicles | row flag actual / estimate, share shown | at risk | 3 (ENG-7) |
| Vendor / supplier performance | `kpiEngine.computeVendorPerformance` `:849` | n/a | supplier pages | unrated reads as perfect quality (C30b) | no | at risk | 3 (ENG-8) |
| Replacement linkage | SQL `_tyre_close_replaced`, `_tyre_close_serial_elsewhere`, `tyre_import_reconcile`, `tyre_replacement_log` (56 rows) | JS intake calls the RPC | none | held for review, not guessed | log + undo | ready | 2 |
| Duplicate prevention | SQL `import_uid` unique index, `expense_reupload_guard` (content hash), `trg_zz_one_price_per_tyre`, Duplicate Control | n/a | tyre import dedupe is a client-side key merge; `tyre_records` has no unique key | rejects logged | n/a | ready | 2 |

## 4. Findings

Format: ID, title, severity, confidence, evidence, what exists / should be / happens, impact on a second
company, fix, risk of the fix to the current company, acceptance test, area, both statuses.

### ENG-1 Two "cost per km" figures on two screens differ by 12.6 times, and neither is a period cost per vehicle km of tyres
- Severity P1. Confidence VERIFIED.
- Evidence: live `get_fleet_cpk('KSA', 2025-11-01, 2026-10-31)`: km side total_km 146,144,345, cpk_tyre 0.0168,
  cpk_total 0.0235 SAR. Live `_cost_cpk` (inside `get_cost_cpk_overview`) same country and dates: km 16,165,110,
  cpk 0.296 SAR. October 2026 alone: 0.0297 versus 1.03. Function bodies read from the live database.
  October detail: of 10,596,800 tyre-km in the window, 10,570,637 (99.8%) was accumulated by fitments that
  started before October and 7,079,069 before 2026.
- What exists: `fleet_tyre_km_by_asset` sums the whole measured life of every fitment whose removal date (or
  issue date) falls in the window. `get_fleet_cpk` divides the expense grid spend dated inside the window by
  that sum. So October's tyre purchases are divided by kilometres run over the previous one to three years by
  the tyres that happened to come off in October. `cpk_total` then adds spare parts and oil to the numerator
  while the denominator stays tyre-km (a 12-wheel mixer contributes roughly 12 times its vehicle distance), so
  "total cost per km" is understated by about the wheel count. It also sums per fitment row without the
  overlap rule (T18) or the physical-tyre layer.
  The Expenses and CPK page uses vehicle odometer distance instead (span of tyre fitment readings, 92 assets
  in October), which is a real vehicle-km but covers 38% of spend for the month.
- What should be: one named measurement per screen with its basis printed next to the number. A period tyre
  CPK should either be lifetime CPK of tyres retired in the period (price of those tyres over their own km),
  or period spend over period vehicle-km times wheels. Maintenance cost per km must use vehicle-km only.
- What happens: an owner comparing the two pages sees 0.02 and 0.30 for "cost per km" with no explanation.
- Impact on a second company: a prospect who checks the figure against their own books will find it is not
  a cost per km in any standard sense. High credibility risk in a demo.
- Fix: (a) relabel now: "Tyre spend in period / lifetime km of tyres removed in period" and hide `cpk_total`
  on the tyre-km basis; (b) add a new RPC for retired-tyre lifetime CPK (already available from
  `get_tyre_lifetime_cpk`) and make it the headline; (c) keep the old keys for one release.
- Risk to the current company: (a) none, labels only. (b) and (c) medium: the headline number on CPK
  Intelligence changes; publish a before and after table per country as was done for the November repoint.
- Acceptance test: for a fixed month, the headline equals sum(price of physical tyres removed in the month)
  / sum(their validated km) from `v_tyre_lifetime`, and the page text states the basis; the Expenses and CPK
  figure and this one are each labelled with different names.
- Area: DB, web.
- Internal: at risk. Commercial: class 3.

### ENG-2 Expected tyre life (running and remaining life) is built from unverified odometers, so the due list is short
- Severity P1. Confidence VERIFIED.
- Evidence: live body of `get_tyre_running_life`, CTE `removed`: `t.total_km between 1000 and 400000`, no call
  to `tyre_km_life`. Measured baseline mean, raw versus the T7 rule: KSA 42,631 vs 37,081 km (452 placeholder
  rows inside the baseline), UAE 42,147 vs 30,647, Egypt 68,532 vs 34,580 (maximum raw value 331,872 km).
  KSA due count today 358; with the T7 rule on the baseline 385. Same function: `km_run` requires
  `km_at_fitment > 1`, so 34 active KSA tyres fitted at factory zero have no km run although T7 treats zero as
  real. 405 of 2,547 active KSA tyres have no km run and 280 have no meter of either kind.
- What exists: the expected life of a size or type is the plain average of whatever total_km is stored on
  removed rows, including rows where total_km is the machine odometer.
- What should be: the same km rule as everywhere else, and the modern-baseline date.
- What happens: expected life is overstated (by 15% to 98% depending on country), remaining life is
  overstated, and tyres that are due are shown as mid-life. This is the unsafe direction. KSA is shielded
  because 2,348 of 2,547 active tyres use an owner-set manual target; UAE and Egypt and any new company
  rely on the measured baseline.
- Impact on a second company: a new tenant has no manual targets, so every expected life comes from this
  baseline. Their first placeholder odometers will inflate it.
- Fix: replace the baseline expression with `tyre_km_life(...)` using the fleet class fallback; accept factory
  zero in `km_run`; filter the baseline to the tenant's trusted-from date; use `tyre_status_is_active`.
  Mirror test: extend `tyreRunningLifeBands.test.js`.
- Risk to the current company: low to medium. KSA due list grows from 358 to about 385; UAE and Egypt
  expected lives drop sharply (their lists will grow). Ship with a dry-run comparison first.
- Acceptance test: for each country the baseline mean equals `avg(tyre_km_life(...))` over removed rows, and a
  tyre fitted at 0 km on an asset with a current odometer shows a km run.
- Area: DB, web test.
- Internal: at risk. Commercial: class 3.

### ENG-3 The calculation core is hard-wired to the current customer
- Severity P1. Confidence VERIFIED.
- Evidence and list of what must become per-tenant configuration:
  - Life caps by class: `src/lib/tyreKm.js:16-22` and SQL `tyre_life_km_cap` (mixer 80,000, pump 56,000,
    loader 15,000, else 100,000; matched by substring, so a "low loader" trailer is capped at 15,000 km).
  - CPK unit by keyword: SQL `cpk_unit_for_asset_type`, `src/lib/costIntelligence.js:23-24` (ENG-4).
  - Country list and currency map: `src/contexts/SettingsContext.jsx:21-22` plus 18 more files that declare
    their own `KSA: 'SAR', UAE: 'AED', Egypt: 'EGP'` map; `governedCost.js:50-57` with base currency SAR;
    three reconciliation panels with a literal `['KSA','UAE','Egypt']`. SQL uses a `country_currency` table,
    which is the right pattern.
  - ERP item code ranges: `src/lib/classificationBrain.js:82-99` (310xxx tyres, TI-GE Egypt tyres, OL- oils,
    150 to 153xxx filters, 400xxx pump parts and so on) and the SQL mirror `brain_classify`.
  - Brand list "seen in this fleet's own data": `classificationBrain.js:104-117`.
  - Job card prefixes AFKR / GCKR (KSA), RM (UAE), EG (Egypt): the expense country guard trigger and
    `src/lib/jobCard.js`, `src/lib/jobCardDate.js`, `src/lib/api/erpIntake.js`. A second company's job card
    numbers starting with RM would be rejected or moved to UAE.
  - UAE "BUILDINGS without WORKSHOP" upload rule (V603), `-ST` store suffix stripping in `normalize_site`,
    `site_aliases` rows, `store_site_map`: all global, not scoped per organisation in the rules themselves.
  - SANY and SCO cost sources, concrete m3 denominator, production station map, 43 SAR per hour delay penalty.
  - Trusted reporting date `2025-01-01`: `src/lib/tyreEvidenceAudit.js:9`, `v_tyre_fitment_evidence`.
  - Mobile asset class prefixes TM/MP/PL/WL/BH/SL/LP/MB: `mobile/lib/assetClasses.ts:16`.
  - Tyre position vocabulary (LHF1, RHCO, LHRI) and diagram layouts keyed to this fleet's type names.
  - Downtime rate 850 per hour, 8 hour shift, 95% availability target: `downtimeTrackerAnalytics.js:17-19`.
  - Due-soon thresholds 10,000 km / 500 h / 90%: `tyreRunningLife.js:155-157` and the SQL mirror.
  - Import default organisation stamp (`stamp_import_default_org`, single tenant mode).
- What should be: a per-organisation configuration table (asset class register with unit, cap, wheel count;
  country and currency list; ERP code map; job card prefix map; trusted-from date; thresholds) read by both the
  SQL functions and the JS mirrors, seeded for the current company with today's constants.
- Impact on a second company: wrong units, wrong caps, wrong country routing of expense lines, wrong
  classification of spend, with no way for the customer to correct any of it.
- Fix: introduce `org_engineering_config` and resolve each rule through it with the current constants as the
  default when no row exists.
- Risk to the current company: low if every lookup falls back to the present constant and the seed rows equal
  them; verify by hashing the main RPC outputs before and after.
- Acceptance test: a second organisation with class "WATER TANKER, unit km, cap 120,000" gets km-based CPK
  and the cap, while Company A outputs are byte identical.
- Area: DB, web, Flutter, console.
- Internal: ready. Commercial: class 3.

### ENG-4 The km or hours unit is chosen by keyword and misclassifies ordinary road vehicles
- Severity P1. Confidence VERIFIED.
- Evidence: test C20b. SQL `cpk_unit_for_asset_type` and JS `cpkUnitForAssetType` both return engine_hours
  for WATER TANKER, LOW LOADER TRAILER, CONCRETE MIXER TRUCK, CRANE TRUCK and ROLLER SHUTTER VAN.
- What happens: those assets' tyre cost is divided by engine hours (usually none recorded), so they show no
  CPK and drop out of the km fleet figure; their life targets are judged on the hours side.
- Current company: unaffected today because its type names (TR-MIXER, PUMPS, PICKUP) avoid the collisions.
- Fix: unit as an attribute of the asset class in configuration (ENG-3); keep the keyword rule only as the
  default suggestion at import.
- Risk to the current company: none if seeded from the present rule.
- Acceptance test: C20b passes for a tenant whose class register says km.
- Area: DB, web.
- Internal: ready. Commercial: class 3.

### ENG-5 Repair, retread, fitting and warranty lines are counted as tyre purchase spend in the expense grid
- Severity P2. Confidence VERIFIED.
- Evidence: test C24c (`classificationBrain.classifyLine`: "Repair TIRE 315/80R22.5", "RETREAD TYRE ...",
  "TYRE FITTING CHARGES" and the warranty line all return bucket tyre). Live tyre bucket: Egypt 33 repair
  lines worth EGP 148,339, KSA 18 lines worth SAR 7,200, KSA 2 warranty-worded lines, KSA 1 tube or flap line.
  The grid has only three buckets (tyre, spare, oil); `tyreCostAudit.lineKind` knows repair, service,
  warranty, tube, flap, valve but is used only by the price audit.
- What should be: tyre purchase, tyre repair, retread, fitting service, tube, flap and warranty as separate
  sub-categories under the tyre bucket, so tyre purchase spend and "full lifetime cost" can each be reported.
- Impact on a second company: a tyre contractor customer bills repair and fitting heavily; their "tyre spend"
  would mix purchase and service.
- Fix: add a `cost_subcategory` column filled by the classifier using the `lineKind` rule; keep `tyre_cost`
  unchanged; report purchase-only as a new figure.
- Risk to the current company: none while `tyre_cost` is untouched (additive column). Low if the headline is
  later switched to purchase-only (Egypt tyre total falls by about 0.9%).
- Acceptance test: C24c passes on the subcategory; totals by bucket unchanged.
- Area: DB, web.
- Internal: ready (small amounts). Commercial: class 3.

### ENG-6 The warranty detector misses the spelling the ERP actually uses
- Severity P2. Confidence VERIFIED.
- Evidence: test C23b. SQL `tyre_price_is_warranty('TIRE -WARRENTY -315/80 R 22.5')` returns false; JS
  `isTyreWarranty` (`src/lib/tyrePriceRules.js:25-30`) returns false. PROJECT_MEMORY records two live KSA lines
  with this spelling. The mirrors agree with each other and are both wrong.
- What happens: a warranty replacement can be priced from a comparable or its own job card instead of being
  CONFIRMED_ZERO, which overstates cost and CPK for that tyre.
- Fix: add warrenty, warranty misspellings and "free issue" to both lists in one change, with a test.
- Risk to the current company: low; affects at most the two known lines and future backfills.
- Acceptance test: C23b passes in SQL and JS.
- Area: DB, web.
- Internal: at risk (2 lines). Commercial: class 2.

### ENG-7 Downtime, availability and reliability figures rest mostly on assumptions and on corrupt job card dates
- Severity P1. Confidence VERIFIED.
- Evidence:
  - `src/lib/downtimeTrackerAnalytics.js:20` and `:90-94`: when an asset has no work order with both
    timestamps the event is given 4, 3, 2 or 2 hours by risk level, default 2. Risk level is filled on 0 of
    11,260 rows, so every estimated event is 2 hours (test C28b).
  - `:67-71` `workOrderHours` accepts any positive opened to completed span. KSA work orders: 10,790 opened
    before 1990 (two-digit year import), 977 completed before opened, 1,025 longer than 365 days, 364 opened
    in the future. One such card makes that asset's "actual" average downtime thousands of hours, and that
    average is then applied to every tyre event on the asset.
  - `src/pages/DowntimeTracker.jsx:187` selects `reason_for_removal`, which is filled on 0 rows (the populated
    column is `removal_reason`), so the cause breakdown can only read Unknown or Routine.
  - Downtime cost = hours x 850 (`:17`), a constant with no currency, applied to SAR, AED and EGP alike.
  - `kpiEngine.computeVehicleDowntimeImpact` (`src/lib/kpiEngine.js:737-744`): fitment rows x 2 hours (C30c).
  - Availability = (vehicle-days minus hours / 8) / vehicle-days, where vehicles are only those with a tyre
    event in the window.
  - MTTR exists as a per-day job card figure (`get_daily_job_cards`) and MTBF as calendar days between dated
    breakdown cards on the disposal screen. There is no fleet MTTR or MTBF trend, and no MKBF (distance or
    hours between failures) anywhere.
- What should be: downtime only from job cards with two plausible timestamps (bounded, after the date
  repair), "not measured" otherwise; one MTTR and one MTBF definition; MKBF from failures joined to meters.
- Impact on a second company: availability and downtime cost are headline claims for a PMV maintenance
  buyer; today they are estimates shown with a measured look.
- Fix: bound `workOrderHours` (for example 0 to 720 hours and dates after 2000), return null hours for events
  with no job card and show the estimated share as a separate, clearly named figure; read `removal_reason`;
  take the rate and currency from tenant settings.
- Risk to the current company: medium. Downtime totals and availability on the Downtime Tracker will change
  (fewer hours, more "not measured"). Announce and keep the estimate visible as a labelled secondary line.
- Acceptance test: C28b and C30c return null measured hours; a work order with opened year 0024 contributes
  nothing; cause breakdown shows the KSA reasons.
- Area: web, DB (date repair is an owner action: re-upload).
- Internal: at risk. Commercial: class 3 (MKBF class 4).

### ENG-8 Vendor performance score treats unknown quality as perfect and ranks by an unbounded, currency dependent term
- Severity P2. Confidence VERIFIED.
- Evidence: `src/lib/kpiEngine.js:867-878`; test C30b (brand with no rating and no km: failureRate 0,
  avgLife 0, score 0.3, rank 1). `cpkScore = 1 / avgCpk` is about 50 for 0.02 SAR/km and about 2.7 for
  0.37 EGP/km, so the 40% CPK term swamps the other two and is not comparable across countries. "Vendor" is the
  tyre brand; supplier is filled on 0 rows and the suppliers table is empty.
- Fix: null quality when unrated, normalise each term within the compared set, rank only within one currency,
  name the screen "brand performance" until supplier is captured.
- Risk to the current company: low to medium; ranking order on Vendor Intelligence may change.
- Acceptance test: C30b returns null failureRate and no rank for an unmeasured brand.
- Area: web.
- Internal: at risk. Commercial: class 3.

### ENG-9 Pressure compliance measures consistency, not compliance, and tread depth is never captured
- Severity P2. Confidence VERIFIED.
- Evidence: `src/lib/kpiEngine.js:459-461, 510`; test C31b (four tyres at 60 psi score 100%). No target
  pressure per size, axle or load exists in the schema. Steer and drive axles that are correctly set to
  different pressures can be flagged. Live: tread depth on 0 of 29,332 wheel entries, 0 of 11,260 tyre rows;
  pressure on 27,936 entries. Condition vocabulary in use: Good 26,217, Worn 1,853, Flat 544, Damaged 410,
  Puncture 223, Missing 85 (the stem matcher in `inspectionView.js` covers these). All inspections are KSA.
- Impact on a second company: "pressure compliance %" cannot be sold as a compliance KPI; wear rate, remaining
  tread and tread-based forecasts have no data.
- Fix: rename to "pressure consistency" now; add target pressure by asset class and axle to configuration and
  compute true compliance when a target exists; make tread depth a first-class capture field.
- Risk to the current company: none for the rename; low for the new measure (additive).
- Acceptance test: C31b reads non-compliant when a 120 psi target is configured.
- Area: web, Flutter, DB.
- Internal: at risk. Commercial: class 3 (tread analytics class 4).

### ENG-10 Removal reason data cannot support failure or root cause reporting
- Severity P2. Confidence VERIFIED.
- Evidence: reason present on 3,778 of 5,806 removed KSA rows, 12 of 971 UAE (every one is "RADIAL", a
  construction type, and matches a brand value), 0 of 129 Egypt. KSA has 31 free-text values with
  misspellings ("THREAD SEPRATION"), and the third most common "reason" (432 rows) is the system note
  "TWO CURRENT TYRES - MANUAL REVIEW" written by a reconciliation step. Risk level is empty, so failure rate
  reads "not measured" everywhere. `tyre_service_events`, `warranty_claims`, `retread_jobs` are empty.
- Fix: a controlled removal reason list per tenant with a mapping from imported text, a separate column for
  system notes, and reason required on removal in the app.
- Risk to the current company: low; the 432 system notes should be moved to a notes field with a backup.
- Acceptance test: the public tyre maintenance board top reasons contain no system text and no brand.
- Area: DB, web, Flutter.
- Internal: at risk. Commercial: class 3.

### ENG-11 Per-fitment km and CPK are still recomputed outside the single rule in 12 places
- Severity P2. Confidence VERIFIED.
- Evidence (current list, file:line): `src/lib/tyreBay.js:89-98` and `:109` (labelled stint, in the ratchet
  backlog); `src/lib/fleetRisk.js:105-112` and `:118-123` (prefers raw total_km); `src/lib/opsIntelligence.js:353-360`
  (`tyreNetCpk`, no caller found, dead); `src/lib/expenseReportAnalytics.js:76-93` (site and brand CPK from raw
  total_km and per-row price, not in the ratchet because the regex does not match it);
  `src/lib/predictiveMaintenance.js:605` and `:720` (raw total_km feeds the risk and wear forecast);
  `src/lib/assetHistory.js:684` and `:1425` (average tyre life from raw total_km);
  `src/lib/tyreScrapView.js:146`; `src/components/cpk/KmSourcePanel.jsx:423` (sums raw total_km as the "proof"
  of a T7 figure, so the two can disagree for a placeholder row); `mobile/app/(app)/records/index.tsx:444`
  (raw removal minus fitment); SQL `calc_cpk` (C29); SQL `get_tyre_running_life` baseline (ENG-2).
  The server reports `report_tyre_summary`, `report_asset_metrics`, `report_country_metrics`,
  `get_report_snapshot`, `get_mobile_analytics` are documented as still per fitment row
  (docs/tyre/CALCULATION_SOURCE_MAP.md) and were not re-read in this pass.
- Impact: the same tyre can show different km or CPK on different screens, most visibly for the 690
  placeholder rows.
- Fix: route each through `fitmentKm` / `fitmentCpk` or `tyre_km_life`; widen the ratchet regex to catch
  `Number(r.total_km)` divisions; delete `tyreNetCpk`.
- Risk to the current company: low to medium per screen (numbers move for placeholder and over-cap rows);
  do one screen per change with a before and after.
- Acceptance test: the golden reconciliation test asserts the same km for the placeholder tyre through each
  of these helpers.
- Area: web, mobile, DB.
- Internal: at risk. Commercial: class 3.

### ENG-12 The modern baseline (January 2025) is a display classification, not a KPI filter
- Severity P2. Confidence VERIFIED.
- Evidence: test C26. No engine filters on the trusted date; `v_tyre_fitment_evidence` classifies but
  `v_tyre_lifetime`, `get_fleet_cpk`, `get_tyre_running_life` and `kpiEngine` do not read it. KPI populations
  therefore include 736 CONFLICTING, 79 DUPLICATE and 170 UNDATED fitments. Live effect of legacy rows is
  small today (88 rows, 12 in the Egypt running-life baseline). The date itself is a constant
  (`src/lib/tyreEvidenceAudit.js:9`).
- Note: BUSINESS_RULES T20 says legacy fitments are kept and used for lifetime km and cost, which conflicts
  with the instruction that older rows must not distort KPIs. This needs one owner ruling.
- Fix: per-tenant trusted-from date; KPI functions take an "evidence scope" parameter defaulting to today's
  behaviour; headline tiles state the scope.
- Risk to the current company: none while the default is unchanged.
- Acceptance test: C26 returns 0.05 when the scope is "modern baseline".
- Area: DB, web.
- Internal: ready. Commercial: class 3.

### ENG-13 Price coverage is low and "one tyre one price" has 33 open exceptions
- Severity P2. Confidence VERIFIED.
- Evidence: 6,365 of 11,260 fitments unpriced (KSA 53%, UAE 76%, Egypt 26%). 33 real serials carry a price
  on more than one row (KSA 32, Egypt 1) while docs/tyre/BUSINESS_RULES.md says one remained. The JS layer
  takes the first price and marks DISPUTED, so no double count, but the live state has drifted from the
  documented one (the trigger only guards INSERT, not UPDATE or backfill).
- Impact: lifetime CPK is computed on under half the tyres; the coverage figure must travel with every CPK.
- Fix: list the 33 in the exceptions screen for a decision; extend the trigger to UPDATE of `cost_per_tyre`.
- Risk to the current company: low.
- Acceptance test: `get_tyre_exceptions` count for `serial_priced_twice` equals the SQL count.
- Area: DB, owner action.
- Internal: at risk. Commercial: class 2.

### ENG-14 A third to a half of all spend is classified by the fallback rule
- Severity P2. Confidence VERIFIED.
- Evidence: share of line cost with `classified_by = 'default'`: KSA 32.6%, UAE 38.1%, Egypt 50.5%.
- Impact on a second company: with different item codes and brands (ENG-3) the fallback share will be
  higher; spare versus oil versus tyre splits are then weak. The certainty panel already publishes this.
- Fix: per-tenant code map and an onboarding review step for the top items by value.
- Risk to the current company: none.
- Area: console, web. Internal: ready (disclosed). Commercial: class 2.

### ENG-15 Re-import protection for expenses is content based and works; tyre fitments have no database key
- Severity P2. Confidence VERIFIED for the facts, PLAUSIBLE for the risk.
- Evidence: `expense_reupload_guard` body (hash of org, country, date, issue number, job card, item, qty,
  value, store, cost centre; multiplicity aware; rejects logged). `import_uid` covers 99.5% of KSA lines but
  14% of UAE and 5% of Egypt, so those countries rely on the hash only. The hash omits asset code and
  description, so two genuine lines that differ only in asset would be treated as a repeat across uploads
  (not within one upload). `tyre_records` has no unique key; duplicate fitments are prevented by the client
  merge in `erpIntake.js` and by `tyre_import_reconcile`, and 79 fitments are classed DUPLICATE today.
- Fix: add asset code to the hash for new rows (new hash version column); add a partial unique index on the
  fitment key for real serials after the 79 are resolved.
- Risk to the current company: low for the hash version (additive); medium for the unique index (must clear
  existing duplicates first).
- Area: DB. Internal: ready. Commercial: class 2.

### ENG-16 Expense dates are parsed with a bare cast in the classifier trigger
- Severity P2. Confidence PLAUSIBLE (code verified, failure not reproduced because that needs a write).
- Evidence: live `classify_parts_consumption`: `NEW.event_date := nullif(btrim(NEW.txn_date), '')::date`
  with an exception handler that sets null. The project's own rule (PROJECT_MEMORY V388) is never to hand a
  day-first string to a bare cast under DateStyle MDY. Current data has 0 null event dates, so this
  customer's files arrive in a safe format.
- Impact on a second company: a file with 07/09/2026 would be read as 9 July, or dropped from every dated
  KPI when the day is above 12, silently.
- Fix: use `erp_parse_date` (day-first aware) in the trigger; count and surface null event dates per upload.
- Risk to the current company: low; verify that every stored `txn_date` parses to the same date first.
- Area: DB. Internal: ready. Commercial: class 3.

### ENG-17 Actual, estimated and unavailable are distinguished in the lifetime layer but not consistently in exports
- Severity P2. Confidence PLAUSIBLE (not every export was opened).
- Evidence: `toLifetimeTyres` sets `_cost_status` only when the row carries `price_source`; the expense
  export has a "Cost basis" column; `fmtCpk` prints N/A for null. The scheduled dataset reports
  (`src/lib/api/scheduledReports.js:79-84`) export raw `total_km` and `cost_per_tyre` columns with no status,
  so a placeholder odometer total prints as a life. `tyre_price_backfill_log` holds 1,988 comparable and 1,001
  own job card rows; 0 currently priced rows are comparable estimates (the estimates were reverted).
- Fix: add km status and cost status columns to tyre exports and scheduled reports.
- Risk to the current company: none (extra columns).
- Area: web, edge fn. Internal: at risk. Commercial: class 3.

### ENG-18 Replacement frequency and removal rate count rows, not events
- Severity P2. Confidence VERIFIED by reading (`src/lib/kpiEngine.js:351, 426`; documented as LISTED in
  docs/tyre/KPI_DEFINITIONS.md). Refits, rotations and duplicate entries count as replacements.
- Fix: use consumption v2 physical tyres. Risk to the current company: low to medium (figure falls).
- Area: web. Internal: at risk. Commercial: class 3.

### ENG-19 Cost per m3 and the SANY / SCO sources are specific to ready-mix concrete
- Severity P3. Confidence VERIFIED (live body). October 2026 reads null honestly because production data
  stops on 2026-08-09; internal cost reconciles exactly.
- Fix: present "cost per output unit" only when the tenant has enabled an output unit; hide SANY and SCO
  ledgers for other tenants (module control already exists).
- Risk to the current company: none.
- Area: console, web. Internal: ready. Commercial: class 6 for non concrete customers, class 2 for ready-mix.

### ENG-20 Small mirror gaps in the fleet CPK and replacement path
- Severity P3. Confidence VERIFIED by reading.
- `fleet_tyre_km_by_asset` joins the fleet register on raw `asset_no` (not upper/trim) for the class
  fallback; `_tyre_close_replaced` computes the closing total with the row's own vehicle type only, so the
  class cap falls back to 100,000 for the 85% of rows with a blank type.
- Fix: use the same class resolution in both. Risk to the current company: low.
- Area: DB. Internal: ready. Commercial: class 2.

## 5. Figures that must not be marketed as measured

1. Total cost per km on CPK Intelligence (`cpk_total`) and any monthly "fleet CPK" from `get_fleet_cpk`
   (ENG-1). Use "tyre spend over lifetime km of tyres retired" wording or do not quote.
2. Expected tyre life and remaining life where the basis is "measured" rather than a manual target (ENG-2).
3. Downtime hours, downtime cost, fleet availability and "vehicle downtime impact" (ENG-7). Mostly assumed.
4. MTTR as a fleet KPI, MTBF in anything other than calendar days per asset, and MKBF (does not exist).
5. Failure rate, fleet availability from tyre risk, risk matrices: risk level is filled on 0 rows.
6. Pressure compliance as compliance with a specification (ENG-9). It is consistency within a vehicle.
7. Tread depth, wear rate, tread-based forecasts: no tread data exists.
8. Supplier or vendor performance and its ranking: supplier is empty; the score is a brand heuristic (ENG-8).
9. Retread performance, warranty recovery, repair cost per tyre, "full lifetime CPK": source tables are empty.
10. Root cause analysis of removals outside KSA; KSA reasons are free text with system notes mixed in.
11. Any CPK without its coverage: 57% of fitments have no price and 690 have a placeholder fitment odometer.
12. Any figure summed across countries: no FX rate is approved (`currency_rates` is empty); the system
    correctly refuses, and marketing must not combine them either.
13. Tyre replacement frequency (counts rows, ENG-18).
14. Spare versus oil split as audited fact: 33% to 50% of spend is fallback classified (ENG-14).

## 6. What was verified and what was not

VERIFIED: live bodies of `tyre_km_life`, `tyre_life_km_cap`, `tyre_serial_is_strong`, `tyre_status_is_active`,
`cpk_unit_for_asset_type`, `calc_cpk`, `fleet_tyre_km_by_asset`, `fleet_hours_by_asset`, `get_fleet_cpk`,
`_cost_cpk`, `get_tyre_running_life`, `get_cost_per_m3`, `classify_parts_consumption`,
`expense_reupload_guard`, `tyre_one_price_per_tyre`, `_tyre_close_replaced`, `tyre_price_is_repair`,
`tyre_price_is_warranty`; JS `tyreKm`, `tyreLifetime`, `tyreRunningLife` bands, `kpiEngine` (CPK, life,
failure, pressure, downtime, availability, vendor), `downtimeTrackerAnalytics`, `costIntelligence`,
`tyrePriceRules`, `tyreCostAudit.lineKind`, `classificationBrain.classifyLine`, `governedCost` money rules.

NOT VERIFIED (not re-read in this pass, relied on docs/tyre): bodies of `v_tyre_lifetime`,
`get_tyre_lifetime_cpk`, `get_brand_size_cpk`, `get_cpk_drivers`, `get_site_operating_cost`,
`get_cost_cpk_overview` beyond `_cost_cpk`, `tyre_import_reconcile`, `tyre_cost_audit_classify`,
`get_asset_disposal_reliability`, `get_daily_job_cards`, `brain_classify` SQL mirror, the report snapshot
functions, Flutter and Expo calculation code other than one line, PDF and PPTX exports. The replacement
functions were not executed (they write). UI rendering was not observed in a browser. The super admin
impersonation probe returned `is_super_admin() = false` for a JWT without the MFA level, so reconciliations
were run as a KSA Manager; `get_tyre_running_life` was called with service-role visibility (2,565 active rows
including 18 outside Company A) and recounted for Company A only (2,547 active, 358 due).
