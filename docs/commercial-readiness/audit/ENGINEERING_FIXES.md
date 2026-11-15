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

---

# Round 2 (2026-11-15): drafts executed on staging, golden fixture, JS against SQL

Production stayed read only (SELECT of aggregates and function text only). Every draft is still
NOT applied to production. Everything below marked "staging" ran on the local staging database:
PostgreSQL 16, the production schema (497 tables, 1,127 functions), synthetic companies Alpha, Beta
and Gamma. The function text the drafts patch is byte identical to production for six of seven
functions (md5 read from production on 2026-11-15); `calc_cpk` differs only in line ends (CRLF).

## R2.1 Drafts executed in order

`supabase/tests/staging/eng_apply_drafts.sh` rebuilds database `tp_eng` from the baseline and runs
120000, 121000, 122000, 123000, 124000, 125000 with `ON_ERROR_STOP`, each in one transaction.
All six ran with no error. No draft file needed a correction to run.

Changes made to drafts in round 2:
- 124000: `get_tyre_spend_breakdown` groups by currency instead of `max(currency)`, so two
  currencies inside one country could never be merged into one row.
- 125000: new (see R2.4, defect R2-D1).
- All: a "ROUND 2" status paragraph in the header.

## R2.2 What is proven, and where

| Claim | Status | Evidence (staging unless said) |
|---|---|---|
| ENG-1 SQL, draft 120000: `get_fleet_cpk` km `cpk_total` is null, old value kept as `legacy_total_per_tyre_km`, `cpk_tyre` unchanged, hour rows unchanged | Verified Fixed on staging; Blocked on production until applied | `eng_round2_staging.mjs` tests 5, 18 (seeded company, 3 countries, every row) |
| ENG-1 SQL: `get_cost_cpk_overview` gains `cpk_tyre`, `cpk_maintenance`, split adds up to the unchanged total, cpk is round(spend / km, 3) | Verified Fixed on staging | tests 6, 17. Golden: 4,012 + 800 = 4,812 over 267,000 km = 0.018 / 0.015 / 0.003 |
| Old callers | Verified on staging | Every key an old caller reads is still present. Only changed values: km `cpk_total` (null). Nothing outside the `cpk` block of the overview changes. Running life returns the same tyres and keys |
| No existing row changes | Verified on staging | md5 of every row of every public table (over 480; registry tables aside) identical before and after; 31 tables carry rows. Registry: `fleet_cpk` renamed, 4 metrics added, 1 version added |
| Currency never blended | Verified on staging | All countries call returns one row per country in SAR, AED, EGP and no fleet scalar; overview currency is null when more than one country is in scope; golden KSA and UAE stay apart; breakdown is per country and currency |
| NULL, not 0, when unmeasurable | Verified on staging | Window with no reading: cpk, cpk_tyre, cpk_maintenance null. Pump with spend and no hour span: rate null. Placeholder tyre: km run and remaining km null. `v_tyre_master.cpk` null for a placeholder fitment |
| C29 `calc_cpk(1800, 1, 184300)` | Verified Fixed on staging (0.0098 before, null after, also through `v_tyre_master`); Blocked on production | tests 11, 23 |
| C20b road vehicles with a plant word | Verified Fixed on staging through `get_fleet_cpk` and `get_tyre_running_life` on stored rows (engine_hours and no rate before; km and 0.05 / 0.125 / 0.05 after); Blocked on production | tests 12, 22 |
| C23b WARRENTY | Verified Fixed on staging (function, line kind, and the price back fill dry run: comparable 1,850 before, warranty 0 after); Blocked on production | test 13 |
| C22 replacement linkage | Verified Fixed on staging through the real import path `tyre_import_reconcile` as a signed in Admin with all triggers on: dry run writes nothing; real run closes the old tyre (removed 1 Jun, 62,000 km, life 22,000, one log row); same day lower meter is held for review; undo restores | test 21. Not Tested on production, by rule (it writes) |
| ENG-2 baseline, draft 121000 | Verified Fixed on staging (33,364 before, 26,020 after; factory zero tyre gains a km run) | test 15 |
| Double active wheel | Verified on staging | stored pair is flagged by `v_tyre_fitment_evidence`; a second active tyre from a signed in user is refused (23505) |
| One price per tyre | Verified on staging | trigger stores the refit with no price and keeps the offered price as a note; lifetime view and JS both count 1,800 once |
| Metric registry statements of draft 120000 | Verified on staging | test 4 |

