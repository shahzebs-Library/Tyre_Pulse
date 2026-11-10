# 11 - Fleet, Tyre and Maintenance Logic Audit

| Field | Value |
|---|---|
| Deliverable | 11 of 29 (spec section 8, "Fleet, Tyre and Maintenance Logic Alignment") |
| Date | 2026-11-10 |
| Status | Partly built. Canonical engines exist for every core rule listed below and most are mirrored in SQL with a pinning test. Lifetime CPK is end to end in the web layer but NOT in the server RPCs; several duplicated or inconsistent definitions remain (section 4). |
| Evidence | Verified in code: every file path and constant quoted in this document was read on 2026-11-10. Verified live (read-only SQL, 2026-11-10): expense line counts, default-classified lines. Taken from PROJECT_MEMORY: measured row counts and before/after figures, marked "(per project memory)". |
| Related docs | `docs/tyre/BUSINESS_RULES.md` (rule register T1-T20), `docs/tyre/CALCULATION_SOURCE_MAP.md`, `docs/tyre/KPI_DEFINITIONS.md`, `docs/tyre/PHASE1_LIFETIME_CPK.md`, `docs/tyre/FINANCIAL_SOURCE_OF_TRUTH.md`, `docs/tyre/LIFECYCLE_EVENTS.md`, `docs/tyre/SITE_ATTRIBUTION.md` |

This document does not restate `docs/tyre/BUSINESS_RULES.md`; it audits where each rule lives, whether the
JS and SQL agree, and where the platform still computes the same thing two ways.

## 1. Rule inventory (where each rule lives today)

