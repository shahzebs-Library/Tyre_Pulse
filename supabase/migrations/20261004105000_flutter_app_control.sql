-- Flutter app control for the System Console (Mobile App page).
--
-- Owner rule (2026-10-04): every mobile control refers to the Flutter app
-- (tyre_pulse_flutter, package com.shahzebrahman.tyrepulse). The Expo app and
-- its keys (mobile_min_version / mobile_latest_version) are retired and stay
-- untouched and read-only in the console.
--
-- Adds, all additive:
--   1. system_config.flutter_latest_version seeded with the pubspec version
--      name (0.1.0) when no row exists. flutter_min_version is NOT seeded: a
--      blank minimum means the gate is off, and the Flutter app fails open.
--   2. _flutter_version_cmp(a, b) - numeric segment compare (-1/0/1), mirrors
--      src/lib/mobileOps.js compareVersions and tyre_pulse_flutter
--      lib/core/auth/app_version.dart (segments are numbers, missing = 0).
--   3. admin_set_flutter_version(p_which, p_value, p_reason) - the ONLY writer
--      for the two Flutter keys from the console. Enforces the interlock on the
--      SERVER as well as on the page:
--        min:    blank = gate off; otherwise a clean version, a latest release
--                must be recorded, and min may never exceed latest.
--        latest: a clean version that is never below the saved minimum.
--      Writes through admin_set_config so the change lands in
--      system_config_history with the reason.
--   4. console_flutter_device_versions() - install base of the Flutter app
--      only (user_devices rows whose push token is NOT an Expo token), plus
--      the retired Expo device count for reference. Aggregates only.
-- All DEFINER functions: search_path pinned, is_super_admin() gate in the
-- body, revoked from PUBLIC then anon, granted to authenticated.
--
-- Rollback:
--   drop function if exists public.admin_set_flutter_version(text, text, text);
--   drop function if exists public.console_flutter_device_versions();
--   drop function if exists public._flutter_version_cmp(text, text);
--   delete from public.system_config where key = 'flutter_latest_version';

insert into public.system_config(key, value)
select 'flutter_latest_version', '0.1.0'
where not exists (select 1 from public.system_config where key = 'flutter_latest_version');

create or replace function public._flutter_version_cmp(a text, b text)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  pa int[] := string_to_array(regexp_replace(btrim(coalesce(a, '')), '^[vV]', ''), '.')::int[];
  pb int[] := string_to_array(regexp_replace(btrim(coalesce(b, '')), '^[vV]', ''), '.')::int[];
  n int := greatest(coalesce(array_length(pa, 1), 0), coalesce(array_length(pb, 1), 0));
  x int; y int;
begin
  for i in 1..n loop
    x := coalesce(pa[i], 0);
    y := coalesce(pb[i], 0);
    if x <> y then
      return case when x < y then -1 else 1 end;
    end if;
  end loop;
  return 0;
end
$$;

revoke all on function public._flutter_version_cmp(text, text) from public;
revoke all on function public._flutter_version_cmp(text, text) from anon;
grant execute on function public._flutter_version_cmp(text, text) to authenticated;

create or replace function public.admin_set_flutter_version(p_which text, p_value text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value  text := btrim(coalesce(p_value, ''));
  v_min    text;
  v_latest text;
  v_key    text;
  v_res    jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can change the Flutter app versions' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Give a short reason for this change' using errcode = '22023';
  end if;

  select btrim(btrim(coalesce(value, '')), '"') into v_min
    from public.system_config where key = 'flutter_min_version';
  select btrim(btrim(coalesce(value, '')), '"') into v_latest
    from public.system_config where key = 'flutter_latest_version';
  v_min := coalesce(v_min, '');
  v_latest := coalesce(v_latest, '');

  if p_which = 'min' then
    v_key := 'flutter_min_version';
    if v_value <> '' then
      if v_value !~ '^[vV]?\d+(\.\d+)*$' then
        raise exception 'That is not a version number. The app would ignore it, so it was not saved' using errcode = '22023';
      end if;
      if v_latest !~ '^[vV]?\d+(\.\d+)*$' then
        raise exception 'Record the newest released Flutter version first' using errcode = '22023';
      end if;
      if public._flutter_version_cmp(v_value, v_latest) > 0 then
        raise exception 'The minimum cannot be above the newest release (%). That would lock every phone out', v_latest using errcode = '22023';
      end if;
    end if;
  elsif p_which = 'latest' then
    v_key := 'flutter_latest_version';
    if v_value !~ '^[vV]?\d+(\.\d+)*$' then
      raise exception 'Enter the version name that is live on Google Play, for example 0.1.1' using errcode = '22023';
    end if;
    if v_min ~ '^[vV]?\d+(\.\d+)*$' and public._flutter_version_cmp(v_min, v_value) > 0 then
      raise exception 'The forced-update minimum is %. Lower it before recording an older release', v_min using errcode = '22023';
    end if;
  else
    raise exception 'Choose min or latest' using errcode = '22023';
  end if;

  v_res := public.admin_set_config(v_key, v_value, p_reason);
  return v_res || jsonb_build_object('which', p_which);
end
$$;

revoke all on function public.admin_set_flutter_version(text, text, text) from public;
revoke all on function public.admin_set_flutter_version(text, text, text) from anon;
grant execute on function public.admin_set_flutter_version(text, text, text) to authenticated;

create or replace function public.console_flutter_device_versions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can read the device install base' using errcode = '42501';
  end if;

  with d as (
    select *
      from public.user_devices
     where coalesce(push_token, '') not like 'ExponentPushToken%'
       and coalesce(push_token, '') not like 'ExpoPushToken%'
  )
  select jsonb_build_object(
    'ok', true,
    'total', (select count(*) from d),
    'active', (select count(*) from d where not coalesce(revoked, false)),
    'revoked', (select count(*) from d where coalesce(revoked, false)),
    'seen_7d', (select count(*) from d where not coalesce(revoked, false) and last_seen_at >= now() - interval '7 days'),
    'seen_30d', (select count(*) from d where not coalesce(revoked, false) and last_seen_at >= now() - interval '30 days'),
    'users', (select count(distinct user_id) from d where not coalesce(revoked, false)),
    'expo_active', (select count(*) from public.user_devices
                     where not coalesce(revoked, false)
                       and (push_token like 'ExponentPushToken%' or push_token like 'ExpoPushToken%')),
    'by_version', coalesce((
      select jsonb_agg(jsonb_build_object(
        'app_version', app_version, 'platform', platform, 'devices', n,
        'last_seen', last_seen, 'seen_30d', seen_30d
      ) order by n desc, app_version)
      from (
        select nullif(btrim(app_version), '') as app_version,
               nullif(btrim(lower(platform)), '') as platform,
               count(*) as n,
               max(last_seen_at) as last_seen,
               count(*) filter (where last_seen_at >= now() - interval '30 days') as seen_30d
          from d
         where not coalesce(revoked, false)
         group by 1, 2
      ) s
    ), '[]'::jsonb)
  ) into v;
  return v;
end
$$;

revoke all on function public.console_flutter_device_versions() from public;
revoke all on function public.console_flutter_device_versions() from anon;
grant execute on function public.console_flutter_device_versions() to authenticated;
