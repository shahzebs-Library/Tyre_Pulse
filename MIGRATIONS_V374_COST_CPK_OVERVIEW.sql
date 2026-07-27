-- V374 - one call behind the Expenses and CPK page: real spend, cost per
-- kilometre, period-on-period comparison, and what moved.
--
-- Applied live 2026-07-27 (v374a..v374e). This file is the record.
--
-- =========================================================================
-- V374a. Fleet running kilometres, derived from meter readings already in the
-- tyre records.
--
-- WHY THIS EXISTS: odometer_logs and engine_hours_logs are both EMPTY (0 rows).
-- Every cost-per-kilometre figure in the app has therefore read N/A since the
-- day it was built. But the fleet HAS been recording odometers all along, in a
-- column nobody read for this: tyre_records.km_at_fitment and km_at_removal are
-- the asset's odometer at the moment a tyre was fitted or pulled. That is 10,390
-- real readings across 516 assets and 22 months.
--
-- It is a sparse series, not telemetry, so the function is deliberately honest
-- about its own limits:
--   * an asset counts only when it has TWO readings inside the window
--   * a future-dated reading is dropped (the data holds a 2026-11-10 typo)
--   * a backwards or implausible run is dropped rather than clamped, because a
--     meter reset is not distance travelled; the ceiling scales with the window
--     at 30,000 km per 30 days
--   * it returns the ASSET LIST, so callers can report coverage instead of
--     dividing whole-fleet spend by part-fleet distance
-- =========================================================================
create or replace function public.fleet_km_by_asset(
  p_org uuid, p_country text, p_from date, p_to date)
returns table (country text, asset_no text, km_run numeric, readings bigint)
language sql stable parallel safe set search_path to 'public' as $$
  with m as (
    select t.country, upper(btrim(t.asset_no)) as asset_no,
           t.fitment_date as d, t.km_at_fitment as km
      from public.tyre_records t
     where t.organisation_id = p_org
       and t.km_at_fitment > 0 and t.fitment_date is not null
       and t.fitment_date <= current_date
       and coalesce(btrim(t.asset_no), '') <> ''
       and (p_country is null or t.country = p_country)
       and (p_from is null or t.fitment_date >= p_from)
       and (p_to   is null or t.fitment_date <= p_to)
    union all
    select t.country, upper(btrim(t.asset_no)), t.removal_date, t.km_at_removal
      from public.tyre_records t
     where t.organisation_id = p_org
       and t.km_at_removal > 0 and t.removal_date is not null
       and t.removal_date <= current_date
       and coalesce(btrim(t.asset_no), '') <> ''
       and (p_country is null or t.country = p_country)
       and (p_from is null or t.removal_date >= p_from)
       and (p_to   is null or t.removal_date <= p_to)
  ), spans as (
    select m.country, m.asset_no, max(m.km) - min(m.km) as km_run, count(*) as readings
      from m group by m.country, m.asset_no having count(*) > 1
  )
  select s.country, s.asset_no, s.km_run, s.readings
    from spans s
   where s.km_run > 0
     and s.km_run <= 30000 * greatest(1,
           ceil((coalesce(p_to, current_date) - coalesce(p_from, current_date - 365))::numeric / 30));
$$;

comment on function public.fleet_km_by_asset(uuid, text, date, date) is
  'Measured km per asset in a window, from tyre-record odometer readings. Sparse by nature - always report coverage alongside it.';

revoke all on function public.fleet_km_by_asset(uuid, text, date, date) from public, anon;
grant execute on function public.fleet_km_by_asset(uuid, text, date, date) to authenticated;

-- =========================================================================
-- V374b..e. get_cost_cpk_overview - the page's single call.
--
-- THREE THINGS IT REFUSES TO DO:
--  1. It never adds SAR, AED and EGP together. With no country chosen it still
--     returns figures but sets blended = true and currency = null, so the caller
--     must present them per country. Every cross-country total in this system
--     has been a bug.
--  2. It never divides whole-fleet spend by part-fleet distance. Cost per km is
--     computed on the MATCHED SET - assets with measured km in the window - and
--     reports coverage_pct beside it.
--  3. It returns null, not zero, when a denominator is missing. A fleet with no
--     measured distance has an unknown cost per km, not a cost per km of zero.
--
-- TWO DEFECTS FIXED AFTER THE FIRST LIVE RUN, both worth remembering:
--  * WINDOW COLLISION (v374c). The three windows were classified in one CASE, so
--    on the default twelve-month range - where the previous window and the
--    same-period-last-year window are the SAME dates - the CASE matched 'prev'
--    first and last year reported spend 0 and cpk 0.000 beside an identical
--    previous window reporting 55,216. Each window is now aggregated
--    independently. `previous_is_last_year` tells the page not to draw the same
--    bar twice.
--  * A COMPARISON NOBODY COULD TRUST (v374c). The first run showed KSA cost per
--    km falling from 1.893 to 0.225, which reads as an eight-fold improvement
--    and is nothing of the sort: the tyre records hold 14 odometer readings from
--    2024 against 5,712 from 2025, so the old window measured 5 assets and the
--    new one 341. Every cpk block now carries coverage_pct and a `comparable`
--    flag, false below MIN_COVERAGE (0.25). A figure the data cannot support has
--    to announce that itself.
--
-- Live: KSA 2025-08..2026-07 returns cpk 0.225 SAR/km at 68.6% coverage
-- (comparable), against a previous window at 0.73% coverage (not comparable).
-- Full call 1.09 s.
-- =========================================================================
-- See the live database for the full bodies of:
--   public.get_cost_cpk_overview(text, text, date, date)   -- the entry point
--   public._cost_totals(uuid, text, text, date, date)      -- spend split, one window
--   public._cost_cpk(uuid, text, text, date, date, numeric)-- cpk + coverage, one window
--   public._cost_dim(uuid, text, text, date, date, date, date, text)
--
-- _cost_dim note (v374e): it read parts_consumption twice per dimension, once
-- per window, and joined. Five dimensions meant ten scans and 1.76 s for a full
-- year. Conditional aggregation gets both windows from ONE scan (1.09 s) with an
-- identical row set - a label present in only one window still appears, because
-- a cost line that STOPPED is as interesting as one that grew. Live proof:
-- MISK-ST shows 65,790 previous against 0 current.
--
-- p_dim is never user input. The caller passes one of a fixed set of column
-- names and anything else returns empty before reaching format().
--
-- All four helpers are SECURITY DEFINER and org-scoped via app_current_org();
-- the three underscore-prefixed ones are revoked from authenticated so only the
-- entry point can reach them.
--
-- =========================================================================
-- CLIENT SIDE
--   src/lib/costCpk.js                          pure maths + the rules (28 tests)
--   src/lib/api/partsConsumption.js             getCostCpkOverview()
--   src/components/expense/CostCpkPanels.jsx    the panels (8 tests)
--   src/pages/ExpenseReport.jsx                 route /expense-report, nav "Expenses & CPK"
--
-- The page is the one place these figures live. Do NOT add a second cost surface:
-- the period bar drives every panel, so nothing on screen compares different spans.
-- =========================================================================

