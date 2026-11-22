rollback;
-- FILE 02b: run right after file 02. The rollback above clears the aborted transaction (a harmless 'no transaction in progress' warning means it was already clear).
-- Expected: false, false, 4, 1652, 0 synthetic rows.
select to_regproc('public.oem_catalog_admin') is not null as admin_fn_exists, to_regclass('public.oem_figures') is not null as figures_exists;
select (select count(*) from public.oem_parts_manuals) as manuals, (select count(*) from public.oem_parts_entries) as entries;
select count(*) as synthetic_rows_left from public.oem_parts_manuals where source_sha256 like 'probe-sha%';
