# Engineering calculation fixes (2026-11-12)

Follows `ENGINEERING_CALCULATIONS.md` and `calculation_test_cases.md`. Production was read only
throughout. Every SQL change is a draft in `supabase/pending_migrations/` and is NOT applied.
No stored row was changed. No browser was used.

## 1. Why two screens disagreed 12.6 times (ENG-1)

KSA, 2025-11-01 to 2026-10-31: CPK Intelligence showed 0.0235 SAR per km, Expenses and CPK showed
0.296 SAR per km. Both divisions were arithmetically right. They were four different measurements
sharing one name.

| What was divided | By what | KSA SAR | UAE AED | Egypt EGP |
|---|---|---|---|---|
| Period tyre spend (assets with tyre km) | Lifetime km of tyres taken off in the period (146,144,345 / 25,211,633 / 1,993,658 tyre km) | 0.0168 | 0.0536 | 1.1087 |
| Period tyres + spares + oil | The same tyre km | 0.0235 | 0.1135 | 3.7754 |
| Price of each retired tyre, once | That tyre's own validated km | 0.028661 | 0.015972 | 0.402182 |
| Period tyres + spares + oil (assets with odometer span) | Vehicle km driven in the period (16,165,110 / 8,016,606 / 415,159) | 0.2961 | 0.4178 | 14.3936 |

A vehicle carries about nine tyres, so tyre km is about nine times vehicle km. Row 2 (the 0.0235)
puts spares and oil over tyre km. That measures nothing and is now withheld everywhere. Rows 1, 3
and 4 are real measurements and now carry different names.

Egypt row 4 covers 19.8% of spend (18 assets) and is marked not comparable.

## 2. Metric glossary (single source: `src/lib/cpkMetrics.js`)

| Name on screen and in exports | Definition | Formula | Source function | Where shown |
|---|---|---|---|---|
| Tyre CPK (lifetime) | Purchase price of each physical tyre, counted once, over the validated km it ran across all fitments. Weighted. Final figure uses tyres no longer fitted. | sum(price) / sum(validated lifetime km) | JS `tyreLifetime.lifetimeSummary`; SQL `get_tyre_lifetime_cpk` | CPK Intelligence headline tile and Tyre lifetime tab, Engineering KPI |
| Fitment CPK | Price of one tyre over the km of one fitment, by the single km rule. | tyre price / fitment km | JS `tyreLifetime.fitmentCpk` over `tyreKm.js`; SQL `calc_cpk` (draft 122000) | Tyre records, cost centre, brand tables |
| Tyre spend ratio | Tyre spend dated in the period, on assets with tyre km, over the whole lifetime km of the tyres taken off (or issued) in the period. Not a tyre CPK, not a cost per vehicle km. | period tyre spend / lifetime tyre km | SQL `get_fleet_cpk` km side (`cpk_tyre`); JS gate `cpkMetrics.sanitizeFleetCpk` | CPK Intelligence (tile, by type, per vehicle, report, drivers), Board Overview, Expenses and CPK studio |
| Tyre cost per vehicle km | Tyre spend in the period on assets with a measured distance, over the km those vehicles drove. | matched tyre spend / odometer span | SQL `get_cost_cpk_overview` `cpk.*.cpk_tyre` (draft 120000); JS `costCpk.cpkView` | Expenses and CPK, cost per vehicle km panel (N/A until draft applied) |
| Maintenance cost per vehicle km | Spare parts and oil in the period on measured assets, over the km driven. Parts and materials only. | matched (spare + oil) / odometer span | same, `cpk_maintenance` | same |
| Operating cost per vehicle km (parts and materials) | Tyres, spares and oil on measured assets over the km driven. No labour, fuel or depreciation. | matched spend / odometer span | SQL `get_cost_cpk_overview` `cpk.*.cpk`; JS `costCpk.cpkView` | Expenses and CPK |
| Tyre cost per hour | Tyre spend on hour-metered plant over engine hours run. | tyre spend / engine hours | `get_fleet_cpk` hours side `cpk_tyre` | CPK Intelligence, non movable side |
| Operating cost per hour | Tyres, spares and oil on hour-metered plant over engine hours run. | spend / engine hours | `get_fleet_cpk` hours side `cpk_total` | CPK Intelligence, Board Overview |
| Withheld | "Total cost per km" on tyre km. | n/a | `cpkMetrics.TOTAL_PER_TYRE_KM_WITHHELD` | Shown as N/A; raw value kept as `legacy_total_per_tyre_km` for traceability only |

