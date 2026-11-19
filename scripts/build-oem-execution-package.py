#!/usr/bin/env python3
"""Regenerates docs/oem-catalog/execution/*.sql from the ONE migration file, so rehearsal and apply embed identical bytes.
Usage: python3 scripts/build-oem-execution-package.py"""
import hashlib, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
mig_path = root / 'supabase/pending_migrations/20261118100000_oem_catalog_advanced.sql'
M = mig_path.read_text()
SHA = hashlib.sha256(M.encode()).hexdigest()
out = root / 'docs/oem-catalog/execution'
out.mkdir(parents=True, exist_ok=True)

FP = '4270e1621f940a37d226c538118114e7'
HEAD_LOCKS = "set local lock_timeout = '5s';\nset local statement_timeout = '120s';\n"
PRE_GUARD = f"""do $guard$
begin
  if (select count(*) from public.oem_parts_manuals) <> 4 or (select count(*) from public.oem_parts_entries) <> 1652 then
    raise exception 'GUARD: expected 4 manuals and 1652 entries, found % and %. Nothing was changed.',
      (select count(*) from public.oem_parts_manuals), (select count(*) from public.oem_parts_entries);
  end if;
  if (select md5(coalesce(string_agg(id::text || part_no || description || coalesce(quantity::text,''), '|' order by id),'')) from public.oem_parts_entries) <> '{FP}' then
    raise exception 'GUARD: entries fingerprint differs from the saved baseline. Nothing was changed.';
  end if;
  if to_regproc('public.oem_catalog_admin') is not null or to_regclass('public.oem_figures') is not null then
    raise exception 'GUARD: the migration objects already exist (applied or a previous rehearsal persisted). Nothing was changed.';
  end if;
  if to_regclass('_bak.oem_policies_20261118') is null or (select count(*) from _bak.oem_policies_20261118) <> 22 then
    raise exception 'GUARD: baseline _bak.oem_policies_20261118 (22 rows) is missing. Run file 01 first.';
  end if;
  if to_regclass('_bak.oem_grants_20261118') is null then
    raise exception 'GUARD: baseline _bak.oem_grants_20261118 is missing. Run file 01 first.';
  end if;
end $guard$;
"""

POLICY_DIFF = """
-- Differences between live policies (2 OEM tables + storage oem_parts_pdf*) and the saved baseline.
create or replace function pg_temp.oem_policy_diff() returns table(side text, schemaname name, tablename name, policyname name, cmd text)
language sql as $f$
  select 'baseline_not_live'::text, b.schemaname, b.tablename, b.policyname, b.cmd from _bak.oem_policies_20261118 b
   where not exists (select 1 from pg_policies p where p.schemaname = b.schemaname and p.tablename = b.tablename and p.policyname = b.policyname
     and p.permissive = b.permissive and p.cmd = b.cmd and p.roles::text = b.roles::text
     and p.qual is not distinct from b.qual and p.with_check is not distinct from b.with_check)
  union all
  select 'live_not_baseline', p.schemaname, p.tablename, p.policyname, p.cmd from pg_policies p
   where ((p.schemaname = 'public' and p.tablename in ('oem_parts_manuals','oem_parts_entries')) or (p.schemaname = 'storage' and p.policyname like 'oem_parts_pdf%'))
     and not exists (select 1 from _bak.oem_policies_20261118 b where p.schemaname = b.schemaname and p.tablename = b.tablename and p.policyname = b.policyname
     and p.permissive = b.permissive and p.cmd = b.cmd and p.roles::text = b.roles::text
     and p.qual is not distinct from b.qual and p.with_check is not distinct from b.with_check)
$f$;
"""

def write(name, text):
    (out / name).write_text(text)

# ---- 01 preflight + baselines
write('01_PREFLIGHT_before.sql', f"""-- FILE 01: PREFLIGHT + baseline. Writes ONLY to the _bak schema (idempotent). Save the output.
-- Expected: manuals 4, entries 1652, fingerprint {FP}, storage objects 2, baseline policies 22, baseline grants (note the count), new objects absent.
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
""")


