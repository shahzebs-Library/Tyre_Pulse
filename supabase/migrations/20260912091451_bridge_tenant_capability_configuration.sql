-- Snapshot the two formerly platform-wide policies as each existing tenant's
-- effective baseline. This preserves permissions/flags; it does not attribute
-- private global settings to tenants or grant any new capabilities.
DO $baseline$
DECLARE o record; snapshot jsonb; before_settings jsonb; after_settings jsonb;
BEGIN
  SELECT coalesce(jsonb_object_agg(key,to_jsonb(value)),'{}'::jsonb) INTO snapshot
    FROM public.app_settings WHERE key IN ('permission_overrides','feature_flags');
  FOR o IN SELECT id,settings FROM public.organisations FOR UPDATE LOOP
    before_settings:=coalesce(o.settings,'{}'::jsonb);
    after_settings:=jsonb_set(before_settings,'{app_settings}',snapshot || coalesce(before_settings->'app_settings','{}'::jsonb),true);
    IF after_settings IS DISTINCT FROM before_settings THEN
      UPDATE public.organisations SET settings=after_settings,updated_at=now() WHERE id=o.id;
      INSERT INTO public.audit_log(table_name,record_id,action,old_data,new_data,organisation_id,details)
      VALUES('organisations',o.id,'UPDATE',before_settings,after_settings,o.id,
        jsonb_build_object('operation','preserve_effective_platform_policy','migration','bridge_tenant_capability_configuration'));
    END IF;
  END LOOP;
END $baseline$;

-- Ordinary company settings can be transferred only where the recorded editor
-- belongs to that company. Existing tenant values win; originals stay archived.
DO $settings$
DECLARE o record; patch jsonb; before_settings jsonb; after_settings jsonb;
BEGIN
  FOR o IN SELECT id,settings FROM public.organisations FOR UPDATE LOOP
    SELECT jsonb_object_agg(s.key,to_jsonb(s.value::text)) INTO patch
      FROM public.settings s JOIN public.profiles p ON p.id=s.updated_by WHERE p.org_id=o.id;
    IF patch IS NULL THEN CONTINUE; END IF;
    before_settings:=coalesce(o.settings,'{}'::jsonb);
    after_settings:=jsonb_set(before_settings,'{settings}',patch || coalesce(before_settings->'settings','{}'::jsonb),true);
    IF after_settings IS DISTINCT FROM before_settings THEN
      UPDATE public.organisations SET settings=after_settings,updated_at=now() WHERE id=o.id;
      INSERT INTO public.audit_log(table_name,record_id,action,old_data,new_data,organisation_id,details)
      VALUES('organisations',o.id,'UPDATE',before_settings,after_settings,o.id,
        jsonb_build_object('operation','preserve_attributed_settings','migration','bridge_tenant_capability_configuration'));
    END IF;
  END LOOP;
END $settings$;

-- Keep the deployed view-matrix contract and audit format. Change only the
-- capability store, so an atomic matrix save and its read use the same tenant.
DO $bridge$
DECLARE original text; revised text; old_write text;
BEGIN
  original:=pg_get_functiondef('public.save_access_control_matrix(jsonb,text,text)'::regprocedure);
  revised:=replace(original,
    'if v_uid is null then raise exception ''Authentication required.'' using errcode = ''42501''; end if;',
    'if v_uid is null or public.app_current_org() is null or not coalesce(public.app_is_active(),false) then raise exception ''Active organisation membership required.'' using errcode = ''42501''; end if;');
  IF revised=original THEN RAISE EXCEPTION 'Unexpected matrix authentication guard'; END IF;
  original:=revised;
  revised:=replace(original,
    'select value into v_old from public.app_settings where key = ''permission_overrides'';',
    'select settings->''app_settings''->>''permission_overrides'' into v_old from public.organisations where id=public.app_current_org() for update;');
  IF revised=original THEN RAISE EXCEPTION 'Unexpected matrix capability read'; END IF;
  old_write:=$old$insert into public.app_settings(key, value, description, updated_by, updated_at)
    values ('permission_overrides', p_capability_envelope,
            'Role capability overrides managed by Master Access Control', v_uid, now())
    on conflict (key) do update set value = excluded.value, description = excluded.description,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at;$old$;
  original:=revised;
  revised:=replace(original,old_write,
    'perform public.save_organisation_configuration(''app_settings'',jsonb_build_array(jsonb_build_object(''key'',''permission_overrides'',''value'',p_capability_envelope)));');
  IF revised=original THEN RAISE EXCEPTION 'Unexpected matrix capability write'; END IF;
  EXECUTE revised;

  original:=pg_get_functiondef('public.app_user_can(text,text)'::regprocedure);
  revised:=replace(original,
    'select value::jsonb into v_json from public.app_settings'||chr(10)||'       where key = ''permission_overrides'' limit 1;',
    'select (settings->''app_settings''->>''permission_overrides'')::jsonb into v_json from public.organisations where id=public.app_current_org();');
  IF revised=original THEN RAISE EXCEPTION 'Unexpected capability enforcement read'; END IF;
  EXECUTE revised;
END $bridge$;