Test counts (2026-11-15):
- `node --test supabase/tests/staging/eng_round2_staging.mjs`: 23 of 23 (staging).
- `src/test/engGoldenFixture.test.js`: 110 of 110 (JS only, runs in CI).
- `src/test/engGoldenSqlParity.test.js`: 14 of 14 (JS against live staging SQL; skipped when no cluster).
- PGlite `supabase/tests/eng_calculation_cases.test.mjs`: 10 of 10.
- Related vitest files after merging main: 35 files, 546 tests, all passed. ESLint on changed files: 0 errors. `vite build`: clean.
- Mutation checks: raising the JS mixer cap to 90,000 fails 10 tests; removing "warrenty" from the JS word list fails 6. Both restored.

## R2.3 Golden fixture

`supabase/tests/fixtures/eng_golden_fixture.json`: 28 synthetic fitments, 9 expense lines, 6 assets,
5 hour readings, 3 life targets, 6 job cards, with answers worked by hand. Loaded into the empty
company Gamma inside a rolled back transaction. The JS engines and the SQL RPCs both run on it.

| Topic | Hand answer | JS | SQL (staging) |
|---|---|---|---|
| Tyre CPK lifetime, KSA | 12,500 / 258,200 = 0.048412 (6 of 13 retired tyres measurable) | pass | pass |
| Not the mean of fitment CPKs | mean of 7 ratios is 0.077105 | pass | pass |
| Placeholder fitment km (1) | km unknown, no CPK | pass | pass (after 122000 for `calc_cpk`) |
| Factory fitment (0) | 38,200 km, 0.049738 | pass | pass |
| Km caps by class | mixer 80,000, pump 56,000, loader 15,000, other 100,000, inclusive | pass | pass |
| Overlapping refit | 15,000 km not added, coverage partial | pass | pass |
| One price per tyre | 1,800 once, status DISPUTED when stored twice | pass | pass |
| Row of two tyres, no serial | 2 x 1,000 over 2 x 20,000 | pass | pass |
| Warranty zero | price 0, source warranty | pass | pass (after 124000) |
| Repair is not a price | tyre with only a repair line stays unpriced | pass | pass |
| Purchase line of two tyres | 3,600 / 2 = 1,800 each | pass | pass |
| Running life, km | healthy 17%, mid life 67%, due soon 4,000 km left, overdue 117%, placeholder unknown | pass | pass |
| Running life, hours | due soon at 200 h left of 5,000; healthy at 56% | pass | pass |
| Two budgets | pump judged on distance (93%) ahead of hours (20%) | pass | pass |
| Measured baseline | 26,020 km from 10 removed tyres | n/a | pass (after 121000) |
| Double active wheel | both tyres flagged; second insert refused | n/a (JS only labels the SQL flag) | pass |
| Downtime | 12 h and 24 h cards measured; year 0025, reversed, over 720 h and open cards refused; event with no card is null with a named assumption of 4 h or 2 h | pass | n/a (no SQL function measures downtime) |
| Two countries | KSA 0.048412 SAR, UAE 0.03 AED, no blended figure | pass | pass |

JS against SQL, compared directly (`engGoldenSqlParity.test.js`): km rule on 3,960 combinations,
fitment CPK on 108, unit rule on 59 type names, warranty / repair / line kind on 60+ descriptions,
real serial test on 30 shapes, every golden tyre, the due set on the seeded company in three
countries, lifetime CPK of the seeded company (1,058 fitments) in three countries, and the web
gate `sanitizeFleetCpk` over the unpatched function against the patched function. Mismatches: 0.

## R2.4 Defects found by the golden fixture

| Id | Defect | Engines | Status |
|---|---|---|---|
| R2-D1 | `fleet_km_by_asset` reads the placeholder odometer 1 as a real reading, so a vehicle's distance becomes its whole odometer. It is the denominator of every cost per vehicle km. Production, 2025-11-01 to 2026-10-31 (read only aggregates): KSA 16,165,110 km now, 15,411,576 without placeholders (66 placeholder readings on 23 assets, 4.7% overstated); UAE 8,016,606 to 7,442,153 (7.2%); Egypt 415,159 to 415,158. | SQL only (JS has no vehicle km engine) | Fixed in draft 125000. Verified Fixed on staging (golden: 94,999 before, 85,000 after). Blocked on production |
| R2-D2 | The life cap matches the word LOADER anywhere, so a LOW LOADER TRAILER (a road trailer, km by draft 123000) gets the 15,000 km wheel loader cap and loses every longer tyre life. | JS and SQL agree, both wrong | Open. Not fixed: the cap table is an owner rule. No such vehicle type exists in production today (32 types checked), so current impact is none. Pinned by a test so the fix cannot be forgotten |
| R2-D3 | `calc_cpk(cost, km_fit, km_rem)` has no vehicle type, so it applies the general 100,000 km cap. A mixer tyre at 85,000 km is refused by the lifetime engine and JS, but `v_tyre_master` and `get_country_kpi` still give it a row CPK (golden rows 5 and 7: 0.0235, 0.0281). | SQL differs from JS by design of the signature | Open. Needs a fourth argument and both readers changed; not small |

