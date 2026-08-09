-- V488 TYRE RUNNING LIFE - "how far has each tyre run and how much is left"
-- STATUS: APPLIED LIVE (2026-08-09) via Supabase MCP.
--
-- One SECURITY INVOKER aggregate powering the "Running & Remaining" section on
-- /tyre-lifecycle. Per ACTIVE tyre it returns BOTH meters:
--   km side    : km_at_fitment vs the asset's current_km (telematics/meter-log
--                fed) -> km_run; expected life = the avg total_km of REMOVED
--                tyres of the same country+size (a measured baseline, never a
--                constant) -> remaining_km + life_used_pct, with the baseline
--                sample size so a thin baseline is visible.
--   hours side : engine-hours reading at/before fitment vs the latest reading
--                -> hours_run (no removed-tyre hours history exists, so there
--                is deliberately NO invented hours baseline).
-- Every figure is null when not computable (fitment km missing/placeholder 1,
-- meter behind fitment, no baseline) - honest N/A, never a fabricated number.
-- INVOKER: RLS (org + country + site) scopes every read to the caller.
--
-- Verify: select get_tyre_running_life('KSA') -> rows with km_run/remaining_km.
-- Rollback: drop function public.get_tyre_running_life(text);

create or replace function public.get_tyre_running_life(p_country text default null)
returns jsonb
language sql
stable
set search_path = public
as $$
with active as (
  select t.id, t.country, t.site, t.asset_no, t.serial_no, t.tyre_position,
         t.brand, t.size, t.issue_date, t.km_at_fitment,
         f.current_km, f.vehicle_type
  from tyre_records t
  left join vehicle_fleet f
    on f.country = t.country and f.asset_no = t.asset_no
   and f.organisation_id = t.organisation_id
  where t.status = 'Active'
    and (p_country is null or t.country = p_country)
),
baseline as (
  select country, size,
         round(avg(total_km)) as avg_life_km,
         count(*) as sample
  from tyre_records
  where coalesce(status,'') <> 'Active'
    and total_km between 1000 and 400000
    and size is not null
    and (p_country is null or country = p_country)
  group by 1, 2
),
enriched as (
  select a.*,
         b.avg_life_km, b.sample as life_sample,
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
              then a.current_km - a.km_at_fitment end as km_run
  from active a
  left join baseline b on b.country = a.country and b.size = a.size
)
select jsonb_build_object(
  'ok', true,
  'generated_at', now(),
  'country', p_country,
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
      'km_at_fitment', km_at_fitment,
      'current_km', current_km,
      'km_run', km_run,
      'hours_at_fitment', hours_at_fitment,
      'current_hours', current_hours,
      'hours_run', case when hours_at_fitment is not null and current_hours is not null
                         and current_hours > hours_at_fitment
                        then round(current_hours - hours_at_fitment) end,
      'expected_life_km', avg_life_km,
      'life_sample', life_sample,
      'remaining_km', case when km_run is not null and avg_life_km is not null
                           then greatest(avg_life_km - km_run, 0) end,
      'life_used_pct', case when km_run is not null and avg_life_km is not null and avg_life_km > 0
                            then least(round(km_run * 100.0 / avg_life_km), 999) end
    ) order by
      case when km_run is not null and avg_life_km is not null
           then greatest(avg_life_km - km_run, 0) end asc nulls last,
      asset_no, tyre_position)
    from (select * from enriched limit 6000) e), '[]'::jsonb)
);
$$;

revoke all on function public.get_tyre_running_life(text) from public;
revoke all on function public.get_tyre_running_life(text) from anon;
grant execute on function public.get_tyre_running_life(text) to authenticated;
