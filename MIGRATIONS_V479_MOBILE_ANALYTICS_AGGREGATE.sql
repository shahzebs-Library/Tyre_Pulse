-- V479 - one server-side aggregate for the mobile analytics screen.
-- STATUS: APPLIED LIVE on project jhssdmeruxtrlqnwfksc (2026-08-04) and verified.
--
-- WHY
-- The phone paged the WHOLE tyre_records table into device memory and counted
-- the rows itself, plus the WHOLE vehicle_fleet purely to build a site
-- dropdown. On the 2GB handsets this fleet actually uses that made analytics
-- the slowest screen in the app and a real out-of-memory risk - the same class
-- of failure behind the native crashes in Play Console. Counting belongs here.
--
-- SECURITY INVOKER on purpose: org + country + site RLS keeps governing every
-- read exactly as before. This function grants no new visibility to anyone.
--
-- SUPERSEDES V478 get_mobile_kpis, which is DROPPED below. V478 was applied
-- earlier the same day and never consumed by shipped client code, so there is
-- ONE mobile aggregate rather than two that can drift apart. There is
-- deliberately no repo file for V478.
--
-- CURRENCY RULE (the reason the cost columns are nullable)
-- SAR, AED and EGP are never summed. When no single country is in scope every
-- cost comes back NULL and the phone shows 'N/A' and ranks by volume, rather
-- than printing a confident blended total.
--
-- ROLLBACK
--   drop function if exists public.get_mobile_analytics(text, date, date, text);
-- (re-create V478 get_mobile_kpis from git history if the old client is redeployed)

drop function if exists public.get_mobile_kpis(text);

create or replace function public.get_mobile_analytics(
  p_country text default null,
  p_from    date default null,
  p_to      date default null,
  p_site    text default null
)
returns json
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with scope as (
    select p_country as country, p_from as d_from, p_to as d_to,
           nullif(btrim(coalesce(p_site,'')),'') as site
  ),
  t as (
    select r.risk_level, r.brand, r.site, r.cost_per_tyre, r.qty
    from public.tyre_records r, scope s
    where (s.country is null or r.country = s.country or r.country is null)
      and (s.d_from  is null or r.issue_date >= s.d_from)
      and (s.d_to    is null or r.issue_date <= s.d_to)
      and (s.site    is null or r.site = s.site)
  ),
  -- One line's spend, mirroring the web rule: unit price x quantity, and a
  -- missing/zero quantity counts as one tyre rather than as zero money.
  tv as (
    select *, coalesce(cost_per_tyre,0)
             * (case when coalesce(qty,0) > 0 then qty else 1 end) as line_cost
    from t
  ),
  f as (
    select 1 from public.vehicle_fleet v, scope s
    where (s.country is null or v.country = s.country or v.country is null)
      and (s.site    is null or v.site = s.site)
  ),
  i as (
    select 1 from public.inspections n, scope s
    where n.inspection_date >= (current_date - interval '30 days')
      and (s.country is null or n.country = s.country or n.country is null)
      and (s.site    is null or n.site = s.site)
  ),
  a as (
    select 1 from public.corrective_actions ca, scope s
    where coalesce(ca.status,'') not in ('closed','Closed','completed','Completed')
      and (s.country is null or ca.country = s.country or ca.country is null)
      and (s.site    is null or ca.site = s.site)
  ),
  single_country as (select (select country from scope) is not null as ok),
  risk_rows as (
    select coalesce(nullif(btrim(coalesce(risk_level,'')),''),'Unknown') as risk,
           count(*) as cnt
    from tv group by 1
  ),
  site_rows as (
    select coalesce(nullif(btrim(coalesce(site,'')),''),'Unknown') as site,
           count(*) as cnt, sum(line_cost) as cost
    from tv group by 1
  ),
  brand_rows as (
    select coalesce(nullif(btrim(coalesce(brand,'')),''),'Unknown') as brand,
           count(*) as cnt, sum(line_cost) as cost
    from tv group by 1
  ),
  site_opts as (
    select distinct nullif(btrim(coalesce(v.site,'')),'') as site
    from public.vehicle_fleet v, scope s
    where (s.country is null or v.country = s.country or v.country is null)
      and nullif(btrim(coalesce(v.site,'')),'') is not null
  )
  select json_build_object(
    'country',         (select country from scope),
    'site',            (select site from scope),
    'from',            (select d_from from scope),
    'to',              (select d_to from scope),
    'tyres_total',     (select count(*) from tv),
    'tyres_critical',  (select count(*) from tv where lower(coalesce(risk_level,'')) = 'critical'),
    'tyres_high',      (select count(*) from tv where lower(coalesce(risk_level,'')) = 'high'),
    'tyre_spend',      (case when (select ok from single_country)
                             then (select coalesce(sum(line_cost),0) from tv) end),
    'vehicles_total',  (select count(*) from f),
    'inspections_30d', (select count(*) from i),
    'open_actions',    (select count(*) from a),
    'by_risk',         coalesce((select json_agg(json_build_object('risk', risk, 'count', cnt)
                                  order by cnt desc) from risk_rows), '[]'::json),
    -- Ranked by cost inside one country, by volume on the All view, so the
    -- ordering always matches the number the phone is able to show.
    'by_site',         coalesce((select json_agg(x) from (
                          select json_build_object(
                            'site', site, 'count', cnt,
                            'cost', case when (select ok from single_country) then cost end) as x,
                            cnt, cost
                          from site_rows
                          order by (case when (select ok from single_country)
                                         then cost else cnt end) desc, cnt desc
                          limit 8) q), '[]'::json),
    'by_brand',        coalesce((select json_agg(x) from (
                          select json_build_object(
                            'brand', brand, 'count', cnt,
                            'cost', case when (select ok from single_country) then cost end) as x,
                            cnt
                          from brand_rows order by cnt desc limit 6) q), '[]'::json),
    'sites',           coalesce((select json_agg(site order by site) from site_opts), '[]'::json),
    'generated_at',    now()
  );
$function$;

comment on function public.get_mobile_analytics(text, date, date, text) is
  'Mobile analytics in one row. SECURITY INVOKER: RLS still governs. Costs are NULL on the All-countries view because SAR/AED/EGP must never be summed.';

revoke all on function public.get_mobile_analytics(text, date, date, text) from public;
grant execute on function public.get_mobile_analytics(text, date, date, text) to authenticated;
