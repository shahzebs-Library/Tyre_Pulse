-- Problem Tracking, Phase 2 (backend half).
-- Applied live via Supabase MCP on project jhssdmeruxtrlqnwfksc.
--
-- 1. Target-time breach alerts. A pg_cron job every 30 minutes finds OPEN reports
--    (new / triaged / in_progress) whose sla_due_at has passed and notifies, ONCE
--    per report, the assigned owner, or every unlocked super admin when nobody
--    owns it. In-app notifications only (no email, no push). A history row
--    (event_type 'sla_breach') is written so the timeline shows the alert.
--    'waiting_user' is deliberately NOT alerted: the clock is on the reporter.
--    Dedupe = user_issues.sla_breach_notified_at (stamped in the same statement
--    that sends the notice; a report is never alerted twice, even if reopened).
--    Switch: system_config.user_issue_breach_alerts ('true' default, 'false' = off).
--
-- 2. get_user_issue_summary(): read-only super-admin aggregate for the Error
--    Center. Counts by status / severity / platform, median hours to first
--    response and to fix (NULL when nothing is measurable, never 0), breaches in
--    the last 7 days, and the sample size behind each median.
--
-- Rollback:
--   select cron.unschedule('user-issue-breach-check');
--   drop function if exists public.cron_check_user_issue_breaches();
--   drop function if exists public.get_user_issue_summary();
--   delete from public.system_config where key = 'user_issue_breach_alerts';
--   delete from public.user_issue_events where event_type = 'sla_breach';
--   alter table public.user_issue_events drop constraint user_issue_events_event_type_check,
--     add constraint user_issue_events_event_type_check check (event_type in
--     ('created','status','assign','fixed_version','comment'));
--   alter table public.user_issues drop column if exists sla_breach_notified_at;

-- ── Schema (additive) ───────────────────────────────────────────────────────
alter table public.user_issues
  add column if not exists sla_breach_notified_at timestamptz;

create index if not exists user_issues_breach_scan_idx
  on public.user_issues (sla_due_at)
  where sla_breach_notified_at is null and status in ('new', 'triaged', 'in_progress');

alter table public.user_issue_events drop constraint if exists user_issue_events_event_type_check;
alter table public.user_issue_events add constraint user_issue_events_event_type_check
  check (event_type in ('created', 'status', 'assign', 'fixed_version', 'comment', 'sla_breach'));

insert into public.system_config (key, value, description, category)
values ('user_issue_breach_alerts', 'true',
        'Notify the owner (or super admins) once when a reported problem passes its target time',
        'notifications')
on conflict (key) do nothing;

-- ── 1. Breach scan (cron only) ──────────────────────────────────────────────
create or replace function public.cron_check_user_issue_breaches()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_on       text;
  r          record;
  v_targets  uuid[];
  v_to_owner boolean;
  v_hours    int;
  v_issues   int := 0;
  v_notices  int := 0;
  v_title    text := 'A reported problem is past its target time';
  v_body     text;
begin
  select lower(btrim(coalesce(value, ''))) into v_on
    from public.system_config where key = 'user_issue_breach_alerts';
  if v_on in ('false', '"false"', '0', 'off', 'no') then
    return jsonb_build_object('ok', true, 'skipped', 'switched_off');
  end if;

  for r in
    select i.*
      from public.user_issues i
     where i.status in ('new', 'triaged', 'in_progress')
       and i.sla_due_at is not null
       and i.sla_due_at < now()
       and i.sla_breach_notified_at is null
     order by i.sla_due_at
     limit 500
     for update skip locked
  loop
    v_targets := null;
    v_to_owner := false;
    if r.assignee_id is not null then
      select array_agg(p.id) into v_targets
        from public.profiles p
       where p.id = r.assignee_id and not coalesce(p.locked, false);
      v_to_owner := v_targets is not null;
    end if;
    if v_targets is null then
      select array_agg(p.id) into v_targets
        from public.profiles p
       where coalesce(p.is_super_admin, false) and not coalesce(p.locked, false);
    end if;

    v_hours := greatest(0, floor(extract(epoch from (now() - r.sla_due_at)) / 3600)::int);
    v_body := initcap(r.severity) || ' problem reported on ' || coalesce(r.platform, 'web')
      || ' is ' || case when v_hours < 1 then 'less than 1 hour' else v_hours || ' hours' end
      || ' past its target time and is still ' || replace(r.status, '_', ' ') || '. '
      || left(regexp_replace(r.description, '\s+', ' ', 'g'), 140);

    if v_targets is not null then
      insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
      select t, 'warning', v_title, v_body, 'user_issue', r.id from unnest(v_targets) t;
      v_notices := v_notices + coalesce(array_length(v_targets, 1), 0);
    end if;

    update public.user_issues set sla_breach_notified_at = now() where id = r.id;

    insert into public.user_issue_events (issue_id, organisation_id, actor_id, event_type, to_value, note)
    values (r.id, r.organisation_id, null, 'sla_breach',
            case when v_targets is null then 'nobody'
                 when v_to_owner then 'owner' else 'super_admins' end,
            'Past its target time. '
              || case when v_targets is null then 'No one could be notified.'
                      when v_to_owner then 'The owner was notified.'
                      else 'Super admins were notified.' end);
    v_issues := v_issues + 1;
  end loop;

  return jsonb_build_object('ok', true, 'issues', v_issues, 'notifications', v_notices);
