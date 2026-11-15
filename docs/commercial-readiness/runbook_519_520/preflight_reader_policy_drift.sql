-- Reader-policy drift: tables whose anum_reader_select_scope differs from what
-- anum_integration.apply_reader_policies() would write now. Must be 0 before steps 2 and 6
-- (both call apply_reader_policies()); otherwise those steps also rewrite these policies and the
-- step rollback cannot restore them.
with t as (
  select c.relname,
         exists (select 1 from anum_integration.reader_tables a where a.table_name = c.relname) as allowed,
         exists (select 1 from pg_attribute at where at.attrelid = c.oid and at.attname = 'organisation_id'
                   and not at.attisdropped and at.atttypid = 'uuid'::regtype) as has_org
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity)
select 'reader policy drift' as k, count(*) as tables_that_would_change, string_agg(t.relname, ', ' order by t.relname) as tables
  from t left join pg_policies p
    on p.schemaname = 'public' and p.tablename = t.relname and p.policyname = 'anum_reader_select_scope'
 where p.qual is distinct from case when t.allowed and t.has_org
         then '((NOT ( SELECT anum_integration.is_reader() AS is_reader)) OR (organisation_id = ( SELECT anum_integration.reader_org() AS reader_org)))'
         else '(NOT ( SELECT anum_integration.is_reader() AS is_reader))' end;
