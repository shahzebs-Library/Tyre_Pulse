select 'pre4 step3 applied' k, to_regprocedure('public.wo_write_guard()') is not null ok;
select 'pre4 backup absent' k, to_regclass('_bak.wo3_module_permissions_20261115') is null ok;
select 'pre4 no duplicate built-in rows' k, count(*) = 0 ok from (select role, module_key from public.module_permissions where org_id is null group by 1,2 having count(*) > 1) d;
select 'pre4 unique index for on conflict' k, count(*) >= 1 ok from pg_indexes where tablename='module_permissions' and indexdef ilike '%coalesce(org_id%';
select 'pre4 current built-in rows' k, role, module_key, enabled from public.module_permissions where org_id is null and module_key in ('work_orders','workshop_live') order by 2,3;
