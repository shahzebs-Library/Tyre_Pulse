-- Control Center, Organizations: one read-only overview per organization.
--
-- admin_org_overview() returns, for every organisation: members, members signed in
-- in 7 and 30 days, rows held in the five main business tables, the countries its
-- vehicles are in, and the time of its most recent write. Super admin only.
--
-- It changes nothing: Lock, plan labels and member caps are reported, not enforced
-- (those wait on an owner decision; see the Organizations screen).
--
-- Rollback: drop function if exists public.admin_org_overview();

create or replace function public.admin_org_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can read the organization overview' using errcode = '42501';
  end if;

  with mem as (
    select coalesce(p.organisation_id, p.org_id) as org,
           count(*) as members,
           count(*) filter (where u.last_sign_in_at > now() - interval '30 days') as active_30d,
           count(*) filter (where u.last_sign_in_at > now() - interval '7 days') as active_7d,
           count(*) filter (where u.last_sign_in_at is not null) as ever_signed_in
      from public.profiles p left join auth.users u on u.id = p.id
     group by 1
  ), veh as (
    select organisation_id as org, count(*) as n, max(created_at) as last_at,
           array_remove(array_agg(distinct country), null) as countries
      from public.vehicle_fleet group by 1
  ), tyr as (select organisation_id as org, count(*) as n, max(created_at) as last_at from public.tyre_records group by 1),
     wo  as (select organisation_id as org, count(*) as n, max(created_at) as last_at from public.work_orders group by 1),
     exp as (select organisation_id as org, count(*) as n, max(created_at) as last_at from public.parts_consumption group by 1),
     ins as (select organisation_id as org, count(*) as n, max(created_at) as last_at from public.inspections group by 1)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id,
           'members', coalesce(mem.members, 0),
           'active_30d', coalesce(mem.active_30d, 0),
           'active_7d', coalesce(mem.active_7d, 0),
           'ever_signed_in', coalesce(mem.ever_signed_in, 0),
           'vehicles', coalesce(veh.n, 0),
           'tyre_records', coalesce(tyr.n, 0),
           'job_cards', coalesce(wo.n, 0),
           'expense_lines', coalesce(exp.n, 0),
           'inspections', coalesce(ins.n, 0),
           'data_countries', to_jsonb(coalesce(veh.countries, '{}'::text[])),
           'last_write_at', nullif(greatest(
               coalesce(veh.last_at, '-infinity'), coalesce(tyr.last_at, '-infinity'),
               coalesce(wo.last_at, '-infinity'), coalesce(exp.last_at, '-infinity'),
               coalesce(ins.last_at, '-infinity')), '-infinity'::timestamptz)
         ) order by o.created_at), '[]'::jsonb)
    into v
    from public.organisations o
    left join mem on mem.org = o.id
    left join veh on veh.org = o.id
    left join tyr on tyr.org = o.id
    left join wo  on wo.org  = o.id
    left join exp on exp.org = o.id
    left join ins on ins.org = o.id;

  return jsonb_build_object('ok', true, 'generated_at', now(), 'orgs', v);
end
$$;
revoke all on function public.admin_org_overview() from public;
revoke all on function public.admin_org_overview() from anon;
grant execute on function public.admin_org_overview() to authenticated;