| # | Rule | Canonical JS | SQL mirror / owner | Pin test | Status |
|---|---|---|---|---|---|
| R1 | Tyre km of one fitment (T7): fitment odometer "1" is a placeholder, 0 is factory and real, life above the class cap is unknown | `src/lib/tyreKm.js` (`tyreKmAssessment`, `tyreLifeCapKm`) | `tyre_km_life(fit,rem,total,vehicle_type)`, `tyre_life_km_cap` (migration 20261104110000) | tyreKm tests | Built, mirrored |
| R2 | Class life caps: mixer 80,000 km, pump 56,000, loader 15,000, other 100,000 | `tyreLifeCapKm` in `src/lib/tyreKm.js` | `tyre_life_km_cap` | yes | Built. Owner confirmed caps 2026-11-04 |
| R3 | Real serial (T6): >= 6 chars, contains a digit, not a size, month code, Excel notation, placeholder or sequence | `isStrongSerial` in `src/lib/tyreLifetime.js` | `tyre_serial_is_strong` | `tyreLifecycleHardening.test.js` | Built, mirrored. A second, older checker `src/lib/tyreSerialCheck.js` still exists (gap G6) |
| R4 | One tyre, one price (T1) | `toLifetimeTyres`, `withOnePricePerTyre` (`src/lib/tyreLifetime.js`) | trigger `trg_zz_one_price_per_tyre` (INSERT only); `v_tyre_lifetime` | yes | Built |
| R5 | Latest uploaded row keeps the price when a serial is priced twice (T2) | none | data fix only (`_bak.ksa_two_price_latest_wins_20261109`) | no | Data rule only; conflicts with R4 "earliest priced" in principle (gap G3) |
| R6 | One wheel, one active tyre (T3) and same-day stale guard (T4) | `insertTyreRecords` holds rows (`src/lib/api/erpIntake.js`) | `_tyre_close_replaced`, `guard_tyre_active_fitment`, `tyre_import_reconcile` (20261109090000, 100000, 150000) | yes | Built. Note: `guard_tyre_active_fitment` skips when `auth.uid()` is null, so staging loads rely on `_tyre_close_replaced` alone |
| R7 | One tyre, one vehicle (T5) | n/a | `_tyre_close_serial_elsewhere` | rolled-back live test | Built |
| R8 | Overlapping fitments add no km (T18) | `toLifetimeTyres()._overlapping_fitments` | `v_tyre_lifetime_fitments.is_overlap` | parity test (Egypt 12/12) | Built |
| R9 | Five CPK kinds, never relabelled (T19) | `CPK_KIND`, `CPK_KIND_LABEL` in `tyreLifetime.js` | n/a | yes | Built in web; server RPCs still per fitment row (gap G1) |
| R10 | Fleet CPK is WEIGHTED (total cost / total km) | `weightedCpk` via `kpiEngine.computeCpkFleet` (`src/lib/kpiEngine.js`) | inside `get_tyre_lifetime_cpk` (20261109160000) | yes | Built. Old mean-of-ratios kept as `meanOfRatios` for comparison only |
| R11 | Tyre and fleet cost TOTALS come from the expense grid (T9) | `loadCostSplit`, `loadGovernedCostSplit`, `loadGridTyreByAsset` (`src/lib/api/costSummary.js`) | `get_parts_expense_snapshot`, `get_tyre_cost_by_asset` (V347) | yes | Built. One known violation remains (gap G4) |
| R12 | Currency never blended (T10) | `src/lib/governedCost.js` (`money`, `addMoney` throws on mismatch, `CountryCostSet` has no scalar total) | per-country RPC payloads; `fx_coverage` (V380, inert until rates approved) | yes | Built |
| R13 | Cost bucket = the ITEM decides (tyre / spare / oil), amount = `Values` | `src/lib/classificationBrain.js` (`classifyLine`, `CODE_RANGES`, `TYRE_BRANDS`, `ACCESSORY_TOKENS`, `NON_TYRE_PART_TOKENS`, `LUBRICANT_TOKENS`, `OIL_PART_TOKENS`) | `classify_parts_consumption` trigger; `brain_*` functions; `brain_rules_version()` | `classificationBrain.test.js` (real wrong rows) | Built, mirrored |
| R14 | Expense duplicate = exact content; re-import idempotent on `import_uid` (T11) | n/a | `parts_import_uid`, unique index on `import_uid` (V363, V365) | rolled-back test | Built for KSA; see gap G9 |
| R15 | Running and remaining life: each budget judged on its own, the worse verdict wins | `measureFor`, `bandFor` in `src/lib/tyreRunningLife.js` | `get_tyre_running_life` `is_due` (V541) | `tyreRunningLifeBands.test.js` | Built; thresholds drift (gap G2) |
| R16 | PM schedule: time axis and meter axis, worst of the two | `src/lib/pmSchedule.js` (`addTimeInterval`, `meterDueStatus`, `pmAssetDueStatus`, `advanceSchedule`) | `record_pm_service` RPC (V253) | pmSchedule tests | Built |
| R17 | Work order status vocabulary (11 canonical) | `src/lib/workOrderStatus.js` (`WO_STATUSES`, `normalizeWoStatus`, `KANBAN_COLUMNS`) | `wo_status_canonical()` (V586); widened CHECK (V497) | `workOrdersPaging.test.js` (19 live cases) | Built, mirrored |
| R18 | Job card availability flow (waiting / workshop / release gaps) | `src/lib/jobCard.js` (`JOB_CARD_STAGES`, `jobCardDurations`, `waitingSplit`, `stageChronologyIssues`) | V381 columns + V605 promotion | jobCard tests | Built |
| R19 | Cost per m3 = (internal ERP + SCO + SANY) / APPROVED m3, by region | `src/lib/costPerM3.js` (`costPerM3Reliable`, `MIN_M3_FOR_RATE = 1000`) | `get_cost_per_m3` (V450b, V523 approved only), `get_cost_per_m3_trend` (V451) | `costPerM3Guard.test.js` | Built |
| R20 | Unit-aware cost per km / hour / m3 by asset type | `src/lib/costIntelligence.js` (`cpkUnitForAssetType`) | `cpk_unit_for_asset_type` | yes | Built, mirrored |
| R21 | Trusted reporting period from 2025-01-01, evidence classes (T20) | `src/lib/tyreEvidenceAudit.js` | `v_tyre_fitment_evidence`, `get_tyre_evidence_audit` (20261111090000) | yes | Built, read-only |

## 2. CPK: what exists and what still disagrees

