-- V446 get_brand_size_cpk: brand + price + CPK comparison BY TYRE SIZE.
--
-- Management question this answers (user's own example): "I buy one brand tyre
-- at 766 (Techking) and the same size at 860; which is better?" A cheaper tyre
-- that wears out fast can cost MORE per km than a pricier long-life tyre. For a
-- given tyre size this returns, per brand, the purchase price AND the cost-per-km
-- (avg_price / avg_life_km) it actually delivers on the fleet.
--
-- SOURCE: tyre_records (brand, size, cost_per_tyre = purchase price,
-- total_km = life km, country). SIZE is normalised (whitespace stripped, upper)
-- so '315/80 R 22.5', '315/80R22.5' and '315 /80R22.5' fold into one bucket;
-- a human-readable representative (mode of the raw values) is returned.
-- Currency is per country (never blended). CPK is NULL when there is no life km
-- (honest N/A, never a fabricated 0).
--
-- SECURITY: SECURITY DEFINER, search_path pinned, anon revoked, scoped to
-- app_current_org(). STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc.
-- Reversible: drop function public.get_brand_size_cpk(text, date, date);
create or replace function public.get_brand_size_cpk(
  p_country text default null,
  p_from date default null,
  p_to date default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      country,
      upper(regexp_replace(size, '\s+', '', 'g'))          as nsize,
      btrim(size)                                          as raw_size,
      upper(btrim(brand))                                  as nbrand,
      btrim(brand)                                         as raw_brand,
      cost_per_tyre,
      total_km
    from public.tyre_records
    where organisation_id = public.app_current_org()
      and size is not null and btrim(size) <> ''
      and brand is not null and btrim(brand) <> ''
      and (p_country is null or country = p_country)
      and (p_from is null or coalesce(issue_date, fitment_date, removal_date) >= p_from)
      and (p_to is null or coalesce(issue_date, fitment_date, removal_date) <= p_to)
  ),
  grouped as (
    select
      country,
      nsize,
      mode() within group (order by raw_size)  as size,
      mode() within group (order by raw_brand) as brand,
      count(*)                                                    as tyres,
      round(avg(cost_per_tyre) filter (where cost_per_tyre > 0), 2) as avg_price,
      round(
        percentile_cont(0.5) within group (order by cost_per_tyre)
          filter (where cost_per_tyre > 0)::numeric, 2)          as median_price,
      round(avg(total_km) filter (where total_km > 0))           as avg_life_km
    from base
    group by country, nsize, nbrand
    having count(*) filter (where cost_per_tyre > 0) > 0
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
      case when avg_life_km > 0 and avg_price is not null
        then round(avg_price / avg_life_km, 5) end as cpk,
      public.currency_for_country(country)         as currency,
      country
    from grouped
  ) r;
$$;

revoke all on function public.get_brand_size_cpk(text, date, date) from anon;
grant execute on function public.get_brand_size_cpk(text, date, date) to authenticated;
