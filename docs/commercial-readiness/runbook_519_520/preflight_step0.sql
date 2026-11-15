-- Preflight for STEP 0 (read only). Record every output. Expected on production 2026-11-15:
--   drift = 2 (observation_erp_link_events, observation_erp_links); anum_reader_* on the two tables = 0;
--   policy list = the 6 lines below the query; ACL = authenticated r + service_role all, no anon;
--   ERP functions: authenticated f, anon f.
\i runbook_519_520/preflight_reader_policy_drift.sql
select 'pre0 anum_reader policies on the two tables (expect 0)' k, count(*) from pg_policies
 where schemaname='public' and tablename in ('observation_erp_links','observation_erp_link_events') and policyname like 'anum\_reader\_%';
select 'pre0 listed in reader_tables (expect 0)' k, count(*) from anum_integration.reader_tables
 where table_name in ('observation_erp_links','observation_erp_link_events');
select tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies
 where schemaname='public' and tablename in ('observation_erp_links','observation_erp_link_events') order by 1,2;
select relname, relacl, relrowsecurity, relforcerowsecurity from pg_class
 where relnamespace='public'::regnamespace and relname in ('observation_erp_links','observation_erp_link_events') order by 1;
select p.oid::regprocedure fn, p.proacl,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_exec,
       has_function_privilege('anon', p.oid, 'EXECUTE') anon_exec
  from pg_proc p where p.pronamespace='public'::regnamespace
   and p.proname in ('observation_erp_decide','confirm_observation_erp_link','reject_observation_erp_link') order by 1;