Metric registry rows (`metric_registry`, `metric_versions`) are renamed and added by draft 120000
so the registry text matches the screen text.

## 3. Before and after, per country

Currencies are never added together. Period for rate figures: 2025-11-01 to 2026-10-31.

### 3.1 Changed now (JS, live once this branch is deployed)

| Figure | KSA (SAR) | UAE (AED) | Egypt (EGP) |
|---|---|---|---|
| CPK Intelligence headline, before: "Fleet CPK, tyre" (period spend over tyre km) | 0.0168 | 0.0536 | 1.1087 |
| CPK Intelligence headline, after: Tyre CPK (lifetime) | 0.0287 (1,497 of 4,856 retired tyres measurable) | 0.0160 (120 of 738) | 0.4022 (38 of 92) |
| The 0.0168 / 0.0536 / 1.1087 figure, after | same value, second tile, named "Tyre spend ratio", unit "per tyre km" | same | same |
| "Fleet CPK, total" per km (tile, by type, per vehicle, exports, Board Overview, studio) before | 0.0235 | 0.1135 | 3.7754 |
| after | N/A (withheld) | N/A | N/A |
| Operating cost per hour (plant) | 4.9701, unchanged | 6.3941, unchanged | unchanged |
| Expenses and CPK panel value | 0.296, unchanged; now titled "Operating cost per vehicle km (parts and materials)", unit "per vehicle km" | 0.418, unchanged | 14.394, unchanged, not comparable |
| Downtime hours (Engineering KPI card, Downtime Tracker with no job card match) before | assumed 2 h per event shown as hours | same | same |
| after | N/A (not measured); the assumed figure is shown beside it and labelled assumed | same | same |
| Downtime cost before | hours x 850 with no currency basis | same | same |
| after | N/A until a rate is entered; measured cost uses measured hours only | same | same |
| Vendor score for a brand with no rating and no km before | failure rate 0, score 0.3, ranked | same | same |
| after | failure rate N/A, score N/A, unranked | same | same |
| "Pressure compliance" label | renamed "Pressure consistency" (value unchanged). True compliance is reported only where a required pressure exists. | same | same |
| Tyre CPK by site, Expenses and CPK chart (rows with qty above 1) | cost x qty now over km x qty (was km x 1); km by the single rule. Not re-measured per country. | same | same |

### 3.2 Changes when the SQL drafts are applied (measured read only, 2026-11-12)

| Figure | KSA | UAE | Egypt |
|---|---|---|---|
| Tyre cost per vehicle km (new) | 0.1907 SAR | 0.1827 AED | 4.8969 EGP |
| Maintenance cost per vehicle km (new) | 0.1054 SAR | 0.2351 AED | 9.4966 EGP |
| Matched tyre / maintenance spend behind them | 3,082,290 / 1,703,401 | 1,464,723 / 1,884,493 | 2,033,001 / 3,942,619 |
| Mean life of removed tyres in the expected life baseline | 42,631 to 37,085 km (rows 5,215 to 4,444) | 42,147 to 30,647 (681 to 552) | 68,532 to 34,580 (70 to 53) |
| Average expected life of active tyres on a measured basis | 54,167 to 31,280 km (197 tyres) | 22,267 to 19,504 (108) | 69,486 to 38,968 (411) |
| Tyres flagged due | 358 to 399 | 150 to 153 | 0 to 0 |
| Active tyres with a km run (factory zero fitments now counted) | 2,142 to 2,176 | not re-measured | not re-measured |
| Rows given a row CPK by `calc_cpk` | 1,829 to 1,688 | 140 to 113 | 52 to 41 |
| Unit (km or hours) of any existing vehicle type | no change | no change | no change |
| Lines newly recognised as warranty | 2 (amount 0.00, not in the tyre bucket) | 0 | 0 |
| Tyre bucket that is not a tyre purchase (all time), now visible via `get_tyre_spend_breakdown` | repair 7,200.00 (18 lines), other 19,500.00 (10), tube 62.00 (1) of 12,367,362.20 | other 83,580.00 (73 lines) of 4,006,505.04 | repair 148,339.49 (33 lines) of 16,517,335.08 |

