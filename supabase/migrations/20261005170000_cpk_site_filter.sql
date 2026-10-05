-- =============================================================================
-- 20261005170000_cpk_site_filter
-- CPK Intelligence: a real "All Sites" filter.
--
-- WHAT
--   get_fleet_cpk, get_cpk_drivers and get_brand_size_cpk gain a LAST
--   parameter `p_site text default null`. NULL or blank = all sites, i.e. the
--   exact behaviour of the previous signature (md5-proven, see VERIFY).
--
-- SITE SEMANTICS
--   A site is the asset's REGISTERED site in vehicle_fleet (country-scoped),
--   NOT parts_consumption.site (that column is the ISSUING STORE, see V512).
--   get_fleet_cpk / get_cpk_drivers filter their `fleet` CTE, which drives
--   every per-asset join, so cost and km/hours always describe the SAME asset
--   set and cannot disagree. Cost on asset codes missing from the register
--   ("unregistered_cost") cannot be attributed to a site, so it reads 0 when a
--   site is chosen. get_brand_size_cpk keeps a tyre only when its asset is
--   registered at that site in the tyre's own country.
--
-- SECURITY
--   Named-site guard (V553 pattern): a site the caller cannot see is refused
--   with each function's existing refusal shape ({ok:false,reason:forbidden}
--   for the two plpgsql functions, [] for the sql one). `is not false`
--   semantics plus is_super_admin(), per the FIVE TRAPS list. Org and country
--   guards are untouched. The all-sites path is unchanged on purpose.
--
-- MECHANICS
--   Postgres cannot add a parameter with CREATE OR REPLACE and two overloads
--   make PostgREST calls ambiguous (42725). No DROP (MCP approval timeout):
--   the old signature is RENAMED to <name>_v1_retired and EXECUTE revoked.
--   The new body is built from the LIVE pg_get_functiondef text with anchored
--   replace(); every anchor must occur exactly once or the migration aborts.
--
-- VERIFY (2026-10-05, super admin, default 365-day window AND current month,
-- countries KSA / UAE / Egypt / null, p_site null and '')
--   get_cpk_drivers, get_brand_size_cpk: md5-identical to the retired fn.
--   get_fleet_cpk: fleet, by_type and per_vehicle are element-for-element
--   identical as sets in every case; byte-identical for KSA. Where bytes differ
--   it is only the order of rows that TIE on total_cost (the jsonb_agg ORDER BY
--   has no tiebreak, so tie order is plan-dependent; it was already undefined).
--   KSA NHC (365d): per_vehicle 183 of 608, total_cost 2,624,374.26 of
--   6,476,497.91 SAR, km 325,746,882 of 436,408,544, unregistered_cost 0;
--   brand rows 77 of 119; drivers segments scoped to the 80 km + 40 hour
--   assets at NHC. Unknown site -> empty fleet, no error.
--   Impersonated KSA Manager narrowed to sites {NHC} (rolled back): NHC ok,
--   JED forbidden on fleet + drivers, brand JED [], UAE forbidden, all-sites ok.
--   Grants: new fns authenticated=true anon=false; retired fns no EXECUTE.
--
-- ROLLBACK
--   alter function public.get_fleet_cpk(text,date,date,text) rename to get_fleet_cpk_v2_off;
--   revoke execute on function public.get_fleet_cpk_v2_off(text,date,date,text) from public, anon, authenticated;
--   alter function public.get_fleet_cpk_v1_retired(text,date,date) rename to get_fleet_cpk;
--   grant execute on function public.get_fleet_cpk(text,date,date) to authenticated, service_role;
--   (same for get_cpk_drivers(text,date,date,date,date) and get_brand_size_cpk(text,date,date))
-- =============================================================================
do $mig$
declare
  nl constant text := chr(10);
  v_guard_plpgsql text :=
    'begin' || nl || nl ||
    '  if nullif(btrim(coalesce(p_site, '''')), '''') is not null' ||
    ' and not (public.is_super_admin() or public.app_can_see_site(p_site) is not false) then' || nl ||
    '    return jsonb_build_object(''ok'', false, ''reason'', ''forbidden''); end if;' || nl ||
    '  if p_country is not null and not public.app_can_see_country(p_country) then';
  v_site_decl text := nl || '  v_site text := nullif(upper(regexp_replace(btrim(coalesce(p_site, '''')), ''\s+'', '' '', ''g'')), '''');';
  d text;