ASSERT = f"""
do $assert$
declare diff int; bad int;
begin
  if (select count(*) from public.oem_parts_manuals) <> 4 or (select count(*) from public.oem_parts_entries) <> 1652 then raise exception 'ASSERT: row counts changed'; end if;
  if (select md5(coalesce(string_agg(id::text || part_no || description || coalesce(quantity::text,''), '|' order by id),'')) from public.oem_parts_entries) <> '{FP}' then raise exception 'ASSERT: entries fingerprint changed'; end if;
  if (select count(*) from storage.objects where bucket_id = 'oem-parts-catalogs') <> 2 then raise exception 'ASSERT: storage object count changed'; end if;
  if (select count(*) from public.oem_parts_entries where review_status <> 'published' or admin_corrected) <> 0 then raise exception 'ASSERT: existing entries not all published/uncorrected'; end if;
  if to_regclass('public.oem_figures') is null or to_regclass('public.oem_review_items') is null or to_regclass('public.oem_corrections') is null or to_regclass('public.oem_category_rules') is null then raise exception 'ASSERT: new tables missing'; end if;
  if (select count(*) from pg_proc where proname in ('oem_catalog_admin','oem_apply_correction','oem_reassign_entries','oem_figure_merge','oem_figure_split','oem_protect_corrected') and pronamespace = 'public'::regnamespace) <> 6 then raise exception 'ASSERT: expected 6 functions'; end if;
  if has_function_privilege('anon', 'public.oem_figure_merge(uuid,text,text)', 'execute') then raise exception 'ASSERT: anon can execute the figure tools'; end if;
  select count(*) into bad from pg_policies where schemaname = 'public' and tablename in ('oem_parts_manuals','oem_parts_entries') and cmd in ('INSERT','UPDATE','DELETE')
    and policyname in ('oem_parts_manuals_insert','oem_parts_manuals_update','oem_parts_manuals_delete','oem_parts_entries_insert','oem_parts_entries_update','oem_parts_entries_delete')
    and coalesce(qual,'') || coalesce(with_check,'') not like '%oem_catalog_admin%';
  if bad <> 0 then raise exception 'ASSERT: % write policies do not use oem_catalog_admin()', bad; end if;
  -- read policies (SELECT) of the two tables must be byte-identical to the baseline
  select count(*) into diff from _bak.oem_policies_20261118 b where b.cmd = 'SELECT' and b.schemaname = 'public' and not exists (
    select 1 from pg_policies p where p.schemaname = b.schemaname and p.tablename = b.tablename and p.policyname = b.policyname and p.permissive = b.permissive
      and p.cmd = b.cmd and p.roles::text = b.roles::text and p.qual is not distinct from b.qual and p.with_check is not distinct from b.with_check);
  if diff <> 0 then raise exception 'ASSERT: % read policies differ from the baseline', diff; end if;
  select count(*) into diff from _bak.oem_policies_20261118 b where b.policyname like 'anum_reader%' and not exists (
    select 1 from pg_policies p where p.schemaname = b.schemaname and p.tablename = b.tablename and p.policyname = b.policyname and p.qual is not distinct from b.qual and p.with_check is not distinct from b.with_check);
  if diff <> 0 then raise exception 'ASSERT: % integration reader policies changed', diff; end if;
  select count(*) into diff from _bak.oem_grants_20261118 b where not exists (select 1 from information_schema.table_privileges g where g.table_schema = 'public' and g.table_name = b.table_name and g.grantee = b.grantee and g.privilege_type = b.privilege_type);
  if diff <> 0 then raise exception 'ASSERT: % baseline grants missing', diff; end if;
end $assert$;
"""

