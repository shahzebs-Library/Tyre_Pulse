-- =============================================================================
-- TEN-6b: a preflight and a guarded switch for plan and subscription enforcement.
-- STATUS: AUTHORED, NOT APPLIED. Draft for review. Run only on the local staging copy
-- (three synthetic companies). Never run on production by the author.
--
-- WHY
--   TEN-6 (20261113110000) adds the enforcement path behind
--   system_config.entitlement_enforcement, inserted as 'off'. Turning it on is one
--   UPDATE of one row. Nothing today tells the owner, BEFORE that update, which company
--   would stop being able to add vehicles or approve members. The current company is
--   far above the trial caps (production, counted 2026-11-15: 1,618 vehicles and 767
--   approved members against a trial cap of 25 and 3), so a wrong plan row on it at the
--   moment of the flip would stop its vehicle intake.
--
-- WHAT IT ADDS (no existing function body is changed)
--   1. entitlement_enforcement_preflight()  read-only report, one row per organisation:
--      subscription row present, plan, standing, usage against the plan limits, and
--      what the switch would refuse. Super admin, or a session with no user (SQL editor).
--   2. admin_set_entitlement_enforcement(p_on, p_reason, p_accept_blocked)
--      the only supported way to turn the switch on. Refuses (PT409) when the legacy
--      (current) company would lose anything. Refuses when any OTHER company would be
--      refused something unless p_accept_blocked is true. Writes an audit row.
--      Turning it off is always allowed.
--   3. trg_guard_entitlement_switch on system_config: a signed-in user who sets the row
--      to 'on' directly (console System Configuration page) is refused and pointed at
--      the function. A session with no user (migration, SQL editor) is not stopped:
--      that is the break-glass path and it is how the staging tests flip the switch.
--
-- GRANDFATHERING (how the current company stays unlimited)
--   TEN-6 gives every organisation that exists at apply time an explicit `internal`
--   subscription row (all features, no limits). This draft does not change that. It
--   makes the flip refuse unless the legacy company is on a plan with no vehicle and no
--   user limit below its usage, its standing is 'ok', and no module is refused to it.
--
-- RISK TO THE CURRENT COMPANY: none. Two new functions and one trigger that only fires
--   on the single row key = 'entitlement_enforcement'. The switch stays 'off'.
--
-- APPLY ORDER: after 20261113110000 (TEN-6), 20261113111000 (TEN-7, _legacy_config_org).
--
-- VERIFY (begin; ... rollback;)
--   select public.entitlement_enforcement_preflight();          -- safe_to_enable, per org
--   select public.admin_set_entitlement_enforcement(true, 'test');  -- as super admin
--   select value from system_config where key = 'entitlement_enforcement';
--
-- ROLLBACK
--   alter table public.system_config disable trigger trg_guard_entitlement_switch;
--   revoke execute on function public.admin_set_entitlement_enforcement(boolean, text, boolean),
--     public.entitlement_enforcement_preflight() from authenticated;
--   The objects are then unused. Removing them needs the word the confirm gate stops on.
-- =============================================================================

do $$ begin
  if to_regprocedure('public._org_standing(uuid)') is null or to_regprocedure('public._legacy_config_org()') is null then
    raise exception 'TEN-6b needs TEN-6 and TEN-7 applied first. Nothing applied.';
  end if;
end $$;

create or replace function public._entitlement_preflight_rows()
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_legacy uuid := public._legacy_config_org(); v_out jsonb := '[]'::jsonb; r record; v_row jsonb; v_blocks text[];
        v_modules int;
begin
  for r in
    select o.id, o.name, s.plan_code, p.max_vehicles, p.max_users,
           (s.organisation_id is not null) as has_row,
           public._org_standing(o.id) as standing,
           (select count(*) from public.vehicle_fleet v where v.organisation_id = o.id) as vehicles,
           (select count(*) from public.profiles m where m.org_id = o.id and coalesce(m.approved, false)) as approved_users
      from public.organisations o
      left join public.org_subscriptions s on s.organisation_id = o.id
      left join public.subscription_plans p on p.code = s.plan_code
     order by (o.id = v_legacy) desc, o.name
  loop
    v_blocks := '{}';
    if r.standing <> 'ok' then v_blocks := v_blocks || ('standing:' || r.standing); end if;
    if r.max_vehicles is not null and r.vehicles >= r.max_vehicles then v_blocks := v_blocks || 'vehicles_at_or_over_limit'::text; end if;
    if r.max_users is not null and r.approved_users >= r.max_users then v_blocks := v_blocks || 'users_at_or_over_limit'::text; end if;
    select count(*) into v_modules from public.modules m
     where r.standing = 'ok' and not public._org_module_entitled(r.id, m.module_id);
    if v_modules > 0 then v_blocks := v_blocks || ('modules_refused:' || v_modules); end if;
    v_row := jsonb_build_object(
      'organisation_id', r.id, 'name', r.name, 'is_legacy', r.id = v_legacy,
      'has_subscription_row', r.has_row, 'plan_code', r.plan_code, 'standing', r.standing,
      'vehicles', r.vehicles, 'max_vehicles', r.max_vehicles,
      'approved_users', r.approved_users, 'max_users', r.max_users,
      'would_refuse', to_jsonb(v_blocks), 'unchanged', cardinality(v_blocks) = 0);
    v_out := v_out || v_row;
  end loop;
  return v_out;