| CPK kind (T19) | Where computed | Basis |
|---|---|---|
| Per-fitment tyre CPK | `recordCpk` (tyreLifetime.js) | one stint, price from `withOnePricePerTyre` |
| Physical tyre lifetime CPK | SQL `get_tyre_lifetime_cpk`; JS `lifetimeCpk`, `fullLifetimeCpk` | km summed across non-overlapping fitments, price once |
| Fleet aggregate tyre CPK | JS `weightedCpk`, `lifetimeSummary`; SQL inside `get_tyre_lifetime_cpk` | total purchase cost / total measurable km |
| Fleet expense per vehicle-km | SQL `get_fleet_cpk` (V445, km side repointed by V453 to `fleet_tyre_km_by_asset`) | expense grid / sum of tyre total_km |
| Cost per engine hour | `get_fleet_cpk` hours side, `fleet_hours_by_asset` | expense / hour-meter span |

Findings:
- The server RPCs `get_fleet_cpk`, `get_cpk_drivers`, `get_brand_size_cpk`, `get_tyre_running_life`,
  `report_tyre_summary`, `report_asset_metrics`, `report_country_metrics`, `get_report_snapshot(_authed)` and
  `get_mobile_analytics` are still PER FITMENT ROW (per `docs/tyre/CALCULATION_SOURCE_MAP.md`). They were left
  unchanged on purpose until the new figures are verified. So the public share board, the Flutter management
  screen and the mobile analytics screen show a different tyre CPK basis from CPK Intelligence.
- V453 changed the fleet CPK km side from odometer span to SUM of tyre `total_km` (cost per tyre-km), per owner
  decision. The odometer-span function `fleet_km_by_asset` (V374) is still used by `get_cost_cpk_overview`.
  Two km bases for "cost per km" therefore coexist; screens label the basis but a reader can still compare them.
- Estimated prices: verified purchase-only CPK KSA 0.0291 SAR/km against reported 0.0254 (per project memory,
  2026-11-09). Estimated (comparable-price backfill) prices pull CPK down by about 15%. T17 requires the
  estimated share to be shown beside any CPK that uses it.
- Km denominators: `odometer_logs` and `engine_hours_logs` were empty for most of the platform's life; telematics
  loads (V406-V408) and the KSA TM meter files (2026-08-09) filled part of it. 362 KSA assets carried odometer km
  but no tyre km (per project memory, V470); CPK is not yet computed on the odometer basis for them.

## 3. Maintenance, work order and job card logic

- PM: `src/lib/pmPrograms.js` owns `DUE_SOON_DAYS = 14`; `src/lib/pmSchedule.js` owns
  `METER_DUE_SOON = { odometer: 500, engine_hours: 25 }` and `advanceSchedule`, which mirrors the
  `record_pm_service` RPC so the modal preview equals the server result. Engine hours are read from
  `engine_hours_logs` in bulk; there is no `current_hours` column (decided against).
- Work orders: the database still stores legacy tokens (Closed / Completed / Open / In Progress / Cancelled;
  measured 89,913 rows, per project memory V586). `normalizeWoStatus` folds them on read and
  `wo_status_canonical()` is its byte mirror for server filters. V497 widened the CHECK because the app's
  canonical "New" was rejected by the old 6-value CHECK, so Workshop Live job creation could not save.
- Job card availability: `jobCard.js` splits Production Out to Workshop In (scheduling gap), Workshop In to
  Workshop Out (workshop time) and Workshop Out to Production In (release gap). An unmeasurable gap renders
  "Not measurable", never 0. ERP-reported cost on the job card is read-only (`erpReportedCost`); the expense
  grid stays the cost source.
- `Total Breakdown hours` from the ERP export runs to today on open cards (40,028 hours seen on one card, per
  project memory V381); typed columns are filled only for closed cards.

## 4. Duplicated or inconsistent logic (the audit findings)

