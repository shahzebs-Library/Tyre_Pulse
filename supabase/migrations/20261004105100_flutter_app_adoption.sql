-- App adoption split by app (owner rule 2026-10-04: mobile = the Flutter app).
--
-- admin_app_flutter_adoption(p_app text default 'flutter') returns the same
-- shape as admin_app_version_adoption (installs, active_7d, by_version with
-- app_version / platform / installs / active_7d / last_seen) but filtered to
-- one app:
--   'flutter' - push tokens that are NOT Expo tokens (Firebase, the Flutter app)
--   'expo'    - Expo push tokens (the retired Expo app, read-only reference)
-- admin_app_version_adoption is left untouched (other readers keep working).
-- DEFINER, search_path pinned, is_super_admin() gate, revoked PUBLIC then anon,
-- granted authenticated. Aggregates only: no token, user or id leaves.
--
-- Rollback: drop function if exists public.admin_app_flutter_adoption(text);

create or replace function public.admin_app_flutter_adoption(p_app text default 'flutter')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_expo boolean;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can read app adoption' using errcode = '42501';
  end if;
  if coalesce(p_app, 'flutter') not in ('flutter', 'expo') then
    raise exception 'Choose flutter or expo' using errcode = '22023';
  end if;
  v_expo := coalesce(p_app, 'flutter') = 'expo';

  with d as (
    select *
      from public.user_devices
     where not coalesce(revoked, false)
       and ((coalesce(push_token, '') like 'ExponentPushToken%' or coalesce(push_token, '') like 'ExpoPushToken%') = v_expo)
  )
  select jsonb_build_object(
    'ok', true,
    'app', coalesce(p_app, 'flutter'),
    'installs', (select count(*) from d),
    'active_7d', (select count(*) from d where last_seen_at >= now() - interval '7 days'),
    'by_version', coalesce((
      select jsonb_agg(jsonb_build_object('app_version', app_version, 'platform', platform,
                                          'installs', n, 'active_7d', a7, 'last_seen', ls)
                       order by n desc, app_version)
        from (select nullif(btrim(app_version), '') as app_version,
                     nullif(btrim(lower(platform)), '') as platform,
                     count(*) as n,
                     count(*) filter (where last_seen_at >= now() - interval '7 days') as a7,
                     max(last_seen_at) as ls
                from d
               group by 1, 2) s), '[]'::jsonb)
  ) into v;
  return v;
end
$$;

revoke all on function public.admin_app_flutter_adoption(text) from public;
revoke all on function public.admin_app_flutter_adoption(text) from anon;
grant execute on function public.admin_app_flutter_adoption(text) to authenticated;
