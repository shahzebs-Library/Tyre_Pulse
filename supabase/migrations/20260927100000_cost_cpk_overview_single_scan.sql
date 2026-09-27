-- 20260927100000_cost_cpk_overview_single_scan
--
-- PURPOSE
--   get_cost_cpk_overview (Expenses & CPK page) read parts_consumption ~14
--   times per call: 3x _cost_totals + 3x _cost_cpk (one per window: current,
--   previous, same period last year), the monthly strip, by_evidence, 5x
--   _cost_dim and the currency count. The totals, the cost-per-km spend side,
--   the monthly strip and by_evidence are now computed from ONE scoped read of
--   parts_consumption (materialized CTE `pc`, narrow projection) using FILTER
--   aggregates per window, and the three fleet_km_by_asset reads are
--   materialized once (`kmr`) and probed with a hashed IN instead of
--   `= any(array)` per row.
--
--   Every guard is unchanged and in the same order: site ABAC
--   (app_can_see_site), country ABAC (app_can_see_country), org + active
--   (app_current_org / app_is_active), the row-level country and site scope
--   predicates (is_super_admin / app_sees_all_* / app_*_scope) are carried
--   byte-for-byte into the single read, and SECURITY DEFINER, search_path and
--   plan_cache_mode=force_custom_plan are kept.
--
--   DELIBERATELY UNCHANGED: the five by_* breakdowns still call _cost_dim.
--   A single grouping-sets pass was built and measured (927 ms total) but was
--   REFUSED: _cost_dim orders by (spend desc, prev_spend desc) with LIMIT 25
--   and no unique tiebreak, so rows tied on rounded spend come back in a
--   plan-dependent order. The one-pass version returned the same rows but in a
--   different tie order (and a different 25th row) for 2 of 74 probes
--   (Egypt/UAE users, all-countries, Aug-2026). Equivalence could not be
--   proven, so it was not shipped. See the owner note in the round-3 report.
--
-- MEASURED (KSA-only Manager 34793423, set local role authenticated, same
-- session, alternating old/new, 3 runs each):
--   KSA default 12 months : 1,689-1,757 ms  ->  1,202-1,336 ms
--   All countries         : 2,239-2,340 ms  ->  1,534-1,589 ms
--
-- EQUIVALENCE (enforced before apply): payload minus generated_at compared as
-- text, old vs new, for 6 real users (2 KSA Managers, super admin, 3-country
-- Tire Planning Engineer, Egypt-only Tyre Data Collector, UAE-only PMV
-- Manager) x up to 16 parameter sets (all/KSA/UAE/Egypt, site NHC/DIRIYAH,
-- 1-day, 1-month, 6-month, 1-year, 5- and 7-year spans, reversed range,
-- forbidden country): 74/74 byte-identical.
--
-- VERIFY
--   select md5((public.get_cost_cpk_overview('KSA',null,null,null)
--               - 'generated_at')::text);   -- as the KSA Manager, same day as
--   the pre-apply capture: 526fdf777082f3cef864ec8e0c49b2b2 (2026-09-27).
--   select has_function_privilege('anon',
--     'public.get_cost_cpk_overview(text,text,date,date)','EXECUTE'); -- false
--
-- ROLLBACK
--   Re-create the previous body (V-series definition: calls _cost_totals /
--   _cost_cpk per window). It is reproduced verbatim at the bottom of this
--   file as a comment block.

