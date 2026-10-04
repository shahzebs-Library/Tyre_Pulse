-- 20260930162000_platform_activity.sql
-- Analytics: how the platform is actually used, from data that really exists.
--
-- WHAT IT ADDS (additive only)
--   1. get_platform_activity()  read-only, super admin. Returns, never an email:
--        accounts; sign-ins in 30 / 7 days and today (auth.users.last_sign_in_at, Riyadh day);
--        Android app opened in 30 / 7 days (user_devices.last_seen_at, distinct people);
--        the current-month signup cohort (created, ever signed in, signed in within 7 days, never signed in);
--        active by role and by country (30 days, sign-in OR app opened);
--        usage per organisation (members, active 30 / 7 days, expense lines, job cards, tyre records,
--        inspections, newest write);
--        records written per day per module for 60 days, by created_at (the day a row was entered);
--        AI calls (ai_token_logs) and the AI budget row if one exists (ai_budgets).
--      Page views, clicks and web active people are NOT here because nothing records them (PostHog 0
--      events); the screen says Not recorded instead of inventing a number.
--   2. metric_registry gains nullable status (certified / draft / deprecated) and approved_by, so the
--      Certified pill can read a stored decision. NULL keeps today's behaviour: the screen derives the
--      pill from completeness (owner, refresh target, calc ref, dashboards).
--
-- PRE-FLIGHT
--   Data loss: none. metric_registry has 12 rows; two nullable columns, no default, no rewrite.
--   Locks: trivial. CHECK on the new column accepts NULL. Reads: count(*) over parts_consumption
--   (216k) / work_orders (94k) grouped by organisation and a 60-day created_at window; measured well
--   under the statement window.
--   DEFINER: search_path public + auth, is_super_admin() in body, revoke PUBLIC then anon, grant
--   authenticated. Takes no arguments.
--   Rollback: drop function public.get_platform_activity(); alter table public.metric_registry
--   drop column status, drop column approved_by.

alter table public.metric_registry
  add column if not exists status text check (status is null or status in ('certified','draft','deprecated')),
  add column if not exists approved_by uuid references auth.users(id) on delete set null;

