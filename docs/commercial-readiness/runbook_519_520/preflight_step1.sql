select 'pre1 app_user_can live hash' k, md5(prosrc) = 'df5b4f662cb0822453a8be753da453db' ok from pg_proc where oid = 'public.app_user_can(text,text)'::regprocedure;
select 'pre1 default fn absent' k, to_regprocedure('public.app_role_capability_default(text,text,text)') is null ok;
select 'pre1 anchor once' k, (length(d) - length(replace(d, 'v_default := coalesce((v_ov -> v_role -> p_key ->> v_cap)::boolean, false);', ''))) / length('v_default := coalesce((v_ov -> v_role -> p_key ->> v_cap)::boolean, false);') = 1 ok from (select pg_get_functiondef('public.app_user_can(text,text)'::regprocedure) d) x;
select 'pre1 backup table absent' k, to_regclass('_bak.cur1_org_settings_20261113') is null ok;
