-- FILE 04b: read-only comparison of live OEM policies against the saved baseline.
-- After 03 (apply) expect 9 rows of baseline_not_live and 9 rows of live_not_baseline (the 9 admin-only write policies).
-- After 04 (rollback) expect ZERO rows.

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

select * from pg_temp.oem_policy_diff() order by 1, 2, 3, 4;
