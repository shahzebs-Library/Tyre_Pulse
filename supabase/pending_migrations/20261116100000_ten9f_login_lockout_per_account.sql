-- =============================================================================
-- TEN-9f (standalone)  Sign-in lockout counts per ACCOUNT, not per spelling.
-- STATUS: AUTHORED, NOT APPLIED. Needs the owner's explicit approval.
-- Independent of TEN-9d / TEN-9e / ten9c and of the multi-company switch: it only
-- reads functions that are already live (_resolve_sign_in_profile, _login_max_attempts,
-- _login_window_minutes, _login_lock_minutes, app_role, is_super_admin, app_current_org,
-- is_approved_and_unlocked) and the existing public.login_attempts / access_audit tables.
--
-- DEFECT (reproduced on production 2026-11-16 in a rolled-back transaction, demo account)
--   login_attempt_status / record_login_failure key the counter on the TYPED text.
--   One account is reachable through many texts (username, employee id, email,
--   "<company code>/<name>", and every spacing / backslash variant of that form), each
--   with its own counter. After 5 failures on "demo.manager" the account read LOCKED,
--   while "PLAY-DEMO-MGR", "demo.manager@users.tyrepulse.app", "demo/demo.manager" and
--   "demo / demo.manager" each still read 5 fresh attempts. The spacing variants are
--   unlimited, so the "lock after N failed sign-ins" setting can be bypassed.
--
-- ALSO FIXED
--   1. Account-existence oracle: record_login_failure answered unknown names with no
--      'remaining' key and never locked them, so an anonymous caller could tell real
--      accounts from made-up ones. Unknown names now get their own (hashed) counter and
--      lock exactly like real ones, and neither RPC returns 'remaining' any more
--      (no screen on web, Expo or Flutter shows it; Flutter reads it as optional).
--   2. Concurrency (hardening, not an observed defect): the first failure for a key did
--      select-then-insert, so two attempts in the same instant could collide on the
--      primary key and one would be swallowed by the exception handler. 20 parallel
--      clients on staging did NOT reproduce a loss with the current function (20/20
--      counted), so this is defence in depth. Now a single INSERT .. ON CONFLICT DO UPDATE.
--   3. Admin recovery: there was no way for an administrator to clear a lock (only the
--      15-minute expiry). New admin_login_lock_status / admin_clear_login_lock, gated to
--      super admin or an Admin of the same company, reason required, every clear written
--      to access_audit with the before state.
--
-- UNCHANGED FOR USERS: same 5 attempts / 15-minute window / 15-minute lock
-- (system_config.max_login_attempts), same JSON keys the apps read
-- (enabled, locked, retry_after_seconds), same reset on a successful sign-in.
--
-- NOT COVERED (stated, not hidden): this counter is enforced by the apps and the
-- sign-in edge function. A script calling the Supabase Auth API directly with an
-- account's email never touches it; that path is bounded only by Supabase Auth's
-- own per-IP rate limits. Closing it needs the Password Verification Attempt hook
-- (Supabase Teams plan) or CAPTCHA on every client. See the approval package.
--
-- TRANSITION: the 18 existing rows are keyed by text; they keep counting down their
-- 15-minute window and then stop mattering. Nothing existing is deleted by this file.
-- ROLLBACK: 20261116100000_ten9f_login_lockout_per_account.ROLLBACK.sql
-- =============================================================================

begin;

create index if not exists login_attempts_updated_at_idx on public.login_attempts (updated_at);