# ---- 02 rehearsal
PROBE = r"""
-- ---- Synthetic probe data, created by the owner role inside this transaction (rolled back with everything else).
-- Real catalog rows are only ever COUNTED below, never updated or deleted.
do $synth$
declare org uuid; man uuid := '00000000-0000-0000-0000-0000000f0001'; ent uuid := '00000000-0000-0000-0000-0000000f0002'; ent2 uuid := '00000000-0000-0000-0000-0000000f0003';
begin
  select organisation_id into org from public.oem_parts_manuals order by created_at limit 1;
  insert into public.oem_parts_manuals (id, organisation_id, manufacturer, model, source_file_name, source_sha256)
    values (man, org, 'PROBE', 'PROBE', 'probe.pdf', 'probe-sha-rehearsal-only');
  insert into public.oem_parts_entries (id, organisation_id, manual_id, source_pdf_page, row_order, part_no, description, figure_id)
    values (ent, org, man, 9999, 1, 'PROBE-0001', 'probe one', 'PROBE-A'), (ent2, org, man, 9999, 2, 'PROBE-0002', 'probe two', 'PROBE-A');
  insert into public.oem_figures (organisation_id, manual_id, figure_id, pdf_page, crop)
    values (org, man, 'PROBE-A', 9999, '{"x0":0,"y0":0,"x1":10,"y1":10}'), (org, man, 'PROBE-B', 9999, '{"x0":10,"y0":0,"x1":20,"y1":10}');
end $synth$;

do $probe$
declare
  log text := '';
  u record; n int; m int; e int; rc int;
  man uuid := '00000000-0000-0000-0000-0000000f0001'; ent uuid := '00000000-0000-0000-0000-0000000f0002'; ent2 uuid := '00000000-0000-0000-0000-0000000f0003';
begin
  for u in select * from (values
    ('manager','34793423-43df-4b6f-9270-9d1e8be6fa30'),
    ('tyreman','1cd74900-64fe-4f3a-913c-b9060f088ff3'),
    ('vinay','06161659-c666-48ac-82f3-5887b1082dc2'),
    ('admin','58787cc7-818b-4fd5-8b7b-c93e4e01f641')) as v(label,id) loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.id, 'role','authenticated','aal','aal2')::text, true);
    execute 'set local role authenticated';
    select count(*) into m from public.oem_parts_manuals where id <> man;
    select count(*) into e from public.oem_parts_entries where manual_id <> man;
    log := log || format(E'\n%s realManuals=%s realEntries=%s', u.label, m, e);
    begin select count(*) into n from public.oem_review_items; log := log || format(' review=%s', n); exception when others then log := log || ' review=ERR'; end;
    begin insert into public.oem_parts_manuals (manufacturer, model, source_file_name, source_sha256) values ('PROBE','PROBE','p2.pdf','probe-sha-2-'||u.label); log := log || ' insertManual=ALLOWED'; exception when others then log := log || ' insertManual=blocked'; end;
    begin update public.oem_parts_entries set description = 'probe changed' where id = ent; get diagnostics rc = row_count; log := log || ' updateSynthetic='||rc; exception when others then log := log || ' updateSynthetic=ERR'; end;
    begin perform public.oem_apply_correction(ent, 'remark', 'probe', 'rehearsal'); log := log || ' correction=ALLOWED'; exception when others then log := log || ' correction=blocked'; end;
    begin delete from public.oem_parts_entries where id = ent2; get diagnostics rc = row_count; log := log || ' deleteSynthetic='||rc; exception when others then log := log || ' deleteSynthetic=ERR'; end;
    begin delete from public.oem_parts_entries where id = ent; get diagnostics rc = row_count; log := log || ' deleteCorrectedSynthetic='||rc; exception when others then log := log || ' deleteCorrectedSynthetic=blocked'; end;
    begin perform public.oem_reassign_entries(man, array[ent], 'PROBE-B'); log := log || ' reassign=ALLOWED'; exception when others then log := log || ' reassign=blocked'; end;
    begin perform public.oem_figure_merge(man, 'PROBE-B', 'PROBE-A'); log := log || ' merge=ALLOWED'; exception when others then log := log || ' merge=blocked'; end;
    begin perform public.oem_figure_split(man, 'PROBE-A', 'PROBE-C', '{"x0":0,"y0":0,"x1":5,"y1":5}'::jsonb, array[ent]); log := log || ' split=ALLOWED'; exception when others then log := log || ' split=blocked'; end;
    begin insert into storage.objects (bucket_id, name) values ('oem-parts-catalogs', man::text || '/probe.pdf'); log := log || ' storageInsert=ALLOWED'; exception when others then log := log || ' storageInsert=blocked'; end;
    begin select count(*) into n from public.parts_requests; log := log || ' partsRequestsVisible=' || n; exception when others then log := log || ' partsRequests=ERR'; end;
    begin select count(*) into n from public.oem_figures where manual_id = man; log := log || ' syntheticFiguresVisible=' || n; exception when others then log := log || ' figures=ERR'; end;
    execute 'reset role';
  end loop;
  raise exception 'PROBE RESULTS:%', log;
end $probe$;
"""
write('02_REHEARSAL_rolled_back.sql', f"""-- FILE 02: ROLLED-BACK REHEARSAL (migration sha256 {SHA}).
-- Atomic: explicit begin; first statement; guard aborts before touching anything unless the catalog matches the baseline.
-- It ENDS WITH A DELIBERATE ERROR 'PROBE RESULTS: ...': that error is the success signal and leaves nothing behind.
-- The same assert block as the apply runs before the probes, so the rehearsal fails exactly where the apply would.
-- Then run 02b (it starts with rollback; to clear the aborted transaction).
begin;
{HEAD_LOCKS}{PRE_GUARD}
{M}
{ASSERT}
{PROBE}""")