CREATE OR REPLACE FUNCTION public.get_cost_cpk_overview(p_country text DEFAULT NULL::text, p_site text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare
  -- below this share of window spend, a cost-per-km comparison is coverage
  -- noise rather than a trend
  MIN_COVERAGE constant numeric := 0.25;
  v_org  uuid := public.app_current_org();
  v_to   date := coalesce(p_to, current_date);
  v_from date := coalesce(p_from, coalesce(p_to, current_date) - 364);
  v_len  int;
  v_pf date; v_pt date; v_lf date; v_lt date;
  v_ms date; v_lo date; v_hi date;
  v_cur text; v_countries int;
  result jsonb;
begin

  if p_site is not null and btrim(p_site) <> '' and not public.app_can_see_site(p_site) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  if p_country is not null and not public.app_can_see_country(p_country) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if v_org is null or not public.app_is_active() then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  v_len := (v_to - v_from) + 1;
  v_pt := v_from - 1;
  v_pf := v_pt - (v_len - 1);
  v_lf := (v_from - interval '1 year')::date;
  v_lt := (v_to   - interval '1 year')::date;
  v_ms := (v_to - interval '35 months')::date;
  -- one read of parts_consumption covering every window the payload needs
  v_lo := least(v_from, v_pf, v_lf, v_ms);
  v_hi := greatest(v_to, v_pt, v_lt, v_from);

  select count(distinct country) into v_countries
    from public.parts_consumption
   where organisation_id = v_org and (p_country is null or country = p_country) and (country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries()) or lower(btrim(country)) = any(coalesce((select public.app_country_scope()), '{}'::text[])));
  v_cur := case when p_country is null and v_countries > 1 then null
                else public.currency_for_country(coalesce(p_country,
                  (select country from public.parts_consumption
                    where organisation_id = v_org limit 1))) end;

  with pc as materialized (
    select event_date, tyre_cost, spare_cost, oil_cost, line_cost,
           upper(btrim(asset_code)) ac, classified_by
      from public.parts_consumption
     where organisation_id = v_org
       and (p_country is null or country = p_country) and (country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries()) or lower(btrim(country)) = any(coalesce((select public.app_country_scope()), '{}'::text[])))
       and (p_site is null or site = p_site) and ((site)::text is null or btrim((site)::text) = '' or (select public.is_super_admin()) or (select public.app_sees_all_sites()) or upper(btrim((site)::text)) = any(coalesce((select public.app_site_scope()), '{}'::text[])))
       and event_date between v_lo and v_hi
  ),
  -- the same fleet_km_by_asset reads _cost_cpk made, one per window
  kmr as materialized (
    select w.k, x.asset_no, x.km_run
      from (values ('current', v_from, v_to), ('previous', v_pf, v_pt), ('last_year', v_lf, v_lt)) w(k, f0, t0)
      cross join lateral public.fleet_km_by_asset(v_org, p_country, w.f0, w.t0) x
     where true and (x.country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries()) or lower(btrim(x.country)) = any(coalesce((select public.app_country_scope()), '{}'::text[])))
  ),
  km as (
    select w.k, coalesce(sum(r.km_run),0) km, count(r.asset_no) n
      from (values ('current'), ('previous'), ('last_year')) w(k)
      left join kmr r on r.k = w.k
     group by w.k
  ),
  agg as (
    select
      coalesce(round(sum(tyre_cost)  filter (where event_date between v_from and v_to)),0) c_tyre,
      coalesce(round(sum(spare_cost) filter (where event_date between v_from and v_to)),0) c_spare,
      coalesce(round(sum(oil_cost)   filter (where event_date between v_from and v_to)),0) c_oil,
      coalesce(round(sum(line_cost)  filter (where event_date between v_from and v_to)),0) c_total,
      count(*) filter (where event_date between v_from and v_to) c_lines,
      count(distinct ac) filter (where event_date between v_from and v_to) c_assets,
      coalesce(round(sum(line_cost)  filter (where event_date between v_from and v_to
          and ac in (select asset_no from kmr where k = 'current'))),0) c_matched,
      coalesce(round(sum(tyre_cost)  filter (where event_date between v_pf and v_pt)),0) p_tyre,
      coalesce(round(sum(spare_cost) filter (where event_date between v_pf and v_pt)),0) p_spare,
      coalesce(round(sum(oil_cost)   filter (where event_date between v_pf and v_pt)),0) p_oil,
      coalesce(round(sum(line_cost)  filter (where event_date between v_pf and v_pt)),0) p_total,
      count(*) filter (where event_date between v_pf and v_pt) p_lines,
      count(distinct ac) filter (where event_date between v_pf and v_pt) p_assets,
      coalesce(round(sum(line_cost)  filter (where event_date between v_pf and v_pt
          and ac in (select asset_no from kmr where k = 'previous'))),0) p_matched,
      coalesce(round(sum(tyre_cost)  filter (where event_date between v_lf and v_lt)),0) l_tyre,
      coalesce(round(sum(spare_cost) filter (where event_date between v_lf and v_lt)),0) l_spare,
      coalesce(round(sum(oil_cost)   filter (where event_date between v_lf and v_lt)),0) l_oil,
      coalesce(round(sum(line_cost)  filter (where event_date between v_lf and v_lt)),0) l_total,
      count(*) filter (where event_date between v_lf and v_lt) l_lines,
      count(distinct ac) filter (where event_date between v_lf and v_lt) l_assets,
      coalesce(round(sum(line_cost)  filter (where event_date between v_lf and v_lt
          and ac in (select asset_no from kmr where k = 'last_year'))),0) l_matched
      from pc
  ),
  win as (
    select 'current' k, c_tyre tyre, c_spare spare, c_oil oil, c_total total, c_lines lines, c_assets assets, c_matched matched from agg
    union all
    select 'previous', p_tyre, p_spare, p_oil, p_total, p_lines, p_assets, p_matched from agg
    union all
    select 'last_year', l_tyre, l_spare, l_oil, l_total, l_lines, l_assets, l_matched from agg
  ),
  cpk as (
    select w.k,
      jsonb_build_object('tyre', w.tyre, 'spare', w.spare, 'oil', w.oil, 'total', w.total,
                         'lines', w.lines, 'assets', w.assets) totals,
      jsonb_build_object(
        'km', round(m.km),
        'assets_measured', m.n,
        'spend_matched', w.matched,
        'spend_total', w.total,
        'coverage_pct', case when w.total > 0 then round(w.matched / w.total, 4) end,
        -- null, never zero: an unmeasured fleet has an unknown cost per km
        'cpk', case when m.km > 0 then round(w.matched / m.km, 3) end,
        'comparable', coalesce(case when w.total > 0 then round(w.matched / w.total, 4) end, 0) >= MIN_COVERAGE) cpk
      from win w join km m using (k)
  )
  select jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'currency', v_cur,
    'blended', (v_cur is null),
    'country', p_country,
    'site', p_site,
    'min_coverage', MIN_COVERAGE,
    'windows', jsonb_build_object(
      'current',   jsonb_build_object('from', v_from, 'to', v_to),
      'previous',  jsonb_build_object('from', v_pf,   'to', v_pt),
      'last_year', jsonb_build_object('from', v_lf,   'to', v_lt),
      'days', v_len,
      -- a twelve month range makes these the same dates; say so rather than
      -- drawing the same bar twice
      'previous_is_last_year', (v_pf = v_lf and v_pt = v_lt)),

    'totals', (select jsonb_object_agg(k, totals) from cpk),
    'cpk',    (select jsonb_object_agg(k, cpk) from cpk),

    'monthly', (select coalesce(jsonb_agg(x order by x.m), '[]'::jsonb) from (
        select to_char(date_trunc('month', event_date),'YYYY-MM') m,
               round(sum(tyre_cost)) tyre, round(sum(spare_cost)) spare,
               round(sum(oil_cost)) oil, round(sum(line_cost)) total,
               count(*) lines
          from pc
         where event_date is not null
           and event_date >= v_ms
           and event_date <= v_to
         group by 1) x),

    'by_site',         public._cost_dim(v_org, p_country, p_site, v_from, v_to, v_pf, v_pt, 'site'),
    'by_cost_center',  public._cost_dim(v_org, p_country, p_site, v_from, v_to, v_pf, v_pt, 'cost_center'),
    'by_asset_type',   public._cost_dim(v_org, p_country, p_site, v_from, v_to, v_pf, v_pt, 'asset_type'),
    'by_asset',        public._cost_dim(v_org, p_country, p_site, v_from, v_to, v_pf, v_pt, 'asset_code'),
    'by_item',         public._cost_dim(v_org, p_country, p_site, v_from, v_to, v_pf, v_pt, 'item_description'),

    'by_evidence', (select coalesce(jsonb_agg(x order by x.spend desc), '[]'::jsonb) from (
        select coalesce(classified_by,'unknown') label, round(sum(line_cost)) spend, count(*) lines
          from pc
         where event_date between v_from and v_to
         group by 1) x)
  ) into result;

  return result;
