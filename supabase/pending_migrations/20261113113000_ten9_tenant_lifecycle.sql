-- =============================================================================
-- TEN-9 (and CF-02, CF-07, CF-09, CF-12): tenant lifecycle.
-- STATUS: AUTHORED, NOT APPLIED. Draft for review. Proven only against PGlite
-- (supabase/tests/tenant_isolation_ten9.test.mjs) on verbatim copies of the live
-- app_is_active and handle_new_user bodies. The purge procedure is a DRAFT that is
-- dry-run by default and has never touched a real database.
--
-- WHAT IT FIXES
--   There is no supported way to create a company with an owner, no invitation, a
--   locked organisation keeps full access, and nothing removes a tenant's data.
--
--   1. PROVISIONING  admin_provision_organisation(name, owner_email, plan, ...)
--      Super admin only. One call, one transaction: organisation + subscription
--      (trial with an end date, or an operator-set plan) + a single-use owner
--      invitation (role Admin). Any failure leaves nothing behind.
--      The live create_workspace_owner(text, text) stays as it is: EXECUTE revoked.
--      It is NOT granted here because it lets any pending member of the current
--      company leave and found a company, and it runs ALTER TABLE profiles DISABLE
--      TRIGGER (an exclusive lock on the table every signed-in user reads). It is
--      marked superseded with a comment only.
--   2. INVITATION    org_invitations (token stored as a SHA-256 hash, single use,
--      expiring), org_invite_member() for the tenant's own Admin,
--      org_revoke_invitation(). The sign-up hook _signup_context (created in TEN-8)
--      is replaced: a valid invitation decides organisation, role and approval. A
--      token that is presented but not usable NEVER falls back to a default
--      organisation: the profile is created with no organisation and no access.
--   3. SUSPENSION    organisations.locked / active are now read. _org_active(org) is
--      consulted by app_is_active(), which every table policy already calls, so a
--      locked or inactive organisation loses all data access in the next request, on
--      web, Flutter and Expo alike, with no client change. Super admins are exempt.
--   4. UNIQUENESS    additive per-organisation unique indexes on username and
--      employee id. The GLOBAL unique indexes are NOT removed here (design and risk
--      below).
--   5. PURGE (DRAFT) admin_purge_organisation(org, dry_run default TRUE, ...).
--      Executable by service_role only (it takes an organisation id). Refuses the
--      legacy config organisation (Company A) always, and refuses a real run unless
--      the organisation is locked and its slug is typed back.
--
-- UNIQUENESS: DESIGN ONLY FOR THE GLOBAL KEYS (not executed)
--   Today: profiles_username_key, profiles_username_lower_uidx,
--   ux_profiles_username_lower, profiles_employee_id_lower_uidx,
--   ux_profiles_employee_id_lower are unique across ALL tenants, and
--   work_orders_work_order_no_key is global.
--   Target: unique per organisation. The per-organisation indexes created below are
--   implied by the global ones today, so they cannot fail and change nothing.
--   The remaining step is to remove the five global profile indexes. It is NOT in this
--   draft because:
--     a. get_email_by_identifier(identifier) (anon, used by every sign-in on web,
--        Flutter and the installed Expo build) resolves a username or employee id
--        with `limit 1` and no organisation. With duplicates across tenants it would
--        hand tenant A's sign-in address to tenant B's user typing the same employee
--        id: the sign-in simply fails for one of them, silently.
--     b. the fix is a second argument (organisation code = organisations.slug) on the
--        resolver and a "company code" field on the three sign-in screens and the
--        sign-in edge function. That is client work on three surfaces, one of which
--        (Expo) is frozen.
--     c. removing an index needs the word the MCP confirm gate stops on; the owner
--        must approve it interactively.
--   Order when the owner approves: ship the organisation-code sign-in everywhere,
--   make Company A's code the default when none is typed, then remove the global
--   indexes. Until then two tenants cannot share a username or an employee id, and a
--   colliding sign-up for tenant B is refused by the index (it does not land in
--   Company A). work_orders: the TEN-1 draft owns the (organisation_id, work_order_no)
--   key; it must change together with the `on conflict (work_order_no)` clause in
--   process_stg_job_cards and the in-app merge in src/lib/api/erpIntake.js.
--
-- RISK TO THE CURRENT COMPANY (Company A, 00000000-0000-0000-0000-000000000001)
--   Provisioning, invitations, purge: none (new objects; purge refuses Company A by
--   id and is not callable by any signed-in user).
--   _signup_context: none while no sign-up carries an invite_token: the no-token path
--   is the TEN-8 body unchanged.
--   Suspension: MEDIUM, because app_is_active() is on the path of every table policy.
--   It gains one primary-key lookup on organisations per evaluation (policies call it
--   as an InitPlan, once per statement). Verified live on 2026-11-12: all five
--   organisations are locked = false, active = true, and 0 profiles point at a
--   missing organisation, so no user's result changes at apply time. The migration
--   ABORTS if any organisation that has members is locked or inactive when it runs.
--   From then on, setting organisations.locked = true on Company A locks out every
--   Company A user except super admins. Today the organisation's own Admin can write
--   that row (TEN-5 closes this): apply TEN-5 first. MEASURE one dashboard load as a
--   Company A Manager before and after.
--   Per-organisation indexes: two small unique indexes on profiles (768 rows); a
--   brief lock while they build.
--
-- OWNER DECISIONS
--   D1 an invited person is approved on sign-up (the invitation is the approval).
--   D2 an invitation may be bound to an e-mail or left open (field staff sign up with
--      a synthetic address): open invitations are single use and expire.
--   D3 an operator-provisioned paid plan starts `active` with no payment record.
--   D4 trial length (default 14 days) and invitation life (default 7 days).
--   D5 the global identity keys (design above).
--   D6 purge policy: export first, retention period, who approves; and what happens
--      to the member accounts (this draft keeps profiles and auth users).
--
-- APPLY ORDER
--   Last. After TEN-1..TEN-5 (TEN-5 guards organisations.locked / active), after
--   20261113110000 (TEN-6: plans, _org_standing), 111000 (TEN-7: _legacy_config_org,
--   _builtin_roles) and 112000 (TEN-8: _signup_context, handle_new_user patch).
--   The file contains a runtime `delete from` (the purge loop), so the Supabase MCP
--   confirm gate will ask a person to approve it.
--
-- VERIFY (inside begin; ... rollback; on a branch database)
--   -- as a Company A Manager, before and after: identical
--   select public.app_is_active();
--   select count(*) from tyre_records;
--   -- as super admin
--   select public.admin_provision_organisation('Verify Co', 'owner@verify.test', 'trial');
--   select name, locked, active from organisations order by created_at desc limit 1;
--   select plan_code, status, trial_ends_at from org_subscriptions order by created_at desc limit 1;
--   -- as postgres / service role
--   select public.admin_purge_organisation('<new org id>');          -- dry run, counts only
--   select public.admin_purge_organisation('00000000-0000-0000-0000-000000000001', false, 'x', 'x');  -- refused
--
-- ROLLBACK
--   Re-create app_is_active from public._fn_backup_ten9 (execute the def): suspension
--   is off again at once. Re-create _signup_context from the same table to return to
--   the TEN-8 behaviour. The new tables, functions and indexes can stay unused.
-- =============================================================================

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

