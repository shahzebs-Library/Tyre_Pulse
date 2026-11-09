# Phase 1 - physical tyre lifetime and lifetime CPK (2026-11-09)

Branch `claude/tyre-lifetime-cpk-phase1` (from main `6ae975a4`). Not merged.

## What changed
- **Database (applied live, additive only - no existing function, view or row replaced):**
  - `20261109160000` `v_tyre_lifetime_fitments`, `v_tyre_lifetime`, `get_tyre_lifetime_cpk(country, from, to, site)`.
  - `20261109170000` `tyre_price_provenance` (428 moved prices: 417 own job card, 11 comparable estimates) and
    `v_tyre_lifetime` re-created with the same columns so a moved estimate stays ESTIMATED.
- **Web:** one shared layer (`src/lib/tyreLifetime.js`) mirroring the database; ~45 helpers moved onto it
  (see CALCULATION_SOURCE_MAP.md); new "Tyre lifetime" tab on CPK Intelligence.
- **Mobile (Expo):** AI context and Overview count each tyre's purchase once and never label AED/EGP as SAR.
  Needs an EAS build to reach phones (none triggered).
- **Rules added:** T17 cost status, T18 overlapping fitments not double counted, T19 five named CPK measurements.

## Before vs after (live, all dates, purchase-only lifetime CPK of FINAL tyres)
| Country | Current Fleet CPK (`get_fleet_cpk`, unchanged) | km behind it | New lifetime CPK | Validated km | Measurable / final tyres | Estimated share of the cost |
|---|---|---|---|---|---|---|
| KSA | 0.0057 SAR | 455,724,885 | 0.025542 SAR | 98,930,704 | 2,504 / 5,230 | 37% (925,973 of 2,526,847) |
| UAE | 0.0306 AED | 44,463,424 | 0.015713 AED | 5,395,958 | 118 / 768 | 0% |
| Egypt | 0.4021 EGP | 7,371,872 | 0.382049 EGP | 1,307,009 | 36 / 93 | 0% |

**Why they differ (they are different measurements, T19):** the current figure divides tyre expense from the
expense lines by raw `total_km` summed per fitment row. That km has no T7 rule (a placeholder fitment `1` turns the
vehicle odometer into tyre life; no class cap) and counts overlapping duplicate stints. The new figure is each
physical tyre's purchase price once over validated km of its non-overlapping fitments. The current function keeps its
production answer until the new figure is independently verified.

Still-fitted (provisional, life so far): KSA 2,605 tyres at 0.022448, UAE 1,365 at 0.018268, Egypt 414 at 0.537786.

## Findings that surfaced
- **560 overlapping fitments** (a stint starting before an earlier stint of the same tyre ended); 183 are duplicate rows
  with identical meter readings. Their km is excluded (T18) and the tyres show partial coverage. KSA 285 tyres,
  UAE 165, Egypt 67. Listed for review in Phase 4 (data reconciliation); not modified.
- **11 estimated prices (SAR 9,766) read ACTUAL** after the #470 old-tyre fix moved them; fixed by 170000.
- **Repairs / retreads / recoveries:** `tyre_service_events`, `retread_jobs`, `retread_claims`, `warranty_claims` are all
  empty, so full lifetime CPK = purchase-only CPK today. Unlinked tyre repair lines in the expense grid: KSA 18
  (7,200 SAR), Egypt 33 (148,339.49 EGP). Not attributed to any tyre.
- **K507B403860** shows DISPUTED (priced on 2 fitments); untouched, first price used, as protected.

## Verification
- Database vs web parity on live Egypt (591 rows -> 507 tyres): tyres, km 1,667,035, cost 5,893,603.79, overlap
  tyres 67, unknown-km fitments 74, coverage none/complete/partial 442/31/34, ACTUAL/MISSING 404/103, active 414,
  provisional 481 - identical.
- Country isolation: a KSA-only Manager sees only KSA; asking for UAE returns nothing.
- `tyre_records` fingerprint unchanged after both migrations (11,410 `7723a9af...`).
- Rollback test: `docs/tyre/rollback_test_phase1.sql` (one aborted transaction) - see PR for the result.

## Rollback
1. `drop function if exists public.get_tyre_lifetime_cpk(text, date, date, text);`
2. `drop view if exists public.v_tyre_lifetime; drop view if exists public.v_tyre_lifetime_fitments;`
3. `drop table if exists public.tyre_price_provenance;`
4. `git revert` the branch commits (web/mobile). No business data was changed, so nothing else to restore.
