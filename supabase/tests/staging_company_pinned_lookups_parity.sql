-- Output fingerprints of the five functions for one user (psql -v uid=<uuid>).
-- Prints "name|md5" lines; read-only, ends in ROLLBACK.
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, true);
set local role authenticated;
-- Compared as sets: both order only by a count, so rows that tie may come back
-- in either order when the plan changes; the order of ties is not a contract.
select 'report_asset_overview|' || md5((select jsonb_agg(e order by e::text) from jsonb_array_elements(public.report_asset_overview('All')) e)::text);
select 'report_asset_overview_ksa|' || md5((select jsonb_agg(e order by e::text) from jsonb_array_elements(public.report_asset_overview('KSA')) e)::text);
select 'report_asset_metrics|' || md5((select jsonb_agg(e order by e::text) from jsonb_array_elements(public.report_asset_metrics('All', null, null)) e)::text);
select 'check_duplicate_serials|' || md5(coalesce(json_agg(d order by d.serial_no, d.existing_id)::text, ''))
  from public.check_duplicate_serials(array(select serial_no from public.tyre_records where serial_no is not null order by serial_no limit 300)) d;
select 'get_unplanned_assets|' || md5(coalesce(json_agg(u order by u.asset_no, u.country)::text, ''))
  from public.get_unplanned_assets(null, 30, null, 2000) u;
select 'asset_site_at|' || md5(string_agg(a.asset_no || '=' || coalesce((select s.site || ':' || s.evidence from public.asset_site_at(a.asset_no, a.country, current_date) s), '-'), ',' order by a.asset_no, a.country))
  from (select distinct asset_no, country from public.vehicle_fleet where asset_no is not null) a;
rollback;
