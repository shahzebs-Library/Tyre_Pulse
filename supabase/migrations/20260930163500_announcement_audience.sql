-- 20260930163500_announcement_audience.sql
-- Notifications: the live audience count in the announcement composer.
--
-- WHAT IT ADDS
--   announcement_audience(p_roles text[], p_countries text[])  read-only, super admin. For the chosen
--   roles (null = everyone) and countries (null = any country, matched against profiles.country) it
--   returns: accounts who would see the banner, how many signed in within 30 days (so will see it soon),
--   and how many have an active phone with a push token (reachable if push is also sent). Counts only,
--   no names or emails.
--
-- PRE-FLIGHT
--   Read only. DEFINER, search_path public + auth, is_super_admin() in body, revoke PUBLIC then anon,
--   grant authenticated. Rollback: drop function public.announcement_audience(text[], text[]);

create or replace function public.announcement_audience(p_roles text[] default null, p_countries text[] default null)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can size an announcement audience' using errcode = '42501';
  end if;
  with aud as (
    select p.id from public.profiles p
    where coalesce(p.approved, false) and not coalesce(p.locked, false)
      and (p_roles is null or cardinality(p_roles) = 0 or p.role = any(p_roles))
      and (p_countries is null or cardinality(p_countries) = 0 or p.country && p_countries)
  )
  select jsonb_build_object(
    'ok', true,
    'accounts', (select count(*) from aud),
    'signed_in_30d', (select count(*) from aud a join auth.users u on u.id = a.id
                       where u.last_sign_in_at >= now() - interval '30 days'),
    'push_reachable', (select count(distinct d.user_id) from public.user_devices d join aud a on a.id = d.user_id
                        where not coalesce(d.revoked, false) and nullif(btrim(d.push_token), '') is not null)
  ) into v;
  return v;
end;
$$;

revoke all on function public.announcement_audience(text[], text[]) from public;
revoke all on function public.announcement_audience(text[], text[]) from anon;
grant execute on function public.announcement_audience(text[], text[]) to authenticated;