write('02b_after_rehearsal_nothing_persisted.sql', """rollback;
-- FILE 02b: run right after file 02. The rollback above clears the aborted transaction (a harmless 'no transaction in progress' warning means it was already clear).
-- Expected: false, false, 4, 1652, 0 synthetic rows.
select to_regproc('public.oem_catalog_admin') is not null as admin_fn_exists, to_regclass('public.oem_figures') is not null as figures_exists;
select (select count(*) from public.oem_parts_manuals) as manuals, (select count(*) from public.oem_parts_entries) as entries;
select count(*) as synthetic_rows_left from public.oem_parts_manuals where source_sha256 like 'probe-sha%';
""")

# ---- 03 apply
write('03_APPLY_migration.sql', f"""-- FILE 03: APPLY (migration sha256 {SHA}). All or nothing: begin; ... commit;
-- Any guard or assert failure aborts the whole transaction and nothing is changed.
-- If the editor shows an error, run `rollback;` once and send me the message.
begin;
{HEAD_LOCKS}{PRE_GUARD}
{M}
{ASSERT}
commit;
""")

# ---- 04 rollback (baseline-driven)
RESTORE = """
do $restore$
declare r record; n int := 0;
begin
  for r in select * from _bak.oem_policies_20261118 b
    where (b.schemaname = 'public' and b.tablename in ('oem_parts_manuals','oem_parts_entries') and b.policyname in
            ('oem_parts_manuals_insert','oem_parts_manuals_update','oem_parts_manuals_delete','oem_parts_entries_insert','oem_parts_entries_update','oem_parts_entries_delete'))
       or (b.schemaname = 'storage' and b.policyname in ('oem_parts_pdf_insert','oem_parts_pdf_update','oem_parts_pdf_delete'))
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    execute format('create policy %I on %I.%I as %s for %s to %s%s%s', r.policyname, r.schemaname, r.tablename, r.permissive, r.cmd,
      array_to_string(r.roles, ', '),
      case when r.qual is not null then ' using (' || r.qual || ')' else '' end,
      case when r.with_check is not null then ' with check (' || r.with_check || ')' else '' end);
    n := n + 1;
  end loop;
  if n <> 9 then raise exception 'ROLLBACK: expected to restore 9 baseline policies, restored %', n; end if;
end $restore$;
"""
write('04_ROLLBACK_only_if_needed.sql', f"""-- FILE 04 (only if needed): ROLLBACK to the exact saved baseline. All or nothing.
-- Restores the 9 policies the migration replaced from _bak.oem_policies_20261118 (same names, commands, roles, USING and WITH CHECK text),
-- removes the objects the migration created, then asserts ZERO differences against the baseline policies and baseline grants.
-- Added columns on oem_parts_manuals / oem_parts_entries are kept (nullable or defaulted, harmless).
-- WARNING: the new tables are removed. Export oem_figures, oem_review_items, oem_corrections, oem_category_rules first if they hold data.
-- This file contains the word drop: the Supabase connector will ask for confirmation; the SQL Editor does not.
begin;
{HEAD_LOCKS}
do $guard$ begin
  if to_regclass('_bak.oem_policies_20261118') is null or (select count(*) from _bak.oem_policies_20261118) <> 22 then raise exception 'ROLLBACK GUARD: baseline policies missing'; end if;
  if to_regclass('_bak.oem_grants_20261118') is null then raise exception 'ROLLBACK GUARD: baseline grants missing'; end if;
end $guard$;
{RESTORE}
drop function if exists public.oem_reassign_entries(uuid, uuid[], text);
drop function if exists public.oem_figure_merge(uuid, text, text);
drop function if exists public.oem_figure_split(uuid, text, text, jsonb, uuid[]);
drop trigger if exists oem_protect_corrected_trg on public.oem_parts_entries;
drop function if exists public.oem_protect_corrected();
drop function if exists public.oem_apply_correction(uuid, text, text, text);
drop table if exists public.oem_category_rules;
drop table if exists public.oem_corrections;
drop table if exists public.oem_review_items;
drop table if exists public.oem_figures;
drop function if exists public.oem_catalog_admin();
{POLICY_DIFF}
do $verify$
declare d int; g int;
begin
  select count(*) into d from pg_temp.oem_policy_diff();
  select count(*) into g from _bak.oem_grants_20261118 b where not exists (select 1 from information_schema.table_privileges x where x.table_schema = 'public' and x.table_name = b.table_name and x.grantee = b.grantee and x.privilege_type = b.privilege_type);
  if d <> 0 or g <> 0 then raise exception 'ROLLBACK VERIFY: % policy differences and % missing grants versus the baseline. Nothing was changed.', d, g; end if;
  if (select count(*) from public.oem_parts_manuals) <> 4 or (select count(*) from public.oem_parts_entries) <> 1652 then raise exception 'ROLLBACK VERIFY: row counts changed'; end if;
end $verify$;
commit;
""")

