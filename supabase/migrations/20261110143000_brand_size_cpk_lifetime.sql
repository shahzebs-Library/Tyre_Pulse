-- 20261110143000_brand_size_cpk_lifetime.sql
-- Loop 5 / finding F-E-02: compute get_brand_size_cpk from the physical-tyre
-- lifetime layer, weighted, instead of per-fitment-row averages.
--
-- WHAT / WHY
--   get_brand_size_cpk grouped tyre_records by country/size/brand and emitted
--   cpk = avg(cost_per_tyre) / avg(total_km) over each FITMENT ROW (raw km). A
--   refit was averaged as a fresh purchase, and a brand with mangled meter data
--   (ERICLE raw avg life 4,295,772 km) ranked as the cheapest tyre in the fleet
--   at 0.0002 SAR/km. The procurement "best value" ranking was inverted by two
--   orders of magnitude.
--
--   This re-expresses it from public.v_tyre_lifetime (one row per PHYSICAL tyre,
--   purchase price counted once per tyre_key, km_known = validated km across the
--   tyre's fitments by the T7 rule, over-cap/placeholder excluded):
--     cpk = sum(purchase_cost * qty) / sum(km_known * qty)   -- rule T8, weighted
--   over tyres that have BOTH a price and a measurable life, grouped by the
--   tyre's latest brand/size. This mirrors JS kpiEngine.computeCpkByBrand /
--   tyreLifetime.weightedCpk, which read toLifetimeTyres() (== v_tyre_lifetime,
--   parity already verified). cpk is NULL when km is 0.
--
--   The OUT shape and ordering are unchanged: a jsonb array of
--   { size, brand, tyres, avg_price, median_price, avg_life_km, cpk, currency,
--   country } ordered by country, size, cpk nulls last. `tyres` is now physical
--   tyres (was fitment rows: TEGRYS had 2,078 rows for 1,383 strong serials).
--   `avg_price` / `median_price` stay descriptive (mean/median purchase price of
--   priced tyres); `avg_life_km` is the weighted life of the priced+measurable
--   tyres behind the cpk. cpk is no longer avg_price/avg_life_km but the correct
--   weighted total cost / total km.
--
--   v_tyre_lifetime is SECURITY INVOKER; this function is SECURITY DEFINER (runs
--   as owner, bypassing RLS), so the org / country ABAC / site predicates are
--   replicated BYTE-FOR-BYTE from the prior body against the view's columns. No
--   scope is widened.
--
-- MIRROR: SQL v_tyre_lifetime + this function <-> JS tyreLifetime.weightedCpk /
--   kpiEngine.computeCpkByBrand. No new maths; only the server RPC is repointed.
--
-- PRE-FLIGHT (database-migration-safety)
--   Data loss / rename / type / CHECK / FK / locks / triggers : none (function body only).
--   RLS/grants : unchanged (SECURITY DEFINER, search_path=public, force_custom_plan kept).
--                Org/country/site filters replicated, so a KSA-scoped user still
--                sees KSA only (the view read is explicitly org+ABAC filtered).
--   PostgREST  : returns jsonb; no RAISE.
--   Duration   : instant (DDL on one function).
--
-- VERIFY (SEPARATE call from apply):
--   -- A) direct lifetime-layer probe (super admin / service role), KSA 315/80R22.5:
--   --    ERICLE ~ 0.0366, TRIANGLE ~ 0.0209 (acceptance ERICLE ~0.038, TRIANGLE ~0.022),
--   --    ordering ascending by weighted cpk == kpiEngine.computeCpkByBrand.
--   with base as (
--     select country, upper(regexp_replace(size,'\s+','','g')) nsize, upper(btrim(brand)) nbrand,
--            qty, purchase_cost, km_known
--       from public.v_tyre_lifetime
--      where organisation_id='00000000-0000-0000-0000-000000000001' and country='KSA'
--        and size is not null and btrim(size)<>'' and brand is not null and btrim(brand)<>'')
--   select nbrand,
--          round((sum(purchase_cost*coalesce(qty,1)) filter (where purchase_cost>0 and km_known>0))
--               / nullif(sum(km_known*coalesce(qty,1)) filter (where purchase_cost>0 and km_known>0),0),5) cpk
--     from base where nsize='315/80R22.5' group by nbrand
--    having count(*) filter (where purchase_cost>0 and km_known>0)>0 order by cpk nulls last;
--   -- B) the RPC itself, impersonating a real KSA Manager (34793423), rolled back:
--   begin;
--     select set_config('request.jwt.claims', json_build_object('sub','<real KSA manager uuid>','role','authenticated')::text, true);
--     set local role authenticated;
--     select r->>'brand' brand, r->>'cpk' cpk, r->>'country' country
--       from jsonb_array_elements(public.get_brand_size_cpk('KSA')) r
--      where r->>'size' ~ '315' order by (r->>'cpk')::numeric nulls last limit 5;
--   rollback;  -- expect only KSA rows; ERICLE ~0.037, TRIANGLE ~0.021
--
-- ROLLBACK: re-apply the prior body (saved verbatim in the migration PR / the
--   repo history of this file's first revision; base captured from
--   pg_get_functiondef on 2026-11-10 before this change).