end $$;

-- ── 2. Summary (super admin, read only) ─────────────────────────────────────
create or replace function public.get_user_issue_summary()
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $$
declare v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can read the problem summary' using errcode = '42501';
  end if;

  with i as (select * from public.user_issues),
  fr as (
    select extract(epoch from (first_response_at - created_at)) / 3600.0 as h
      from i where first_response_at is not null and first_response_at >= created_at),
  fx as (
    select extract(epoch from (resolved_at - created_at)) / 3600.0 as h
      from i where status = 'fixed' and resolved_at is not null and resolved_at >= created_at)
  select jsonb_build_object(
    'generated_at', now(),
    'total', (select count(*) from i),
    'open', (select count(*) from i where status in ('new', 'triaged', 'in_progress', 'waiting_user')),
    'by_status', coalesce((select jsonb_object_agg(status, n) from
        (select status, count(*) n from i group by status) s), '{}'::jsonb),
    'by_severity', coalesce((select jsonb_object_agg(severity, n) from
        (select severity, count(*) n from i group by severity) s), '{}'::jsonb),
    'by_platform', coalesce((select jsonb_object_agg(platform, n) from
        (select platform, count(*) n from i group by platform) s), '{}'::jsonb),
    'median_first_response_hours',
        (select round((percentile_cont(0.5) within group (order by h))::numeric, 2) from fr),
    'first_response_measured', (select count(*) from fr),
    'median_fix_hours',
        (select round((percentile_cont(0.5) within group (order by h))::numeric, 2) from fx),
    'fix_measured', (select count(*) from fx),
    'breaches_7d', (select count(*) from i
        where sla_due_at is not null
          and sla_due_at >= now() - interval '7 days' and sla_due_at <= now()
          and (resolved_at is null or resolved_at > sla_due_at)
          and status <> 'waiting_user'),
    'breach_alerts_7d', (select count(*) from i where sla_breach_notified_at >= now() - interval '7 days'),
    'open_past_target', (select count(*) from i
        where status in ('new', 'triaged', 'in_progress') and sla_due_at < now())
  ) into v;
  return v;
end $$;

-- ── Grants: revoke PUBLIC first, then anon; the cron fn is not client callable ──
revoke all on function public.cron_check_user_issue_breaches() from public;
revoke all on function public.cron_check_user_issue_breaches() from anon;
revoke all on function public.cron_check_user_issue_breaches() from authenticated;
grant execute on function public.cron_check_user_issue_breaches() to service_role;

revoke all on function public.get_user_issue_summary() from public;
revoke all on function public.get_user_issue_summary() from anon;
grant execute on function public.get_user_issue_summary() to authenticated, service_role;

-- ── Schedule ────────────────────────────────────────────────────────────────
do $$
begin
  perform cron.unschedule('user-issue-breach-check')
    where exists (select 1 from cron.job where jobname = 'user-issue-breach-check');
  perform cron.schedule('user-issue-breach-check', '*/30 * * * *',
    'select public.cron_check_user_issue_breaches()');
end $$;

-- VERIFIED live 2026-09-30 by impersonation, rolled back (DO block ending in RAISE):
--   Tyre Man A submits a critical (unowned) and a high report; super admin S owns
--   the second. Both due dates pushed 3 h into the past. Run 1: issues 2,
--   notifications 3 (2 super admins for the unowned one, 1 owner for the other).
--   Run 2: issues 0 (deduped). 2 sla_breach history rows. A reads own 2 and sees
--   the breach row; A direct UPDATE refused 42501; Tyre Man B reads 0.
--   A: summary refused 42501, cron fn refused 42501; anon: summary refused 42501.
--   S summary: total 2, open 2, breaches_7d 2, median_fix_hours null (fix_measured 0).
--   Switch set to 'false': {"skipped":"switched_off"}. Cron job scheduled */30.
