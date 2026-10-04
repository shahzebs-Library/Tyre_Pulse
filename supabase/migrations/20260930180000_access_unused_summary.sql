-- 20260930180000_access_unused_summary.sql
-- STATUS: applied live 30 Sep 2026 (Control Center, Trust area, Access Control).
--
-- Read-only "Unused and risky access" summary for the console Access Control
-- home. Super admin only (in-body is_super_admin gate). Nothing here changes
-- data: it reads profiles, auth.users.last_sign_in_at, user_access_grants,
-- custom_roles and access_review_campaigns and returns one jsonb document.
--
-- people[] feeds the access review drawer (suggestions are computed on the
-- client, see src/lib/accessUnused.js). Emails are masked server-side
-- (a***@x.com) so a full address never reaches the browser.
--
-- Rollback: drop function public.access_unused_summary();

create or replace function public._mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null or position('@' in p_email) = 0 then null
    else left(p_email, 1) || '***@' || split_part(p_email, '@', 2)
  end
$$;
revoke all on function public._mask_email(text) from public;
revoke all on function public._mask_email(text) from anon;
grant execute on function public._mask_email(text) to authenticated;

create or replace function public.access_unused_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_idle_days constant int := 30;
  v_out jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;

  with base as (
    select p.id, p.full_name, p.role, coalesce(p.is_super_admin, false) as is_super_admin,
           p.created_at, u.last_sign_in_at, u.email,
           (p.approved is not false and not coalesce(p.locked, false)) as can_sign_in
      from public.profiles p
      left join auth.users u on u.id = p.id
  ), g as (
    select user_id,
           count(*) as n,
           count(*) filter (where effect = 'revoke') as blocks,
           count(*) filter (where effect <> 'revoke') as grants,
           count(*) filter (where expires_at is not null) as with_end
      from public.user_access_grants
     group by user_id
  ), people as (
    select b.*, coalesce(g.n, 0) as rules
      from base b left join g on g.user_id = b.id
     where b.can_sign_in
  ), role_counts as (
    select role, count(*) as n from people group by role
  )
  select jsonb_build_object(
    'generated_at', now(),
    'idle_days', v_idle_days,
    'can_sign_in', (select count(*) from people),
    'active_30d', (select count(*) from people where last_sign_in_at >= now() - make_interval(days => v_idle_days)),
    'never_signed_in', (select count(*) from people where last_sign_in_at is null),
    'never_by_role', coalesce((select jsonb_object_agg(role, n) from (
        select coalesce(role, 'No role') as role, count(*) as n from people where last_sign_in_at is null group by 1) x), '{}'::jsonb),
    'never_first_created', (select min(created_at) from people where last_sign_in_at is null),
    'idle', (select count(*) from people where last_sign_in_at < now() - make_interval(days => v_idle_days)),
    'idle_by_role', coalesce((select jsonb_object_agg(role, n) from (
        select coalesce(role, 'No role') as role, count(*) as n from people
         where last_sign_in_at < now() - make_interval(days => v_idle_days) group by 1) x), '{}'::jsonb),
    'role_totals', coalesce((select jsonb_object_agg(coalesce(role, 'No role'), n) from role_counts), '{}'::jsonb),
    'admins', (select count(*) from people where is_super_admin or role = 'Admin'),
    'rules_total', (select coalesce(sum(n), 0) from g),
    'rules_grants', (select coalesce(sum(grants), 0) from g),
    'rules_blocks', (select coalesce(sum(blocks), 0) from g),
    'rules_with_end', (select coalesce(sum(with_end), 0) from g),
    'rules_people', (select count(*) from g),
    'empty_custom_roles', coalesce((select jsonb_agg(cr.name order by cr.name)
        from public.custom_roles cr
       where coalesce(cr.active, true)
         and not exists (select 1 from public.profiles p where p.role = cr.name)), '[]'::jsonb),
    'reviews_ever', (select count(*) from public.access_review_campaigns),
    'reviews_closed', (select count(*) from public.access_review_campaigns where status = 'closed'),
    'page_views_recorded', false,
    'people', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id,
        'name', coalesce(nullif(btrim(full_name), ''), public._mask_email(email), 'No name'),
        'email', public._mask_email(email),
        'role', role,
        'is_super_admin', is_super_admin,
        'created_at', created_at,
        'last_sign_in_at', last_sign_in_at,
        'rules', rules
      ) order by last_sign_in_at desc nulls last, full_name) from people), '[]'::jsonb)
  ) into v_out;

  return v_out;
end
$$;

revoke all on function public.access_unused_summary() from public;
revoke all on function public.access_unused_summary() from anon;
grant execute on function public.access_unused_summary() to authenticated;