| ID | Finding | Evidence | Impact | Recommendation | Phase | Effort |
|---|---|---|---|---|---|---|
| G1 | Lifetime CPK is not in the server RPCs | `docs/tyre/CALCULATION_SOURCE_MAP.md` list of per-row RPCs | Share board, Flutter, mobile and AI context show a per-fitment basis | Repoint the nine RPCs onto `v_tyre_lifetime` one at a time with before/after hashes, as Phase 1 did for the web | 2 | L |
| G2 | Due-soon thresholds differ between JS and SQL | JS `measureFor` uses `min(10000, 10% of expected life)` km and `min(500, 10%)` hours; SQL `is_due` in `MIGRATIONS_V541_RUNNING_LIFE_DUE_EITHER_BUDGET.sql` uses fixed `< 10000` and `< 500` | A short-life tyre (loader 15k cap) can be "due" on the Inspections page (server due-only fetch) while the band on Running and Remaining says mid-life | Add the 10% clamp to the SQL `is_due` (pinned by the same test) | 2 | S |
| G3 | Price ownership rule disagrees in principle | T1 (JS keeps EARLIEST priced fitment) vs T2 (data keeps LATEST UPLOADED) | Today they agree on live data except serial K507B403860 (per project memory); a new double price will diverge | Owner to pick one rule; implement it in both `toLifetimeTyres` and the trigger | 2 | S |
| G4 | Board Overview monthly "Tyre spend" trend sums `cost_per_tyre * qty` | `src/lib/boardOverview.js` `buildTrends` (line ~109); headline uses the grid (`BoardOverview.jsx` ~line 493) | Headline and trend on the same page use two different sources (T9 violation) | Feed the trend from `loadCostSplit().byMonth.tyre` | 2 | S |
| G5 | Five "is scrapped" definitions | `tyreScrapManagementAnalytics.isScrap` (risk Critical or category Scrap or `_scrap`), `tyrePool.REMOVED_STATUS_RE`, `combinations._isScrap` (status), `performanceBenchmarkAnalytics.isScrap` (category/reason/status regex), `retreadManagementAnalytics.isScrap` (category); authoritative is `tyre_status_marks.mark_type='scrap'` + `list_scrapped_tyres` (V383/V384) | Scrap counts differ by screen; the analytics heuristic is not the register | One `isScrappedTyre(row, marks)` helper over the mark plus status; keep the risk heuristic only as "scrap candidates" | 2 | M |
| G6 | Two serial-validity checkers | `isStrongSerial` (tyreLifetime.js, mirrored) and `src/lib/tyreSerialCheck.js` | Different screens can call the same serial weak or strong | Fold `tyreSerialCheck.js` onto `isStrongSerial` (already listed open in project memory) | 2 | S |
| G7 | Two cost mode lists | `COST_MODES` in `src/lib/costSources.js` (10 importers) and in `src/lib/governedCost.js` (34 importers) | Labels and keys agree today; drift risk | Make `costSources.js` re-export from `governedCost.js` | 2 | S |
| G8 | ~40 web helpers still per fitment row | CALCULATION_SOURCE_MAP "NOT lifetime-aware yet" | Brand / supplier / retread / TCO life averages differ from Engineering KPI | Move each group onto `lifetimeGroups` with a refit test, as Phase 1 did | 2 | L |
| G9 | Expense re-import key missing outside KSA | Live 2026-11-10: 89,999 of 220,425 `parts_consumption` rows have NULL `import_uid`; UAE 51,546 / Egypt 38,451 lines have no source row (per project memory 20261109140000) | A re-upload of an old UAE/Egypt file duplicates money; only the file fingerprint warns | Make the `#` column mandatory in the intake for expense files; refuse commit without it | 2 | S |
| G10 | Default-classified spend is large | Live 2026-11-10: 120,609 of 220,425 expense lines `classified_by = 'default'` (spare at 0.30 confidence) | Spare share is overstated by an unknown amount; Material Master is marked fully reviewed (doc 19) yet these rows were never re-run | Run `reclassify_from_master(dry_run)` and review the money moved; see doc 19 | 3 | M |
| G11 | Two km bases for "cost per km" | `fleet_tyre_km_by_asset` (V453) vs `fleet_km_by_asset` (V374) | Expenses and CPK page vs CPK Intelligence report different "cost per km" | Name both on screen (already partly done) and register both in `metric_registry` with distinct ids | 3 | S |
| G12 | Pressure compliance has no stored target | `computePressureCompliance` uses vehicle-median +/-15% with >= 4 readings (V-session 2026-08-10) | Honest, but not comparable to an OEM target | Add target pressure to `tyre_specifications` and switch when populated | 4 | M |
| G13 | Failure rate rests on an almost empty field | `risk_level` populated on 0 of 11,132 tyres (per project memory 2026-08-10); engine returns null + coverage | KPI reads N/A, correctly | Capture risk on the inspection/removal form | 4 | M |

