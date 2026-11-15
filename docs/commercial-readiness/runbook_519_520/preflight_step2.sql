\i runbook_519_520/preflight_reader_policy_drift.sql
select 'pre2 step1 applied' k, to_regprocedure('public.app_role_capability_default(text,text,text)') is not null ok;
select 'pre2 rule table absent' k, to_regclass('public.work_order_role_rules') is null ok;
select 'pre2 resolver fns absent' k, count(*) = 0 ok from pg_proc where pronamespace='public'::regnamespace and proname in ('work_order_can','work_order_can_job','work_order_scope','work_order_my_access','work_order_is_assigned','work_order_is_tyre','work_order_is_closed');
select 'pre2 helpers it needs exist' k, to_regprocedure('public.app_can_admin_delete()') is not null and to_regprocedure('public.app_sees_all_sites()') is not null and to_regprocedure('public.app_can_see_site(text)') is not null and to_regprocedure('anum_integration.apply_reader_policies()') is not null ok;
