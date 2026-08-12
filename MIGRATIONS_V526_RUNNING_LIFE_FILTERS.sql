-- V526 - the running-life read was fetching 7.7x what it kept
-- STATUS: APPLIED LIVE 2026-08-12 (migration v526_running_life_filters)
--
-- WHAT WAS WRONG
--   get_tyre_running_life answers one question - "per active tyre, how much life
--   is left" - and V523 taught it to page, which fixed the browser dropping the
--   2.2 MB response. It did not make the read smaller, and two of its callers
--   never wanted the whole set:
--
--     src/pages/Inspections.jsx, flag-map effect
--       pulls every row on mount and hands it to buildAssetFlagMap, which KEEPS
--       ONLY the rows that are overdue or due soon and discards the rest.
--
--     src/pages/Inspections.jsx, row PDF export (and the checklist PDF)
--       pulls every row, then filters to ONE asset.
--
--   So the page paid for the whole country on every load, and again on every
--   single PDF export, to keep a fraction of it. That is the speed complaint.
--
-- MEASURED, LIVE, BEFORE THE CHANGE
--   KSA      3,595 active tyres      465 overdue or due soon    (12.9%)
--   UAE      1,388                   168
--   Egypt      429                     0
--   One KSA asset (TM335)               12 tyres
--
--   Payload, KSA:  everything 2,190 kB | due only 285 kB | one asset 7,639 bytes
--
-- WHAT THIS DOES
--   Two new parameters, both defaulting to today's behaviour:
--     p_asset    text    - only that asset's tyres. A PURE FILTER: asset codes
--                          are canonical UPPER (V490) so exact equality is the
--                          whole rule. No normalising, no fuzzy match.
--     p_due_only boolean - only rows whose band is overdue or due-soon.
--
--   Verified after applying:
--     one signature only .................. get_tyre_running_life(text,integer,integer,text,boolean)
--     1-arg call still resolves ........... KSA total 3,595
--     3-arg call still resolves ........... KSA total 3,595
--     p_due_only => true .................. KSA total 465, rows 465
--     same 465 as filtering the full payload row by row (independent check)
--     p_asset => 'TM335' .................. 12 rows, 1 distinct asset
--     per-asset rows byte-identical to those rows inside the full payload
--
-- THE OVERLOAD TRAP - the reason for the DROP
--   Adding defaulted parameters creates a NEW signature and leaves the old
--   3-arg one in place. PostgREST then cannot choose between them and BOTH
--   shapes fail with 42725. This bit V520b/V520c and again in V523, so the old
--   signature is dropped in the same migration and exactly one now exists.
--
-- THE THRESHOLDS ARE WRITTEN TWICE, ON PURPOSE, AND GUARDED
--   The band rule lives in bandFor() in src/lib/tyreRunningLife.js and is
--   mirrored here so the server can apply it. The three numbers are exported
--   there as DUE_SOON_KM (10000) / DUE_SOON_HOURS (500) / LIFE_USED_DUE_PCT
--   (90), and src/test/tyreRunningLifeBands.test.js fails if any of them moves.
--   That test is the tripwire: CHANGE THE JS AND THIS SQL TOGETHER.
--
--   The rule, exactly as bandFor judges it:
--     judged on km when there is a remaining km;
--     an hours-only tyre falls through to its hours target;
--     due  = remaining 0, or remaining under the threshold, or life used >= 90%;
--     a tyre with neither remaining figure is 'unknown' and is NOT due.
--
-- DELIBERATELY NOT DONE
--   * p_asset is NOT applied to the `removed` CTE. That set is the fleet
--     baseline the expected life is measured from; narrowing it to one asset
--     would make that asset's expected life depend on how you asked for it.
--     Verified: a per-asset read returns rows byte-identical to the full one.
--   * `total` is the count of the FILTERED set, not of everything. The client
--     pages until it has `total` rows, so a filtered read must report its own
--     count or the loop would never terminate.
--   * p_limit still means "everything" when omitted (coalesce(p_limit, 6000)).
--     Capping it would make a stale client render a silent partial list with
--     wrong totals, which this codebase holds to be worse than an honest
--     failure. The honest fix for that remains getting clients onto a paged
--     build; this migration reduces how much there is to page.
--   * No new index. The cost here was response size and rows shipped to the
--     browser, not the scan.
--
-- ROLLBACK
--   Re-apply the V523 body (the same function without p_asset / p_due_only /
--   the judged+banded+scoped CTEs) and drop the 5-arg signature. Callers pass
--   the new arguments by name, so the old 3-arg function must come back at the
--   same time as the client is reverted.

