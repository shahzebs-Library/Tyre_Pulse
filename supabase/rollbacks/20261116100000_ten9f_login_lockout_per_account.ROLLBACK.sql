-- ROLLBACK for 20261116100000_ten9f_login_lockout_per_account.sql
-- Restores the three sign-in lockout functions to the exact bodies live on production
-- on 2026-11-16 (md5 of pg_get_functiondef: login_attempt_status bda4f978f7404a86aa650f9aab6f3f14,
-- record_login_failure c8a5b4a419e567262e6620c3fb16bbed, reset_login_attempts
-- 32867f65d8493dd864f2d00c9e29dc71), then removes the objects TEN-9f added.
-- Counter rows keyed 'u:<id>' / 'x:<hash>' are left in place and simply stop being read.
-- The access_audit rows written by admin_clear_login_lock are kept (audit history).
begin;
CREATE OR REPLACE FUNCTION public.login_attempt_status(p_identifier text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_key text := lower(btrim(coalesce(p_identifier, '')));
  v_max int := public._login_max_attempts();
  v_win int := public._login_window_minutes();
  r public.login_attempts%rowtype;
  v_used int := 0;
begin
  if v_max = 0 or v_key = '' then
    return jsonb_build_object('enabled', v_max <> 0, 'locked', false);
  end if;
  select * into r from public.login_attempts where identifier = v_key;
  if found and r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('enabled', true, 'locked', true,
      'retry_after_seconds', greatest(0, ceil(extract(epoch from (r.locked_until - now())))::int));
  end if;
  if found and r.window_started_at > now() - make_interval(mins => v_win) then
    v_used := r.attempt_count;
  end if;
  return jsonb_build_object('enabled', true, 'locked', false,
    'remaining', greatest(0, v_max - v_used));
exception when others then
  return jsonb_build_object('enabled', false, 'locked', false);
end $function$
;
CREATE OR REPLACE FUNCTION public.record_login_failure(p_identifier text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_key text := lower(btrim(coalesce(p_identifier, '')));
  v_max int := public._login_max_attempts();
  v_win int := public._login_window_minutes();
  v_lock int := public._login_lock_minutes();
  r public.login_attempts%rowtype;
  v_count int;
  v_locked_until timestamptz := null;
begin
  if v_max = 0 or v_key = '' then
    return jsonb_build_object('enabled', v_max <> 0, 'locked', false);
  end if;
  if not public._login_identifier_exists(v_key) then
    -- Do not create rows for non-existent identifiers (no enumeration surface).
    return jsonb_build_object('enabled', true, 'locked', false);
  end if;

  select * into r from public.login_attempts where identifier = v_key for update;
  if not found then
    v_count := 1;
    insert into public.login_attempts(identifier, attempt_count, window_started_at, updated_at)
      values (v_key, 1, now(), now());
  elsif r.window_started_at > now() - make_interval(mins => v_win) and (r.locked_until is null or r.locked_until <= now()) then
    v_count := r.attempt_count + 1;
    update public.login_attempts set attempt_count = v_count, updated_at = now() where identifier = v_key;
  elsif r.locked_until is not null and r.locked_until > now() then
    -- Already locked; keep the lock.
    return jsonb_build_object('enabled', true, 'locked', true,
      'retry_after_seconds', greatest(0, ceil(extract(epoch from (r.locked_until - now())))::int));
  else
    -- Window expired: start a fresh window.
    v_count := 1;
    update public.login_attempts set attempt_count = 1, window_started_at = now(), locked_until = null, updated_at = now()
      where identifier = v_key;
  end if;

  if v_count >= v_max then
    v_locked_until := now() + make_interval(mins => v_lock);
    update public.login_attempts set locked_until = v_locked_until, updated_at = now() where identifier = v_key;
    return jsonb_build_object('enabled', true, 'locked', true,
      'retry_after_seconds', v_lock * 60);
  end if;
  return jsonb_build_object('enabled', true, 'locked', false,
    'remaining', greatest(0, v_max - v_count));
exception when others then
  return jsonb_build_object('enabled', false, 'locked', false);
end $function$
;
CREATE OR REPLACE FUNCTION public.reset_login_attempts()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  delete from public.login_attempts la
  using public.profiles p, auth.users au
  where p.id = v_uid and au.id = v_uid
    and la.identifier in (lower(btrim(p.username)), lower(btrim(p.employee_id)), lower(btrim(au.email)));
exception when others then
  return;
end $function$
;
drop function if exists public.admin_clear_login_lock(uuid, text);
drop function if exists public.admin_login_lock_status(uuid);
drop function if exists public._login_lock_admin_ok(uuid);
drop function if exists public._login_attempt_key(text);
drop index if exists public.login_attempts_updated_at_idx;
commit;