The audit note said 385 KSA tyres due with the km rule. The draft gives 399 because it also uses
the fleet vehicle type when the row type is blank and counts factory zero fitments.

## 4. Files

JS source of truth
- `src/lib/cpkMetrics.js` (new): glossary, `sanitizeFleetCpk` gate, `rowRate`.
- `src/lib/api/fleetCpk.js`: every `get_fleet_cpk` payload passes the gate.
- `src/lib/kpiEngine.js`: downtime null plus named assumption, vendor honest nulls, pressure consistency plus target compliance.
- `src/lib/downtimeTrackerAnalytics.js`: measured only from job card timestamps (year 2000 or later, closed after opened, at most 720 h), no default rate.
- `src/lib/costIntelligence.js`, `src/lib/tyrePriceRules.js`, `src/lib/tyreCostAudit.js`, `src/lib/tyreEvidenceAudit.js`, `src/lib/costCpk.js`, `src/lib/expenseReportAnalytics.js`.

Screens and exports relabelled
- `src/pages/CpkIntelligence.jsx`, `src/lib/fleetCpkView.js`, `src/lib/cpkModule.js`, `src/lib/cpkOverviewView.js`, `src/lib/cpkReport.js`, `src/components/cpk/CpkScenarioStudioPanel.jsx`, `src/components/cpk/CpkDriversPanel.jsx`, `src/pages/BoardOverview.jsx`, `src/lib/boardOverviewAnalytics.js`, `src/pages/ExpenseReport.jsx`, `src/components/expense/CostCpkPanels.jsx`, `src/lib/api/aiProposals.js`, `src/pages/EngineeringKpi.jsx`, `src/pages/DowntimeTracker.jsx`, `src/lib/vendorIntelligenceAnalytics.js`, `src/pages/SafetyCompliance.jsx`, `src/pages/ComplianceDashboard.jsx`, `src/pages/DisplayDashboard.jsx`, `src/lib/safetyComplianceAnalytics.js`, `src/lib/kpiCommandCenterAnalytics.js`, locales `downtime`, `execreport`, `kpicommand` (en and ar).

SQL drafts (not applied)
- `20261113120000_eng1_cost_per_km_named_metrics.sql`
- `20261113121000_eng2_running_life_baseline_km_rule.sql`
- `20261113122000_eng3_calc_cpk_km_rule.sql`
- `20261113123000_eng4_unit_rule_road_vehicles.sql`
- `20261113124000_eng5_warranty_spelling_and_tyre_spend_kinds.sql`

Each is built from the live definition by anchored replacement, aborts if an anchor is not found
exactly once, saves the previous definition to `_bak.fn_defs_eng_20261113`, and carries VERIFY and
ROLLBACK steps in its header.

Tests
- `src/test/engineeringHandCases.test.js` (new, 48 tests): the hand cases, JS side.
- `src/test/cpkMetrics.test.js` (new, 22 tests): glossary and gate.
- `supabase/tests/eng_calculation_cases.test.mjs` (new, 10 tests, PGlite): SQL side, drafts applied over the live bodies in `supabase/tests/fixtures/eng_live_functions.sql`.
- Existing tests that pinned the old behaviour were changed, each with the reason written in the test: `fleetCpkView`, `cpkOverviewView`, `cpkReport`, `costCpk`, `costCpkPanels`, `cpkIntelligence.render`, `downtimeTrackerAnalytics`, `expenseReportAnalytics`, `expenseReportScopeSurfaces`, `safetyComplianceAnalytics`.

## 5. The 36 cases

"JS" is the vitest file, "SQL" is the PGlite file. "Live SQL" says whether production already
behaves that way.

