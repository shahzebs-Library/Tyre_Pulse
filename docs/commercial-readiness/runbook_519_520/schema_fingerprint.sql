\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'
select 'FN', n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', md5(pg_get_functiondef(p.oid)), coalesce(p.proacl::text,'')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','approval_private','anum_integration') and p.prokind in ('f','p')
 order by 2;
select 'POL', schemaname||'.'||tablename||'.'||policyname, permissive, roles::text, cmd, coalesce(qual,''), coalesce(with_check,'')
  from pg_policies where schemaname in ('public','storage','approval_private') order by 2;
select 'REL', n.nspname||'.'||c.relname, c.relkind, c.relrowsecurity, coalesce(c.relacl::text,''), coalesce(array_to_string(c.reloptions,','),'')
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','approval_private','anum_integration') and c.relkind in ('r','v','m','p','S') order by 2;
select 'COL', table_schema||'.'||table_name||'.'||column_name, data_type, is_nullable, coalesce(column_default,'')
  from information_schema.columns where table_schema in ('public','approval_private') order by 2;
select 'TRG', c.relname||'.'||t.tgname, t.tgenabled, md5(pg_get_triggerdef(t.oid))
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where not t.tgisinternal and n.nspname='public' order by 2;
select 'IDX', schemaname||'.'||indexname, md5(indexdef) from pg_indexes where schemaname in ('public','approval_private') order by 2;
select 'CON', conrelid::regclass::text||'.'||conname, md5(pg_get_constraintdef(oid)) from pg_constraint
 where connamespace in ('public'::regnamespace) order by 2;
select 'DATA', 'module_permissions', md5(coalesce(string_agg(concat_ws(':',id,role,module_key,org_id,enabled,updated_at),',' order by id),'')) from public.module_permissions;
select 'DATA', 'organisations.settings', md5(coalesce(string_agg(id::text||':'||coalesce(settings::text,''),',' order by id),'')) from public.organisations;
select 'DATA', 'anum.reader_tables', md5(coalesce(string_agg(t::text,',' order by t::text),'')) from anum_integration.reader_tables t;
select 'DATA', 'approval_policies', md5(coalesce(string_agg(t::text,',' order by t::text),'')) from public.approval_policies t;
