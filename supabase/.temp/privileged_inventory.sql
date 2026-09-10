with funcs as (
  select p.oid, n.nspname as schema_name, p.proname,
    pg_get_function_identity_arguments(p.oid) as args,
    pg_get_userbyid(p.proowner) as owner,
    p.proconfig,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
    has_function_privilege('public', p.oid, 'EXECUTE') as public_exec
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema')
), cron_columns as (
  select coalesce(jsonb_agg(jsonb_build_object('name', column_name, 'type', data_type) order by ordinal_position), '[]'::jsonb) value
  from information_schema.columns
  where table_schema = 'public' and table_name = 'cron_config'
), cron_safety as (
  select jsonb_build_object(
    'job_commands_with_embedded_jwt_like_value', count(*) filter (where command ~* '(eyJ[a-zA-Z0-9_-]{10,}\\.[a-zA-Z0-9_-]{10,})'),
    'job_commands_with_service_role_literal', count(*) filter (where command ~* 'service[_ -]?role'),
    'job_commands_with_authorization_header', count(*) filter (where command ~* 'authorization'),
    'active_jobs', count(*) filter (where active),
    'inactive_jobs', count(*) filter (where not active)
  ) value from cron.job
)
select jsonb_build_object(
  'anon_security_definers', coalesce((select jsonb_agg(jsonb_build_object(
    'schema', schema_name, 'name', proname, 'args', args, 'owner', owner,
    'public_execute', public_exec, 'authenticated_execute', auth_exec,
    'search_path', proconfig
  ) order by schema_name, proname, args) from funcs where anon_exec), '[]'::jsonb),
  'public_security_definers', coalesce((select jsonb_agg(jsonb_build_object(
    'schema', schema_name, 'name', proname, 'args', args, 'owner', owner,
    'anon_execute', anon_exec, 'authenticated_execute', auth_exec,
    'search_path', proconfig
  ) order by schema_name, proname, args) from funcs where public_exec), '[]'::jsonb),
  'cron_config_columns', (select value from cron_columns),
  'cron_safety', (select value from cron_safety)
);
