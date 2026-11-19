-- FILE 05: VERIFY after file 03. Read-only. Expected values in the comments.
select count(*) as manuals, (select count(*) from public.oem_parts_entries) as entries from public.oem_parts_manuals;                 -- 4, 1652
select md5(string_agg(id::text || part_no || description || coalesce(quantity::text,''), '|' order by id)) as entries_fingerprint from public.oem_parts_entries; -- 4270e1621f940a37d226c538118114e7
select count(*) as storage_objects from storage.objects where bucket_id = 'oem-parts-catalogs';                                         -- 2
select count(*) as not_published_or_corrected from public.oem_parts_entries where review_status <> 'published' or admin_corrected;     -- 0
select to_regclass('public.oem_figures') is not null as figures, to_regclass('public.oem_review_items') is not null as review,
       to_regclass('public.oem_corrections') is not null as corrections, to_regclass('public.oem_category_rules') is not null as rules; -- all true
select proname from pg_proc where proname in ('oem_catalog_admin','oem_apply_correction','oem_reassign_entries','oem_figure_merge','oem_figure_split','oem_protect_corrected') and pronamespace = 'public'::regnamespace order by 1; -- 6 rows
select has_function_privilege('anon','public.oem_figure_merge(uuid,text,text)','execute') as anon_can_merge;                              -- false
select policyname, cmd, qual, with_check from pg_policies where tablename in ('oem_parts_manuals','oem_parts_entries') and cmd in ('INSERT','UPDATE','DELETE') and policyname like 'oem_parts_%' order by 1; -- every qual/with_check mentions oem_catalog_admin()
select policyname, cmd from pg_policies where tablename in ('oem_parts_manuals','oem_parts_entries') and cmd = 'SELECT' order by 1;    -- read policies, unchanged from file 01
select policyname from pg_policies where schemaname='storage' and policyname like 'oem_parts_pdf%' order by 1;                           -- 4 (read + 3 admin-only writes)
select count(*) as new_table_rows from (select 1 from public.oem_figures union all select 1 from public.oem_review_items union all select 1 from public.oem_corrections union all select 1 from public.oem_category_rules) x; -- 0
select count(*) as reader_policy_tables from pg_policies where policyname like 'anum_reader%' and tablename in ('oem_figures','oem_review_items','oem_corrections','oem_category_rules'); -- >0 when the integration schema exists
-- Live comparison against the baseline: run 04b_VERIFY_rollback_vs_baseline.sql (expect 9 + 9 rows now).
