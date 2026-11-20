-- FILE 04 (only if needed): ROLLBACK to the exact saved baseline. All or nothing.
-- Restores the 9 policies the migration replaced from _bak.oem_policies_20261118 (same names, commands, roles, USING and WITH CHECK text),
-- removes the objects the migration created, then asserts ZERO differences against the baseline policies and baseline grants.
-- Added columns on oem_parts_manuals / oem_parts_entries are kept (nullable or defaulted, harmless).
-- WARNING: the new tables are removed. Export oem_figures, oem_review_items, oem_corrections, oem_category_rules first if they hold data.
-- This file contains the word drop: the Supabase connector will ask for confirmation; the SQL Editor does not.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$ begin
  if to_regclass('_bak.oem_policies_20261118') is null or (select count(*) from _bak.oem_policies_20261118) <> 22 then raise exception 'ROLLBACK GUARD: baseline policies missing'; end if;
  if to_regclass('_bak.oem_grants_20261118') is null then raise exception 'ROLLBACK GUARD: baseline grants missing'; end if;
end $guard$;

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

do $verify$
declare d int; g int;
begin
  select count(*) into d from pg_temp.oem_policy_diff();
  select count(*) into g from _bak.oem_grants_20261118 b where not exists (select 1 from information_schema.table_privileges x where x.table_schema = 'public' and x.table_name = b.table_name and x.grantee = b.grantee and x.privilege_type = b.privilege_type);
  if d <> 0 or g <> 0 then raise exception 'ROLLBACK VERIFY: % policy differences and % missing grants versus the baseline. Nothing was changed.', d, g; end if;
  if (select count(*) from public.oem_parts_manuals) <> 4 or (select count(*) from public.oem_parts_entries) <> 1652 then raise exception 'ROLLBACK VERIFY: row counts changed'; end if;
end $verify$;
commit;