Not a defect, recorded: the import trigger on `tyre_records` swaps a reversed fitment and removal
odometer and turns an inserted 0 into null, so a factory fitment at 0 km can only be stored with
that trigger off. The golden fixture loads with triggers off for that reason.

## R2.5 Production checks the owner can run (read only), before and after apply

```sql
-- A. C29 (draft 122000). Before: 0.0098, {"KSA":90,"UAE":16}. After: null, null (no rows).
select public.calc_cpk(1800, 1, 184300) as c29,
       (select jsonb_object_agg(country, n) from (select country, count(*) n from public.v_tyre_master
          where cpk is not null and km_at_fitment = 1 group by 1) x) as placeholder_rows_with_cpk;

-- B. C20b (draft 123000). Before: engine_hours x3. After: km x3. The md5 must NOT change
--    (it was 54db03beb39ffeab6614b1256d7ced62 over 32 types on 2026-11-15): no live type changes unit.
select public.cpk_unit_for_asset_type('WATER TANKER') a, public.cpk_unit_for_asset_type('LOW LOADER TRAILER') b,
       public.cpk_unit_for_asset_type('CONCRETE MIXER TRUCK') c,
       (select md5(string_agg(vt || '=' || public.cpk_unit_for_asset_type(vt), ',' order by vt)) from (
          select distinct upper(btrim(vehicle_type)) vt from public.vehicle_fleet where coalesce(btrim(vehicle_type),'') <> ''
          union select distinct upper(btrim(vehicle_type)) from public.tyre_records where coalesce(btrim(vehicle_type),'') <> ''
          union select distinct upper(btrim(asset_type)) from public.parts_consumption where coalesce(btrim(asset_type),'') <> '') t) as unit_map_md5;

-- C. C23b (draft 124000). Before: false, KSA 2 lines, already_warranty 0, amount 0. After: true, 2, 2, 0.
select public.tyre_price_is_warranty('TIRE -WARRENTY -315/80 R 22.5') as c23b,
       (select jsonb_agg(x) from (select country, count(*) lines,
            count(*) filter (where public.tyre_price_is_warranty(item_description)) already_warranty,
            sum(coalesce(tyre_cost, 0)) tyre_bucket_amount
          from public.parts_consumption
         where item_description ~* '\y(warrenty|waranty|warenty|warrantie|gaurantee|guaranty|free issue)\y' group by 1) x) as lines;

-- D. ENG-1 (draft 120000), as a signed in Manager. After: cpk_total null, legacy_total_per_tyre_km = the
--    old cpk_total, cpk_tyre unchanged; overview spend_matched = spend_matched_tyre + spend_matched_maintenance.
select j->'fleet'->0->'km' from (select public.get_fleet_cpk('KSA','2025-11-01','2026-10-31') j) x;
select o->'cpk'->'current' from (select public.get_cost_cpk_overview('KSA',null,'2025-11-01','2026-10-31') o) x;

-- E. R2-D1 (draft 125000). Before (2026-11-15): KSA 353 / 16,165,110, UAE 160 / 8,016,606, Egypt 18 / 415,159.
--    After: KSA 348 / 15,411,576, UAE 151 / 7,442,153, Egypt 17 / 415,158.
select country, count(*) assets, sum(km_run) km
  from public.fleet_km_by_asset('00000000-0000-0000-0000-000000000001'::uuid, null, '2025-11-01', '2026-10-31')
 group by 1 order by 1;
```

## R2.6 Callers that need a change after apply

- AI orchestrator edge function, fleet CPK tool: its description still says "total cost / total km".
  After 120000 it receives `cpk_total` null on km rows. The description should name the tyre spend
  ratio. Edge functions are outside this stream and cannot be deployed from here.
- `get_tyre_spend_breakdown` has no reader yet. The JS split (`splitTyreSpend`) is tested against it;
  a screen has to call it before anyone sees the split.
- `get_data_trust_overview` and `_cost_cpk` read `fleet_km_by_asset`; their km and coverage figures
  fall by the R2-D1 amount after 125000. No client change needed.
- Web: none. The gate in `cpkMetrics.js` already returns what the patched function returns (proven
  row by row on staging).
- Flutter and Expo: no reader of any changed function.

## R2.7 Still not verified

- Nothing ran on production. Staging data is synthetic: it proves the logic and the schema fit, not
  production scale (staging has 1,058 fitments; timing was not measured).
- No browser was used.
- Draft 125000 anchors were counted once each on the production function text, and the before
  figures were reproduced on production by a read only query of the same logic. The after figures
  come from that query with the corrected comparison, not from the patched function on production data.
