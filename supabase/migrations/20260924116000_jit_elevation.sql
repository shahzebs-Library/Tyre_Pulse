-- ============================================================================
-- 20260924116000_jit_elevation.sql
-- Just-in-time (JIT) privilege elevation for /console/jit-elevation.
--
-- STATUS: APPLIED LIVE 2026-09-25 (project jhssdmeruxtrlqnwfksc) via Supabase
--         MCP apply_migration 'jit_elevation'. Body below is what was applied.
--         Verified in rolled-back transactions (see VERIFY).
--
-- WHAT IT IS
--   A non-super user (Manager, Director, Inspector ...) asks for ONE module
--   capability (view/create/edit/export/approve) for 5..480 minutes with a
--   mandatory reason. A super admin approves (optionally shortening it) or
--   denies. Approval writes an EXPIRING row into the EXISTING
--   public.user_access_grants table - there is no second permission system.
--   Every reader of that table (app_user_can, app_cap_revoked,
--   get_my_access_grants, get_my_capabilities, user_has_capability x2) already
--   filters `expires_at is null or expires_at > now()`, verified from the live
--   definitions, so an elevation stops working the instant it expires even if
--   the cron below never runs (LAZY expiry is the real boundary; the cron only
--   tidies status + deletes the dead grant row).
--
-- DELIBERATE SCOPE LIMITS (stated, not hidden)
--   * Capability grants only, NOT a temporary ROLE change. A role change edits
--     profiles.role (guarded by trg_guard_profile_privileged) and would need a
--     reliable revert; a grant carries its own expiry, so it cannot be left
--     behind by a missed job.
--   * 'delete' is not offered: app_user_can hard-refuses delete to every
--     non-admin, so a delete grant would change nothing.
--   * Admins and super admins cannot be targets: app_user_can already returns
--     true for them on every capability. Nobody can elevate themselves as a
--     super admin; a super admin can never approve their own request (they
--     cannot file one), so approval is always four-eyes.
--   * If the target already holds an active grant or an explicit DENY for the
--     same module+capability, approval is refused rather than overwriting it
--     (the table is UNIQUE(user_id, module_key, capability, effect)).
--
-- OBJECTS
--   table  jit_elevation_requests  (RLS: RESTRICTIVE org isolation; SELECT for
--          super admins, the requester and the target; NO client write grant)
--   rpc    request_elevation(module, cap, minutes, reason)       any approved non-super, non-Admin
--   rpc    cancel_elevation(id)                                   requester, pending only
--   rpc    my_elevation_requests()                                own rows
--   rpc    admin_list_elevations(status, limit, offset)           super admin
--   rpc    admin_decide_elevation(id, approve, note, minutes)     super admin
--   rpc    admin_grant_elevation(user, module, cap, minutes, reason)  super admin (direct)
--   rpc    admin_revoke_elevation(id, reason)                     super admin, early revoke
--   fn     expire_jit_elevations()   internal; pg_cron 'jit-elevation-expiry' every 5 min
--   helper _jit_activate / _jit_audit  internal (no client EXECUTE)
--   Every write audits to console_sessions AND access_audit (entity 'jit_elevation').
--   The existing trg_access_audit_grants trigger additionally logs the grant row.
--
-- VERIFY (run 2026-09-25 inside DO blocks that end in RAISE, so every write
--   rolled back; impersonation via set_config('request.jwt.claims',...) +
--   set local role authenticated). Manager = 34793423-... (adnan), super admin
--   = d2d43a5f-... Results, verbatim:
--   Manager: app_user_can('stock','edit') before = false; short reason 22023;
--     'delete' 22023; 600 min 22023; valid request -> pending; duplicate pending
--     23505; admin_list_elevations 42501; admin_decide_elevation 42501; direct
--     INSERT into the table 42501; my_elevation_requests = 1 row; table SELECT
--     under RLS = 1 row; expire_jit_elevations 42501.
--   Super admin: request_elevation 22023 (supers cannot request); list pending
--     total = 1; approve for 900 min (> requested) 22023; approve 30 min ->
--     approved, grant row with 30 min left.
--   Manager after approval: app_user_can('stock','edit') = TRUE; after forcing
--     the grant's expires_at into the past = FALSE (lazy expiry proven).
--   Revoke with empty reason 22023; with reason -> revoked, grant row deleted
--     (0 rows); console_sessions rows = 3, access_audit rows = 3,
--     notifications = 4 (2 supers on request, 1 on approve, 1 on revoke).
--   Second run: deny without note 22023; deny -> denied; admin_grant_elevation
--     direct -> approved; second grant for the same cap 22023 (active grant
--     exists); grant to self 22023; grant to the other super admin 22023;
--     unknown module 22023; sweep after forced expiry -> {expired:1}, status
--     'expired', grant row deleted. anon EXECUTE on request/list = false,
--     authenticated EXECUTE on _jit_activate = false, anon table SELECT = false,
--     cron 'jit-elevation-expiry' = */5 * * * *.
--
-- ROLLBACK
--   select cron.unschedule('jit-elevation-expiry');
--   delete from public.user_access_grants g using public.jit_elevation_requests r
--    where r.grant_id = g.id;
--   drop function if exists public.expire_jit_elevations();
--   drop function if exists public.admin_revoke_elevation(uuid, text);
--   drop function if exists public.admin_grant_elevation(uuid, text, text, int, text);
--   drop function if exists public.admin_decide_elevation(uuid, boolean, text, int);
--   drop function if exists public.admin_list_elevations(text, int, int);
--   drop function if exists public.my_elevation_requests();
--   drop function if exists public.cancel_elevation(uuid);
--   drop function if exists public.request_elevation(text, text, int, text);
--   drop function if exists public._jit_activate(uuid, int, text);
--   drop function if exists public._jit_audit(text, uuid, jsonb, jsonb, text);
--   drop function if exists public._jit_validate_target(uuid, text, text);
--   drop table if exists public.jit_elevation_requests;
-- ============================================================================