begin
  -- every replace below is preceded by an exactly-once anchor check
  -- ---------------------------------------------------------------- get_fleet_cpk
  d := pg_get_functiondef('public.get_fleet_cpk(text,date,date)'::regprocedure);
  if (length(d) - length(replace(d, 'p_to date DEFAULT NULL::date)' || nl || ' RETURNS jsonb', ''))) / length('p_to date DEFAULT NULL::date)' || nl || ' RETURNS jsonb') <> 1 then raise exception 'fleet_cpk: signature anchor'; end if;
  d := replace(d, 'p_to date DEFAULT NULL::date)' || nl || ' RETURNS jsonb', 'p_to date DEFAULT NULL::date, p_site text DEFAULT NULL::text)' || nl || ' RETURNS jsonb');
  if (length(d) - length(replace(d, 'v_to   date := coalesce(p_to, current_date);', ''))) / length('v_to   date := coalesce(p_to, current_date);') <> 1 then raise exception 'fleet_cpk: declare anchor'; end if;
  d := replace(d, 'v_to   date := coalesce(p_to, current_date);', 'v_to   date := coalesce(p_to, current_date);' || v_site_decl);
  if (length(d) - length(replace(d, 'begin' || nl || nl || '  if p_country is not null and not public.app_can_see_country(p_country) then', ''))) / length('begin' || nl || nl || '  if p_country is not null and not public.app_can_see_country(p_country) then') <> 1 then raise exception 'fleet_cpk: guard anchor'; end if;
  d := replace(d, 'begin' || nl || nl || '  if p_country is not null and not public.app_can_see_country(p_country) then', v_guard_plpgsql);
  if (length(d) - length(replace(d, 'and coalesce(btrim(f.asset_no), '''') <> ''''' || nl || '    ),' || nl || '    per_asset as', ''))) / length('and coalesce(btrim(f.asset_no), '''') <> ''''' || nl || '    ),' || nl || '    per_asset as') <> 1 then raise exception 'fleet_cpk: fleet anchor'; end if;
  d := replace(d, 'and coalesce(btrim(f.asset_no), '''') <> ''''' || nl || '    ),' || nl || '    per_asset as',
                  'and coalesce(btrim(f.asset_no), '''') <> ''''' || nl || '         and (v_site is null or upper(btrim(f.site)) = v_site)' || nl || '    ),' || nl || '    per_asset as');
  if (length(d) - length(replace(d, 'where not exists (select 1 from fleet fl', ''))) / length('where not exists (select 1 from fleet fl') <> 1 then raise exception 'fleet_cpk: unreg anchor'; end if;
  d := replace(d, 'where not exists (select 1 from fleet fl', 'where v_site is null and not exists (select 1 from fleet fl');

  alter function public.get_fleet_cpk(text,date,date) rename to get_fleet_cpk_v1_retired;
  revoke execute on function public.get_fleet_cpk_v1_retired(text,date,date) from public, anon, authenticated;
  execute d;
  grant execute on function public.get_fleet_cpk(text,date,date,text) to authenticated, service_role;
  revoke execute on function public.get_fleet_cpk(text,date,date,text) from public;
  revoke execute on function public.get_fleet_cpk(text,date,date,text) from anon;

  -- -------------------------------------------------------------- get_cpk_drivers
  d := pg_get_functiondef('public.get_cpk_drivers(text,date,date,date,date)'::regprocedure);
  if (length(d) - length(replace(d, 'p_prev_to date DEFAULT NULL::date)' || nl || ' RETURNS jsonb', ''))) / length('p_prev_to date DEFAULT NULL::date)' || nl || ' RETURNS jsonb') <> 1 then raise exception 'drivers: signature anchor'; end if;
  d := replace(d, 'p_prev_to date DEFAULT NULL::date)' || nl || ' RETURNS jsonb', 'p_prev_to date DEFAULT NULL::date, p_site text DEFAULT NULL::text)' || nl || ' RETURNS jsonb');
  if (length(d) - length(replace(d, 'v_f0  date := coalesce(p_prev_from, v_f1 - 1 - (v_t1 - v_f1));', ''))) / length('v_f0  date := coalesce(p_prev_from, v_f1 - 1 - (v_t1 - v_f1));') <> 1 then raise exception 'drivers: declare anchor'; end if;
  d := replace(d, 'v_f0  date := coalesce(p_prev_from, v_f1 - 1 - (v_t1 - v_f1));', 'v_f0  date := coalesce(p_prev_from, v_f1 - 1 - (v_t1 - v_f1));' || v_site_decl);
  if (length(d) - length(replace(d, 'begin' || nl || nl || '  if p_country is not null and not public.app_can_see_country(p_country) then', ''))) / length('begin' || nl || nl || '  if p_country is not null and not public.app_can_see_country(p_country) then') <> 1 then raise exception 'drivers: guard anchor'; end if;
  d := replace(d, 'begin' || nl || nl || '  if p_country is not null and not public.app_can_see_country(p_country) then', v_guard_plpgsql);
  if (length(d) - length(replace(d, 'and coalesce(btrim(f.asset_no), '''') <> ''''' || nl || '    ),' || nl || '    km1 as', ''))) / length('and coalesce(btrim(f.asset_no), '''') <> ''''' || nl || '    ),' || nl || '    km1 as') <> 1 then raise exception 'drivers: fleet anchor'; end if;
  d := replace(d, 'and coalesce(btrim(f.asset_no), '''') <> ''''' || nl || '    ),' || nl || '    km1 as',
                  'and coalesce(btrim(f.asset_no), '''') <> ''''' || nl || '         and (v_site is null or upper(btrim(f.site)) = v_site)' || nl || '    ),' || nl || '    km1 as');

  alter function public.get_cpk_drivers(text,date,date,date,date) rename to get_cpk_drivers_v1_retired;
  revoke execute on function public.get_cpk_drivers_v1_retired(text,date,date,date,date) from public, anon, authenticated;
  execute d;
  grant execute on function public.get_cpk_drivers(text,date,date,date,date,text) to authenticated, service_role;
  revoke execute on function public.get_cpk_drivers(text,date,date,date,date,text) from public;
  revoke execute on function public.get_cpk_drivers(text,date,date,date,date,text) from anon;

  -- ----------------------------------------------------------- get_brand_size_cpk
  d := pg_get_functiondef('public.get_brand_size_cpk(text,date,date)'::regprocedure);
  if (length(d) - length(replace(d, 'p_to date DEFAULT NULL::date)' || nl || ' RETURNS jsonb', ''))) / length('p_to date DEFAULT NULL::date)' || nl || ' RETURNS jsonb') <> 1 then raise exception 'brand: signature anchor'; end if;
  d := replace(d, 'p_to date DEFAULT NULL::date)' || nl || ' RETURNS jsonb', 'p_to date DEFAULT NULL::date, p_site text DEFAULT NULL::text)' || nl || ' RETURNS jsonb');
  if (length(d) - length(replace(d, 'and (p_from is null or coalesce(issue_date, fitment_date, removal_date) >= p_from)', ''))) / length('and (p_from is null or coalesce(issue_date, fitment_date, removal_date) >= p_from)') <> 1 then raise exception 'brand: predicate anchor'; end if;
  d := replace(d, 'and (p_from is null or coalesce(issue_date, fitment_date, removal_date) >= p_from)',
    'and (nullif(btrim(coalesce(p_site, '''')), '''') is null or (' ||
      '((select public.is_super_admin()) or public.app_can_see_site(p_site) is not false)' ||
      ' and exists (select 1 from public.vehicle_fleet f' ||
      ' where f.organisation_id = tyre_records.organisation_id' ||
      ' and f.country is not distinct from tyre_records.country' ||
      ' and upper(btrim(f.asset_no)) = upper(btrim(tyre_records.asset_no))' ||
      ' and upper(btrim(f.site)) = upper(regexp_replace(btrim(p_site), ''\s+'', '' '', ''g'')))))' || nl ||
    '      and (p_from is null or coalesce(issue_date, fitment_date, removal_date) >= p_from)');

  alter function public.get_brand_size_cpk(text,date,date) rename to get_brand_size_cpk_v1_retired;
  revoke execute on function public.get_brand_size_cpk_v1_retired(text,date,date) from public, anon, authenticated;
  execute d;
  grant execute on function public.get_brand_size_cpk(text,date,date,text) to authenticated, service_role;
  revoke execute on function public.get_brand_size_cpk(text,date,date,text) from public;
  revoke execute on function public.get_brand_size_cpk(text,date,date,text) from anon;
end
$mig$;
