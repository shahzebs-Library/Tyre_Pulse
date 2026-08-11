-- NUMBERING NOTE: this file was written as V513 while V513 was being used at the
-- same time for the tyre re-import duplicate removal. Both applied cleanly - the
-- database keys migrations on a timestamp, not on the V-label - so the clash was
-- only ever in the repo file names. Renamed to V515 so the labels stay unique.
-- The applied names in supabase_migrations remain v513_tyre_consumption and
-- v513b_tyre_consumption_index_usable_join. Next free label is V516.
--
-- V515 - TYRE CONSUMPTION (how many tyres are fitted, and the daily rate)
-- STATUS: APPLIED LIVE on project jhssdmeruxtrlqnwfksc.
--
-- WHY THIS EXISTS
-- The owner asked "how many tyres do we use, daily average". tyre_records is the
-- fitment record and IS authoritative for COUNTS (it is never authoritative for
-- money - that stays with the expense grid). This function answers the count
-- question server-side so the browser never pages 11,132 rows to count them.
--
-- THE MEASUREMENT THAT SHAPED THE DESIGN (run before writing a line of this):
--   * Uploads arrive in BATCHES: KSA 2026 has 2,172 fitments loaded on only 8
--     distinct created_at days - but those rows carry 214 distinct issue_dates,
--     and ZERO rows have created_at::date = issue_date. So the fitment date is a
--     real business date, NOT an upload artifact, and a daily rate derived from
--     issue_date is legitimate. This function therefore reports one.
--     `upload_days` / `fit_days` / `same_day_pct` are returned so a reader can
--     re-check that claim instead of taking it on trust.
--   * KSA Feb-Aug 2026: 184 of 191 calendar days carry a fitment, mean 10.6/day,
--     median 10, max 31 (CV 0.48). That is a genuine daily cadence, not a spike.
--   * site is NULL on 85% of recent KSA tyre_records and vehicle_type on 98%.
--     Both are 100% present on the ASSET. So site and class are read THROUGH the
--     asset (tyre -> vehicle_fleet), which is the same standing rule the expense
--     side already follows. Coverage is returned so a partial join is visible.
--
-- SECURITY: mirrors get_site_operating_cost exactly - SECURITY DEFINER, org from
-- app_current_org(), country checked with app_can_see_country, search_path pinned,
-- granted to authenticated + service_role, revoked from PUBLIC then from anon BY
-- NAME (revoking PUBLIC alone does not clear the anon grant Supabase adds at
-- CREATE time - the V500 lesson).
--
-- A STABLE function may not create a temp table; the row set is built once with
-- `with ... as materialized` and referenced by every branch below it.
--
-- ROLLBACK: drop function public.get_tyre_consumption(text, date, date);

