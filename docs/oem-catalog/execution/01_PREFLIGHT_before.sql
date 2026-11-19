-- FILE 01: PREFLIGHT + baseline. Writes ONLY to the _bak schema (idempotent). Save the output.
-- Expected: manuals 4, entries 1652, fingerprint 4270e1621f940a37d226c538118114e7, storage objects 2, baseline policies 22, baseline grants (note the count), new objects absent.
select count(*) as manuals, (select count(*) from public.oem_parts_entries) as entries from public.oem_parts_manuals;
select md5(string_agg(id::text || part_no || description || coalesce(quantity::text,''), '|' order by id)) as entries_fingerprint from public.oem_parts_entries;
select count(*) as storage_objects from storage.objects where bucket_id = 'oem-parts-catalogs';
-- Baseline of the grants on the 2 tables (policies and row copies were saved earlier in _bak.*_20261118).
create table if not exists _bak.oem_grants_20261118 as
  select grantee, table_name, privilege_type from information_schema.table_privileges
  where table_schema = 'public' and table_name in ('oem_parts_manuals','oem_parts_entries');
select (select count(*) from _bak.oem_parts_manuals_20261118) as bak_manuals,
       (select count(*) from _bak.oem_parts_entries_20261118) as bak_entries,
       (select count(*) from _bak.oem_policies_20261118) as bak_policies,
       (select count(*) from _bak.oem_grants_20261118) as bak_grants;   -- 4, 1652, 22, (count of grants, note it)
select to_regproc('public.oem_catalog_admin') is not null as admin_fn_exists, to_regclass('public.oem_figures') is not null as figures_exists;  -- false, false