| Case | Expectation (corrected where marked) | JS | SQL (PGlite) | Live SQL today |
|---|---|---|---|---|
| C01 to C10 | km rule: placeholder, factory zero, class caps, reversed | pass | pass | pass |
| C11, C12, C13 | fitment CPK, no price, placeholder | pass | n/a | n/a |
| C29 | `calc_cpk(1800, 1, 184300)` is null | pass (JS side) | pass with draft 122000 | FAILS until applied (0.0098) |
| C14 to C18, C25 | weighted fleet CPK, one price per tyre, overlap, no currency blend, qty | pass | n/a | n/a |
| C26 | corrected: the January 2025 trusted date is an explicit scope (`evidenceScopeRows`), not a silent default. All history gives 0.0375, modern scope gives 0.05, and each is labelled. | pass | n/a | n/a |
| C19 | strong serial | pass | pass | pass |
| C20 | loader per engine hour | pass | pass | pass |
| C20b | WATER TANKER, LOW LOADER TRAILER, CONCRETE MIXER TRUCK are km | pass | pass with draft 123000 | FAILS until applied (no live type affected) |
| C21a to C21f | life bands | pass | n/a | pass (unchanged) |
| C22 | later fitment closes the old tyre (removal 1 Jun, 62,000 km, life 22,000, one log row); same day lower meter is held | n/a | pass (first run of this case) | not run on production, by rule |
| C23, C24, C24b | warranty, repair, tube, flap, mixed | pass | pass | pass |
| C23b | "WARRENTY" is a warranty line | pass | pass with draft 124000 | FAILS until applied |
| C24c | corrected: repair, tube and other lines stay where the ERP booked them (history is preserved) but are split out of tyre PURCHASE spend by `splitTyreSpend` and `get_tyre_spend_breakdown` | pass | pass with draft 124000 | function not present until applied |
| C32, C33 | unit price, zero denominator | pass | n/a | n/a |
| C27, C28 | MTTR, mean time between events | pass | n/a | n/a |
| C28b | event with no job card has null measured hours | pass | n/a | n/a |
| C30 | honest nulls | pass | n/a | n/a |
| C30b | unrated brand: failure rate null, score null, unranked | pass | n/a | n/a |
| C30c | downtime impact from tyre rows is null, assumption named | pass | n/a | n/a |
| C31 | 4 of 5 within tolerance is 80% | pass | n/a | n/a |
| C31b | corrected: four tyres at 60 psi are 100% consistent, which is true. The metric is named Pressure consistency. Compliance against a required pressure is 0% when a target is supplied and N/A when none exists. | pass | n/a | n/a |
| ENG-2 (reconciliation row 3) | baseline equals avg(tyre_km_life) | n/a | pass with draft 121000 | FAILS until applied |

Nine failing cases: C26, C20b, C23b, C24c, C28b, C30b, C30c, C31b are resolved in JS now. C29 is
SQL only and resolves when draft 122000 is applied. C22 (not run before) passes on PGlite.

### Status of the nine failing cases and the unrun case

| Case | Status | Evidence |
|---|---|---|
| C29 `calc_cpk` on a placeholder fitment | Verified Fixed on PGlite (draft 122000); Blocked on production until the draft is applied | `eng_calculation_cases.test.mjs` |
| C26 trusted date baseline | Verified Fixed (corrected expectation: explicit scope) | `engineeringHandCases.test.js` |
| C20b road vehicles with a plant word | Verified Fixed in JS; SQL Verified Fixed on PGlite (draft 123000), Blocked on production | both files |
| C23b WARRENTY spelling | Verified Fixed in JS; SQL Verified Fixed on PGlite (draft 124000), Blocked on production | both files |
| C24c repair and other lines in tyre purchase spend | Verified Fixed as a reported split (corrected expectation); booked buckets not moved | both files |
| C28b downtime with no job card | Verified Fixed | `engineeringHandCases.test.js`, `downtimeTrackerAnalytics.test.js` |
| C30b vendor score with nothing measured | Verified Fixed | `engineeringHandCases.test.js`, `kpiEngineNullHonesty.test.js` |
| C30c downtime impact from tyre rows | Verified Fixed | `engineeringHandCases.test.js` |
| C31b pressure at half the required value | Verified Fixed (renamed to consistency; compliance N/A without a stored target) | `engineeringHandCases.test.js` |
| C22 replacement linkage (not run in the audit) | Verified Fixed on PGlite; Not Tested on production, by rule | `eng_calculation_cases.test.mjs` |
| ENG-1 SQL (draft 120000) | Not Tested (never executed; anchors counted on live text only) | none |