create or replace function public.get_tyre_consumption(
  p_country text default null,
  p_from    date default null,
  p_to      date default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_org uuid := public.app_current_org();
  v_to   date;
  v_from date;
  v_cal_days int;
  v_result jsonb;
begin
  if v_org is null then
    return jsonb_build_object('ok', false, 'reason', 'no_org');
  end if;
  if p_country is not null and not public.app_can_see_country(p_country) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- A rate needs a bounded window; an unbounded "all time" average is meaningless.
  -- The end is clamped to today so a stray future-dated row can never inflate the
  -- denominator with days that have not happened yet (the work_orders.opened_at
  -- trap, applied defensively here).
  v_to   := least(coalesce(p_to, current_date), current_date);
  v_from := coalesce(p_from, v_to - 89);
  if v_from > v_to then
    return jsonb_build_object('ok', false, 'reason', 'empty_period');
  end if;
  v_cal_days := (v_to - v_from) + 1;

  with fitments as materialized (
    select
      t.issue_date,
      upper(btrim(coalesce(t.asset_no, ''))) as asset_no,
      t.country,
      t.created_at::date                     as upload_day,
      -- site and class come from the ASSET, falling back to whatever the tyre row
      -- itself carries. Neither is invented: a row that resolves to nothing is
      -- counted as unresolved rather than bucketed under a guessed name.
      coalesce(nullif(btrim(f.site), ''), nullif(btrim(t.site), ''))                 as site,
      coalesce(nullif(btrim(f.vehicle_type), ''), nullif(btrim(t.vehicle_type), '')) as vehicle_type
    from public.tyre_records t
    -- The PROBE side is normalised, the STORED side is compared raw, so the
    -- (organisation_id, country, asset_no) index is usable. That is only sound
    -- because V490 normalised asset codes to upper/no-whitespace on both tables
    -- and enforces it with triggers - verified 0 off-canonical rows in both
    -- vehicle_fleet (1,617) and tyre_records (11,241) before making this change.
    -- Wrapping the stored column in upper(btrim()) instead costs a fleet scan per
    -- tyre row: measured 454 ms / 23,925 buffers against 24 ms / 4,900 for a
    -- 90-day KSA window.
    left join lateral (
      select vf.site, vf.vehicle_type
      from public.vehicle_fleet vf
      where vf.organisation_id = t.organisation_id
        and vf.asset_no = upper(btrim(coalesce(t.asset_no, '')))
        and (vf.country is null or vf.country = t.country)
      order by (vf.country = t.country) desc nulls last
      limit 1
    ) f on true
    where t.organisation_id = v_org
      and (p_country is null or t.country = p_country)
      and t.issue_date >= v_from
      and t.issue_date <= v_to
  ),
  -- Rows that carry no fitment date at all cannot enter a dated period and are
  -- reported separately, so "we have 184 tyres we cannot date" never silently
  -- reads as "we fitted 184 fewer tyres".
  undated as (
    select count(*) n from public.tyre_records t
    where t.organisation_id = v_org
      and (p_country is null or t.country = p_country)
      and t.issue_date is null
  ),
  by_day as (
    select issue_date d, count(*) n from fitments group by 1
  ),
  totals as (
    select
      (select count(*) from fitments)                          as fitments,
      (select count(*) from by_day)                            as active_days,
      (select count(distinct asset_no) from fitments
         where asset_no <> '')                                 as assets,
      (select count(distinct upload_day) from fitments)        as upload_days,
      (select count(distinct issue_date) from fitments)        as fit_days,
      (select count(*) from fitments
         where upload_day = issue_date)                        as same_day
  ),
  months as (
    select
      to_char(date_trunc('month', d), 'YYYY-MM') as m,
      sum(n)::int   as n,
      count(*)::int as active_days,
      -- Elapsed calendar days of THAT month inside the window. The current month
      -- is partial, so dividing its count by 30 or 31 would understate the rate.
      (least((date_trunc('month', d) + interval '1 month - 1 day')::date, v_to)
       - greatest(date_trunc('month', d)::date, v_from) + 1)::int as cal_days
    from by_day
    group by date_trunc('month', d)
  ),
  site_rows as (
    select coalesce(site, 'Not linked to a site') as k, count(*)::int n,
           count(distinct asset_no) filter (where asset_no <> '')::int assets,
           (site is not null) as resolved
    from fitments group by site
  ),
  class_rows as (
    select coalesce(vehicle_type, 'Class not recorded') as k, count(*)::int n,
           count(distinct asset_no) filter (where asset_no <> '')::int assets,
           (vehicle_type is not null) as resolved
    from fitments group by vehicle_type
  )
  select jsonb_build_object(
    'ok', true,
    'from', v_from,
    'to', v_to,
    'country', p_country,
    'calendar_days', v_cal_days,
    'fitments',    (select fitments from totals),
    'active_days', (select active_days from totals),
    'assets',      (select assets from totals),
    'undated',     (select n from undated),
    -- The evidence for "these dates are real, not upload days". Kept in the
    -- payload so the screen can show the check rather than assert the conclusion.
    'batch_check', jsonb_build_object(
        'upload_days',  (select upload_days from totals),
        'fit_days',     (select fit_days from totals),
        'same_day',     (select same_day from totals)),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'n', n) order by d)
                        from by_day), '[]'::jsonb),
    'by_month', coalesce((select jsonb_agg(jsonb_build_object(
                            'm', m, 'n', n, 'active_days', active_days, 'cal_days', cal_days)
                          order by m) from months), '[]'::jsonb),
    'by_site', coalesce((select jsonb_agg(jsonb_build_object(
                            'k', k, 'n', n, 'assets', assets, 'resolved', resolved)
                          order by n desc) from site_rows), '[]'::jsonb),
    'by_class', coalesce((select jsonb_agg(jsonb_build_object(
                            'k', k, 'n', n, 'assets', assets, 'resolved', resolved)
                          order by n desc) from class_rows), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

comment on function public.get_tyre_consumption(text, date, date) is
  'Tyre fitment COUNTS and daily rate for a bounded period. Counts only - never a '
  'money source. Site and class are resolved through the asset (vehicle_fleet), '
  'with coverage reported. Returns the upload-day vs fitment-day check so a reader '
  'can verify the dates are real business dates and not batch-upload artifacts.';

grant execute on function public.get_tyre_consumption(text, date, date)
  to authenticated, service_role;
revoke execute on function public.get_tyre_consumption(text, date, date) from public;
revoke execute on function public.get_tyre_consumption(text, date, date) from anon;