do $chk$
declare v_bad text;
begin
  if to_regprocedure('public._signup_context(uuid,jsonb,text)') is null
     or to_regprocedure('public._legacy_config_org()') is null
     or to_regprocedure('public._org_standing(uuid)') is null then
    raise exception 'TEN-9 needs the TEN-6, TEN-7 and TEN-8 drafts applied first. Nothing applied.';
  end if;
  select string_agg(o.id::text, ', ') into v_bad
    from public.organisations o
   where (coalesce(o.locked, false) or not coalesce(o.active, true))
     and exists (select 1 from public.profiles p where p.org_id = o.id);
  if v_bad is not null then
    raise exception 'TEN-9: organisation(s) % have members and are locked or inactive. Enforcing suspension would lock those members out now. Decide first. Nothing applied.', v_bad;
  end if;
end $chk$;

create table if not exists public._fn_backup_ten9 (
  fn text primary key, def text not null, saved_at timestamptz not null default now());
alter table public._fn_backup_ten9 enable row level security;
revoke all on public._fn_backup_ten9 from public, anon, authenticated;
insert into public._fn_backup_ten9 (fn, def)
select p::text, pg_get_functiondef(p)
  from unnest(array['public.app_is_active()'::regprocedure, 'public._signup_context(uuid,jsonb,text)'::regprocedure]) p
