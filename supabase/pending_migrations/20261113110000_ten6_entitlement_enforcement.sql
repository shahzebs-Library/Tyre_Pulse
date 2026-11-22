-- =============================================================================
-- TEN-6 (and CF-05, CF-07, CF-08): one server-side entitlement decision.
-- STATUS: AUTHORED, NOT APPLIED. Draft for review. Proven only against a PGlite
-- copy of the live function bodies (supabase/tests/tenant_isolation_ten6.test.mjs).
-- Never run on production by the author. Do not apply without the owner's go-ahead.
--
-- WHAT IT FIXES
--   Today nothing on the server reads the subscription: an organisation with no
--   org_subscriptions row is an endless trial, plan limits switch on by accident the
--   moment a row appears (CF-08), a customer Admin passes every gate, and there is no
--   per-tenant module switch. This draft adds ONE decision, public.org_entitled(key),
--   reusing subscription_plans, org_subscriptions and modules, and consumes it in
--   app_user_can, enforce_plan_limit and a new user (seat) limit.
--
--   1. Plan `internal` (all features, no limits, not public) and an explicit
--      org_subscriptions row (internal, active) for EVERY organisation that exists at
--      apply time. Company A therefore has a deliberate unlimited row BEFORE anything
--      is enforced.
--   2. system_config.entitlement_enforcement, inserted as 'off'. While it is 'off'
--      every function below answers exactly as production answers today.
--   3. modules.min_plan_feature (the single plan to module mapping) and
--      org_module_overrides (per-tenant on / off / inherit, super admin writes).
--   4. org_entitled(key), get_my_entitlements(), set_org_module_override().
--   5. app_user_can: a customer Admin no longer bypasses entitlement (super admin does).
--   6. enforce_plan_limit: with enforcement on, "no subscription row" blocks instead
--      of allowing; standing (locked, expired trial, cancelled) blocks too.
--   7. enforce_user_limit on profiles: seats (plan max_users) counted at approval.
--   8. ensure_org_subscription no longer self-creates a trial once enforcement is on.
--   9. get_subscription_overview reports an unprovisioned organisation as `expired`
--      (not an endless `trialing`) once enforcement is on.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * It does not fold the platform-wide modules.status into app_user_can. 75 modules
--     are 'disabled' today and the Flutter app does not read module status, so a
--     server refusal keyed on it could stop field writes Company A makes now.
--     get_my_entitlements() returns the platform status beside each module so the
--     clients can AND it. Folding it into the server gate is an owner decision.
--   * It does not add write-blocking RLS for an expired tenant on tables whose writes
--     are allowed by the legacy role policies (app_user_can is OR'd with those).
--     Suspension is enforced in TEN-9 (app_is_active). Blocking writes while keeping
--     reads for an expired trial needs RESTRICTIVE write policies per table: roadmap.
--   * No client is changed. Web, Flutter and the edge functions still ignore
--     entitlements until they call get_my_entitlements() / org_entitled().
--
-- RISK TO THE CURRENT COMPANY (Company A, 00000000-0000-0000-0000-000000000001)
--   With entitlement_enforcement = 'off' (as inserted): none by construction. Every
--   patched branch is behind the switch; the test compares the full role x module x
--   capability matrix of app_user_can before and after and it is identical.
--   Two visible changes even with the switch off, both intended:
--     a. Company A gains a subscription row. enforce_plan_limit then evaluates
--        org_can_add: the internal plan has NULL limits so it returns true. Company A
--        has about 1,618 vehicles and 768 profiles; the test inserts a vehicle as a
--        Company A user at 30 vehicles (above the trial cap of 25) and it succeeds.
--        This also closes the CF-08 trap (one Billing click creating a trial row).
--     b. The Billing page will show plan "Internal" / active instead of a synthetic
--        trial. `internal` is is_public = false; confirm the page renders a plan that
--        is not in the public list before applying (web check, not done here).
--   With the switch 'on': low. Company A is on `internal` (every feature true, no
--   override rows), so org_entitled is true for every key. Cost: app_user_can gains
--   1 primary-key lookup (switch off) or about 5 (switch on) per call; it is used in
--   RLS on 11 tables. MEASURE one bulk insert as a Company A Manager before flipping.
--   If Company A is ever locked or its row is edited to a lesser plan the gate WILL
--   apply to it: that is the design.
--
-- OWNER DECISIONS (marked DECISION below)
--   D1 plan label and the fact that all five existing organisations (Company A, the
--      demo tenant and three empty shells) receive `internal`.
--   D2 past_due is treated as entitled with no time limit (grace length not defined).
--   D3 a cancelled subscription stays entitled until current_period_end.
--   D4 which modules get a min_plan_feature (none are mapped by this draft).
--   D5 whether modules.status should also be enforced by the server.
--   D6 when to flip entitlement_enforcement to 'on' (after clients read entitlements).
--
-- APPLY ORDER
--   After the TEN-1..TEN-5 drafts (20261113100000..104000). TEN-3 and TEN-5 lock the
--   writers of modules, subscription_plans, org_subscriptions and organisations; until
--   they are applied a customer Admin can still edit the inputs this function reads.
--   Before TEN-7, TEN-8 and TEN-9 (they call objects created here).
--   If another draft has already rewritten app_user_can, enforce_plan_limit,
--   ensure_org_subscription or get_subscription_overview, an anchor below is no
--   longer found exactly once and this migration ABORTS without changing anything.
--
-- VERIFY (run each inside begin; ... rollback; on a branch database first)
--   select code, max_vehicles, features from subscription_plans where code = 'internal';
--   select organisation_id, plan_code, status from org_subscriptions;       -- one row per org
--   select value from system_config where key = 'entitlement_enforcement';  -- off
--   -- as a Company A Manager (set request.jwt.claims + set local role authenticated):
--   select md5(public.get_my_entitlements()::text);         -- record; must not change when 'on'
--   select public.app_user_can('tyre_records', 'create');   -- same as before the migration
--   insert into vehicle_fleet (asset_no, country) values ('ZZ-VERIFY', 'KSA');   -- succeeds
--   -- anon: select has_function_privilege('anon', 'public.org_entitled(text)', 'execute');  -- false
--
-- ROLLBACK
--   1. update system_config set value = 'off' where key = 'entitlement_enforcement';
--      (instant, restores today's behaviour in every patched function)
--   2. Full removal: re-create app_user_can, enforce_plan_limit, ensure_org_subscription
--      and get_subscription_overview from the definitions saved by this migration in
--      public._fn_backup_ten6 (execute each def), disable trigger
--      trg_zz_enforce_user_limit on profiles, and leave the new tables, column, plan
--      and subscription rows in place (they are inert without the functions).
--      The Company A subscription row should STAY: removing it reopens CF-08.
-- =============================================================================

-- ---- shared patch helper (session local) ------------------------------------
create or replace function pg_temp.tp_patch(p_fn regprocedure, p_anchor text, p_new text, p_expected int default 1)
returns void language plpgsql as $tp$
declare v_def text := pg_get_functiondef(p_fn); v_n int;
begin
  v_n := (length(v_def) - length(replace(v_def, p_anchor, ''))) / greatest(length(p_anchor), 1);
  if v_n <> p_expected then
    raise exception 'tp_patch: anchor found % time(s) in %, expected %. The live body differs from the one this draft was built from. Nothing applied.',
      v_n, p_fn, p_expected;
  end if;
  execute replace(v_def, p_anchor, p_new);
end $tp$;

-- ---- 0. keep the definitions we are about to rewrite ------------------------
create table if not exists public._fn_backup_ten6 (
  fn text primary key, def text not null, saved_at timestamptz not null default now());
alter table public._fn_backup_ten6 enable row level security;   -- no policy: deny all to clients
revoke all on public._fn_backup_ten6 from public, anon, authenticated;
insert into public._fn_backup_ten6 (fn, def)
select p::text, pg_get_functiondef(p)
  from unnest(array['public.app_user_can(text,text)'::regprocedure, 'public.enforce_plan_limit()'::regprocedure,
                    'public.ensure_org_subscription()'::regprocedure, 'public.get_subscription_overview()'::regprocedure]) p
on conflict (fn) do nothing;

-- ---- 1. internal plan + an explicit row for every existing organisation -----
-- DECISION D1: label, and that every organisation existing today is grandfathered.
insert into public.subscription_plans
  (code, name, description, price_monthly, price_annual, currency,
   max_vehicles, max_users, max_api_keys, max_storage_gb, features, is_public, sort_order, active)
values
  ('internal', 'Internal', 'Platform operator and grandfathered organisations. No limits. Not for sale.', 0, 0, 'USD',
   null, null, null, null,
   '{"ai_tools":true,"erp_sync":true,"tv_display":true,"report_scheduling":true,"automation_platform":true}'::jsonb,
   false, 99, true)
on conflict (code) do nothing;

insert into public.org_subscriptions
  (organisation_id, plan_code, status, billing_interval, seats, trial_ends_at, current_period_start, current_period_end)
select o.id, 'internal', 'active', 'annual', 0, null, now(), null
  from public.organisations o
on conflict (organisation_id) do nothing;

do $chk$
begin
  if exists (select 1 from public.organisations o
              where not exists (select 1 from public.org_subscriptions s where s.organisation_id = o.id)) then
    raise exception 'TEN-6: an organisation has no subscription row after the backfill. Nothing applied.';
  end if;
end $chk$;

-- ---- 2. the switch ----------------------------------------------------------
insert into public.system_config (key, value, category, description)
values ('entitlement_enforcement', 'off', 'billing',
        'on = subscription, plan features and per-tenant module overrides are enforced by the server (org_entitled). off = legacy behaviour.')
on conflict (key) do nothing;

-- ---- 3. plan to module mapping and per-tenant overrides ---------------------
alter table public.modules add column if not exists min_plan_feature text;
comment on column public.modules.min_plan_feature is
  'Key in subscription_plans.features a tenant plan must carry (true) for this module. NULL = in every plan. TEN-6.';

create table if not exists public.org_module_overrides (
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  module_key      text not null,
  state           text not null check (state in ('on', 'off', 'inherit')),
  reason          text,
  set_by          uuid default auth.uid(),
  expires_at      timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (organisation_id, module_key)
);
alter table public.org_module_overrides enable row level security;
create policy org_module_overrides_org_isolation on public.org_module_overrides as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
create policy org_module_overrides_read on public.org_module_overrides for select to authenticated
  using ((select public.app_is_active()) is true);
create policy org_module_overrides_super_write on public.org_module_overrides for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
grant select, insert, update on public.org_module_overrides to authenticated;
grant all on public.org_module_overrides to service_role;
revoke all on public.org_module_overrides from public;
revoke all on public.org_module_overrides from anon;

-- ---- 4. the decision --------------------------------------------------------
create or replace function public._entitlement_enforced() returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce((select btrim(lower(value), ' "') from public.system_config where key = 'entitlement_enforcement'), 'off') = 'on'
$fn$;

-- Standing of ONE organisation. Internal: takes an organisation id, so it is not
-- executable by authenticated (the V378 rule).
create or replace function public._org_standing(p_org uuid) returns text
language plpgsql stable security definer set search_path = public as $fn$
declare v_locked boolean; v_active boolean; v_status text; v_trial timestamptz; v_end timestamptz;
begin
  if p_org is null then return 'no_organisation'; end if;
  select coalesce(o.locked, false), coalesce(o.active, true) into v_locked, v_active
    from public.organisations o where o.id = p_org;
  if not found then return 'no_organisation'; end if;
  if v_locked then return 'locked'; end if;
  if not v_active then return 'inactive'; end if;
  select s.status, s.trial_ends_at, s.current_period_end into v_status, v_trial, v_end
    from public.org_subscriptions s where s.organisation_id = p_org;
  if not found then return 'no_subscription'; end if;      -- a missing row is NOT a trial
  if v_status = 'active' then return 'ok'; end if;
  if v_status = 'past_due' then return 'ok'; end if;       -- DECISION D2: grace, no time limit yet
  if v_status = 'trialing' then
    -- A trial with no end date is not an endless trial: it is not entitled.
    if v_trial is not null and v_trial > now() then return 'ok'; end if;
    return 'trial_expired';
  end if;
  if v_status = 'canceled' then                            -- DECISION D3
    if v_end is not null and v_end > now() then return 'ok'; end if;
    return 'canceled';
  end if;
  return 'expired';
end $fn$;

create or replace function public._org_module_entitled(p_org uuid, p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_key text := btrim(coalesce(p_key, ''));
  v_base text := split_part(btrim(coalesce(p_key, '')), ':', 1);   -- 'parent:child' inherits the parent
  v_state text; v_feature text; v_features jsonb;
begin
  if public._org_standing(p_org) <> 'ok' then return false; end if;

  select o.state into v_state from public.org_module_overrides o
   where o.organisation_id = p_org and o.module_key in (v_key, v_base)
     and o.state <> 'inherit' and (o.expires_at is null or o.expires_at > now())
   order by (o.module_key = v_key) desc limit 1;
  if v_state = 'on' then return true; end if;
  if v_state = 'off' then return false; end if;

  select p.features into v_features
    from public.org_subscriptions s join public.subscription_plans p on p.code = s.plan_code
   where s.organisation_id = p_org;
  select m.min_plan_feature into v_feature from public.modules m
   where m.module_id in (v_key, v_base) and m.min_plan_feature is not null
   order by (m.module_id = v_key) desc limit 1;
  -- A plan feature key asked for directly, for example org_entitled('ai_tools').
  if v_feature is null and coalesce(v_features, '{}'::jsonb) ? v_key then v_feature := v_key; end if;
  if v_feature is null then return true; end if;            -- in every plan
  return coalesce((v_features ->> v_feature)::boolean, false);
end $fn$;

-- THE entry point. No organisation argument: the organisation is the caller's own.
create or replace function public.org_entitled(p_module text) returns boolean
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not public._entitlement_enforced() then return true; end if;   -- legacy behaviour
  if public.is_super_admin() then return true; end if;              -- platform owner, never a customer Admin
  return public._org_module_entitled(public.app_current_org(), p_module);
end $fn$;

-- One call for web, Flutter and edge functions.
create or replace function public.get_my_entitlements() returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_org uuid := public.app_current_org(); v_sub record; v_features jsonb; v_modules jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  select s.plan_code, s.status, s.trial_ends_at, s.current_period_end into v_sub
    from public.org_subscriptions s where s.organisation_id = v_org;
  select p.features into v_features from public.subscription_plans p where p.code = v_sub.plan_code;
  select coalesce(jsonb_object_agg(m.module_id, jsonb_build_object(
           'entitled', public.org_entitled(m.module_id),
           'platform_status', m.status)), '{}'::jsonb)
    into v_modules from public.modules m;
  return jsonb_build_object(
    'ok', true,
    'enforced', public._entitlement_enforced(),
    'organisation_id', v_org,
    'standing', case when public.is_super_admin() then 'ok' else public._org_standing(v_org) end,
    'plan_code', v_sub.plan_code,
    'status', v_sub.status,
    'trial_ends_at', v_sub.trial_ends_at,
    'current_period_end', v_sub.current_period_end,
    'features', coalesce(v_features, '{}'::jsonb),
    'modules', v_modules);
end $fn$;

-- Per-tenant switch. SECURITY INVOKER on purpose: it takes an organisation id, so it
-- must not be a definer function; the super-admin-only write policy is the gate.
create or replace function public.set_org_module_override(
  p_org uuid, p_module text, p_state text, p_reason text default null, p_expires timestamptz default null)
returns jsonb language plpgsql security invoker set search_path = public as $fn$
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can change a tenant module override' using errcode = '42501';
  end if;
  if p_state not in ('on', 'off', 'inherit') then
    raise exception 'state must be on, off or inherit' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  insert into public.org_module_overrides (organisation_id, module_key, state, reason, set_by, expires_at, updated_at)
  values (p_org, btrim(p_module), p_state, btrim(p_reason), auth.uid(), p_expires, now())
  on conflict (organisation_id, module_key)
  do update set state = excluded.state, reason = excluded.reason, set_by = excluded.set_by,
                expires_at = excluded.expires_at, updated_at = now();
  return jsonb_build_object('ok', true, 'organisation_id', p_org, 'module_key', btrim(p_module), 'state', p_state);
end $fn$;

-- ---- 5. app_user_can: entitlement applies to the customer Admin too ---------
select pg_temp.tp_patch('public.app_user_can(text,text)'::regprocedure,
$a$  if v_super is true or v_role = 'Admin' then return true; end if;
$a$,
$b$  if v_super is true then return true; end if;
  if not public.org_entitled(p_key) then return false; end if;
  if v_role = 'Admin' then return true; end if;
$b$);

-- ---- 6. enforce_plan_limit: no row is not a free pass once enforced ---------
select pg_temp.tp_patch('public.enforce_plan_limit()'::regprocedure,
$a$    if not exists (select 1 from public.org_subscriptions s where s.organisation_id = v_org) then
      return NEW;
    end if;
$a$,
$b$    if not public._entitlement_enforced()
       and not exists (select 1 from public.org_subscriptions s where s.organisation_id = v_org) then
      return NEW;
    end if;
    if public._entitlement_enforced() and not public.is_super_admin()
       and public._org_standing(v_org) <> 'ok' then
      v_block := true;
      v_label := 'standing';
    end if;
$b$);
select pg_temp.tp_patch('public.enforce_plan_limit()'::regprocedure,
$a$  if v_block then
    v_label := case v_resource when 'api_keys' then 'API keys' else v_resource end;
$a$,
$b$  if v_block and v_label = 'standing' then
    raise exception 'Your organisation has no active subscription. Contact your administrator.'
      using errcode = 'check_violation';
  end if;
  if v_block then
    v_label := case v_resource when 'api_keys' then 'API keys' else v_resource end;
$b$);

-- ---- 7. seats: plan max_users counted when a member is approved -------------
create or replace function public.enforce_user_limit() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_org uuid := coalesce(new.org_id, new.organisation_id); v_limit int; v_used bigint;
begin
  if not public._entitlement_enforced() then return new; end if;
  if coalesce(new.approved, false) is not true then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.approved, false) is true
     and coalesce(old.org_id, old.organisation_id) is not distinct from v_org then
    return new;
  end if;
  if v_org is null or coalesce(new.is_super_admin, false) then return new; end if;

  select p.max_users into v_limit
    from public.org_subscriptions s join public.subscription_plans p on p.code = s.plan_code
   where s.organisation_id = v_org;
  if not found or public._org_standing(v_org) <> 'ok' then
    if tg_op = 'INSERT' then new.approved := false; return new; end if;   -- never fail a sign-up
    raise exception 'This organisation has no active subscription, so members cannot be approved.'
      using errcode = 'check_violation';
  end if;
  if v_limit is null then return new; end if;

  select count(*) into v_used from public.profiles p
   where p.org_id = v_org and coalesce(p.approved, false) and p.id <> new.id;
  if v_used >= v_limit then
    if tg_op = 'INSERT' then new.approved := false; return new; end if;
    raise exception 'Plan limit reached for users (% of %). Upgrade the plan to approve more members.', v_used, v_limit
      using errcode = 'check_violation';
  end if;
  return new;
end $fn$;
create trigger trg_zz_enforce_user_limit before insert or update on public.profiles
  for each row execute function public.enforce_user_limit();

-- ---- 8. no self-service trial once enforcement is on ------------------------
select pg_temp.tp_patch('public.ensure_org_subscription()'::regprocedure,
$a$  IF NOT FOUND THEN
$a$,
$b$  IF NOT FOUND AND NOT public._entitlement_enforced() THEN
$b$);

-- ---- 9. an unprovisioned organisation is not an endless trial ---------------
select pg_temp.tp_patch('public.get_subscription_overview()'::regprocedure,
$a$jsonb_build_object('plan_code','trial','status','trialing','billing_interval','monthly',$a$,
$b$jsonb_build_object('plan_code','trial','status', case when public._entitlement_enforced() then 'expired' else 'trialing' end,'billing_interval','monthly',$b$);

-- ---- grants: authenticated and service_role first, then PUBLIC, then anon ----
grant execute on function public.org_entitled(text) to authenticated, service_role;
grant execute on function public.get_my_entitlements() to authenticated, service_role;
grant execute on function public.set_org_module_override(uuid, text, text, text, timestamptz) to authenticated, service_role;
grant execute on function public._entitlement_enforced() to service_role;
grant execute on function public._org_standing(uuid) to service_role;
grant execute on function public._org_module_entitled(uuid, text) to service_role;
grant execute on function public.enforce_user_limit() to service_role;

revoke execute on function public.org_entitled(text) from public;
revoke execute on function public.get_my_entitlements() from public;
revoke execute on function public.set_org_module_override(uuid, text, text, text, timestamptz) from public;
revoke execute on function public._entitlement_enforced() from public;
revoke execute on function public._org_standing(uuid) from public;
revoke execute on function public._org_module_entitled(uuid, text) from public;
revoke execute on function public.enforce_user_limit() from public;

revoke execute on function public.org_entitled(text) from anon;
revoke execute on function public.get_my_entitlements() from anon;
revoke execute on function public.set_org_module_override(uuid, text, text, text, timestamptz) from anon;
revoke execute on function public._entitlement_enforced() from anon, authenticated;
revoke execute on function public._org_standing(uuid) from anon, authenticated;
revoke execute on function public._org_module_entitled(uuid, text) from anon, authenticated;
revoke execute on function public.enforce_user_limit() from anon, authenticated;

-- ---- final guard: the current company is entitled to everything -------------
do $chk$
declare r record;
begin
  for r in select o.id from public.organisations o loop
    if public._org_standing(r.id) <> 'ok' then
      raise exception 'TEN-6: organisation % is not in good standing after the backfill (locked, inactive or a pre-existing lesser subscription row). Resolve before applying. Nothing applied.', r.id;
    end if;
  end loop;
end $chk$;

select anum_integration.apply_reader_policies();
