# ENGINEERING2, round 2 report (2026-11-15)

Branch `claude/engineering-accuracy-7rxp2t` (draft PR #513), `origin/main` merged in cleanly.
Production: SELECT only (aggregates and function text). Nothing applied, nothing pushed.
Full detail: `ENGINEERING_FIXES.md`, section "Round 2".

## Files changed
- New draft: `supabase/pending_migrations/20261113125000_eng6_vehicle_km_ignores_placeholder_odometer.sql`.
- Drafts 120000 to 124000: round 2 status header; 124000 groups the spend breakdown by currency.
- `supabase/pending_migrations/README.md`: order and status of the six engineering drafts.
- New tests: `supabase/tests/fixtures/eng_golden_fixture.json`, `supabase/tests/staging/` (apply script,
  library, golden SQL, 23 staging tests), `src/test/engGoldenFixture.test.js` (110),
  `src/test/engGoldenSqlParity.test.js` (14). `supabase/tests/eng_calculation_cases.test.mjs`: comment only.
- Docs: `ENGINEERING_FIXES.md` (Round 2), this file. No application source file changed.

## Tests run
- Staging (PostgreSQL 16, production schema, synthetic companies): 23 of 23.
- Golden JS: 110 of 110. JS against SQL on staging: 14 of 14, 0 mismatches.
- PGlite: 10 of 10. Related vitest: 35 files, 546 tests passed. ESLint 0 errors. `vite build` clean.

## Proven on synthetic staging only
- All six drafts run in order with no error on the production function text.
- Draft 120000 (never executed before): named metrics return the documented definitions; old callers
  keep every key; only km `cpk_total` becomes null; no row of any table changes (hash); currencies
  are never blended; unmeasurable is NULL, not 0.
- C20b, C23b, C29: fail before, pass after, on stored rows through the real functions.
- C22: passes through the real import path with all triggers on, including undo.
- Golden set: lifetime against fitment CPK, placeholder km, class caps, double active wheel, one
  price per tyre, warranty zero, repair is not a price, life bands for km and hours, measured against
  assumed downtime (JS only: no SQL function measures downtime).

## Not tested
- Anything on production (blocked until the owner approves the apply). No browser. No timing at scale.

## Defects found
- R2-D1 (fixed in draft 125000, staging verified): vehicle km counts the placeholder odometer 1.
  Production vehicle km is overstated 4.7% KSA and 7.2% UAE, so cost per vehicle km is understated.
- R2-D2 (open): a LOW LOADER TRAILER gets the 15,000 km wheel loader life cap, in JS and SQL alike.
  No such type in production today.
- R2-D3 (open): `calc_cpk` cannot apply class caps, so `v_tyre_master` and `get_country_kpi` still
  price mixer and pump tyres that ran past their class cap.

## Impact
- Current company: nothing changes until drafts are applied. After apply: km total disappears from
  `get_fleet_cpk` (web already hides it); cost per vehicle km rises about 5% KSA and 8% UAE (125000);
  41 more KSA tyres read due (121000); 90 KSA and 16 UAE placeholder rows lose a row CPK (122000).
- Commercial: one definition per metric, proven equal in JS and SQL on a shared fixture, is something a
  buyer can audit. R2-D2 matters for a customer that runs low loader trailers.

## Migration order and dependencies
120000, 121000, 122000, 123000, 124000, 125000. None depends on a table change. 120000 and 125000 both
move "cost per vehicle km": apply together. Not dependent on any other stream's draft.

## Rollback
Each draft saves the replaced definition in `_bak.fn_defs_eng_20261113`; re-run the saved text.
The registry row is saved there too. `get_tyre_spend_breakdown` is new and can be left unused.

## Remaining risks
- Staging data is synthetic; production shape was mirrored, not copied.
- The AI orchestrator tool text still describes a km total (edge function, not in this stream).
- `get_fleet_cpk` and `get_cost_cpk_overview` still take no account of the caller's country scope inside
  the definer body beyond the existing guards (known, unchanged).

## Questions for the owner
1. Apply the six drafts to production, in order? Users should be told first that cost per vehicle km
   rises about 5% (KSA) and 8% (UAE) and that the CPK Intelligence headline changes.
2. R2-D2: should a low loader trailer (and any other road trailer with LOADER in its name) use the
   100,000 km cap?
3. R2-D3: may `calc_cpk` take the vehicle type, so the tyre master view and the country KPI apply the
   class caps (more rows would show N/A)?