drop function if exists public.get_tyre_running_life(text, integer, integer);

create or replace function public.get_tyre_running_life(
  p_country text default null,
  p_limit integer default null,
  p_offset integer default 0,
  p_asset text default null,
  p_due_only boolean default false
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
with active as (
  select t.id, t.country, t.site, t.asset_no, t.serial_no, t.tyre_position,
         t.brand, t.size, t.issue_date, t.km_at_fitment,
         f.current_km, coalesce(f.vehicle_type, t.vehicle_type) as vehicle_type
  from tyre_records t
  left join vehicle_fleet f
    on f.country = t.country and f.asset_no = t.asset_no
   and f.organisation_id = t.organisation_id
  where t.status = 'Active'
    and (p_country is null or t.country = p_country)
    -- Pure filter. Asset codes are canonical UPPER (V490), so an exact match is
    -- the whole rule; no normalising, no fuzzy match, no judgement.
    and (p_asset is null or t.asset_no = p_asset)
),
removed as (
  select t.country, t.size, t.total_km,
         coalesce(t.vehicle_type, f.vehicle_type) as vehicle_type,
         case when t.removal_date is not null and t.issue_date is not null
               and t.removal_date > t.issue_date
              then t.removal_date - t.issue_date end as life_days
  from tyre_records t
  left join vehicle_fleet f
    on f.country = t.country and f.asset_no = t.asset_no
   and f.organisation_id = t.organisation_id
  where coalesce(t.status,'') <> 'Active'
    and t.total_km between 1000 and 400000
    and t.size is not null
    and (p_country is null or t.country = p_country)
  -- NOTE: p_asset is deliberately NOT applied here. This is the fleet baseline
  -- the expected life is measured from; narrowing it to one asset would change
  -- that asset's expected life depending on how you asked for it.
),
base_size as (
  select country, public.tyre_size_key(size) as size_key, round(avg(total_km)) as avg_km, count(*) as sample,
         round(avg(life_days)) as avg_days, count(life_days) as day_sample
  from removed group by 1,2
),
base_type as (
  select country, public.tyre_size_key(size) as size_key, vehicle_type, round(avg(total_km)) as avg_km, count(*) as sample,
         round(avg(life_days)) as avg_days, count(life_days) as day_sample
  from removed where vehicle_type is not null group by 1,2,3
),
enriched as (
  select a.*,
         bs.avg_km as size_avg_km, bs.sample as size_sample,
         bs.avg_days as size_avg_days, bs.day_sample as size_day_sample,
         bt.avg_km as type_avg_km, bt.sample as type_sample,
         bt.avg_days as type_avg_days, bt.day_sample as type_day_sample,
         tg.target_km, tg.target_hours,
         public.cpk_unit_for_asset_type(a.vehicle_type) as unit,
         (select e.engine_hours from engine_hours_logs e
           where e.asset_no = a.asset_no and e.country = a.country
             and a.issue_date is not null and e.reading_date <= a.issue_date
           order by e.reading_date desc limit 1) as hours_at_fitment,
         (select e.engine_hours from engine_hours_logs e
           where e.asset_no = a.asset_no and e.country = a.country
           order by e.reading_date desc limit 1) as current_hours,
         case when a.km_at_fitment is not null and a.km_at_fitment > 1
               and a.current_km is not null and a.current_km > a.km_at_fitment
              then a.current_km - a.km_at_fitment end as km_run,
         case when a.issue_date is not null and a.issue_date <= current_date
              then current_date - a.issue_date end as days_on
  from active a
  left join base_size bs on bs.country = a.country and bs.size_key = public.tyre_size_key(a.size)
  left join base_type bt on bt.country = a.country and bt.size_key = public.tyre_size_key(a.size)
                        and bt.vehicle_type = a.vehicle_type and bt.sample >= 3
  left join lateral (
    select t.target_km, t.target_hours from tyre_life_targets t
    where (t.size is null or public.tyre_size_key(t.size) = public.tyre_size_key(a.size))
      and (t.vehicle_type is null or t.vehicle_type = a.vehicle_type)
      and (t.country is null or t.country = a.country)
    order by ((t.size is not null)::int + (t.vehicle_type is not null)::int) desc,
             (t.vehicle_type is not null) desc,
             (t.country is not null) desc
    limit 1
  ) tg on true
),
hours_calc as (
  select e.*,
         case when e.hours_at_fitment is not null and e.current_hours is not null
               and e.current_hours > e.hours_at_fitment
              then round(e.current_hours - e.hours_at_fitment) end as hours_run
  from enriched e
),
final as (
  select e.*,
         coalesce(e.target_km, e.type_avg_km, e.size_avg_km) as expected_km,
         case when e.target_km is not null then 'manual'
              when e.type_avg_km is not null then 'measured_type'
              when e.size_avg_km is not null then 'measured_size' end as life_basis,
         case when e.target_km is not null then null
              when e.type_avg_km is not null then e.type_sample
              else e.size_sample end as life_sample,
         coalesce(e.type_avg_days, e.size_avg_days) as expected_days,
         case when e.type_avg_days is not null then e.type_day_sample else e.size_day_sample end as day_sample
  from hours_calc e
),
-- MIRROR OF bandFor() IN src/lib/tyreRunningLife.js. The three figures below are
-- DUE_SOON_KM 10000 / DUE_SOON_HOURS 500 / LIFE_USED_DUE_PCT 90, exported there
-- as named constants and pinned by src/test/tyreRunningLifeBands.test.js.
-- CHANGE BOTH TOGETHER.
-- Judged on km when there is a km remaining; an hours-only tyre falls through to
-- its hours target. A row with neither is 'unknown' and is NOT due.
judged as (
  select f.*,
         case when f.km_run is not null and f.expected_km is not null
              then greatest(f.expected_km - f.km_run, 0) end as rem_km,
         case when f.km_run is not null and f.expected_km is not null and f.expected_km > 0
              then least(round(f.km_run * 100.0 / f.expected_km), 999) end as used_km_pct,
         case when f.hours_run is not null and f.target_hours is not null
              then greatest(round(f.target_hours - f.hours_run), 0) end as rem_hours,
         case when f.hours_run is not null and f.target_hours is not null and f.target_hours > 0
              then least(round(f.hours_run * 100.0 / f.target_hours), 999) end as used_hours_pct
  from final f
),
banded as (
  select j.*,
         case
           when j.rem_km is not null then
             (j.rem_km = 0 or j.rem_km < 10000 or (j.used_km_pct is not null and j.used_km_pct >= 90))
           when j.rem_hours is not null then
             (j.rem_hours = 0 or j.rem_hours < 500 or (j.used_hours_pct is not null and j.used_hours_pct >= 90))
           else false
         end as is_due
  from judged j
),
scoped as (
  select * from banded where (not coalesce(p_due_only, false)) or is_due
)
select jsonb_build_object(
  'ok', true,
  'generated_at', now(),
  'country', p_country,
  'asset', p_asset,
  'due_only', coalesce(p_due_only, false),
  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'serial_no', serial_no,
      'asset_no', asset_no,
      'position', tyre_position,
      'vehicle_type', vehicle_type,
      'unit', unit,
      'site', site,
      'country', country,
      'brand', brand,
      'size', size,
      'fitted_on', issue_date,
      'days_on', days_on,
      'expected_days', expected_days,
      'day_sample', day_sample,
      'remaining_days', case when days_on is not null and expected_days is not null
                             then greatest(expected_days - days_on, 0) end,
      'km_at_fitment', km_at_fitment,
      'current_km', current_km,
      'km_run', km_run,
      'hours_at_fitment', hours_at_fitment,
      'current_hours', current_hours,
      'hours_run', hours_run,
      'expected_life_km', expected_km,
      'expected_life_hours', target_hours,
      'remaining_hours', rem_hours,
      'hours_used_pct', used_hours_pct,
      'life_basis', life_basis,
      'life_sample', life_sample,
      'remaining_km', rem_km,
      'life_used_pct', used_km_pct
    ) order by rem_km asc nulls last, asset_no, tyre_position)
    -- The order lives INSIDE the sliced subquery: ordering only in jsonb_agg
    -- makes page 2 an arbitrary set (the V523 lesson).
    from (select * from scoped
            order by rem_km asc nulls last, asset_no, tyre_position
            limit coalesce(p_limit, 6000) offset coalesce(p_offset, 0)) e), '[]'::jsonb),
  -- total is the count of the FILTERED set, so the client's paging loop stops
  -- at the right place for a filtered read.
  'total', (select count(*) from scoped)
);
$function$;

-- SECURITY INVOKER (RLS governs). Grant order per the V500 lesson: grant, then
-- revoke PUBLIC, then revoke anon BY NAME - a bare revoke from anon is a no-op
-- against a PUBLIC grant, and revoking PUBLIC alone strips authenticated.
grant execute on function public.get_tyre_running_life(text, integer, integer, text, boolean) to authenticated, service_role;
revoke execute on function public.get_tyre_running_life(text, integer, integer, text, boolean) from public;
revoke execute on function public.get_tyre_running_life(text, integer, integer, text, boolean) from anon;
