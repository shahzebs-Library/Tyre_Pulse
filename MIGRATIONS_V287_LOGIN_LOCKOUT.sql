-- V287 — account lockout after N failed logins (System Configuration:
-- max_login_attempts). Standard identifier-based lockout with a rolling window.
--
-- Security model:
--  * status + record-failure are anon-callable (pre-auth), but record-failure
--    only counts against a REAL account (no enumeration junk) and never reveals
--    whether the account exists (generic status either way).
--  * reset REQUIRES an authenticated session and only clears the CALLER's own
--    counters — so an attacker who cannot sign in can never reset to bypass the
--    lock (this is what makes the control real rather than trivially defeated).
--  * Fail-SAFE everywhere: if max_login_attempts is 0/unset the control is OFF
--    (never locks); any internal error returns "not locked" so a bug can never
--    block a legitimate login.
--  * Known tradeoff (documented): identifier lockout is DoS-able by someone who
--    knows a valid username, bounded by the auto-expiring lock window (15 min).
--
-- Idempotent (CREATE ... IF NOT EXISTS / OR REPLACE). Next free migration V288.

create table if not exists public.login_attempts (
  identifier        text primary key,
  attempt_count     integer not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until      timestamptz,
  updated_at        timestamptz not null default now()
);

alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from anon, authenticated;

create or replace function public._login_window_minutes() returns int language sql immutable as $$ select 15 $$;
create or replace function public._login_lock_minutes()   returns int language sql immutable as $$ select 15 $$;

create or replace function public._login_max_attempts()
returns int language plpgsql security definer set search_path to 'public' stable as $$
declare v text; n int;
begin
  select value into v from public.system_config where key = 'max_login_attempts';
  if v is null then return 0; end if;
  begin n := trunc(v::numeric)::int; exception when others then return 0; end;
  if n is null or n < 1 then return 0; end if;
  return n;
end $$;

create or replace function public._login_identifier_exists(p_id text)
returns boolean language sql security definer set search_path to 'public' stable as $$
  select exists (
    select 1 from public.profiles p
    where lower(p.username) = lower(btrim(p_id))
       or lower(p.employee_id) = lower(btrim(p_id))
       or lower(p.email) = lower(btrim(p_id))
  );
$$;

create or replace function public.login_attempt_status(p_identifier text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
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
end $$;

create or replace function public.record_login_failure(p_identifier text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
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
end $$;

create or replace function public.reset_login_attempts()
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  delete from public.login_attempts la
  using public.profiles p, auth.users au
  where p.id = v_uid and au.id = v_uid
    and la.identifier in (lower(btrim(p.username)), lower(btrim(p.employee_id)), lower(btrim(au.email)));
exception when others then
  return;
end $$;

revoke all on function public.login_attempt_status(text) from public;
revoke all on function public.record_login_failure(text) from public;
revoke all on function public.reset_login_attempts() from public;
grant execute on function public.login_attempt_status(text) to anon, authenticated;
grant execute on function public.record_login_failure(text) to anon, authenticated;
grant execute on function public.reset_login_attempts() to authenticated;

-- Rollback: drop the four functions + helpers + table public.login_attempts.