create or replace function public.get_platform_activity()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare
  v jsonb;
  v_today timestamptz := date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh';
  v_month timestamptz := date_trunc('month', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh';
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can read platform activity' using errcode = '42501';
  end if;

  with acc as (
    select p.id, p.role, coalesce(p.organisation_id, p.org_id) as org,
           coalesce(nullif(array_to_string(p.country, ', '), ''), 'No country set') as country,
           u.last_sign_in_at, u.created_at,
           (select max(d.last_seen_at) from public.user_devices d
             where d.user_id = p.id and not coalesce(d.revoked, false)) as app_seen
    from public.profiles p left join auth.users u on u.id = p.id
  ), act as (
    select *, (last_sign_in_at >= now() - interval '30 days' or app_seen >= now() - interval '30 days') as active30,
              (last_sign_in_at >= now() - interval '7 days' or app_seen >= now() - interval '7 days') as active7
    from acc
  ), daily as (
    select 'expense_lines' m, (created_at at time zone 'Asia/Riyadh')::date d, count(*) n
      from public.parts_consumption where created_at >= now() - interval '60 days' group by 2
    union all select 'job_cards', (created_at at time zone 'Asia/Riyadh')::date, count(*)
      from public.work_orders where created_at >= now() - interval '60 days' group by 2
    union all select 'inspections', (created_at at time zone 'Asia/Riyadh')::date, count(*)
      from public.inspections where created_at >= now() - interval '60 days' group by 2
    union all select 'meter_readings', (created_at at time zone 'Asia/Riyadh')::date, count(*)
      from (select created_at from public.odometer_logs where created_at >= now() - interval '60 days'
            union all select created_at from public.engine_hours_logs where created_at >= now() - interval '60 days') x group by 2
    union all select 'tyre_records', (created_at at time zone 'Asia/Riyadh')::date, count(*)
      from public.tyre_records where created_at >= now() - interval '60 days' group by 2
    union all select 'checklists', (created_at at time zone 'Asia/Riyadh')::date, count(*)
      from public.checklist_submissions where created_at >= now() - interval '60 days' group by 2
    union all select 'accidents', (created_at at time zone 'Asia/Riyadh')::date, count(*)
      from public.accidents where created_at >= now() - interval '60 days' group by 2
  )
  select jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'accounts', (select count(*) from acc),
    'approved', (select count(*) from public.profiles where coalesce(approved, false)),
    'signed_in', (select jsonb_build_object(
        'd30', count(*) filter (where last_sign_in_at >= now() - interval '30 days'),
        'd7', count(*) filter (where last_sign_in_at >= now() - interval '7 days'),
        'today', count(*) filter (where last_sign_in_at >= v_today),
        'ever', count(*) filter (where last_sign_in_at is not null),
        'never', count(*) filter (where last_sign_in_at is null)) from acc),
    'app_opened', (select jsonb_build_object(
        'd30', count(distinct user_id) filter (where last_seen_at >= now() - interval '30 days'),
        'd7', count(distinct user_id) filter (where last_seen_at >= now() - interval '7 days'),
        'devices', count(*), 'people', count(distinct user_id))
      from public.user_devices where not coalesce(revoked, false)),
    'active', (select jsonb_build_object('d30', count(*) filter (where active30), 'd7', count(*) filter (where active7)) from act),
    'cohort', (select jsonb_build_object(
        'month', to_char(v_month at time zone 'Asia/Riyadh', 'YYYY-MM'),
        'created', count(*) filter (where created_at >= v_month),
        'ever_signed', count(*) filter (where created_at >= v_month and last_sign_in_at is not null),
        'signed_7d', count(*) filter (where created_at >= v_month and last_sign_in_at >= now() - interval '7 days'),
        'never_signed', count(*) filter (where created_at >= v_month and last_sign_in_at is null)) from acc),
    'by_role', coalesce((select jsonb_agg(jsonb_build_object('role', r, 'accounts', n, 'active', a, 'app', ap) order by n desc) from (
        select coalesce(role, 'No role') r, count(*) n, count(*) filter (where active30) a,
               count(*) filter (where app_seen >= now() - interval '30 days') ap
        from act group by 1) s), '[]'::jsonb),
    'by_country', coalesce((select jsonb_agg(jsonb_build_object('country', c, 'accounts', n, 'active', a) order by n desc) from (
        select country c, count(*) n, count(*) filter (where active30) a from act group by 1) s), '[]'::jsonb),
    'by_org', coalesce((select jsonb_agg(jsonb_build_object(
        'org_id', o.id, 'name', o.name, 'created_at', o.created_at,
        'members', (select count(*) from act where act.org = o.id),
        'active30', (select count(*) from act where act.org = o.id and active30),
        'active7', (select count(*) from act where act.org = o.id and active7),
        'expense_lines', (select count(*) from public.parts_consumption x where x.organisation_id = o.id),
        'job_cards', (select count(*) from public.work_orders x where x.organisation_id = o.id),
        'tyre_records', (select count(*) from public.tyre_records x where x.organisation_id = o.id),
        'inspections', (select count(*) from public.inspections x where x.organisation_id = o.id),
        'last_write', greatest(
          (select max(created_at) from public.parts_consumption x where x.organisation_id = o.id),
          (select max(created_at) from public.work_orders x where x.organisation_id = o.id),
          (select max(created_at) from public.inspections x where x.organisation_id = o.id),
          (select max(created_at) from public.tyre_records x where x.organisation_id = o.id))
      ) order by o.created_at) from public.organisations o), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('module', m, 'day', d, 'n', n) order by d, m) from daily), '[]'::jsonb),
    'ai', (select jsonb_build_object(
        'd30', count(*) filter (where created_at >= now() - interval '30 days'),
        'all', count(*),
        'failed_30d', count(*) filter (where created_at >= now() - interval '30 days' and status is not null and status <> 'success'),
        'cost_30d', coalesce(sum(cost_usd) filter (where created_at >= now() - interval '30 days'), 0),
        'last_at', max(created_at)) from public.ai_token_logs),
    'ai_budget', (select jsonb_build_object('period', period, 'cost_cap_usd', cost_cap_usd, 'token_cap', token_cap,
                    'hard_stop', hard_stop, 'active', active)
                  from public.ai_budgets where active order by updated_at desc nulls last limit 1)
  ) into v;
  return v;
end;
$$;

revoke all on function public.get_platform_activity() from public;
revoke all on function public.get_platform_activity() from anon;
grant execute on function public.get_platform_activity() to authenticated;
