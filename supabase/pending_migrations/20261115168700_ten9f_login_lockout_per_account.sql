-- =============================================================================
-- TEN-9f  the sign-in lockout counts per ACCOUNT, not per spelling.
-- STATUS: AUTHORED, NOT APPLIED. Proven on a private copy of local staging only
--         (supabase/tests/multi_company_auth/run_staging.sh, checks 9a-9h).
--
-- DEFECT (PR #546 test matrix, found while running the sign-in function locally)
--   login_attempt_status / record_login_failure key the counter on the TYPED text
--   (lower(btrim(identifier))). TEN-9b made one account reachable through many texts:
--   the username, the employee id, the email, "<code>/<name>", "<slug>/<name>", and
--   every spacing / backslash variant of the code form, which the resolver tolerates
--   ("beta / ali", "beta\ali", "BETA  /ali" ...). Each text has its own counter, so the
--   "lock after N failed sign-ins" rule (System Configuration) can be bypassed with
--   unlimited password guesses against one account by changing the spacing.
--   Before TEN-9b the same gap existed only as username vs employee id vs email (3x).
--
-- FIX
--   _login_attempt_key(text): 'u:<profile id>' when the text names an account
--   (the same resolver sign-in uses, then the auth email), else the old lower/trim text
--   (an unknown text never gets a row anyway). Both lockout functions use it;
--   reset_login_attempts (successful sign-in) clears the account key as well as the
--   old text keys. Behaviour for a person who types one spelling is unchanged.
--
-- TRANSITION: rows already keyed by text keep counting down their 15-minute window and
--   then stop mattering. Nothing is deleted.
-- ROLLBACK: re-create the three functions from the previous bodies (V287 / TEN-9b) and
--   drop function public._login_attempt_key(text).
-- =============================================================================

create or replace function public._login_attempt_key(p_identifier text)
returns text language sql stable security definer set search_path = public as $fn$
  select coalesce(
    'u:' || public._resolve_sign_in_profile(p_identifier)::text,
    'u:' || (select au.id::text from auth.users au where lower(au.email) = lower(btrim(coalesce(p_identifier, ''))) limit 1),
    lower(btrim(coalesce(p_identifier, ''))))
$fn$;
revoke execute on function public._login_attempt_key(text) from public, anon, authenticated;

create or replace function public.login_attempt_status(p_identifier text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_key text;
  v_max int := public._login_max_attempts();
  v_win int := public._login_window_minutes();
  r public.login_attempts%rowtype;
  v_used int := 0;
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
  if found and r.window_started_at > now() - make_interval(mins => v_win) then
    v_used := r.attempt_count;
  end if;
  return jsonb_build_object('enabled', true, 'locked', false,
    'remaining', greatest(0, v_max - v_used));
exception when others then
  return jsonb_build_object('enabled', false, 'locked', false);
end $fn$;

create or replace function public.record_login_failure(p_identifier text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_key text;
  v_max int := public._login_max_attempts();
  v_win int := public._login_window_minutes();
  v_lock int := public._login_lock_minutes();
  r public.login_attempts%rowtype;
  v_count int;
  v_locked_until timestamptz := null;
begin
  if v_max = 0 or btrim(coalesce(p_identifier, '')) = '' then
    return jsonb_build_object('enabled', v_max <> 0, 'locked', false);
  end if;
  if not public._login_identifier_exists(lower(btrim(p_identifier))) then
    -- Do not create rows for non-existent identifiers (no enumeration surface).
    return jsonb_build_object('enabled', true, 'locked', false);
  end if;
  v_key := public._login_attempt_key(p_identifier);

  select * into r from public.login_attempts where identifier = v_key for update;
  if not found then
    v_count := 1;
    insert into public.login_attempts(identifier, attempt_count, window_started_at, updated_at)
      values (v_key, 1, now(), now());
  elsif r.window_started_at > now() - make_interval(mins => v_win) and (r.locked_until is null or r.locked_until <= now()) then
    v_count := r.attempt_count + 1;
    update public.login_attempts set attempt_count = v_count, updated_at = now() where identifier = v_key;
  elsif r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('enabled', true, 'locked', true,
      'retry_after_seconds', greatest(0, ceil(extract(epoch from (r.locked_until - now())))::int));
  else
    v_count := 1;
    update public.login_attempts set attempt_count = 1, window_started_at = now(), locked_until = null, updated_at = now()
      where identifier = v_key;
  end if;

  if v_count >= v_max then
    v_locked_until := now() + make_interval(mins => v_lock);
    update public.login_attempts set locked_until = v_locked_until, updated_at = now() where identifier = v_key;
    return jsonb_build_object('enabled', true, 'locked', true, 'retry_after_seconds', v_lock * 60);
  end if;
  return jsonb_build_object('enabled', true, 'locked', false, 'remaining', greatest(0, v_max - v_count));
exception when others then
  return jsonb_build_object('enabled', false, 'locked', false);
end $fn$;

create or replace function public.reset_login_attempts()
returns void language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  delete from public.login_attempts la
  using public.profiles p, auth.users au
  where p.id = v_uid and au.id = v_uid
    and la.identifier in ('u:' || v_uid::text, lower(btrim(p.username)), lower(btrim(p.employee_id)), lower(btrim(au.email)));
exception when others then
  return;
end $fn$;
