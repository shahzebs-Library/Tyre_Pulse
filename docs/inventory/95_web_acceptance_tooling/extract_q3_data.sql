select 'stock_records' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.stock_records x),'[]') d
union all select 'stock_movements' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.stock_movements x),'[]') d
union all select 'approval_policies' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.approval_policies x),'[]') d
union all select 'custom_roles' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.custom_roles x),'[]') d
union all select 'module_permissions' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.module_permissions x),'[]') d
union all select 'user_access_grants' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.user_access_grants x),'[]') d
union all select 'sites' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.sites x),'[]') d
union all select 'site_aliases' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.site_aliases x),'[]') d
union all select 'country_currency' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.country_currency x),'[]') d
union all select 'store_site_map' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.store_site_map x),'[]') d
union all select 'settings' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.settings x),'[]') d
union all select 'app_settings' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.app_settings x),'[]') d
union all select 'organisation_settings' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.organisation_settings x),'[]') d
union all select 'modules' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.modules x),'[]') d
union all select 'subscription_plans' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.subscription_plans x),'[]') d
union all select 'org_subscriptions' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.org_subscriptions x),'[]') d
union all select 'org_module_overrides' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.org_module_overrides x),'[]') d
union all select 'metric_registry' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.metric_registry x),'[]') d
union all select 'metric_versions' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.metric_versions x),'[]') d
union all select 'tyre_status_marks' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.tyre_status_marks x),'[]') d
union all select 'workflow_instances' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.workflow_instances x),'[]') d
union all select 'stock_entry_requests' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.stock_entry_requests x),'[]') d
union all select 'stock' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.stock x),'[]') d
union all select 'materials' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.materials x),'[]') d
union all select 'suppliers' t, coalesce((select jsonb_agg(to_jsonb(x)) from public.suppliers x),'[]') d
union all select 'organisations', (select jsonb_agg((select jsonb_object_agg(k, case when k ~ '(email|phone|logo|notes|contact|address|token|secret|vat|cr_no)' then 'null'::jsonb else v end) from jsonb_each(to_jsonb(o)) e(k,v))) from public.organisations o)
union all select 'profiles', (select jsonb_agg((select jsonb_object_agg(k, case when k='username' then to_jsonb('user_'||left(md5(p.id::text),8)) when k='full_name' then to_jsonb('User '||upper(left(md5(p.id::text||'n'),6))) when k='employee_id' then case when v='null'::jsonb then v else to_jsonb('E'||left(md5(p.id::text||'e'),6)) end when k='email' then to_jsonb('u'||left(p.id::text,10)||'@example.invalid') when k ~ '(phone|push_token|recovery|notes|avatar)' then 'null'::jsonb else v end) from jsonb_each(to_jsonb(p)) e(k,v))) from public.profiles p)
union all select 'report_schedules', (select jsonb_agg(to_jsonb(r) || jsonb_build_object('recipients', to_jsonb(array['qa@example.invalid']))) from public.report_schedules r)
union all select 'system_config', (select jsonb_agg(to_jsonb(s)) from public.system_config s where s.key !~* '(key|secret|token|password|dsn|webhook|smtp|email|phone|url)')
union all select 'tyre_records', (select jsonb_agg(to_jsonb(r)) from public.tyre_records r where r.serial_no in (select serial from public.tyre_status_marks))
union all select 'parts_consumption', (select jsonb_agg(to_jsonb(r)) from (select * from public.parts_consumption order by created_at desc, id limit 500) r)
union all select 'material_master', (select jsonb_agg(to_jsonb(r)) from (select * from public.material_master m where m.id in (select id from public.material_master order by id limit 400)) r)
union all select 'counts', jsonb_build_object('stock_records',(select count(*) from public.stock_records),'stock_movements',(select count(*) from public.stock_movements),'tyre_records',(select count(*) from public.tyre_records),'parts_consumption',(select count(*) from public.parts_consumption),'profiles',(select count(*) from public.profiles),'material_master',(select count(*) from public.material_master),'tyre_status_marks',(select count(*) from public.tyre_status_marks))