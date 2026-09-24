-- ============================================================================
-- 20260924101000_session_revocation
-- Real session revocation ("force sign-out everywhere") for the super-admin
-- console. SOC 2 CC6.2 / CC6.3: immediate de-provisioning.
--
-- WHY: locking a profile only blocks the NEXT profile check. The user's refresh
-- token keeps minting new access tokens. Deleting their auth.sessions rows
-- (refresh_tokens cascade via refresh_tokens_session_id_fkey ON DELETE CASCADE)
-- means no new access token can ever be issued for those sign-ins.
--
-- LIMIT (stated, not hidden): an access token ALREADY issued stays valid until
-- its own expiry (project default 1 hour). Revocation stops renewal; it cannot
-- recall a JWT that is already in a browser.
--
-- CALLER: only the edge function admin-revoke-sessions, via the service role.
-- Both functions are EXECUTE-granted to service_role ONLY. Revoke from PUBLIC
-- first, then anon/authenticated by name (V500 ordering lesson).
--
-- The actor is re-validated INSIDE the SQL (super admin, not locked), so the
-- boundary does not rest on the edge function alone. The lock is performed as
-- the actor by setting request.jwt.claims locally, so:
--   * trg_guard_profile_privileged passes legitimately via is_super_admin()
--     (no trigger is disabled, no ACCESS EXCLUSIVE lock is taken);
--   * trg_guard_last_admin_upd still refuses locking the last super admin /
--     last org admin (the whole call rolls back, nothing is revoked);
--   * trg_access_audit_profiles records the lock against the real actor.
--
-- ROLLBACK:
--   drop function if exists public.admin_revoke_user_sessions(uuid, uuid, text, boolean);
--   drop function if exists public.revoke_user_sessions(uuid);
-- ============================================================================

create or replace function public.revoke_user_sessions(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_count integer := 0;
begin
  if p_user is null then
    return 0;
  end if;
  delete from auth.sessions where user_id = p_user;
  get diagnostics v_count = row_count;
  -- Defensive: any legacy refresh token not attached to a session.
  delete from auth.refresh_tokens where user_id = p_user::text;
  return v_count;
end
$$;

revoke all on function public.revoke_user_sessions(uuid) from public;
revoke all on function public.revoke_user_sessions(uuid) from anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

comment on function public.revoke_user_sessions(uuid) is
  'Deletes every auth.sessions row (refresh tokens cascade) for a user. Service role only. Issued access tokens stay valid until expiry.';

create or replace function public.admin_revoke_user_sessions(
  p_actor  uuid,
  p_target uuid,
  p_reason text,
  p_lock   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_actor      public.profiles%rowtype;
  v_target     public.profiles%rowtype;
  v_reason     text := nullif(btrim(coalesce(p_reason, '')), '');
  v_count      integer := 0;
  v_locked     boolean := false;
  v_was_locked boolean;
  v_email      text;
begin
  if p_actor is null or p_target is null then
    raise exception 'Missing actor or target.' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'A reason is required.' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    v_reason := left(v_reason, 500);
  end if;
  if p_actor = p_target then
    raise exception 'You cannot revoke your own sessions here.' using errcode = '22023';
  end if;

  select * into v_actor from public.profiles where id = p_actor;
  if not found or not coalesce(v_actor.is_super_admin, false) or coalesce(v_actor.locked, false) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select * into v_target from public.profiles where id = p_target;
  if not found then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  v_was_locked := coalesce(v_target.locked, false);

  select email into v_email from auth.users where id = p_actor;

  -- Act as the actor for the rest of this transaction only.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor::text, 'role', 'authenticated')::text, true);

  if coalesce(p_lock, false) and not v_was_locked then
    -- guard_last_admin raises 42501 for the last super admin / last org admin;
    -- that aborts the whole call, so nothing is half-done.
    update public.profiles set locked = true where id = p_target;
    v_locked := true;
  elsif v_was_locked then
    v_locked := true;
  end if;

  v_count := public.revoke_user_sessions(p_target);

  insert into public.access_audit (actor, actor_email, action, target_user, entity, before, after, reason)
  values (p_actor, v_email, 'REVOKE', p_target, 'session_revoke',
          jsonb_build_object('locked', v_was_locked),
          jsonb_build_object('sessions_revoked', v_count, 'locked', v_locked),
          v_reason);

  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (p_actor, 'revoke_sessions', p_target, 'user',
          jsonb_build_object('sessions_revoked', v_count, 'locked', v_locked,
                             'lock_requested', coalesce(p_lock, false), 'reason', v_reason));

  return jsonb_build_object('ok', true, 'sessions_revoked', v_count, 'locked', v_locked);
end
$$;

revoke all on function public.admin_revoke_user_sessions(uuid, uuid, text, boolean) from public;
revoke all on function public.admin_revoke_user_sessions(uuid, uuid, text, boolean) from anon, authenticated;
grant execute on function public.admin_revoke_user_sessions(uuid, uuid, text, boolean) to service_role;

comment on function public.admin_revoke_user_sessions(uuid, uuid, text, boolean) is
  'Super-admin force sign-out: optional lock + delete all sessions + access_audit/console_sessions rows, atomically. Service role only (edge fn admin-revoke-sessions).';