end $function$;


-- ROLLBACK BODY (pre-apply live definition, comments inside the body trimmed):
-- CREATE OR REPLACE FUNCTION public.get_cost_cpk_overview(p_country text DEFAULT NULL::text, p_site text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public'
--  SET plan_cache_mode TO 'force_custom_plan'
-- AS $function$
-- declare
--   MIN_COVERAGE constant numeric := 0.25;
--   v_org  uuid := public.app_current_org();
--   v_to   date := coalesce(p_to, current_date);
--   v_from date := coalesce(p_from, coalesce(p_to, current_date) - 364);
--   v_len  int;
--   v_pf date; v_pt date; v_lf date; v_lt date;
--   v_cur text; v_countries int;
--   result jsonb;
-- 
--   function_placeholder int;
-- begin
-- 
--   if p_site is not null and btrim(p_site) <> '' and not public.app_can_see_site(p_site) then
--     return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
-- 
--   if p_country is not null and not public.app_can_see_country(p_country) then
--     return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
--   if v_org is null or not public.app_is_active() then
--     return jsonb_build_object('ok', false, 'reason', 'unauthorized');
--   end if;
-- 
--   v_len := (v_to - v_from) + 1;
--   v_pt := v_from - 1;
--   v_pf := v_pt - (v_len - 1);
--   v_lf := (v_from - interval '1 year')::date;
--   v_lt := (v_to   - interval '1 year')::date;
-- 
--   select count(distinct country) into v_countries
--     from public.parts_consumption
--    where organisation_id = v_org and (p_country is null or country = p_country) and (country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries()) or lower(btrim(country)) = any(coalesce((select public.app_country_scope()), '{}'::text[])));
--   v_cur := case when p_country is null and v_countries > 1 then null
--                 else public.currency_for_country(coalesce(p_country,
--                   (select country from public.parts_consumption
--                     where organisation_id = v_org limit 1))) end;
-- 
--   select jsonb_build_object(
--     'ok', true,
--     'generated_at', now(),
--     'currency', v_cur,
--     'blended', (v_cur is null),
--     'country', p_country,
--     'site', p_site,
--     'min_coverage', MIN_COVERAGE,
--     'windows', jsonb_build_object(
--       'current',   jsonb_build_object('from', v_from, 'to', v_to),
--       'previous',  jsonb_build_object('from', v_pf,   'to', v_pt),
--       'last_year', jsonb_build_object('from', v_lf,   'to', v_lt),
--       'days', v_len,
--       'previous_is_last_year', (v_pf = v_lf and v_pt = v_lt)),
-- 
--     'totals', jsonb_build_object(
--       'current',   public._cost_totals(v_org, p_country, p_site, v_from, v_to),
--       'previous',  public._cost_totals(v_org, p_country, p_site, v_pf,   v_pt),
--       'last_year', public._cost_totals(v_org, p_country, p_site, v_lf,   v_lt)),
-- 
--     'cpk', jsonb_build_object(
--       'current',   public._cost_cpk(v_org, p_country, p_site, v_from, v_to, MIN_COVERAGE),
--       'previous',  public._cost_cpk(v_org, p_country, p_site, v_pf,   v_pt, MIN_COVERAGE),
--       'last_year', public._cost_cpk(v_org, p_country, p_site, v_lf,   v_lt, MIN_COVERAGE)),
-- 
--     'monthly', (select coalesce(jsonb_agg(x order by x.m), '[]'::jsonb) from (
--         select to_char(date_trunc('month', event_date),'YYYY-MM') m,
--                round(sum(tyre_cost)) tyre, round(sum(spare_cost)) spare,
--                round(sum(oil_cost)) oil, round(sum(line_cost)) total,
--                count(*) lines
--           from public.parts_consumption
--          where organisation_id = v_org
--            and (p_country is null or country = p_country) and (country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries()) or lower(btrim(country)) = any(coalesce((select public.app_country_scope()), '{}'::text[])))
--            and (p_site is null or site = p_site) and ((site)::text is null or btrim((site)::text) = '' or (select public.is_super_admin()) or (select public.app_sees_all_sites()) or upper(btrim((site)::text)) = any(coalesce((select public.app_site_scope()), '{}'::text[])))
--            and event_date is not null
--            and event_date >= (v_to - interval '35 months')::date
--            and event_date <= v_to
--          group by 1) x),
-- 
--     'by_site',        public._cost_dim(v_org, p_country, p_site, v_from, v_to, v_pf, v_pt, 'site'),
--     'by_cost_center', public._cost_dim(v_org, p_country, p_site, v_from, v_to, v_pf, v_pt, 'cost_center'),
--     'by_asset_type',  public._cost_dim(v_org, p_country, p_site, v_from, v_to, v_pf, v_pt, 'asset_type'),
--     'by_asset',       public._cost_dim(v_org, p_country, p_site, v_from, v_to, v_pf, v_pt, 'asset_code'),
--     'by_item',        public._cost_dim(v_org, p_country, p_site, v_from, v_to, v_pf, v_pt, 'item_description'),
-- 
--     'by_evidence', (select coalesce(jsonb_agg(x order by x.spend desc), '[]'::jsonb) from (
--         select coalesce(classified_by,'unknown') label, round(sum(line_cost)) spend, count(*) lines
--           from public.parts_consumption
--          where organisation_id = v_org
--            and (p_country is null or country = p_country) and (country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries()) or lower(btrim(country)) = any(coalesce((select public.app_country_scope()), '{}'::text[])))
--            and (p_site is null or site = p_site) and ((site)::text is null or btrim((site)::text) = '' or (select public.is_super_admin()) or (select public.app_sees_all_sites()) or upper(btrim((site)::text)) = any(coalesce((select public.app_site_scope()), '{}'::text[])))
--            and event_date between v_from and v_to
--          group by 1) x)
--   ) into result;
-- 
--   return result;
-- end $function$;
