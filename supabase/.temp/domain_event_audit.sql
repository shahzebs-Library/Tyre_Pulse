select jsonb_build_object(
  'columns', (select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='domain_events'),
  'process_definition', (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='process_domain_events' limit 1),
  'triggers', (select jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid))) from pg_trigger where tgrelid='public.domain_events'::regclass and not tgisinternal),
  'grants', (select jsonb_agg(jsonb_build_object('grantee',grantee,'privilege',privilege_type)) from information_schema.role_table_grants where table_schema='public' and table_name='domain_events'),
  'policies', (select jsonb_agg(jsonb_build_object('name',policyname,'command',cmd,'roles',roles)) from pg_policies where schemaname='public' and tablename='domain_events')
);
