begin;

create temporary table tenant_probe_results (
  table_name text primary key,
  visible_other_tenant_rows bigint,
  error_code text
);
grant select, insert, update on tenant_probe_results to authenticated;

select set_config('audit.user_id', p.id::text, true),
       set_config('audit.org_id', p.organisation_id::text, true),
       set_config(
         'request.jwt.claims',
         jsonb_build_object('sub', p.id::text, 'role', 'authenticated')::text,
         true
       )
from public.profiles p
where p.organisation_id is not null
  and coalesce(p.approved, false)
  and coalesce(p.locked, false) = false
  and p.role = 'Tyre Man'
order by p.created_at
limit 1;

set local role authenticated;

do $$
declare
  r record;
  n bigint;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join pg_class pc on pc.oid = to_regclass(format('public.%I', c.table_name))
    where c.table_schema = 'public'
      and c.column_name = 'organisation_id'
      and pc.relkind in ('r', 'p')
      and pc.relrowsecurity
    order by c.table_name
  loop
    begin
      execute format(
        'select count(*) from public.%I where organisation_id::text <> %L',
        r.table_name, current_setting('audit.org_id')
      ) into n;
      insert into tenant_probe_results values (r.table_name, n, null);
    exception
      when insufficient_privilege then
        insert into tenant_probe_results values (r.table_name, null, sqlstate);
      when others then
        insert into tenant_probe_results values (r.table_name, null, sqlstate);
    end;
  end loop;
end $$;

reset role;

select jsonb_build_object(
  'tested_tables', count(*),
  'cross_tenant_exposure_tables', count(*) filter (where visible_other_tenant_rows > 0),
  'cross_tenant_exposure', coalesce(jsonb_agg(jsonb_build_object(
    'table', table_name, 'visible_other_tenant_rows', visible_other_tenant_rows
  )) filter (where visible_other_tenant_rows > 0), '[]'::jsonb),
  'inaccessible_or_error_tables', count(*) filter (where error_code is not null),
  'errors', coalesce(jsonb_agg(jsonb_build_object('table', table_name, 'sqlstate', error_code))
    filter (where error_code is not null), '[]'::jsonb)
) from tenant_probe_results;

rollback;