-- ── 1. table ────────────────────────────────────────────────────────────────
create table if not exists public.jit_elevation_requests (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid,
  target_user_id    uuid not null references public.profiles(id) on delete cascade,
  requested_by      uuid references public.profiles(id) on delete set null,
  module_key        text not null check (module_key ~ '^[a-z0-9_:\-]{1,80}$'),
  capability        text not null check (capability in ('view','create','edit','export','approve')),
  requested_minutes int  not null check (requested_minutes between 5 and 480),
  granted_minutes   int  check (granted_minutes is null or granted_minutes between 5 and 480),
  reason            text not null check (length(btrim(reason)) between 10 and 1000),
  status            text not null default 'pending'
                    check (status in ('pending','approved','denied','cancelled','revoked','expired','lapsed')),
  decided_by        uuid references public.profiles(id) on delete set null,
  decided_at        timestamptz,
  decision_note     text,
  starts_at         timestamptz,
  expires_at        timestamptz,
  grant_id          uuid,
  revoked_by        uuid references public.profiles(id) on delete set null,
  revoked_at        timestamptz,
  revoke_reason     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Four-eyes: a decider is never the requester, except the direct-grant path
  -- where a super admin files on behalf of ANOTHER user (requester <> target).
  constraint jit_decider_not_requester
    check (decided_by is null or requested_by is null or decided_by <> requested_by
           or requested_by <> target_user_id)
);

create index if not exists jit_elevation_status_idx on public.jit_elevation_requests (status, created_at desc);
create index if not exists jit_elevation_target_idx on public.jit_elevation_requests (target_user_id, status);
create index if not exists jit_elevation_active_exp_idx on public.jit_elevation_requests (expires_at) where status = 'approved';
create unique index if not exists jit_elevation_one_pending
  on public.jit_elevation_requests (target_user_id, module_key, capability) where status = 'pending';

alter table public.jit_elevation_requests enable row level security;

drop policy if exists jit_elevation_org_isolation on public.jit_elevation_requests;
create policy jit_elevation_org_isolation on public.jit_elevation_requests
  as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));

drop policy if exists jit_elevation_select on public.jit_elevation_requests;
create policy jit_elevation_select on public.jit_elevation_requests
  for select to authenticated
  using ((select public.is_super_admin())
         or requested_by = (select auth.uid())
         or target_user_id = (select auth.uid()));

revoke all on public.jit_elevation_requests from anon;
revoke insert, update, delete, truncate, trigger on public.jit_elevation_requests from authenticated;
grant select on public.jit_elevation_requests to authenticated;

