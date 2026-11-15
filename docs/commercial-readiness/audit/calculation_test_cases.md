# Independent calculation test cases (engineering audit, 2026-11-12)

Every expected value below was worked by hand from the business rules in `docs/tyre/BUSINESS_RULES.md`
(T1 to T20) and the audit brief, not by calling the code. The engines were then run against them:

- JS engines: a one-off vitest file outside the repository at
  `/tmp/claude-0/-home-user-Tyre-Pulse/f5f47d6f-b333-5be3-b15d-8e39da2bbfea/scratchpad/calc/cases.test.js`
  (plus `probe.test.js` in the same folder), importing the real modules from `src/lib/`. Nothing was added to
  the repo.
- SQL engines: the live functions called with literal arguments in a single SELECT (no table access, no write).

Result key: PASS, FAIL (engine disagrees with the hand value or with the stated rule), NOT RUN (cannot be
executed without a write to production; verified by reading the function body instead).

Summary: 36 cases. 26 PASS, 9 FAIL, 1 NOT RUN. Every FAIL maps to a finding in `ENGINEERING_CALCULATIONS.md`.

## A. Tyre km of one fitment (rule T7)

| ID | Inputs | Hand calculation | Expected | JS `tyreKmAssessment` | SQL `tyre_km_life` |
|---|---|---|---|---|---|
| C01 | mixer, fitment 52,000, removal 96,500 | 96,500 - 52,000 | 44,500 measured | 44,500 PASS | 44,500 PASS |
| C02 | mixer, fitment 1 (placeholder), removal 184,300, total 184,299 | fitment 1 means the fitment reading was never taken; 184,299 is the machine odometer | unknown (null) | null, status placeholder PASS | null PASS |
| C03 | mixer, fitment 0 (factory), removal 38,200 | new machine, tyre ran the whole odometer | 38,200 | 38,200, status factory PASS | 38,200 PASS |
| C04 | mixer, fitment 10,000, removal 95,000 | 85,000 is above the 80,000 mixer cap | unknown (null) | null, over_cap PASS | null PASS |
| C05 | trailer, same readings | 85,000 is below the 100,000 default cap | 85,000 | 85,000 PASS | 85,000 PASS |
| C06 | pump, fitment 20,000, removal 77,000 | 57,000 is above the 56,000 pump cap | null | null PASS | null PASS |
| C07 | wheel loader, total 15,000; then 15,001 | cap 15,000 is inclusive | 15,000; null | 15,000; null PASS | 15,000; null PASS |
| C08 | row type blank, fitment 10,000, removal 95,000, fleet class mixer | fleet class supplies the cap, so 85,000 is over 80,000 | null with fleet class; 85,000 without | null; 85,000 PASS | by reading: `fleet_tyre_km_by_asset` passes the fleet type PASS |
| C09 | nothing recorded | no inputs | null, never 0 | null, status missing PASS | null PASS |
| C10 | fitment 90,000, removal 60,000 (reversed); then with total 30,000 | removal below fitment is not a distance; recorded total is accepted | null; 30,000 | null; 30,000 PASS | null; 30,000 PASS |

## B. Cost per km