-- One counter per account. Unknown text gets a hashed key so it behaves identically
-- (never reveals whether an account exists) and never stores the raw text.
create or replace function public._login_attempt_key(p_identifier text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_text text := lower(btrim(coalesce(p_identifier, '')));
  v_uid uuid;
begin
  if v_text = '' then return null; end if;
  v_uid := public._resolve_sign_in_profile(p_identifier);
  if v_uid is null then
    select au.id into v_uid from auth.users au where lower(au.email) = v_text limit 1;
  end if;
  if v_uid is not null then return 'u:' || v_uid::text; end if;
  return 'x:' || md5(v_text);
end $fn$;
revoke execute on function public._login_attempt_key(text) from public, anon, authenticated;

create or replace function public.login_attempt_status(p_identifier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_max int := public._login_max_attempts();
  v_key text;
  r public.login_attempts%rowtype;
begin
  if v_max = 0 or btrim(coalesce(p_identifier, '')) = '' then
    return jsonb_build_object('enabled', v_max <> 0, 'locked', false);
  end if;
  v_key := public._login_attempt_key(p_identifier);
  select * into r from public.login_attempts where identifier = v_key;
  if found and r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('enabled', true, 'locked', true,
      'retry_after_seconds', greatest(0, ceil(extract(epoch from (r.locked_until - now())))::int));
  end if;
  return jsonb_build_object('enabled', true, 'locked', false);
exception when others then
  return jsonb_build_object('enabled', false, 'locked', false);
end $fn$;

create or replace function public.record_login_failure(p_identifier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_max int := public._login_max_attempts();
  v_win interval := make_interval(mins => public._login_window_minutes());
  v_lock interval := make_interval(mins => public._login_lock_minutes());
  v_key text;
  v_count int;
  v_until timestamptz;
begin
  if v_max = 0 or btrim(coalesce(p_identifier, '')) = '' then
    return jsonb_build_object('enabled', v_max <> 0, 'locked', false);
  end if;
  v_key := public._login_attempt_key(p_identifier);

  -- One statement: concurrent failures serialise on the row and are all counted.
  insert into public.login_attempts as la (identifier, attempt_count, window_started_at, locked_until, updated_at)
  values (v_key, 1, now(), null, now())
  on conflict (identifier) do update set
    attempt_count = case
      when la.locked_until > now() then la.attempt_count
      when la.window_started_at > now() - v_win then la.attempt_count + 1
      else 1 end,
    window_started_at = case
      when la.locked_until > now() or la.window_started_at > now() - v_win then la.window_started_at
      else now() end,
    locked_until = case when la.locked_until > now() then la.locked_until else null end,
    updated_at = now()
  returning attempt_count, locked_until into v_count, v_until;

  if v_until is not null and v_until > now() then
    return jsonb_build_object('enabled', true, 'locked', true,
      'retry_after_seconds', greatest(0, ceil(extract(epoch from (v_until - now())))::int));
  end if;

  if v_count >= v_max then
    v_until := now() + v_lock;
    update public.login_attempts set locked_until = v_until, updated_at = now() where identifier = v_key;
    return jsonb_build_object('enabled', true, 'locked', true,
      'retry_after_seconds', ceil(extract(epoch from v_lock))::int);
  end if;

  -- Occasional housekeeping: counters idle for a day can never matter again.
  if random() < 0.02 then
    delete from public.login_attempts
     where updated_at < now() - interval '1 day'
       and (locked_until is null or locked_until < now());
  end if;

  return jsonb_build_object('enabled', true, 'locked', false);
exception when others then
  return jsonb_build_object('enabled', false, 'locked', false);
end $fn$;

-- Successful sign-in clears the account counter and any legacy text counters.
create or replace function public.reset_login_attempts()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  delete from public.login_attempts la
   where la.identifier = 'u:' || v_uid::text
      or la.identifier in (
        select lower(btrim(x)) from (
          select p.username as x from public.profiles p where p.id = v_uid
          union all select p.employee_id from public.profiles p where p.id = v_uid
          union all select au.email from auth.users au where au.id = v_uid) s
        where x is not null);
exception when others then
  return;
end $fn$;

-- Administrator recovery -------------------------------------------------------
create or replace function public._login_lock_admin_ok(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(public.is_approved_and_unlocked(), false)
     and (coalesce(public.is_super_admin(), false)
          or (public.app_role() = 'admin'
              and exists (select 1 from public.profiles t
                           where t.id = p_user_id and t.org_id = public.app_current_org())))
$fn$;
revoke execute on function public._login_lock_admin_ok(uuid) from public, anon, authenticated;

create or replace function public.admin_login_lock_status(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare r public.login_attempts%rowtype;
begin
  if p_user_id is null or not public._login_lock_admin_ok(p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into r from public.login_attempts where identifier = 'u:' || p_user_id::text;
  return jsonb_build_object('ok', true,
    'locked', coalesce(r.locked_until > now(), false),
    'retry_after_seconds', case when r.locked_until > now()
      then ceil(extract(epoch from (r.locked_until - now())))::int else 0 end,
    'failed_attempts', coalesce(r.attempt_count, 0),
    'last_failure_at', r.updated_at);
end $fn$;
revoke execute on function public.admin_login_lock_status(uuid) from public, anon;
grant execute on function public.admin_login_lock_status(uuid) to authenticated;

create or replace function public.admin_clear_login_lock(p_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_before jsonb;
  v_n int;
begin
  if p_user_id is null or not public._login_lock_admin_ok(p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if length(v_reason) < 5 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  select jsonb_agg(to_jsonb(la)) into v_before
    from public.login_attempts la
   where la.identifier = 'u:' || p_user_id::text;

  delete from public.login_attempts where identifier = 'u:' || p_user_id::text;
  get diagnostics v_n = row_count;

  insert into public.access_audit (actor, actor_email, action, target_user, entity, before, after, reason)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          'login_lock_cleared', p_user_id, 'login_attempts', v_before, null, v_reason);

  return jsonb_build_object('ok', true, 'cleared', v_n);
end $fn$;
revoke execute on function public.admin_clear_login_lock(uuid, text) from public, anon;
grant execute on function public.admin_clear_login_lock(uuid, text) to authenticated;

-- The three sign-in RPCs keep their existing grants (anon + authenticated for the two
-- pre-sign-in calls, authenticated for reset); CREATE OR REPLACE preserves them.

commit;

-- VERIFY (read only, after applying)
--   select p.proname, md5(pg_get_functiondef(p.oid)),
--          has_function_privilege('anon', p.oid, 'EXECUTE') anon_x,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('_login_attempt_key','login_attempt_status','record_login_failure',
--                        'reset_login_attempts','_login_lock_admin_ok',
--                        'admin_login_lock_status','admin_clear_login_lock');
--   expect: _login_attempt_key / _login_lock_admin_ok  anon_x=f auth_x=f
--           login_attempt_status / record_login_failure anon_x=t auth_x=t
--           reset_login_attempts / admin_*            anon_x=f auth_x=t
--   Then the rolled-back spelling test in the approval package (expects every spelling LOCKED).
