-- Verify STEP 0 (read only). Every ok must be t.
\i runbook_519_520/preflight_reader_policy_drift.sql
with exp(tablename, policyname, cmd, qual, with_check) as (values
  ('observation_erp_links','anum_reader_select_scope','SELECT','(NOT ( SELECT anum_integration.is_reader() AS is_reader))',null),
  ('observation_erp_links','anum_reader_no_insert','INSERT',null,'(NOT ( SELECT anum_integration.is_reader() AS is_reader))'),
  ('observation_erp_links','anum_reader_no_update','UPDATE','(NOT ( SELECT anum_integration.is_reader() AS is_reader))','(NOT ( SELECT anum_integration.is_reader() AS is_reader))'),
  ('observation_erp_links','anum_reader_no_delete','DELETE','(NOT ( SELECT anum_integration.is_reader() AS is_reader))',null),
  ('observation_erp_link_events','anum_reader_select_scope','SELECT','(NOT ( SELECT anum_integration.is_reader() AS is_reader))',null),
  ('observation_erp_link_events','anum_reader_no_insert','INSERT',null,'(NOT ( SELECT anum_integration.is_reader() AS is_reader))'),
  ('observation_erp_link_events','anum_reader_no_update','UPDATE','(NOT ( SELECT anum_integration.is_reader() AS is_reader))','(NOT ( SELECT anum_integration.is_reader() AS is_reader))'),
  ('observation_erp_link_events','anum_reader_no_delete','DELETE','(NOT ( SELECT anum_integration.is_reader() AS is_reader))',null))
select 'ver0 8 policies exact (restrictive, authenticated, expressions)' k,
       (select count(*) from exp e join pg_policies p on p.schemaname='public' and p.tablename=e.tablename
          and p.policyname=e.policyname and p.cmd=e.cmd and p.permissive='RESTRICTIVE' and p.roles='{authenticated}'
          and p.qual is not distinct from e.qual and p.with_check is not distinct from e.with_check) = 8
   and (select count(*) from pg_policies where schemaname='public'
          and tablename in ('observation_erp_links','observation_erp_link_events') and policyname like 'anum\_reader\_%') = 8 ok;
select 'ver0 total policies on the two tables (expect 14 = 6 existing + 8)' k,
       (select count(*) from pg_policies where schemaname='public'
          and tablename in ('observation_erp_links','observation_erp_link_events')) = 14 ok;
select 'ver0 no permissive policy added (expect 2 permissive, both *_read)' k,
       (select count(*) from pg_policies where schemaname='public' and permissive='PERMISSIVE'
          and tablename in ('observation_erp_links','observation_erp_link_events')) = 2 ok;
select 'ver0 grants unchanged' k,
       (select array_agg(relacl::text order by relname) from pg_class where relnamespace='public'::regnamespace
          and relname in ('observation_erp_links','observation_erp_link_events'))
       = array['{postgres=arwdDxt/postgres,service_role=arwdDxt/postgres,authenticated=r/postgres}',
               '{postgres=arwdDxt/postgres,service_role=arwdDxt/postgres,authenticated=r/postgres}'] ok;
select 'ver0 ERP lock untouched (authenticated and anon cannot execute)' k,
       not exists (select 1 from pg_proc p where p.pronamespace='public'::regnamespace
         and p.proname in ('observation_erp_decide','confirm_observation_erp_link','reject_observation_erp_link')
         and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))) ok;
