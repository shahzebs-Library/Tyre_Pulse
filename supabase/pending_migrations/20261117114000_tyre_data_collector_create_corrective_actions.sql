-- =============================================================================
-- 20261117114000_tyre_data_collector_create_corrective_actions.sql
-- STATUS: AUTHORED, NOT APPLIED. Data-only (no schema change). Rollback: sibling _ROLLBACK.sql.
--
-- DEFECT (live 2026-11-16 08:00-08:03 UTC): a Tyre Data Collector raised corrective actions
-- from an inspection 7 times; every insert was refused (RLS: app_user_can('corrective_actions',
-- 'create') = false for that role). Owner decision 2026-11-16: Tyre Data Collectors may CREATE and
-- SUBMIT corrective actions within their authorised sites, but never approve or close them.
--
-- WHAT: adds {"create": true} for role "Tyre Data Collector", module corrective_actions, to Company
-- A's permission overrides (organisations.settings.app_settings.permission_overrides, stored as a
-- JSON STRING). This is the same setting the Console Access Control screen writes. Nothing else in
-- the overrides changes (checked by the guards below).
--
-- WHAT STAYS THE SAME (enforced elsewhere, unchanged):
--   * edit / approve / delete for corrective actions: NOT granted.
--   * closing needs a reviewer role (corrective_action_review_guard; Tyre Data Collector is not in
--     ca_reviewer_roles or exception_roles).
--   * submitting completion needs the assignee or a reviewer (corrective_action_submit_completion).
--   * sites and countries: corrective_actions_site_write / _country_write RESTRICTIVE policies still
--     refuse a row outside the person's scope.
-- =============================================================================
begin;
do $$
declare v_pov jsonb; v_new jsonb; v_typ text;
begin
  select jsonb_typeof(settings->'app_settings'->'permission_overrides'),
         (settings->'app_settings'->>'permission_overrides')::jsonb
    into v_typ, v_pov
    from public.organisations where id = '00000000-0000-0000-0000-000000000001' for update;
  if v_typ is distinct from 'string' or v_pov is null or not (v_pov ? 'overrides')
     or v_pov #> '{overrides,Tyre Data Collector}' is null then
    raise exception 'permission_overrides not in the expected shape; nothing changed';
  end if;
  if coalesce((v_pov #>> '{overrides,Tyre Data Collector,corrective_actions,create}')::boolean, false) then
    raise notice 'already granted; nothing to do';
    return;
  end if;
  v_new := jsonb_set(v_pov, '{overrides,Tyre Data Collector,corrective_actions}',
             coalesce(v_pov #> '{overrides,Tyre Data Collector,corrective_actions}', '{}'::jsonb) || '{"create": true}'::jsonb);
  if (v_new - 'overrides') <> (v_pov - 'overrides')
     or ((v_new->'overrides') - 'Tyre Data Collector') <> ((v_pov->'overrides') - 'Tyre Data Collector')
     or ((v_new #> '{overrides,Tyre Data Collector}') - 'corrective_actions') <> ((v_pov #> '{overrides,Tyre Data Collector}') - 'corrective_actions') then
    raise exception 'guard: more than the one setting would change; nothing changed';
  end if;
  update public.organisations
     set settings = jsonb_set(settings, '{app_settings,permission_overrides}', to_jsonb(v_new::text))
   where id = '00000000-0000-0000-0000-000000000001';
end $$;
commit;

-- VERIFY (rolled back, as a real Tyre Data Collector, after applying):
--   begin; select set_config('request.jwt.claims', json_build_object('sub',<collector id>,'role','authenticated')::text, true);
--   set local role authenticated;
--   select app_user_can('corrective_actions','create') /* true */, app_user_can('corrective_actions','edit') /* false */,
--          app_user_can('corrective_actions','approve') /* false */;
--   rollback;
