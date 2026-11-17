-- ROLLBACK for 20261117114000: removes only the "create" flag this migration added.
begin;
do $$
declare v_pov jsonb; v_ca jsonb;
begin
  select (settings->'app_settings'->>'permission_overrides')::jsonb into v_pov
    from public.organisations where id = '00000000-0000-0000-0000-000000000001' for update;
  v_ca := coalesce(v_pov #> '{overrides,Tyre Data Collector,corrective_actions}', '{}'::jsonb) - 'create';
  if v_ca = '{}'::jsonb then
    v_pov := jsonb_set(v_pov, '{overrides,Tyre Data Collector}', (v_pov #> '{overrides,Tyre Data Collector}') - 'corrective_actions');
  else
    v_pov := jsonb_set(v_pov, '{overrides,Tyre Data Collector,corrective_actions}', v_ca);
  end if;
  update public.organisations
     set settings = jsonb_set(settings, '{app_settings,permission_overrides}', to_jsonb(v_pov::text))
   where id = '00000000-0000-0000-0000-000000000001';
end $$;
commit;