end $fn$;

create or replace function public.entitlement_enforcement_preflight()
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_rows jsonb; v_legacy_ok boolean; v_blocked int;
begin
  if auth.uid() is not null and not coalesce(public.is_super_admin(), false) then
    raise exception 'Only a super admin can read the enforcement preflight.' using errcode = '42501';
  end if;
  v_rows := public._entitlement_preflight_rows();
  select coalesce(bool_and((e ->> 'unchanged')::boolean), false) into v_legacy_ok
    from jsonb_array_elements(v_rows) e where (e ->> 'is_legacy')::boolean;
  select count(*) into v_blocked
    from jsonb_array_elements(v_rows) e where not (e ->> 'is_legacy')::boolean and not (e ->> 'unchanged')::boolean;
  return jsonb_build_object(
    'enforcement', case when public._entitlement_enforced() then 'on' else 'off' end,
    'legacy_company_unchanged', coalesce(v_legacy_ok, false),
    'other_companies_refused_something', v_blocked,
    'safe_to_enable', coalesce(v_legacy_ok, false) and v_blocked = 0,
    'organisations', v_rows, 'generated_at', now());
end $fn$;

create or replace function public.admin_set_entitlement_enforcement(
  p_on boolean, p_reason text default null, p_accept_blocked boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_pre jsonb; v_val text := case when p_on then 'on' else 'off' end;
begin
  if not public._console_ip_allowed() then
    raise exception 'Console access is not allowed from this network' using errcode = '42501';
  end if;
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'Only a super admin can change plan enforcement.' using errcode = '42501';
  end if;
  if p_on is null then raise exception 'p_on is required.' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required.' using errcode = '22023';
  end if;
  v_pre := public.entitlement_enforcement_preflight();
  if p_on then
    if not (v_pre ->> 'legacy_company_unchanged')::boolean then
      raise exception 'Refused: the current company would be limited by this switch. Read entitlement_enforcement_preflight() and correct its subscription row first.'
        using errcode = 'PT409';
    end if;
    if (v_pre ->> 'other_companies_refused_something')::int > 0 and not coalesce(p_accept_blocked, false) then
      raise exception 'Refused: % other organisation(s) would be refused something. Review the preflight, then repeat with p_accept_blocked = true.',
        v_pre ->> 'other_companies_refused_something' using errcode = 'PT409';
    end if;
  end if;
  perform set_config('tp.entitlement_switch', 'preflight', true);
  update public.system_config set value = v_val where key = 'entitlement_enforcement';
  if not found then
    insert into public.system_config (key, value) values ('entitlement_enforcement', v_val);
  end if;
  insert into public.console_sessions (admin_id, action, target_type, details)
  values (auth.uid(), 'set_entitlement_enforcement', 'system_config',
          jsonb_build_object('value', v_val, 'reason', btrim(p_reason), 'accepted_blocked', coalesce(p_accept_blocked, false),
                             'other_companies_refused_something', v_pre -> 'other_companies_refused_something'));
  return jsonb_build_object('ok', true, 'enforcement', v_val, 'preflight', v_pre);
end $fn$;

create or replace function public._guard_entitlement_switch()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.key is distinct from 'entitlement_enforcement' then return new; end if;
  if btrim(lower(coalesce(new.value, '')), ' "') is distinct from 'on' then return new; end if;
  if tg_op = 'UPDATE' and btrim(lower(coalesce(old.value, '')), ' "') = 'on' then return new; end if;
  if auth.uid() is null then return new; end if;                       -- migration or SQL editor: break-glass
  if current_setting('tp.entitlement_switch', true) = 'preflight' then return new; end if;
  raise exception 'Plan enforcement is turned on with admin_set_entitlement_enforcement(), which checks every organisation first.'
    using errcode = 'PT409';
end $fn$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_entitlement_switch' and tgrelid = 'public.system_config'::regclass) then
    create trigger trg_guard_entitlement_switch before insert or update on public.system_config
      for each row execute function public._guard_entitlement_switch();
  end if;
end $$;

revoke execute on function public._entitlement_preflight_rows() from public;
revoke execute on function public._entitlement_preflight_rows() from anon, authenticated;
revoke execute on function public._guard_entitlement_switch() from public;
revoke execute on function public._guard_entitlement_switch() from anon, authenticated;
revoke execute on function public.entitlement_enforcement_preflight() from public;
revoke execute on function public.entitlement_enforcement_preflight() from anon;
grant execute on function public.entitlement_enforcement_preflight() to authenticated, service_role;
revoke execute on function public.admin_set_entitlement_enforcement(boolean, text, boolean) from public;
revoke execute on function public.admin_set_entitlement_enforcement(boolean, text, boolean) from anon;
grant execute on function public.admin_set_entitlement_enforcement(boolean, text, boolean) to authenticated, service_role;
