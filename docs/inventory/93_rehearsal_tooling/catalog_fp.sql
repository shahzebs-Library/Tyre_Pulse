-- Whole-catalog fingerprint: one row per object (kind, name, md5). Schemas in scope:
-- public, private, approval_private, anum_integration, auth, _bak (reported separately), extensions.
\pset format unaligned
\pset tuples_only on
\pset fieldsep '\t'
with s(n) as (select unnest(array['public','private','approval_private','anum_integration','auth','_bak','extensions']))
select 'fn', n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
       md5(replace(case when p.prokind in ('f','p') then pg_get_functiondef(p.oid) else p.prosrc end, chr(13), '')||'|'||coalesce((select string_agg(x::text, ',' order by x::text) from unnest(p.proacl) x),'')||'|'||pg_get_userbyid(p.proowner))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in (select n from s)
union all
select 'rel', n.nspname||'.'||c.relname||':'||c.relkind::text,
       md5(concat_ws('|', c.relrowsecurity, c.relforcerowsecurity, coalesce((select string_agg(x::text, ',' order by x::text) from unnest(c.relacl) x),''), pg_get_userbyid(c.relowner),
         (select string_agg(a.attname||' '||format_type(a.atttypid,a.atttypmod)||' '||a.attnotnull||' '||coalesce(pg_get_expr(d.adbin,d.adrelid),'')||' '||a.attgenerated::text||a.attidentity::text||' '||coalesce((select string_agg(x::text, ',' order by x::text) from unnest(a.attacl) x),''), ',' order by a.attnum)
            from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
         case when c.relkind = 'v' then pg_get_viewdef(c.oid) end, coalesce(array_to_string(c.reloptions, ','), '')))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in (select n from s) and c.relkind in ('r','v','m','p','S','f')
union all
select 'con', n.nspname||'.'||c.relname||'.'||co.conname, md5(pg_get_constraintdef(co.oid)||co.convalidated::text)
  from pg_constraint co join pg_class c on c.oid = co.conrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname in (select n from s) and co.contype <> 'n'
union all
select 'idx', n.nspname||'.'||ic.relname, md5(pg_get_indexdef(i.indexrelid))
  from pg_index i join pg_class ic on ic.oid = i.indexrelid join pg_namespace n on n.oid = ic.relnamespace where n.nspname in (select n from s)
union all
select 'pol', n.nspname||'.'||c.relname||'.'||p.polname,
       md5(concat_ws('|', p.polpermissive, p.polcmd::text, p.polroles::text, coalesce(pg_get_expr(p.polqual,p.polrelid),''), coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')))
  from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname in (select n from s)
union all
select 'trg', n.nspname||'.'||c.relname||'.'||t.tgname, md5(pg_get_triggerdef(t.oid)||t.tgenabled::text)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname in (select n from s) and not t.tgisinternal
union all
select 'type', n.nspname||'.'||t.typname, md5(t.typtype::text||coalesce((select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum where enumtypid=t.oid),''))
  from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname in (select n from s) and t.typtype in ('e','d','c') and not exists (select 1 from pg_class where reltype = t.oid)
union all
select 'nsp', nspname, md5(coalesce((select string_agg(x::text, ',' order by x::text) from unnest(nspacl) x),'')||pg_get_userbyid(nspowner)) from pg_namespace where nspname in (select n from s)
union all
select 'defacl', pg_get_userbyid(defaclrole)||':'||coalesce(defaclnamespace::regnamespace::text,'-')||':'||defaclobjtype::text, md5((select string_agg(x::text, ',' order by x::text) from unnest(defaclacl) x)) from pg_default_acl
union all
select 'data', 'public.'||t, md5(coalesce(x, '')) from (
  select 'stock_records' t, (select md5(string_agg(to_jsonb(r)::text, ',' order by id)) from stock_records r) x
  union all select 'stock_movements', (select md5(string_agg(to_jsonb(r)::text, ',' order by id)) from stock_movements r)
  union all select 'tyre_records', (select md5(string_agg(to_jsonb(r)::text, ',' order by id)) from tyre_records r)
  union all select 'tyre_status_marks', (select md5(string_agg(to_jsonb(r)::text, ',' order by id)) from tyre_status_marks r)
  union all select 'parts_consumption', (select md5(string_agg(to_jsonb(r)::text, ',' order by id)) from parts_consumption r)
  union all select 'material_master', (select md5(string_agg(to_jsonb(r)::text, ',' order by id)) from material_master r)
  union all select 'approval_policies', (select md5(string_agg(to_jsonb(r)::text, ',' order by id)) from approval_policies r)
  union all select 'custom_roles', (select md5(string_agg(to_jsonb(r)::text, ',' order by id)) from custom_roles r)
  union all select 'module_permissions', (select md5(string_agg(to_jsonb(r)::text, ',' order by id)) from module_permissions r)
  union all select 'user_access_grants', (select md5(string_agg(to_jsonb(r)::text, ',' order by id)) from user_access_grants r)
  union all select 'profiles', (select md5(string_agg(to_jsonb(r)::text, ',' order by id)) from profiles r)
  union all select 'metric_registry', (select md5(string_agg(to_jsonb(r)::text, ',' order by metric_id)) from metric_registry r)
  union all select 'report_schedules', (select md5(string_agg(to_jsonb(r)::text, ',' order by id)) from report_schedules r)
  union all select 'purchase_orders', (select md5(string_agg(to_jsonb(r)::text, ',' order by id)) from purchase_orders r)
  union all select 'work_orders', (select md5(string_agg(to_jsonb(r)::text, ',' order by id)) from work_orders r)
) d
order by 1, 2;