write('04b_VERIFY_rollback_vs_baseline.sql', f"""-- FILE 04b: read-only comparison of live OEM policies against the saved baseline.
-- After 03 (apply) expect 9 rows of baseline_not_live and 9 rows of live_not_baseline (the 9 admin-only write policies).
-- After 04 (rollback) expect ZERO rows.
{POLICY_DIFF}
select * from pg_temp.oem_policy_diff() order by 1, 2, 3, 4;
""")

# ---- 05 verify
write('05_VERIFY_after_apply.sql', f"""-- FILE 05: VERIFY after file 03. Read-only. Expected values in the comments.
select count(*) as manuals, (select count(*) from public.oem_parts_entries) as entries from public.oem_parts_manuals;                 -- 4, 1652
select md5(string_agg(id::text || part_no || description || coalesce(quantity::text,''), '|' order by id)) as entries_fingerprint from public.oem_parts_entries; -- {FP}
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
""")

# ---- 06 vinay
VID = '06161659-c666-48ac-82f3-5887b1082dc2'; SUP = '58787cc7-818b-4fd5-8b7b-c93e4e01f641'
write('06_VINAY_view_only_grant.sql', f"""-- FILE 06 (after file 05 is clean): give Vinay Kumar T the route key for the OEM catalog page, VIEW ONLY.
-- Verified read-only against the live database on 2026-11-18/19:
--   profile {VID}: VINAY KUMAR T, role 'Workshop Maintenance Area Manager' (custom role, active), approved, not locked, not super admin,
--   org_id = organisation_id = 00000000-0000-0000-0000-000000000001, country {{KSA}}, sites {{ALL}}, no existing user_access_grants rows.
--   module_permissions has a row for his role only for 'stock'; none for 'parts_catalog_oem_preview'.
--   The route /parts-catalog/oem-preview allows Admin, Manager, Director; a custom role passes only with an explicit grant or an enabled matrix row,
--   so this grant IS required for the page to open for him. governingModuleKey('/parts-catalog/oem-preview') = 'parts_catalog_oem_preview'.
--   His DATABASE rights (read published manuals, no writes) do not depend on this grant (RLS read = any signed-in member of the organisation).
--   The sidebar item /parts-catalog is Admin/Manager/Director only, so he opens the OEM page by its address or a link, not from the sidebar.
-- Provenance: user_access_grants has two audit triggers (access_audit via log_access_audit_generic, org admin audit). The SQL editor has no
--   signed-in user, so access_audit.actor will be NULL; we therefore set the audit reason and granted_by explicitly
--   (granted_by = {SUP}, shahzeb Rahman, super admin; FK to profiles, nullable).
begin;
select set_config('app.access_reason', 'OEM catalog view-only route grant for Vinay Kumar T (owner decision 2026-11-18, run in SQL editor)', true);
insert into public.user_access_grants (org_id, user_id, module_key, capability, effect, granted_by, note)
select p.org_id, p.id, 'parts_catalog_oem_preview', 'view', 'grant', '{SUP}', 'OEM catalog: view only (owner decision 2026-11-18)'
from public.profiles p
where p.id = '{VID}' and p.approved and not p.locked and not p.is_super_admin and p.role = 'Workshop Maintenance Area Manager'
on conflict (user_id, module_key, capability, effect) do nothing;
do $a$ begin
  if (select count(*) from public.user_access_grants where user_id = '{VID}') <> 1 then raise exception 'ASSERT: Vinay must have exactly one grant row'; end if;
end $a$;
commit;
-- Verify: one row (grant, view, granted_by shahzeb) and one access_audit row with the reason text
select user_id, module_key, capability, effect, granted_by, note from public.user_access_grants where user_id = '{VID}';
select action, entity, target_user, actor, reason, at from public.access_audit where target_user = '{VID}' order by at desc limit 3;
-- Undo: delete from public.user_access_grants where user_id = '{VID}' and module_key = 'parts_catalog_oem_preview';
""")

# ---- 07 ledger
write('07_RECORD_in_migration_ledger.sql', f"""-- FILE 07: record the manual run in supabase_migrations.schema_migrations so the ledger matches the database.
-- Columns (verified read-only): version text PK, statements text[], name text, created_by text, idempotency_key text unique, rollback text[].
-- Recent rows hold the full SQL; a short marker is used here and the file is identified by its sha256.
insert into supabase_migrations.schema_migrations (version, name, statements, created_by)
select '20261118100000', 'oem_catalog_advanced',
       array['-- applied manually from supabase/pending_migrations/20261118100000_oem_catalog_advanced.sql, sha256 {SHA}, by the owner in the SQL editor on 2026-11-19'],
       'owner (SQL editor)'
where to_regclass('public.oem_figures') is not null
on conflict do nothing;
select version, name, created_by from supabase_migrations.schema_migrations where version = '20261118100000';   -- 1 row
-- AFTER this file succeeds (agent does it on the branch once you say "executed"): move
--   supabase/pending_migrations/20261118100000_oem_catalog_advanced.sql  ->  supabase/migrations/
-- and update the paths in supabase/tests/oem_catalog_access.test.mjs and supabase/tests/oem_execution_package.test.mjs.
""")
print('built', SHA)
