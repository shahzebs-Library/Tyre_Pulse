-- Fleet brand + size mix for the Tyre Specifications "Fleet coverage" view.
-- One row per country + brand + size with the number of tyre records, so the
-- page can show which combinations the fleet runs and whether the shared
-- catalogue (tyre_spec_catalog) holds an approved spec for each.
-- SECURITY INVOKER: RLS on tyre_records scopes it (org, country, site); a
-- caller-supplied country can only narrow that, never widen it.
create or replace function public.get_tyre_brand_size_mix(p_country text default null)
returns table(country text, brand text, size text, tyres bigint, active bigint, last_fitted date)
language sql stable security invoker set search_path = public as $$
  select t.country,
         upper(regexp_replace(btrim(t.brand), '\s+', ' ', 'g')) as brand,
         upper(regexp_replace(t.size, '\s', '', 'g')) as size,
         count(*) as tyres,
         count(*) filter (where t.status ilike 'active') as active,
         max(t.issue_date)::date as last_fitted
  from public.tyre_records t
  where coalesce(btrim(t.brand), '') <> '' and coalesce(btrim(t.size), '') <> ''
    and (p_country is null or t.country = p_country)
  group by 1, 2, 3
  order by tyres desc, 1, 2, 3
$$;
revoke all on function public.get_tyre_brand_size_mix(text) from public;
revoke all on function public.get_tyre_brand_size_mix(text) from anon;
grant execute on function public.get_tyre_brand_size_mix(text) to authenticated, service_role;