### Test results (2026-11-15)

- Changed and related vitest files plus `designSystemRatchet`, `rowCapGuard`, `cpkSourceScan`, `webI18nKeyCoverage`: 48 files, 607 tests, all passed.
- PGlite `supabase/tests/eng_calculation_cases.test.mjs`: 10 of 10 passed.
- ESLint on changed files: 0 errors, 1 warning (existing hook dependency warning in `ComplianceDashboard.jsx`).
- `vite build`: clean.
- One full `vitest run` on 2026-11-12, before the last two test updates: 15,214 passed, 9 failed in 13 files. Two were mine (`boardOverviewAnalytics`, `kpiEngineNullHonesty`, both since fixed and passing). The rest were in files owned by other work streams (api, budgets, kpiTargets, settings, inspectionsPage, write access, workforce board) and were not re-run after those files left this tree.

## 6. Risk to the current company, per change

| Change | Risk | Note |
|---|---|---|
| Headline on CPK Intelligence is Tyre CPK (lifetime) | Medium | The number users remember (KSA 0.0168) moves to the second tile; the headline reads 0.0287. Tell users before deploy. |
| Km total withheld | Low | A figure disappears. Saved custom report layouts that include the column show N/A. |
| Downtime shown as N/A with a named assumption | Low | Screens that showed hours now show N/A unless job cards match. Downtime cost needs a rate entered. |
| Vendor score null when unmeasured | Low | Brands with no data drop out of the ranking instead of ranking near the top. |
| Pressure consistency rename | Low | Label only. |
| Draft 121000 (expected life) | Medium | 41 more KSA and 3 more UAE tyres read due. Intended. |
| Draft 122000 (`calc_cpk`) | Low | 141 KSA, 27 UAE, 11 Egypt rows lose a row CPK. |
| Draft 120000 (overview split, fleet CPK keys) | Low | Additive plus one key set to null that the web already ignores. |
| Drafts 123000, 124000 | None measured | No live type or amount changes. |

## 7. Still wrong, and why

- Tyre CPK (lifetime) rests on a minority of retired tyres: KSA 31%, UAE 16%, Egypt 41% have both a price and validated km. The tile states the count. This is a data gap, not a formula gap.
- CPK Scenario Studio still models tyres plus maintenance over tyre km. It is relabelled as a what-if model with a notice, but the engine (`cpkScenarioStudio.js`) was not rebuilt on vehicle km.
- The "Why it changed" decomposition (`get_cpk_drivers`) still decomposes the tyre spend ratio. It is labelled so, not re-based.
- Repair, tube and unrecognised lines remain inside the booked tyre bucket (KSA 26,762.00, UAE 83,580.00, Egypt 148,339.49, all time). They are reported, not moved, because moving them changes booked history.
- No required tyre pressure is stored anywhere, so true pressure compliance is N/A for every vehicle.
- `get_fleet_cpk` and `get_cost_cpk_overview` are DEFINER functions that still do not check the caller's country scope (known, recorded in project memory, not part of this work).
- Tyre CPK by site on Expenses and CPK was not re-measured per country after the qty and km rule change.
- The AI orchestrator edge function has a fleet CPK tool that calls `get_fleet_cpk` directly (not through the JS gate). Until draft 120000 is applied it can still quote the km total. Edge functions were out of scope here.
- The Flutter and Expo apps were not touched. No reference to `get_fleet_cpk` was found in their sources.

## 8. Not verified

- No browser was used. Screens were exercised by render tests only.
- Draft 120000 was not executed anywhere. Its seven anchors were each counted once on the live text, but the patched `get_fleet_cpk` and `get_cost_cpk_overview` bodies have not run. The split values in 3.2 come from an independent read only query, not from the patched function.
- Drafts 121000 to 124000 ran on PGlite against transcribed live bodies, not on Postgres 15 with production data. The before and after counts in 3.2 come from read only replica queries of the same logic.
- Arabic strings for the relabelled downtime and pressure keys were written but not reviewed by a native reader.
- The metric registry statements in draft 120000 were not run (PGlite has no registry tables).
