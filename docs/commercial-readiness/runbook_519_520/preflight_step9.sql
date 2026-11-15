select 'pre9 step7 applied' k, to_regclass('public.closure_review_config') is not null ok;
select 'pre9 no existing rows for the two roles' k, count(*) = 0 ok from public.module_permissions where org_id is null and module_key='corrective_actions' and role in ('Workshop Supervisor','Maintenance Supervisor');
