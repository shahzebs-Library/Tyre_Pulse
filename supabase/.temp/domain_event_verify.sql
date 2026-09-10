select jsonb_build_object(
  'trigger', (select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.domain_events'::regclass and tgname='guard_domain_event_mutation_trigger'),
  'old_trigger_absent', not exists(select 1 from pg_trigger where tgrelid='public.domain_events'::regclass and tgname='prevent_audit_mutation_trigger'),
  'guard_security_definer', (select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='guard_domain_event_mutation'),
  'guard_anon_execute', has_function_privilege('anon','public.guard_domain_event_mutation()','execute'),
  'guard_authenticated_execute', has_function_privilege('authenticated','public.guard_domain_event_mutation()','execute'),
  'pending_events', (select count(*) from public.domain_events where status='pending'),
  'latest_cron_runs', (select jsonb_agg(x order by start_time desc) from (
    select status, return_message, start_time, end_time
    from cron.job_run_details d join cron.job j using(jobid)
    where j.jobname='process-domain-events'
    order by start_time desc limit 3
  ) x),
  'migration_recorded', exists(select 1 from supabase_migrations.schema_migrations where version='20260830190620')
);
