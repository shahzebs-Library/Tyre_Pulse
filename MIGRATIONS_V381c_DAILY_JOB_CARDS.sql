-- V381c. The daily job card picture for the front page.
--
-- Built on the availability cycle the job card export brings in, so it can
-- separate the two halves of downtime that were previously indistinguishable:
--   waiting  = Production Out to Workshop In   (the asset is down, nobody has
--              started on it - usually the bigger and more fixable number)
--   repair   = Workshop In to Workshop Out     (actual work)
--
-- "Still out" counts assets that left production and have not returned. That is
-- the number a plant manager actually needs at 7am, and nothing in the app
-- showed it before.
create or replace function public.get_daily_job_cards(
  p_country text default null,
  p_on      date default null)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_org uuid := public.app_current_org();
  v_day date := coalesce(p_on, current_date);
  v_cur text;
  result jsonb;
begin
  if v_org is null or not public.app_is_active() then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  v_cur := case when p_country is null then null
                else public.currency_for_country(p_country) end;

  with wo as (
    select * from public.work_orders
     where organisation_id = v_org
       and (p_country is null or country = p_country)
  ), today as (
    select * from wo
     where (opened_at    >= v_day and opened_at    < v_day + 1)
        or (completed_at >= v_day and completed_at < v_day + 1)
  ), still_out as (
    -- left production and not back. No date filter: an asset out since March is
    -- exactly what this panel exists to surface.
    select * from wo
     where production_out_at is not null
       and production_in_at is null
       and coalesce(status, '') not in ('Cancelled')
  ), closed_today as (
    select * from wo
     where completed_at >= v_day and completed_at < v_day + 1
  )
  select jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'day', v_day,
    'country', p_country,
    'currency', v_cur,
    'kpis', jsonb_build_object(
      'opened_today',   (select count(*) from wo where opened_at >= v_day and opened_at < v_day + 1),
      'closed_today',   (select count(*) from closed_today),
      'breakdowns_today',(select count(*) from wo
                           where opened_at >= v_day and opened_at < v_day + 1
                             and work_type = 'Emergency'),
      'scheduled_today',(select count(*) from wo
                           where opened_at >= v_day and opened_at < v_day + 1
                             and work_type = 'Preventive Maintenance'),
      'still_out',      (select count(*) from still_out),
      'still_out_assets',(select count(distinct asset_no) from still_out),
      -- null, not zero, when nothing closed today: an average of no jobs is
      -- unknown, and zero would read as instant turnaround
      'avg_wait_hours', (select round(avg(extract(epoch from (started_at - production_out_at))/3600)::numeric, 2)
                           from closed_today
                          where started_at is not null and production_out_at is not null
                            and started_at >= production_out_at),
      'avg_repair_hours',(select round(avg(extract(epoch from (completed_at - started_at))/3600)::numeric, 2)
                           from closed_today
                          where completed_at is not null and started_at is not null
                            and completed_at >= started_at),
      'longest_out_hours',(select round(max(extract(epoch from (now() - production_out_at))/3600)::numeric, 1)
                             from still_out)
    ),
    -- what is down right now, worst first. This is the actionable list.
    'still_out_list', (select coalesce(jsonb_agg(x order by x.hours_out desc), '[]'::jsonb) from (
        select work_order_no, asset_no, plate_no, asset_category, site, work_type, status,
               coalesce(description, notes) as complaint,
               round(extract(epoch from (now() - production_out_at))/3600::numeric, 1) as hours_out,
               (started_at is null) as not_started
          from still_out
         order by production_out_at asc
         limit 25) x),
    'today_list', (select coalesce(jsonb_agg(x order by x.opened_at desc), '[]'::jsonb) from (
        select work_order_no, asset_no, plate_no, site, work_type, status,
               coalesce(description, notes) as complaint,
               opened_at, completed_at, breakdown_hours
          from today
         order by opened_at desc nulls last
         limit 25) x),
    'by_type', (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (
        select coalesce(nullif(btrim(work_type), ''), 'Unspecified') as label, count(*) n
          from today group by 1) x),
    'by_site', (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (
        select coalesce(nullif(btrim(site), ''), 'Unspecified') as label, count(*) n
          from still_out group by 1) x)
  ) into result;

  return result;
end $$;

revoke all on function public.get_daily_job_cards(text, date) from public, anon;
grant execute on function public.get_daily_job_cards(text, date) to authenticated;