CREATE OR REPLACE FUNCTION public.get_brand_size_cpk(p_country text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_site text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
  with base as (
    select
      vt.country,
      -- normalise size for grouping (strip all whitespace, upper) so
      -- '315/80 R 22.5', '315/80R22.5' and '315 /80R22.5' are one bucket.
      upper(regexp_replace(vt.size, '\s+', '', 'g'))          as nsize,
      btrim(vt.size)                                          as raw_size,
      upper(btrim(vt.brand))                                  as nbrand,
      btrim(vt.brand)                                         as raw_brand,
      coalesce(vt.qty, 1)                                     as qty,
      vt.purchase_cost,
      vt.km_known
    from public.v_tyre_lifetime vt
    where vt.organisation_id = public.app_current_org()
      and vt.size is not null and btrim(vt.size) <> ''
      and vt.brand is not null and btrim(vt.brand) <> ''
      and (p_country is null or vt.country = p_country) and (p_country is null or p_country = 'All' or public.app_can_see_country(p_country)) and (vt.country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries()) or lower(btrim(vt.country)) = any(coalesce((select public.app_country_scope()), '{}'::text[])))
      and (nullif(btrim(coalesce(p_site, '')), '') is null or (((select public.is_super_admin()) or public.app_can_see_site(p_site) is not false) and exists (select 1 from public.vehicle_fleet f where f.organisation_id = vt.organisation_id and f.country is not distinct from vt.country and upper(btrim(f.asset_no)) = upper(btrim(vt.asset_no)) and upper(btrim(f.site)) = upper(regexp_replace(btrim(p_site), '\s+', ' ', 'g')))))
      and (p_from is null or coalesce(vt.last_fit_date, vt.first_fit_date, vt.last_removal_date) >= p_from)
      and (p_to is null or coalesce(vt.last_fit_date, vt.first_fit_date, vt.last_removal_date) <= p_to)
  ),
  grouped as (
    select
      country,
      nsize,
      mode() within group (order by raw_size)  as size,
      mode() within group (order by raw_brand) as brand,
      -- physical tyres (v_tyre_lifetime is one row per tyre)
      count(*)                                                          as tyres,
      round(avg(purchase_cost) filter (where purchase_cost > 0), 2)     as avg_price,
      round(
        percentile_cont(0.5) within group (order by purchase_cost)
          filter (where purchase_cost > 0)::numeric, 2)                 as median_price,
      -- weighted life of the priced + measurable tyres (the life behind the cpk)
      round(
        sum(km_known * qty) filter (where purchase_cost > 0 and km_known > 0)
          / nullif(sum(qty) filter (where purchase_cost > 0 and km_known > 0), 0)
      )                                                                 as avg_life_km,
      -- rule T8 weighted CPK numerator / denominator
      sum(purchase_cost * qty) filter (where purchase_cost > 0 and km_known > 0) as cost,
      sum(km_known      * qty) filter (where purchase_cost > 0 and km_known > 0) as km
    from base
    group by country, nsize, nbrand
    having count(*) filter (where purchase_cost > 0) > 0
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.country, r.size, r.cpk nulls last), '[]'::jsonb)
  from (
    select
      size,
      brand,
      tyres,
      avg_price,
      median_price,
      avg_life_km,
      case when km > 0 then round(cost / km, 5) end as cpk,
      public.currency_for_country(country)          as currency,
      country
    from grouped
  ) r;
$function$;