-- ── 2. internal helpers ─────────────────────────────────────────────────────
create or replace function public._jit_audit(p_action text, p_id uuid, p_before jsonb, p_after jsonb, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_email text; v_target uuid;
begin
  select email into v_email from public.profiles where id = auth.uid();
  select target_user_id into v_target from public.jit_elevation_requests where id = p_id;
  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (auth.uid(), p_action, p_id, 'jit_elevation',
          coalesce(p_after, '{}'::jsonb) || jsonb_build_object('reason', left(p_reason, 500)));
  insert into public.access_audit (actor, actor_email, action, target_user, entity, before, after, reason)
  values (auth.uid(), v_email, p_action, v_target, 'jit_elevation', p_before, p_after, left(p_reason, 500));
end $$;

-- Returns the target's org, or raises with a plain sentence.
create or replace function public._jit_validate_target(p_user uuid, p_module text, p_cap text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_p record; v_key text := lower(btrim(coalesce(p_module, '')));
begin
  select id, role, coalesce(is_super_admin,false) as sup, coalesce(approved,false) as approved,
         coalesce(locked,false) as locked, coalesce(org_id, organisation_id) as org
    into v_p from public.profiles where id = p_user;
  if not found then raise exception 'That user does not exist' using errcode = 'P0002'; end if;
  if v_p.sup then raise exception 'Super admins already hold every capability' using errcode = '22023'; end if;
  if v_p.role = 'Admin' then raise exception 'Admins already hold every module capability' using errcode = '22023'; end if;
  if not v_p.approved or v_p.locked then
    raise exception 'Only an approved, unlocked account can be elevated' using errcode = '22023';
  end if;
  if p_cap not in ('view','create','edit','export','approve') then
    raise exception 'Capability must be view, create, edit, export or approve' using errcode = '22023';
  end if;
  if v_key !~ '^[a-z0-9_:\-]{1,80}$' then
    raise exception 'Unknown module' using errcode = '22023';
  end if;
  if not exists (select 1 from public.modules where module_id = regexp_replace(v_key, '^mobile:', ''))
     and not exists (select 1 from public.module_permissions where module_key = v_key or module_key = regexp_replace(v_key, '^mobile:', ''))
     and position(':' in regexp_replace(v_key, '^mobile:', '')) = 0 then
    raise exception 'Unknown module' using errcode = '22023';
  end if;
  return v_p.org;
end $$;

-- Writes/refreshes the expiring grant for an approved request; returns grant id.
create or replace function public._jit_activate(p_id uuid, p_minutes int, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.jit_elevation_requests%rowtype;
  v_existing public.user_access_grants%rowtype;
  v_exp timestamptz;
  v_gid uuid;
begin
  select * into r from public.jit_elevation_requests where id = p_id for update;
  v_exp := now() + make_interval(mins => p_minutes);

  if exists (select 1 from public.user_access_grants g
              where g.user_id = r.target_user_id and g.module_key = r.module_key
                and g.capability = r.capability and g.effect = 'revoke'
                and (g.expires_at is null or g.expires_at > now())) then
    raise exception 'This user is explicitly denied that capability. Remove the deny first.' using errcode = '22023';
  end if;

  select * into v_existing from public.user_access_grants g
   where g.user_id = r.target_user_id and g.module_key = r.module_key
     and g.capability = r.capability and g.effect = 'grant'
   for update;

  if found then
    if v_existing.expires_at is null or v_existing.expires_at > now() then
      raise exception 'This user already holds that capability (an active grant exists)' using errcode = '22023';
    end if;
    update public.user_access_grants
       set expires_at = v_exp, granted_by = auth.uid(),
           note = left('JIT elevation ' || p_id::text || coalesce(': ' || p_note, ''), 500),
           org_id = coalesce(org_id, r.organisation_id)
     where id = v_existing.id
    returning id into v_gid;
  else
    insert into public.user_access_grants (org_id, user_id, module_key, capability, effect, granted_by, note, expires_at)
    values (r.organisation_id, r.target_user_id, r.module_key, r.capability, 'grant', auth.uid(),
            left('JIT elevation ' || p_id::text || coalesce(': ' || p_note, ''), 500), v_exp)
    returning id into v_gid;
  end if;

  update public.jit_elevation_requests
     set status = 'approved', granted_minutes = p_minutes, starts_at = now(), expires_at = v_exp,
         grant_id = v_gid, decided_by = auth.uid(), decided_at = now(),
         decision_note = left(p_note, 500), updated_at = now()
   where id = p_id;
  return v_gid;
end $$;

-- ── 3. requester RPCs ───────────────────────────────────────────────────────
create or replace function public.request_elevation(p_module_key text, p_capability text, p_minutes int, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_key text := lower(btrim(coalesce(p_module_key, '')));
  v_cap text := lower(btrim(coalesce(p_capability, '')));
  v_id uuid;
begin
  if v_uid is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if public.is_super_admin() then
    raise exception 'Super admins already hold every capability' using errcode = '22023';
  end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 480 then
    raise exception 'Duration must be between 5 minutes and 8 hours' using errcode = '22023';
  end if;
  if length(v_reason) < 10 then
    raise exception 'A reason of at least 10 characters is required' using errcode = '22023';
  end if;
  v_org := public._jit_validate_target(v_uid, v_key, v_cap);

  if exists (select 1 from public.jit_elevation_requests
              where target_user_id = v_uid and module_key = v_key and capability = v_cap and status = 'pending') then
    raise exception 'You already have a pending request for that capability' using errcode = '23505';
  end if;

  insert into public.jit_elevation_requests (organisation_id, target_user_id, requested_by, module_key,
                                             capability, requested_minutes, reason)
  values (v_org, v_uid, v_uid, v_key, v_cap, p_minutes, left(v_reason, 1000))
  returning id into v_id;

  perform public._jit_audit('jit_elevation_request', v_id, null,
    jsonb_build_object('module_key', v_key, 'capability', v_cap, 'minutes', p_minutes), v_reason);

  begin
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
    select p.id, 'security', 'Elevation request waiting',
           coalesce((select coalesce(full_name, email) from public.profiles where id = v_uid), 'A user')
             || ' asks for ' || v_cap || ' on ' || v_key || ' for ' || p_minutes || ' minutes.',
           'jit_elevation', v_id
      from public.profiles p where coalesce(p.is_super_admin,false) and not coalesce(p.locked,false);
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'pending');
end $$;

create or replace function public.cancel_elevation(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.jit_elevation_requests%rowtype;
begin
  select * into r from public.jit_elevation_requests where id = p_id for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if r.requested_by is distinct from auth.uid() then
    raise exception 'Only the requester can cancel this request' using errcode = '42501';
  end if;
  if r.status <> 'pending' then return jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', r.status); end if;
  update public.jit_elevation_requests set status = 'cancelled', updated_at = now() where id = p_id;
  perform public._jit_audit('jit_elevation_cancel', p_id, jsonb_build_object('status','pending'),
                            jsonb_build_object('status','cancelled'), null);
  return jsonb_build_object('ok', true, 'id', p_id, 'status', 'cancelled');
end $$;

create or replace function public.my_elevation_requests()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb)
    from (select id, module_key, capability, requested_minutes, granted_minutes, reason, status,
                 decision_note, decided_at, starts_at, expires_at, revoked_at, revoke_reason, created_at
            from public.jit_elevation_requests
           where target_user_id = auth.uid() or requested_by = auth.uid()
           order by created_at desc limit 200) r;
$$;

-- ── 4. super-admin RPCs ─────────────────────────────────────────────────────
create or replace function public.admin_list_elevations(p_status text default null, p_limit int default 1000, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_rows jsonb; v_total int; v_lim int := least(greatest(coalesce(p_limit,1000),1),1000);
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  perform public.expire_jit_elevations();

  select count(*) into v_total from public.jit_elevation_requests
   where p_status is null or status = p_status;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id), '[]'::jsonb) into v_rows
  from (
    select r.*, coalesce(t.full_name, t.email) as target_name, t.role as target_role,
           coalesce(q.full_name, q.email) as requested_by_name,
           coalesce(d.full_name, d.email) as decided_by_name,
           coalesce(v.full_name, v.email) as revoked_by_name,
           o.name as organisation_name
      from public.jit_elevation_requests r
      left join public.profiles t on t.id = r.target_user_id
      left join public.profiles q on q.id = r.requested_by
      left join public.profiles d on d.id = r.decided_by
      left join public.profiles v on v.id = r.revoked_by
      left join public.organisations o on o.id = r.organisation_id
     where p_status is null or r.status = p_status
     order by r.created_at desc, r.id
     limit v_lim offset greatest(coalesce(p_offset,0),0)
  ) x;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_lim,
                            'offset', greatest(coalesce(p_offset,0),0), 'generated_at', now());
end $$;

create or replace function public.admin_decide_elevation(p_id uuid, p_approve boolean, p_note text default null, p_minutes int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.jit_elevation_requests%rowtype; v_min int; v_gid uuid; v_note text := nullif(btrim(coalesce(p_note,'')),'');
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  select * into r from public.jit_elevation_requests where id = p_id for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then return jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', r.status); end if;
  if r.requested_by = auth.uid() then
    raise exception 'You cannot decide your own request' using errcode = '42501';
  end if;

  if not coalesce(p_approve, false) then
    if v_note is null or length(v_note) < 5 then
      raise exception 'A denial reason of at least 5 characters is required' using errcode = '22023';
    end if;
    update public.jit_elevation_requests
       set status = 'denied', decided_by = auth.uid(), decided_at = now(),
           decision_note = left(v_note, 500), updated_at = now()
     where id = p_id;
    perform public._jit_audit('jit_elevation_deny', p_id, jsonb_build_object('status','pending'),
      jsonb_build_object('status','denied','module_key',r.module_key,'capability',r.capability), v_note);
    begin
      insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
      values (r.requested_by, 'security', 'Elevation request denied',
              r.capability || ' on ' || r.module_key || ': ' || left(v_note, 200), 'jit_elevation', p_id);
    exception when others then null; end;
    return jsonb_build_object('ok', true, 'id', p_id, 'status', 'denied');
  end if;

  v_min := coalesce(p_minutes, r.requested_minutes);
  if v_min < 5 or v_min > r.requested_minutes then
    raise exception 'Approved duration must be between 5 minutes and the requested % minutes', r.requested_minutes using errcode = '22023';
  end if;
  perform public._jit_validate_target(r.target_user_id, r.module_key, r.capability);
  v_gid := public._jit_activate(p_id, v_min, v_note);

  perform public._jit_audit('jit_elevation_approve', p_id, jsonb_build_object('status','pending'),
    jsonb_build_object('status','approved','module_key',r.module_key,'capability',r.capability,
                       'minutes',v_min,'grant_id',v_gid,'target_user_id',r.target_user_id), v_note);
  begin
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
    values (r.target_user_id, 'security', 'Elevation approved',
            r.capability || ' on ' || r.module_key || ' for ' || v_min || ' minutes.', 'jit_elevation', p_id);
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'id', p_id, 'status', 'approved', 'grant_id', v_gid,
                            'expires_at', now() + make_interval(mins => v_min));
end $$;

create or replace function public.admin_grant_elevation(p_user_id uuid, p_module_key text, p_capability text, p_minutes int, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid; v_id uuid; v_gid uuid;
  v_key text := lower(btrim(coalesce(p_module_key,'')));
  v_cap text := lower(btrim(coalesce(p_capability,'')));
  v_reason text := btrim(coalesce(p_reason,''));
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Super admins already hold every capability' using errcode = '22023';
  end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 480 then
    raise exception 'Duration must be between 5 minutes and 8 hours' using errcode = '22023';
  end if;
  if length(v_reason) < 10 then
    raise exception 'A reason of at least 10 characters is required' using errcode = '22023';
  end if;
  v_org := public._jit_validate_target(p_user_id, v_key, v_cap);

  insert into public.jit_elevation_requests (organisation_id, target_user_id, requested_by, module_key,
                                             capability, requested_minutes, reason)
  values (v_org, p_user_id, auth.uid(), v_key, v_cap, p_minutes, left(v_reason, 1000))
  returning id into v_id;
  v_gid := public._jit_activate(v_id, p_minutes, 'Granted directly by a super admin');

  perform public._jit_audit('jit_elevation_grant', v_id, null,
    jsonb_build_object('status','approved','module_key',v_key,'capability',v_cap,'minutes',p_minutes,
                       'grant_id',v_gid,'target_user_id',p_user_id,'direct',true), v_reason);
  begin
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
    values (p_user_id, 'security', 'Temporary access granted',
            v_cap || ' on ' || v_key || ' for ' || p_minutes || ' minutes.', 'jit_elevation', v_id);
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'approved', 'grant_id', v_gid);
end $$;

create or replace function public.admin_revoke_elevation(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.jit_elevation_requests%rowtype; v_reason text := btrim(coalesce(p_reason,''));
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  if length(v_reason) < 5 then
    raise exception 'A revoke reason of at least 5 characters is required' using errcode = '22023';
  end if;
  select * into r from public.jit_elevation_requests where id = p_id for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if r.status <> 'approved' then return jsonb_build_object('ok', false, 'reason', 'not_active', 'status', r.status); end if;

  -- Delete ONLY the grant this elevation wrote, and only while it still carries
  -- our expiry: if someone has since replaced it with a permanent grant, that
  -- deliberate grant is left alone.
  delete from public.user_access_grants
   where id = r.grant_id and expires_at is not null and expires_at <= r.expires_at + interval '1 second';

  update public.jit_elevation_requests
     set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(),
         revoke_reason = left(v_reason, 500), updated_at = now()
   where id = p_id;
  perform public._jit_audit('jit_elevation_revoke', p_id, jsonb_build_object('status','approved','expires_at',r.expires_at),
    jsonb_build_object('status','revoked','module_key',r.module_key,'capability',r.capability,'target_user_id',r.target_user_id), v_reason);
  begin
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
    values (r.target_user_id, 'security', 'Temporary access ended early',
            r.capability || ' on ' || r.module_key || ': ' || left(v_reason, 200), 'jit_elevation', p_id);
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'id', p_id, 'status', 'revoked');
end $$;

-- ── 5. expiry sweep (tidy only; expiry is already enforced lazily) ─────────
create or replace function public.expire_jit_elevations()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_exp int := 0; v_lapsed int := 0;
begin
  with ended as (
    update public.jit_elevation_requests
       set status = 'expired', updated_at = now()
     where status = 'approved' and expires_at <= now()
    returning grant_id, expires_at
  ), gone as (
    delete from public.user_access_grants g using ended e
     where g.id = e.grant_id and g.expires_at is not null and g.expires_at <= now()
    returning 1
  )
  select count(*) into v_exp from ended;

  update public.jit_elevation_requests
     set status = 'lapsed', updated_at = now()
   where status = 'pending' and created_at < now() - interval '24 hours';
  get diagnostics v_lapsed = row_count;

  return jsonb_build_object('expired', v_exp, 'lapsed', v_lapsed);
end $$;

-- ── 6. grants ───────────────────────────────────────────────────────────────
revoke all on function public._jit_audit(text, uuid, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._jit_validate_target(uuid, text, text) from public, anon, authenticated;
revoke all on function public._jit_activate(uuid, int, text) from public, anon, authenticated;
revoke all on function public.expire_jit_elevations() from public, anon, authenticated;

revoke all on function public.request_elevation(text, text, int, text) from public;
revoke all on function public.cancel_elevation(uuid) from public;
revoke all on function public.my_elevation_requests() from public;
revoke all on function public.admin_list_elevations(text, int, int) from public;
revoke all on function public.admin_decide_elevation(uuid, boolean, text, int) from public;
revoke all on function public.admin_grant_elevation(uuid, text, text, int, text) from public;
revoke all on function public.admin_revoke_elevation(uuid, text) from public;
revoke all on function public.request_elevation(text, text, int, text) from anon;
revoke all on function public.cancel_elevation(uuid) from anon;
revoke all on function public.my_elevation_requests() from anon;
revoke all on function public.admin_list_elevations(text, int, int) from anon;
revoke all on function public.admin_decide_elevation(uuid, boolean, text, int) from anon;
revoke all on function public.admin_grant_elevation(uuid, text, text, int, text) from anon;
revoke all on function public.admin_revoke_elevation(uuid, text) from anon;
grant execute on function public.request_elevation(text, text, int, text) to authenticated, service_role;
grant execute on function public.cancel_elevation(uuid) to authenticated, service_role;
grant execute on function public.my_elevation_requests() to authenticated, service_role;
grant execute on function public.admin_list_elevations(text, int, int) to authenticated, service_role;
grant execute on function public.admin_decide_elevation(uuid, boolean, text, int) to authenticated, service_role;
grant execute on function public.admin_grant_elevation(uuid, text, text, int, text) to authenticated, service_role;
grant execute on function public.admin_revoke_elevation(uuid, text) to authenticated, service_role;
grant execute on function public.expire_jit_elevations() to service_role;

-- ── 7. cron ─────────────────────────────────────────────────────────────────
do $$ begin
  perform cron.unschedule('jit-elevation-expiry') where exists (select 1 from cron.job where jobname = 'jit-elevation-expiry');
  perform cron.schedule('jit-elevation-expiry', '*/5 * * * *', 'select public.expire_jit_elevations()');
end $$;