| ID | Inputs | Hand calculation | Expected | Result |
|---|---|---|---|---|
| C11 | price 1,800, mixer, 52,000 to 96,500 | 1,800 / 44,500 | 0.040449 | JS `fitmentCpk` 0.040449 PASS |
| C12 | same km, price missing; price 0 | no price, no CPK | null, null | null, null PASS |
| C13 | price 1,800, fitment 1, removal 184,300 | km unknown (C02) | null | JS `fitmentCpk` null PASS |
| C29 | SQL `calc_cpk(1800, 1, 184300)` | same as C13, must be null | null | **0.0098 FAIL** (raw removal minus fitment, no T7). `calc_cpk(1800,52000,96500)` = 0.0404 PASS |
| C14 | tyre A 1,000 over 20,000 km; tyre B 2,000 over 100,000 km (trailer) | weighted (1,000 + 2,000) / 120,000 = 0.025; mean of ratios (0.05 + 0.02) / 2 = 0.035 | fleet figure 0.025 | `weightedCpk` 0.025, `computeCpkFleet.fleetAvgCpk` 0.025, mean kept separately as 0.035 PASS |
| C15 | one serial, fitted twice: 10,000 to 40,000 on asset A1, then 5,000 to 25,000 on B1, price 1,500 typed on both rows | one tyre, one price: 1,500 / (30,000 + 20,000) | cost 1,500, life 50,000, CPK 0.03, 2 fitments, 2 vehicles, status DISPUTED, second row price dropped | all as expected PASS |
| C16 | one serial, fitment 1 from 10 Jan to 10 Jun (30,000 km), fitment 2 starts 1 Mar (12,000 km) | second fitment overlaps the first; its km is not added | life 30,000, 1 overlapping, coverage partial | PASS |
| C17 | tyre A in KSA (0.05 SAR/km), tyre B in UAE (0.02 AED/km) | SAR and AED cannot be added | fleet CPK null, per country rows 0.05 and 0.02; adding SAR to AED throws | `weightedCpk` null, `lifetimeSummary.mixedCurrency` true, rows [0.05, 0.02], `addMoney` throws PASS |
| C18 | weak serial "DOT1234", qty 4, price 900 each, 30,000 km | (900 x 4) / (30,000 x 4) | 0.03, qty 4 | PASS |
| C25 | real serial, 40,000 km, no price | unpriced tyre has no CPK and is outside the fleet figure | cost null, status MISSING, CPK null | PASS |
| C26 | tyre fitted June 2024 (1,000 over 40,000 km) and tyre fitted June 2025 (2,000 over 40,000 km) | audit rule: only history from January 2025 is the baseline, so 2,000 / 40,000 | 0.05 | **0.0375 FAIL**: `computeCpkFleet` includes the 2024 tyre. No engine filters on the trusted date. (BUSINESS_RULES T20 says legacy fitments are "kept and used for lifetime km/cost where valid", so the code follows T20 but not the brief's rule. See ENG-12.) |

## C. Serial identity (rule T6)

| ID | Inputs | Expected | JS `isStrongSerial` | SQL `tyre_serial_is_strong` |
|---|---|---|---|---|
| C19 | YMA55312, FEB-62, 315/80R22.5, 1.25121E+11, 111111, NO SERIAL, 12345 | true, then six false | match PASS | match PASS |

## D. Hours based plant and unit selection

| ID | Inputs | Hand calculation | Expected | Result |
|---|---|---|---|---|
| C20 | wheel loader, tyre cost 12,000, engine hours 8,300 to 9,500, km 4,000 | 12,000 / 1,200 hours; km is ignored for a loader | 10.0 per hour; null when hours are 0 | JS `assetCpk` 10 and null PASS. SQL unit: loader engine_hours, TR-MIXER km, PUMPS engine_hours PASS |
| C20b | vehicle types a different company would use: WATER TANKER, LOW LOADER TRAILER, CONCRETE MIXER TRUCK | all three are road vehicles measured in km | km, km, km | **FAIL, JS and SQL both return engine_hours for all three** (keywords water, loader, concrete). Also CRANE TRUCK and ROLLER SHUTTER VAN (matches "roller") return engine_hours. See ENG-4. |

## E. Running and remaining life bands

| ID | Inputs | Hand calculation | Expected | JS `bandFor` |
|---|---|---|---|---|
| C21a | expected 80,000 km, remaining 7,500, used 91% | soon limit = min(10,000, 10% of 80,000) = 8,000; 7,500 is under it | due-soon | PASS |
| C21b | expected 80,000, remaining 9,000, used 89% | 9,000 is not under 8,000 and 89 is under 90; above 60% used | mid-life | PASS |
| C21c | remaining 0 | spent | overdue | PASS |
| C21d | pump, 5,000 hour target, remaining 400 h | limit min(500, 500) = 500 | due-soon | PASS |
| C21e | pump, km budget 33% used, hours budget spent | worst budget wins | overdue | PASS |
| C21f | no meter at all | not measurable | unknown, not healthy | PASS |

The band thresholds in SQL (`get_tyre_running_life`, `is_due`) were compared line by line with the JS constants
(10,000 km, 500 h, 90%) and agree. The independent live recount in section H confirms the server count.

## F. Replacement linkage (rules T3, T4)

| ID | Inputs | Expected | Result |
|---|---|---|---|
| C22 | wheel LHF1 holds serial OLD (fitted 1 Mar, 40,000 km). A new row arrives for the same wheel, serial NEW, fitted 1 Jun at 62,000 km. Then the same again but dated 1 Mar with odometer 39,000 (same day, lower meter) | first: OLD closed with removal 1 Jun, removal km 62,000, total 22,000, status Removed, one log row. Second: held as `ambiguous_same_day_stale` (meter below current fitment), nothing inserted | NOT RUN (the function writes to production even in the useful path). Verified by reading `_tyre_close_replaced`: removal date = greatest(new date, old date); removal km = new fitment km when above 1 and not below the old fitment; total via `tyre_km_life`; same-day branch returns `ambiguous_same_day_stale` for the three stale signals; `tyre_replacement_log` row written before the update. One gap noted: the closing total uses only the row's own vehicle type for the cap (blank on 86% of rows), not the fleet class. |

## G. Cost classification, warranty, repair

| ID | Inputs | Hand rule | Expected | Result |
|---|---|---|---|---|
| C23 | "TYRE 315/80R22.5 FOC WARRANTY REPLACEMENT"; a tyre with price source warranty and 40,000 km | warranty tyre costs zero, known, and has no CPK | detected; status CONFIRMED_ZERO; CPK null | JS and SQL detect; CONFIRMED_ZERO; null PASS |
| C23b | "TIRE -WARRENTY -315/80 R 22.5" (the ERP's own spelling, 2 live KSA lines) | still a warranty line | detected | **FAIL in JS `isTyreWarranty` and SQL `tyre_price_is_warranty` (both false)**. See ENG-6. |
| C24 | "Repair TIRE 315/80R22.5" as price evidence; "TYRE 315/80R22.5 BRIDGESTONE" | a repair is never a tyre price | repair true; plain tyre false; line kind repair | JS and SQL PASS |
| C24b | "TUBE 12.00R24", "TYRE FLAP 1200-24", "TYRE 12.00R24 WITH TUBE & FLAP" | tube and flap are spare parts; a combined line must be split | tube, flap, mixed; bucket spare | `tyreCostAudit.lineKind` PASS |
| C24c | the same words through the expense grid classifier (`classificationBrain.classifyLine`, mirror of the SQL trigger) | repair, retread, fitting and warranty must not be counted as tyre purchase spend | tube spare; repair not tyre | tube spare PASS; **repair, "RETREAD TYRE", "TYRE FITTING CHARGES" and the warranty line all return bucket tyre: FAIL**. See ENG-5. |
| C32 | line value 14,000 for qty 20; qty 0 | 14,000 / 20; no quantity, no unit price | 700; null | PASS |
| C33 | 1,000 SAR over 0 km; 733,308 over 55,560 m3 | zero denominator is unknown; 733,308 / 55,560 = 13.1985 | null; 13.1985 | PASS |

## H. Reliability, downtime, inspection

| ID | Inputs | Hand calculation | Expected | Result |
|---|---|---|---|---|
| C27 | asset X, job 1 08:00 to 14:00 (6 h), job 2 09:00 to next day 12:00 (27 h), job 3 still open | MTTR over closed jobs (6 + 27) / 2 | 16.5 h, open job excluded | `actualHoursByAsset` 16.5 PASS |
| C28 | asset X events on 1, 3 and 6 Jan | gaps 48 h and 72 h, mean 60 h | 60 h | `downtimeKpis.mtbeHours` 60 PASS |
| C28b | one tyre event with no job card and no risk rating | there is no measured downtime, so hours must be unknown | null | **2 hours FAIL** (assumed 2 h per event). See ENG-7. |
| C30 | one tyre row with no rating, no km, no price | failure rate, average life, availability, fleet CPK are all unknown | null for all four | PASS |
| C30b | vendor score for a brand with no rating and no km | quality unknown, not perfect | failure rate null | **0 with a positive score 0.3 FAIL**. See ENG-8. |
| C30c | downtime impact for one fitment row | no downtime recorded | null | **2 hours FAIL** (assumption times row count). See ENG-7. |
| C31 | one vehicle, pressures 100, 100, 100, 100, 80 psi | median 100; 80 is 20% off, tolerance 15% | 4 of 5 = 80% | PASS |
| C31b | one vehicle, all four tyres at 60 psi where 120 is required | all under-inflated by half | must not read 100% compliant | **100% FAIL**: the measure is consistency around the vehicle's own median. See ENG-9. |

## I. Live reconciliations (independent SQL versus the application RPC)

Run as a real KSA Manager (JWT claims set inside one SELECT, no role change, no write).

| Aggregate | Application figure | Independent SQL | Difference |
|---|---|---|---|
| KSA fleet tyre CPK, October 2026 (`get_fleet_cpk`, km side) | total km 9,457,022; tyre cost matched 215,219.70; total cost matched 281,193.69; CPK 0.0228; 299 cost assets, 137 measured | km rule and class cap written out by hand, grid cost by asset: 9,457,022; 215,219.70; 281,193.69; 0.0228; 299; 137 | none |
| KSA tyre spend, October 2026 (grid) | `get_fleet_cpk.fleet.tyre_cost` 346,274.04; `get_cost_per_m3.total.tyre_cost` 346,274.04; internal cost 733,307.58 | `sum(tyre_cost)` 346,274.04; `sum(line_cost)` 733,307.58 | none |
| KSA tyres due (`get_tyre_running_life`, due only) | 358 | 358 (rule rebuilt in plain SQL) | none. With the T7 km rule applied to the baseline the count is 385 (27 tyres not flagged today, see ENG-2). |

The RPC arithmetic reconciles exactly. The findings are about what is being divided by what, not about
arithmetic errors.