on conflict (fn) do nothing;

-- ---- 3. suspension ----------------------------------------------------------
-- Internal (takes an organisation id): not executable by authenticated.
-- A profile with no organisation is unchanged (true): it reads nothing anyway.
create or replace function public._org_active(p_org uuid) returns boolean
language sql stable parallel safe security definer set search_path = public as $fn$
  select p_org is null
      or coalesce((select not coalesce(o.locked, false) and coalesce(o.active, true)
                     from public.organisations o where o.id = p_org), false)
$fn$;

-- Live body has CRLF line ends; the anchor is one line.
select pg_temp.tp_patch('public.app_is_active()'::regprocedure,
$a$     and coalesce(locked, false) = false$a$,
$b$     and coalesce(locked, false) = false
     and (coalesce(is_super_admin, false) or public._org_active(org_id))$b$);

-- ---- 2. invitations ---------------------------------------------------------
create table if not exists public.org_invitations (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  email           text,                        -- null = open invitation (DECISION D2)
  role            text not null default 'Reporter',
  is_owner        boolean not null default false,
  token_hash      text not null unique,        -- sha256 hex of the one-time token; the token is never stored
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  accepted_by     uuid,
  revoked_at      timestamptz,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index if not exists org_invitations_org_idx on public.org_invitations (organisation_id, created_at desc);
alter table public.org_invitations enable row level security;
create policy org_invitations_org_isolation on public.org_invitations as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
create policy org_invitations_admin_read on public.org_invitations for select to authenticated
  using ((select public.is_super_admin()) or ((select public.app_is_active()) is true and (select public.get_my_role()) = 'Admin'));
-- No insert / update / delete policy: rows are written only by the definer RPCs below.
-- Column grant, not a table grant: token_hash is never selectable by a client.
grant select (id, organisation_id, email, role, is_owner, expires_at, accepted_at, accepted_by,
              revoked_at, created_by, created_at) on public.org_invitations to authenticated;
grant all on public.org_invitations to service_role;
revoke all on public.org_invitations from public;
revoke all on public.org_invitations from anon;

-- Internal: creates one invitation and returns the raw token once.
create or replace function public._create_invitation(
  p_org uuid, p_email text, p_role text, p_days int, p_is_owner boolean)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_days int := least(greatest(coalesce(p_days, 7), 1), 30);
  v_id uuid;
begin
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That is not a valid e-mail address.' using errcode = '22023';
  end if;
  if p_role <> all (public._builtin_roles())
     and not exists (select 1 from public.custom_roles c where c.name = p_role and c.organisation_id = p_org) then
    raise exception 'Unknown role for this organisation: %', p_role using errcode = '22023';
  end if;
  insert into public.org_invitations (organisation_id, email, role, is_owner, token_hash, expires_at, created_by)
  values (p_org, v_email, p_role, coalesce(p_is_owner, false),
          encode(sha256(convert_to(v_token, 'utf8')), 'hex'), now() + make_interval(days => v_days), auth.uid())
  returning id into v_id;
  return jsonb_build_object('invitation_id', v_id, 'invite_token', v_token,
                            'expires_at', now() + make_interval(days => v_days), 'email', v_email, 'role', p_role);
end $fn$;

-- Tenant Admin invites into its OWN organisation. No organisation argument.
create or replace function public.org_invite_member(
  p_email text default null, p_role text default 'Reporter', p_days int default 7)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_org uuid := public.app_current_org();
begin
  if v_org is null or public.app_is_active() is not true
     or (public.get_my_role() is distinct from 'Admin' and not public.is_super_admin()) then
    raise exception 'Only an Admin of the organisation can invite members.' using errcode = '42501';
  end if;
  return public._create_invitation(v_org, p_email, coalesce(nullif(btrim(p_role), ''), 'Reporter'), p_days, false)
         || jsonb_build_object('ok', true);
end $fn$;

create or replace function public.org_revoke_invitation(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  if public.app_is_active() is not true
     or (public.get_my_role() is distinct from 'Admin' and not public.is_super_admin()) then
    raise exception 'Only an Admin of the organisation can revoke an invitation.' using errcode = '42501';
  end if;
  update public.org_invitations i set revoked_at = now()
   where i.id = p_id and i.accepted_at is null and i.revoked_at is null
     and (public.is_super_admin() or i.organisation_id = public.app_current_org());
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n = 1);
end $fn$;

-- The sign-up hook (signature fixed in TEN-8). An invitation decides; a bad token never
-- falls back to a default organisation.
create or replace function public._signup_context(p_user_id uuid, p_meta jsonb, p_email text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_token text := nullif(btrim(coalesce(p_meta ->> 'invite_token', '')), '');
  v_email text := lower(btrim(coalesce(p_email, '')));
  inv public.org_invitations%rowtype;
begin
  if v_token is null then
    return jsonb_build_object('org', public._single_tenant_org(), 'role', null, 'approved', null);
  end if;
  select * into inv from public.org_invitations i
   where i.token_hash = encode(sha256(convert_to(v_token, 'utf8')), 'hex')
   for update;
  if found and inv.accepted_at is null and inv.revoked_at is null and inv.expires_at > now()
     and (inv.email is null or inv.email = v_email)
     and public._org_active(inv.organisation_id) then
    update public.org_invitations set accepted_at = now(), accepted_by = p_user_id where id = inv.id;
    return jsonb_build_object('org', inv.organisation_id, 'role', inv.role, 'approved', true, 'invitation', inv.id);  -- DECISION D1
  end if;
  return jsonb_build_object('org', null, 'role', null, 'approved', false);
end $fn$;

-- ---- 1. provisioning --------------------------------------------------------
create or replace function public.admin_provision_organisation(
  p_name text, p_owner_email text, p_plan text default 'trial', p_trial_days int default 14,
  p_primary_country text default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_name text := left(btrim(coalesce(p_name, '')), 120);
  v_plan text := lower(btrim(coalesce(p_plan, 'trial')));
  v_days int := least(greatest(coalesce(p_trial_days, 14), 1), 90);
  v_slug_base text; v_slug text; v_org uuid; v_inv jsonb; v_status text; v_trial_end timestamptz;
begin
  if not public._console_ip_allowed() then
    raise exception 'Console access is not allowed from this network' using errcode = '42501';
  end if;
  if not public.is_super_admin() then
    raise exception 'Only a super admin can create an organisation' using errcode = '42501';
  end if;
  if v_name = '' then raise exception 'An organisation name is required.' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_owner_email, '')), '') is null then
    raise exception 'The owner e-mail is required.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.subscription_plans p where p.code = v_plan and p.active) then
    raise exception 'Unknown or inactive plan: %', v_plan using errcode = '22023';
  end if;

  v_slug_base := left(coalesce(nullif(btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'org'), 40);
  loop
    v_slug := v_slug_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    exit when not exists (select 1 from public.organisations o where o.slug = v_slug);
  end loop;

  insert into public.organisations (name, slug, settings, plan, active, locked, contact_email, primary_country, country)
  values (v_name, v_slug, jsonb_build_object('created_via', 'console_provisioning'), v_plan, true, false,
          lower(btrim(p_owner_email)), nullif(btrim(coalesce(p_primary_country, '')), ''),
          nullif(btrim(coalesce(p_primary_country, '')), ''))
  returning id into v_org;

  if v_plan = 'trial' then
    v_status := 'trialing'; v_trial_end := now() + make_interval(days => v_days);
  else
    v_status := 'active'; v_trial_end := null;        -- DECISION D3
  end if;
  insert into public.org_subscriptions
    (organisation_id, plan_code, status, billing_interval, seats, trial_ends_at, current_period_start, current_period_end)
  values (v_org, v_plan, v_status, 'monthly', 1, v_trial_end, now(), v_trial_end);

  v_inv := public._create_invitation(v_org, p_owner_email, 'Admin', 7, true);

  -- Tenant seed (checklist templates, departments, routing rules): roadmap. Called if present.
  if to_regprocedure('public._seed_new_organisation(uuid)') is not null then
    execute 'select public._seed_new_organisation($1)' using v_org;
  end if;

  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (auth.uid(), 'provision_org', v_org, 'organisation',
          jsonb_build_object('name', v_name, 'plan', v_plan, 'status', v_status,
                             'reason', nullif(btrim(coalesce(p_reason, '')), ''), 'invitation_id', v_inv -> 'invitation_id'));

  return jsonb_build_object('ok', true, 'organisation_id', v_org, 'slug', v_slug, 'plan_code', v_plan,
                            'status', v_status, 'trial_ends_at', v_trial_end) || v_inv;
end $fn$;

do $cm$
begin
  if to_regprocedure('public.create_workspace_owner(text,text)') is not null then
    comment on function public.create_workspace_owner(text, text) is
      'SUPERSEDED by admin_provision_organisation (TEN-9). Do not grant EXECUTE: it self-promotes any pending member and takes an exclusive lock on profiles.';
  end if;
end $cm$;

-- ---- 4. per-organisation identity keys (additive; the global keys stay) -----
create unique index if not exists profiles_org_username_lower_uidx
  on public.profiles (org_id, lower(username)) where username is not null and btrim(username) <> '';
create unique index if not exists profiles_org_employee_id_lower_uidx
  on public.profiles (org_id, lower(employee_id)) where employee_id is not null and btrim(employee_id) <> '';

-- ---- 5. purge (DRAFT, dry run by default) -----------------------------------
-- Takes an organisation id, so it is executable by service_role ONLY. It is meant to be
-- run by an operator (SQL editor or an edge function that has verified a super admin and
-- a completed export), never from a browser.
-- Scope: every base table in schema public that carries organisation_id or org_id,
-- except organisations and profiles. It does NOT remove storage objects, auth users or
-- profiles, and append-only audit tables may refuse: everything not removed is reported.
create or replace function public.admin_purge_organisation(
  p_org uuid, p_dry_run boolean default true, p_confirm_slug text default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  o record; r record; v_n bigint; v_pass int; v_progress boolean;
  v_counts jsonb := '{}'::jsonb; v_deleted jsonb := '{}'::jsonb; v_retained jsonb := '{}'::jsonb;
  v_members bigint; v_total bigint := 0;
begin
  select id, name, slug, coalesce(locked, false) as locked into o from public.organisations where id = p_org;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_org is not distinct from public._legacy_config_org() then
    return jsonb_build_object('ok', false, 'reason', 'legacy_organisation_is_never_purged');
  end if;
  select count(*) into v_members from public.profiles p where p.org_id = p_org or p.organisation_id = p_org;

  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and c.column_name in ('organisation_id', 'org_id')
       and t.table_type = 'BASE TABLE' and c.table_name not in ('organisations', 'profiles')
     order by c.table_name, c.column_name
  loop
    execute format('select count(*) from public.%I where %I::text = $1', r.table_name, r.column_name)
      into v_n using p_org::text;
    if v_n > 0 then
      v_counts := v_counts || jsonb_build_object(r.table_name, coalesce((v_counts ->> r.table_name)::bigint, 0) + v_n);
      v_total := v_total + v_n;
    end if;
  end loop;

  if coalesce(p_dry_run, true) then
    return jsonb_build_object('ok', true, 'dry_run', true, 'organisation', o.name, 'slug', o.slug, 'locked', o.locked,
      'rows', v_counts, 'total_rows', v_total, 'members', v_members,
      'not_covered', jsonb_build_array('storage objects', 'auth users and profiles', 'rows in tables without an organisation column'));
  end if;

  if not o.locked then
    return jsonb_build_object('ok', false, 'reason', 'organisation_must_be_locked_first');
  end if;
  if p_confirm_slug is distinct from o.slug then
    return jsonb_build_object('ok', false, 'reason', 'confirmation_does_not_match_slug');
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  -- Several passes so child tables go before their parents without a hand-kept order.
  for v_pass in 1..8 loop
    v_progress := false;
    for r in
      select c.table_name, c.column_name
        from information_schema.columns c
        join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
       where c.table_schema = 'public' and c.column_name in ('organisation_id', 'org_id')
         and t.table_type = 'BASE TABLE' and c.table_name not in ('organisations', 'profiles')
    loop
      begin
        execute format('delete from public.%I where %I::text = $1', r.table_name, r.column_name) using p_org::text;
        get diagnostics v_n = row_count;
        if v_n > 0 then
          v_progress := true;
          v_deleted := v_deleted || jsonb_build_object(r.table_name, coalesce((v_deleted ->> r.table_name)::bigint, 0) + v_n);
          v_retained := v_retained - r.table_name;
        end if;
      exception when others then
        v_retained := v_retained || jsonb_build_object(r.table_name, sqlstate);
      end;
    end loop;
    exit when not v_progress;
  end loop;

  -- What is still there (refused by a guard, or written by a delete trigger).
  v_counts := '{}'::jsonb;
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and c.column_name in ('organisation_id', 'org_id')
       and t.table_type = 'BASE TABLE' and c.table_name not in ('organisations', 'profiles')
  loop
    execute format('select count(*) from public.%I where %I::text = $1', r.table_name, r.column_name)
      into v_n using p_org::text;
    if v_n > 0 then v_counts := v_counts || jsonb_build_object(r.table_name, v_n); end if;
  end loop;

  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (auth.uid(), 'purge_org', null, 'organisation',
          jsonb_build_object('organisation_id', p_org, 'name', o.name, 'reason', btrim(p_reason),
                             'deleted', v_deleted, 'remaining', v_counts, 'run_as', current_user));

  return jsonb_build_object('ok', true, 'dry_run', false, 'organisation', o.name, 'deleted', v_deleted,
    'remaining', v_counts, 'refused', v_retained, 'members_remaining', v_members,
    'next', 'remove storage objects and member accounts, then admin_delete_empty_org');
end $fn$;

-- ---- grants: authenticated and service_role first, then PUBLIC, then anon ----
grant execute on function public.admin_provision_organisation(text, text, text, int, text, text) to authenticated, service_role;
grant execute on function public.org_invite_member(text, text, int) to authenticated, service_role;
grant execute on function public.org_revoke_invitation(uuid) to authenticated, service_role;
grant execute on function public._org_active(uuid) to service_role;
grant execute on function public._create_invitation(uuid, text, text, int, boolean) to service_role;
grant execute on function public._signup_context(uuid, jsonb, text) to service_role;
grant execute on function public.admin_purge_organisation(uuid, boolean, text, text) to service_role;

revoke execute on function public.admin_provision_organisation(text, text, text, int, text, text) from public;
revoke execute on function public.org_invite_member(text, text, int) from public;
revoke execute on function public.org_revoke_invitation(uuid) from public;
revoke execute on function public._org_active(uuid) from public;
revoke execute on function public._create_invitation(uuid, text, text, int, boolean) from public;
revoke execute on function public._signup_context(uuid, jsonb, text) from public;
revoke execute on function public.admin_purge_organisation(uuid, boolean, text, text) from public;

revoke execute on function public.admin_provision_organisation(text, text, text, int, text, text) from anon;
revoke execute on function public.org_invite_member(text, text, int) from anon;
revoke execute on function public.org_revoke_invitation(uuid) from anon;
revoke execute on function public._org_active(uuid) from anon, authenticated;
revoke execute on function public._create_invitation(uuid, text, text, int, boolean) from anon, authenticated;
revoke execute on function public._signup_context(uuid, jsonb, text) from anon, authenticated;
revoke execute on function public.admin_purge_organisation(uuid, boolean, text, text) from anon, authenticated;

select anum_integration.apply_reader_policies();
