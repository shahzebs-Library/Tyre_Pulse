-- =============================================================================
-- 20261005180000_cpk_site_filter_tabs
-- CPK Intelligence: the All Sites filter now also drives the three tabs that
-- ignored it (KM source, Units & why different, Km intelligence).
--
-- WHAT
--   get_cpk_km_source, get_cpk_hours_source, get_cpk_unit_audit and
--   get_cpk_km_intelligence gain a LAST parameter `p_site text default null`.
--   NULL or blank = all sites = the exact behaviour of the previous signature
--   (proven, see VERIFY). Same approach as 20261005170000_cpk_site_filter.
--
-- SITE SEMANTICS
--   A site is the asset's REGISTERED site in vehicle_fleet, in the row's own
--   country (vehicle_fleet is unique per org + country + asset_no). It is NOT
--   tyre_records.site / engine_hours_logs.site (those record where the event
--   was logged). km_source / hours_source / unit_audit keep a tyre or meter
--   reading only when its asset is registered at that site; km_intelligence
--   filters its `fleet` CTE, which drives every per-asset join. An asset code
--   missing from the register cannot be placed at a site, so it drops out when
--   a site is chosen.
--
-- SECURITY
--   Named-site guard: a site the caller cannot see is refused with each
--   function's existing refusal shape {ok:false, reason:'forbidden'};
--   `is_super_admin() or app_can_see_site(p_site) is not false`. Org and
--   country guards, SECURITY DEFINER and search_path=public are untouched.
--
-- MECHANICS
--   No DROP (MCP approval timeout). The old signature is RENAMED to
--   <name>_v1_retired and EXECUTE revoked from public, anon, authenticated. The
--   new body is built from the LIVE pg_get_functiondef text; every anchor must
--   occur exactly once or the migration aborts (pg_temp._cpk_rep1).
--
-- VERIFY (2026-10-05, applied live, super admin, default 365-day window)
--   p_site NULL and p_site '' are md5-IDENTICAL to the retired function for
--   KSA / UAE / Egypt (and country NULL where the RPC allows it):
--   km_source (by_asset + single asset TM634), hours_source (by_asset + TM634),
--   unit_audit, km_intelligence.
--   Named site narrows: KSA NHC km_source by_asset 131 of 364; hours_source
--   82 of 220; unit_audit assets 133 of 374 (80 movable, 53 non-movable);
--   km_intelligence assets 186 of 719. UAE/Egypt with NHC -> empty, no error.
--   Impersonated KSA Manager narrowed to sites {NHC} (rolled back): NHC ok on
--   km_source / hours_source / km_intelligence; JED forbidden on all four;
--   all-sites ok; UAE forbidden (country guard). Grants: new fns
--   authenticated=true anon=false; retired fns no EXECUTE.
--
-- ROLLBACK (per function, example for km_source)
--   alter function public.get_cpk_km_source(text,date,date,text,text) rename to get_cpk_km_source_v2_off;
--   revoke execute on function public.get_cpk_km_source_v2_off(text,date,date,text,text) from public, anon, authenticated;
--   alter function public.get_cpk_km_source_v1_retired(text,date,date,text) rename to get_cpk_km_source;
--   grant execute on function public.get_cpk_km_source(text,date,date,text) to authenticated, service_role;
--   (same for get_cpk_hours_source(text,date,date,text), get_cpk_unit_audit(text,date,date),
--    get_cpk_km_intelligence(text,date,date))
-- =============================================================================
create or replace function pg_temp._cpk_rep1(d text, a text, b text, tag text)
returns text language plpgsql as $f$
begin
  if a is null or length(a) = 0 or (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then
    raise exception 'cpk site tabs: anchor not found exactly once (%)', tag;
  end if;
  return replace(d, a, b);
end $f$;

do $mig$
declare
  nl constant text := chr(10);
  v_country_guard constant text :=
    '  if p_country is not null and not public.app_can_see_country(p_country) then' || nl ||
    '    return jsonb_build_object(''ok'', false, ''reason'', ''forbidden''); end if;';
  v_site_guard constant text := nl ||
    '  if v_site is not null and not (public.is_super_admin() or public.app_can_see_site(p_site) is not false) then' || nl ||
    '    return jsonb_build_object(''ok'', false, ''reason'', ''forbidden''); end if;';
  v_decl_anchor constant text := 'v_to date := coalesce(p_to, current_date);';
  v_site_decl constant text := nl || '  v_site text := nullif(upper(regexp_replace(btrim(coalesce(p_site, '''')), ''\s+'', '' '', ''g'')), '''');';
  v_sig4 constant text := 'p_asset text DEFAULT NULL::text)' || nl || ' RETURNS jsonb';
  v_sig4_new constant text := 'p_asset text DEFAULT NULL::text, p_site text DEFAULT NULL::text)' || nl || ' RETURNS jsonb';
  v_sig3 constant text := 'p_to date DEFAULT NULL::date)' || nl || ' RETURNS jsonb';
  v_sig3_new constant text := 'p_to date DEFAULT NULL::date, p_site text DEFAULT NULL::text)' || nl || ' RETURNS jsonb';
  d text;
begin
  -- ---------------------------------------------------------- get_cpk_km_source
  d := pg_get_functiondef('public.get_cpk_km_source(text,date,date,text)'::regprocedure);
  d := pg_temp._cpk_rep1(d, v_sig4, v_sig4_new, 'km_source signature');
  d := pg_temp._cpk_rep1(d, v_decl_anchor, v_decl_anchor || v_site_decl, 'km_source declare');
  d := pg_temp._cpk_rep1(d, v_country_guard, v_country_guard || v_site_guard, 'km_source guard');
  d := pg_temp._cpk_rep1(d,
    'and coalesce(t.removal_date, t.issue_date) between v_from and v_to' || nl || '         group by 1',
    'and coalesce(t.removal_date, t.issue_date) between v_from and v_to' || nl ||
    '           and (v_site is null or exists (select 1 from public.vehicle_fleet f where f.organisation_id = v_org and f.country is not distinct from t.country and upper(btrim(f.asset_no)) = upper(btrim(t.asset_no)) and upper(btrim(f.site)) = v_site))' || nl ||
    '         group by 1', 'km_source by_asset');
  d := pg_temp._cpk_rep1(d,
    'and coalesce(t.removal_date, t.issue_date) between v_from and v_to;',
    'and coalesce(t.removal_date, t.issue_date) between v_from and v_to' || nl ||
    '     and (v_site is null or exists (select 1 from public.vehicle_fleet f where f.organisation_id = v_org and f.country is not distinct from t.country and upper(btrim(f.asset_no)) = upper(btrim(t.asset_no)) and upper(btrim(f.site)) = v_site));',
    'km_source asset');
  alter function public.get_cpk_km_source(text,date,date,text) rename to get_cpk_km_source_v1_retired;
  revoke execute on function public.get_cpk_km_source_v1_retired(text,date,date,text) from public, anon, authenticated;
  execute d;
  revoke execute on function public.get_cpk_km_source(text,date,date,text,text) from public;
  revoke execute on function public.get_cpk_km_source(text,date,date,text,text) from anon;
  grant execute on function public.get_cpk_km_source(text,date,date,text,text) to authenticated, service_role;

  -- ------------------------------------------------------- get_cpk_hours_source
  d := pg_get_functiondef('public.get_cpk_hours_source(text,date,date,text)'::regprocedure);
  d := pg_temp._cpk_rep1(d, v_sig4, v_sig4_new, 'hours_source signature');
  d := pg_temp._cpk_rep1(d, v_decl_anchor, v_decl_anchor || v_site_decl, 'hours_source declare');
  d := pg_temp._cpk_rep1(d, v_country_guard, v_country_guard || v_site_guard, 'hours_source guard');
  d := pg_temp._cpk_rep1(d,
    'and e.reading_date between v_from and v_to' || nl || '         group by 1 having count(*) > 1',
    'and e.reading_date between v_from and v_to' || nl ||
    '           and (v_site is null or exists (select 1 from public.vehicle_fleet f where f.organisation_id = v_org and f.country is not distinct from e.country and upper(btrim(f.asset_no)) = upper(btrim(e.asset_no)) and upper(btrim(f.site)) = v_site))' || nl ||
    '         group by 1 having count(*) > 1', 'hours_source by_asset');
  d := pg_temp._cpk_rep1(d,
    'and e.reading_date between v_from and v_to;',
    'and e.reading_date between v_from and v_to' || nl ||
    '     and (v_site is null or exists (select 1 from public.vehicle_fleet f where f.organisation_id = v_org and f.country is not distinct from e.country and upper(btrim(f.asset_no)) = upper(btrim(e.asset_no)) and upper(btrim(f.site)) = v_site));',
    'hours_source asset');
  alter function public.get_cpk_hours_source(text,date,date,text) rename to get_cpk_hours_source_v1_retired;
  revoke execute on function public.get_cpk_hours_source_v1_retired(text,date,date,text) from public, anon, authenticated;
  execute d;
  revoke execute on function public.get_cpk_hours_source(text,date,date,text,text) from public;
  revoke execute on function public.get_cpk_hours_source(text,date,date,text,text) from anon;
  grant execute on function public.get_cpk_hours_source(text,date,date,text,text) to authenticated, service_role;

  -- --------------------------------------------------------- get_cpk_unit_audit
  d := pg_get_functiondef('public.get_cpk_unit_audit(text,date,date)'::regprocedure);
  d := pg_temp._cpk_rep1(d, v_sig3, v_sig3_new, 'unit_audit signature');
  d := pg_temp._cpk_rep1(d, v_decl_anchor, v_decl_anchor || v_site_decl, 'unit_audit declare');
  d := pg_temp._cpk_rep1(d, v_country_guard, v_country_guard || v_site_guard, 'unit_audit guard');
  d := pg_temp._cpk_rep1(d,
    'and coalesce(t.removal_date, t.issue_date) between v_from and v_to' || nl || '     group by 1, 2',
    'and coalesce(t.removal_date, t.issue_date) between v_from and v_to' || nl ||
    '       and (v_site is null or exists (select 1 from public.vehicle_fleet f where f.organisation_id = v_org and f.country is not distinct from t.country and upper(btrim(f.asset_no)) = upper(btrim(t.asset_no)) and upper(btrim(f.site)) = v_site))' || nl ||
    '     group by 1, 2', 'unit_audit km');
  d := pg_temp._cpk_rep1(d,
    'and e.reading_date between v_from and v_to' || nl || '       group by 1, 2',
    'and e.reading_date between v_from and v_to' || nl ||
    '         and (v_site is null or exists (select 1 from public.vehicle_fleet f where f.organisation_id = v_org and f.country is not distinct from e.country and upper(btrim(f.asset_no)) = upper(btrim(e.asset_no)) and upper(btrim(f.site)) = v_site))' || nl ||
    '       group by 1, 2', 'unit_audit hrs');
  alter function public.get_cpk_unit_audit(text,date,date) rename to get_cpk_unit_audit_v1_retired;
  revoke execute on function public.get_cpk_unit_audit_v1_retired(text,date,date) from public, anon, authenticated;
  execute d;
  revoke execute on function public.get_cpk_unit_audit(text,date,date,text) from public;
  revoke execute on function public.get_cpk_unit_audit(text,date,date,text) from anon;
  grant execute on function public.get_cpk_unit_audit(text,date,date,text) to authenticated, service_role;

  -- ---------------------------------------------------- get_cpk_km_intelligence
  d := pg_get_functiondef('public.get_cpk_km_intelligence(text,date,date)'::regprocedure);
  d := pg_temp._cpk_rep1(d, v_sig3, v_sig3_new, 'km_intel signature');
  d := pg_temp._cpk_rep1(d, v_decl_anchor, v_decl_anchor || v_site_decl, 'km_intel declare');
  d := pg_temp._cpk_rep1(d, v_country_guard, v_country_guard || v_site_guard, 'km_intel guard');
  d := pg_temp._cpk_rep1(d,
    'and coalesce(btrim(asset_no),'''')<>''''),',
    'and coalesce(btrim(asset_no),'''')<>''''' || nl ||
    '                 and (v_site is null or upper(btrim(site)) = v_site)),', 'km_intel fleet');
  alter function public.get_cpk_km_intelligence(text,date,date) rename to get_cpk_km_intelligence_v1_retired;
  revoke execute on function public.get_cpk_km_intelligence_v1_retired(text,date,date) from public, anon, authenticated;
  execute d;
  revoke execute on function public.get_cpk_km_intelligence(text,date,date,text) from public;
  revoke execute on function public.get_cpk_km_intelligence(text,date,date,text) from anon;
  grant execute on function public.get_cpk_km_intelligence(text,date,date,text) to authenticated, service_role;
end
$mig$;

