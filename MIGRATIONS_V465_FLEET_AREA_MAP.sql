-- V465: per-asset AREA (branch/site) map for the CPK Scenario Studio.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-08-03. Verified.
-- sites.region is unpopulated (0/64), so the real area dimension is
-- vehicle_fleet.site (29 KSA branches: NHC, RED SEA, KSP-TP, ...). The Scenario
-- Studio joins this to the CPK per_vehicle rows by asset_no to group CPK by branch
-- and model branch moves (price impact). DEFINER + org/country scoped.
create or replace function public.get_fleet_area_map(p_country text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_org uuid := public.app_current_org(); v_rows jsonb;
begin
  if v_org is null then return jsonb_build_object('ok', false, 'reason', 'no_org'); end if;
  if p_country is not null and not public.app_can_see_country(p_country) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('asset_no', asset_no, 'site', site, 'region', region, 'vehicle_type', vehicle_type) order by asset_no), '[]'::jsonb)
    into v_rows
  from (
    select upper(btrim(f.asset_no)) as asset_no, nullif(btrim(f.site), '') as site,
           nullif(btrim(s.region), '') as region, nullif(btrim(f.vehicle_type), '') as vehicle_type
      from public.vehicle_fleet f
      left join public.sites s on s.organisation_id = v_org and s.country = f.country
        and upper(btrim(s.name)) = upper(btrim(f.site))
     where f.organisation_id = v_org and (p_country is null or f.country = p_country)
       and coalesce(btrim(f.asset_no), '') <> ''
  ) t;
  return jsonb_build_object('ok', true, 'country', p_country, 'assets', v_rows);
end; $function$;
revoke execute on function public.get_fleet_area_map(text) from public;
grant execute on function public.get_fleet_area_map(text) to authenticated;
-- ROLLBACK: drop function if exists public.get_fleet_area_map(text);
