with funcs as (
  select p.oid, n.nspname as schema_name, p.proname,
    pg_get_function_identity_arguments(p.oid) as args,
    p.proconfig,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
    has_function_privilege('public', p.oid, 'EXECUTE') as public_exec
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef
    and n.nspname not in ('pg_catalog', 'information_schema')
), function_summary as (
select jsonb_build_object(
  'total', count(*),
  'public_schema', count(*) filter (where schema_name = 'public'),
  'unsafe_search_path', count(*) filter (
    where not exists (
      select 1 from unnest(coalesce(proconfig, '{}'::text[])) c
      where c like 'search_path=%'
    )
  ),
  'anon_exec', count(*) filter (where anon_exec),
  'authenticated_exec', count(*) filter (where auth_exec),
  'public_exec', count(*) filter (where public_exec),
  'unsafe_examples', coalesce(jsonb_agg(jsonb_build_object(
    'schema', schema_name, 'name', proname, 'args', args,
    'anon', anon_exec, 'auth', auth_exec
  )) filter (
    where not exists (
      select 1 from unnest(coalesce(proconfig, '{}'::text[])) c
      where c like 'search_path=%'
    )
  ), '[]'::jsonb)
) as value from funcs
), cron_summary as (
select jsonb_build_object(
  'cron_extension', exists(select 1 from pg_extension where extname = 'pg_cron'),
  'cron_jobs', case when to_regclass('cron.job') is null then null else (select count(*) from cron.job) end,
  'cron_config_table', to_regclass('public.cron_config') is not null,
  'cron_config_rls', coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.cron_config')), false),
  'cron_config_force_rls', coalesce((select relforcerowsecurity from pg_class where oid = to_regclass('public.cron_config')), false),
  'cron_config_anon_select', case when to_regclass('public.cron_config') is null then null else has_table_privilege('anon','public.cron_config','SELECT') end,
  'cron_config_auth_select', case when to_regclass('public.cron_config') is null then null else has_table_privilege('authenticated','public.cron_config','SELECT') end
) as value
), tenant_summary as (
select jsonb_build_object(
  'auth_users', (select count(*) from auth.users),
  'organisations', case when to_regclass('public.organisations') is null then null else (select count(*) from public.organisations) end,
  'profiles_with_org', case when to_regclass('public.profiles') is null then null else (select count(*) from public.profiles where organisation_id is not null) end,
  'distinct_profile_orgs', case when to_regclass('public.profiles') is null then null else (select count(distinct organisation_id) from public.profiles where organisation_id is not null) end
) as value
)
select jsonb_build_object(
  'functions', (select value from function_summary),
  'cron', (select value from cron_summary),
  'tenants', (select value from tenant_summary)
);
