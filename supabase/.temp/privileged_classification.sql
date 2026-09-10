with f as (
  select p.oid, n.nspname, p.proname, p.prorettype = 'trigger'::regtype as returns_trigger,
    has_function_privilege('anon',p.oid,'execute') anon_exec,
    has_function_privilege('authenticated',p.oid,'execute') auth_exec,
    exists(select 1 from unnest(coalesce(p.proconfig,'{}'::text[])) c where c like 'search_path=%') pinned
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.prosecdef and n.nspname='public'
)
select jsonb_build_object(
  'public_schema_create_public', has_schema_privilege('public','public','create'),
  'public_schema_create_anon', has_schema_privilege('anon','public','create'),
  'public_schema_create_authenticated', has_schema_privilege('authenticated','public','create'),
  'public_definers', count(*),
  'public_definers_pinned', count(*) filter(where pinned),
  'authenticated_trigger_functions', count(*) filter(where auth_exec and returns_trigger),
  'anon_trigger_functions', count(*) filter(where anon_exec and returns_trigger),
  'authenticated_non_trigger_functions', count(*) filter(where auth_exec and not returns_trigger),
  'anon_non_trigger_functions', count(*) filter(where anon_exec and not returns_trigger)
) from f;