## 5. Spec section 8 checklist (centralized calculation services)

| Required service | Canonical today | Status |
|---|---|---|
| Cost per km | `governedCost.perUnitCost`, `get_fleet_cpk`, `get_cost_cpk_overview` | Built (two km bases, G11) |
| Tyre life | `kpiEngine.computeAvgTyreLife`, `computeFleetTyreLife`, `v_tyre_lifetime` | Built |
| Remaining tread life | none (tread depth captured on 0 of 4,782 inspection entries, per project memory) | Not built (no data) |
| Pressure compliance | `kpiEngine.computePressureCompliance` | Built (median basis) |
| Replacement frequency | `kpiEngine` removal / replacement rates (per row by design) | Built |
| Failure rate | `kpiEngine.computeFailureRate` | Built, N/A today (G13) |
| Warranty recovery | `warranty_claim_guard`, `claimsAnalytics.js` (accident claims) | Partly built; tyre warranty table empty |
| Fleet availability | `kpiEngine`, Workshop Live `computeKpis` | Built |
| Downtime | `jobCardDurations`, DowntimeTracker | Built |
| MTBF / MTTR | no single canonical service found | Not built |
| Maintenance compliance | `pmSchedule.summarizePmCompliance` | Built |
| Cost per asset / site / country | `loadGridTyreByAsset`, `get_site_operating_cost` (V512, through the asset), `governedCost.byCountry` | Built |
| Budget variance | `get_cost_variance` (V378, Bennet split, closes exactly) | Built |
| Forecast consumption | `src/lib/tyreDemandForecast.js` (by size), `expenseTrends.forecast` | Built |

## 6. Standing decisions (recorded, do not reverse without the owner)

- Tyre life caps and the 30-day supplier follow-up limit were confirmed by the owner on 2026-11-04.
- Cost totals never come from `tyre_records.cost_per_tyre`; CPK may use the per-tyre price.
- Washing carries no cost and is reported on compliance, never as a cost driver (owner 2026-08-12).
- The Running and Remaining server RPC `p_limit` defaults to NULL (all rows) and was deliberately NOT capped,
  because a cap would silently truncate stale clients (project memory, V523 follow-up).
- Hour-metered machines with two targets: whichever budget runs out first governs (owner, V541).

## Open decisions for the owner

1. G3: which rule keeps the price when a real serial is priced on two rows: earliest priced fitment (current JS)
   or latest uploaded row (current data fix)?
2. G1: approve repointing the nine server CPK RPCs to lifetime CPK. This changes numbers on the share board,
   Flutter management screen and mobile analytics.
3. G5: should "scrapped" mean only a recorded scrap mark (plus status), with the risk heuristic renamed
   "scrap candidates"?
4. Whether to set an hours target for TR-MIXER (98 of 227 KSA mixers have no odometer, per project memory).

## Next actions

| Action | Phase | Effort |
|---|---|---|
| Fix G2, G4, G6, G7 (small, testable, no data change) | 2 | S each |
| Make the `#` column mandatory for expense intake (G9) | 2 | S |
| Single scrap predicate (G5) with a register-vs-heuristic split | 2 | M |
| Repoint server CPK RPCs to lifetime CPK with before/after hashes (G1) | 2 | L |
| Move remaining ~40 per-row helpers to the lifetime layer (G8) | 2 | L |
| Dry-run `reclassify_from_master` and review (G10) | 3 | M |
| Build MTBF/MTTR as one service over job card stages | 4 | M |
