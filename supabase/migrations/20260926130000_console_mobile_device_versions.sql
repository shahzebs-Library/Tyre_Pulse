-- console_mobile_device_versions: the install base of the field app, by version.
--
-- WHY: the console Mobile App Control page counted "devices registered for
-- alerts" with a direct read of user_devices. That table's only SELECT policy
-- is own-rows (user_id = auth.uid()), so a super admin's count was THEIR OWN
-- devices (1-2), not the fleet (128 active on 2026-09-26). The page also could
-- not answer the one question the forced-update gate needs: how many phones a
-- proposed minimum would put behind the update wall.
--
-- This returns AGGREGATES ONLY (no token, no user, no device id), super-admin
-- only, so the page can show the real install base and a gate impact preview.
-- Read-only. SECURITY DEFINER with a pinned search_path and an in-body gate.
--
-- VERIFY:
--   select public.console_mobile_device_versions();  -- as a super admin: ok true
--   has_function_privilege('anon', 'public.console_mobile_device_versions()', 'EXECUTE') = false
-- ROLLBACK:
--   drop function if exists public.console_mobile_device_versions();

create or replace function public.console_mobile_device_versions()
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

  select jsonb_build_object(
    'ok', true,
    'total', (select count(*) from public.user_devices),
    'active', (select count(*) from public.user_devices where not coalesce(revoked, false)),
    'revoked', (select count(*) from public.user_devices where coalesce(revoked, false)),
    'seen_7d', (select count(*) from public.user_devices where not coalesce(revoked, false) and last_seen_at >= now() - interval '7 days'),
    'seen_30d', (select count(*) from public.user_devices where not coalesce(revoked, false) and last_seen_at >= now() - interval '30 days'),
    'users', (select count(distinct user_id) from public.user_devices where not coalesce(revoked, false)),
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
        from public.user_devices
        where not coalesce(revoked, false)
        group by 1, 2
      ) s
    ), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

revoke all on function public.console_mobile_device_versions() from public;
revoke all on function public.console_mobile_device_versions() from anon;
grant execute on function public.console_mobile_device_versions() to authenticated, service_role;
