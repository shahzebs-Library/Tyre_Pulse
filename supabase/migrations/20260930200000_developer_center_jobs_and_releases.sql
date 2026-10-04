-- ============================================================================
-- Developer Center + Releases (Control Center, Engineering area)
-- ----------------------------------------------------------------------------
-- Additive only. Nothing is dropped, no business row is rewritten.
--
-- 1. Scheduled-job alert policy (Sentry Crons pattern): four system_config
--    keys (grace, failures in a row, stuck threshold, auto-close after N good
--    runs) plus an on/off switch, all seeded with the approved defaults.
-- 2. system_config.updated_by is stamped from auth.uid() on every write, so
--    "who changed the minimum app version" is recorded from now on (it was
--    null on every row because no writer set it).
-- 3. admin_cron_health(p_days)   per-job runs, failures, MISSED runs (from the
--    gaps between starts against the job's own period), avg and longest time,
--    failures in a row, stuck detection. Super admin only.
--    admin_cron_job_runs(jobid)  last N runs of one job for the drawer.
--    admin_cron_set_active       pause / resume one job (reason, audited).
--    admin_cron_run_now          run a job once within about a minute (reason,
--                                audited) by scheduling a one-off copy pinned
--                                to the next minute of this year, so a failed
--                                copy can never repeat every minute.
-- 4. cron_health_watch() + cron job "cron-health-watch" every 5 minutes: opens
--    one alert per job when it misses its time, is stuck, or fails N times in
--    a row; notifies super admins once; auto-closes after N good runs; removes
--    finished run-now copies. State in cron_alert_state (super admin read,
--    no client writes).
-- 5. admin_recent_migrations       applied migrations for the plain-English list.
--    admin_app_version_adoption    installs AND active-7-day phones per version.
-- 6. releases gains kind / platform / from_version / to_version / reason
--    (nullable) and admin_record_rollback() so rollbacks are MEASURED.
--    admin_release_error_windows   app errors logged before vs after each
--    release in EQUAL windows (system_logs error + critical).
--
-- Every DEFINER function: search_path pinned, super-admin gate in-body (except
-- the watcher, which no client role can execute), PUBLIC then anon revoked,
-- authenticated granted.
--
-- Pre-flight: no DROP of data, no DELETE, no type change. releases (tiny)
-- gains nullable columns without defaults (no rewrite); the kind CHECK allows
-- NULL so existing rows and record_release() keep working. system_config gains
-- a BEFORE trigger that only fills updated_by; the two existing guard triggers
-- do not read updated_by. New table cron_alert_state: RLS on, super-admin read,
-- no client writes, no anon grant. No PT/40001 raises. No org argument on any
-- DEFINER function.
--
-- Rollback:
--   select cron.unschedule('cron-health-watch');
--   drop function public.cron_health_watch(); drop table public.cron_alert_state;
--   drop function public.admin_cron_health(int), public._cron_health(int), public._cron_policy(),
--     public._cron_period_minutes(text), public.admin_cron_job_runs(bigint,int),
--     public.admin_cron_set_active(bigint,boolean,text), public.admin_cron_run_now(bigint,text),
--     public.admin_recent_migrations(int), public.admin_app_version_adoption(),
--     public.admin_record_rollback(text,text,text,text),
--     public.admin_release_error_windows(timestamptz[],numeric);
--   drop trigger trg_stamp_system_config_updated_by on public.system_config;
--   drop function public.stamp_system_config_updated_by();
--   alter table public.releases drop constraint releases_kind_check;  (columns may stay)
--   delete from public.system_config where key like 'cron_alert_%';
-- ============================================================================

-- ── 1. alert policy keys ────────────────────────────────────────────────────
insert into public.system_config (key, value, description, category)
values
  ('cron_alert_enabled',     'true', 'Alert super admins when a scheduled job misses its time, gets stuck or keeps failing.', 'automation'),
  ('cron_alert_grace_min',   '5',    'Minutes after the planned start before a job counts as missed.', 'automation'),
  ('cron_alert_fail_streak', '2',    'Failures in a row before an alert opens (one-off blips do not page).', 'automation'),
  ('cron_alert_stuck_min',   '5',    'Minutes a run may take before it counts as stuck.', 'automation'),
  ('cron_alert_recover_ok',  '2',    'Good runs in a row that close an open job alert automatically.', 'automation')
on conflict (key) do nothing;

-- ── 2. who changed a setting ────────────────────────────────────────────────
create or replace function public.stamp_system_config_updated_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_system_config_updated_by on public.system_config;
create trigger trg_stamp_system_config_updated_by
  before insert or update on public.system_config
  for each row execute function public.stamp_system_config_updated_by();
revoke all on function public.stamp_system_config_updated_by() from public, anon, authenticated;

-- ── 3. cron helpers ─────────────────────────────────────────────────────────
-- Period of a cron schedule in minutes for the shapes this database uses.
-- NULL when the shape is not recognised: missed runs then read N/A, never 0.
create or replace function public._cron_period_minutes(p_schedule text)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare f text[];
begin
  f := regexp_split_to_array(btrim(coalesce(p_schedule, '')), '\s+');
  if array_length(f, 1) is distinct from 5 then return null; end if;
  if f[3] <> '*' or f[4] <> '*' then return null; end if;
  if f[1] = '*' and f[2] = '*' and f[5] = '*' then return 1; end if;
  if f[1] ~ '^\*/\d+$' and f[2] = '*' and f[5] = '*' then return substring(f[1] from 3)::int; end if;
  if f[1] ~ '^\d+$' and f[2] = '*' and f[5] = '*' then return 60; end if;
  if f[1] ~ '^\d+$' and f[2] ~ '^\d+$' and f[5] = '*' then return 1440; end if;
  if f[1] ~ '^\d+$' and f[2] ~ '^\d+$' and f[5] ~ '^\d$' then return 10080; end if;
  return null;
end $$;
revoke all on function public._cron_period_minutes(text) from public, anon;
grant execute on function public._cron_period_minutes(text) to authenticated;

create or replace function public._cron_policy()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'enabled',    coalesce((select lower(btrim(value, ' "')) from system_config where key = 'cron_alert_enabled'), 'true') = 'true',
    'grace_min',  coalesce((select nullif(btrim(value, ' "'), '')::int from system_config where key = 'cron_alert_grace_min'), 5),
    'fail_streak',coalesce((select nullif(btrim(value, ' "'), '')::int from system_config where key = 'cron_alert_fail_streak'), 2),
    'stuck_min',  coalesce((select nullif(btrim(value, ' "'), '')::int from system_config where key = 'cron_alert_stuck_min'), 5),
    'recover_ok', coalesce((select nullif(btrim(value, ' "'), '')::int from system_config where key = 'cron_alert_recover_ok'), 2)
  )
$$;
revoke all on function public._cron_policy() from public, anon, authenticated;

-- Core health computation, no gate: called by the gated RPC and the watcher.
create or replace function public._cron_health(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, cron
as $$
declare
  v_days int := least(greatest(coalesce(p_days, 7), 1), 30);
  v_pol jsonb := public._cron_policy();
  v_grace int := (v_pol ->> 'grace_min')::int;
  v_stuck int := (v_pol ->> 'stuck_min')::int;
  v_ws timestamptz := now() - make_interval(days => v_days);
  v_jobs jsonb;
begin
  if to_regclass('cron.job') is null or to_regclass('cron.job_run_details') is null then
    return jsonb_build_object('ok', false, 'reason', 'pg_cron is not installed');
  end if;

  with jobs as (
    select j.jobid, j.jobname::text as jobname, j.schedule::text as schedule, j.active,
           public._cron_period_minutes(j.schedule) as period
      from cron.job j
     where coalesce(j.jobname, '') not like 'console-run-now-%'
  ),
  runs as (
    select d.jobid, d.start_time, d.end_time, d.status::text as status,
           extract(epoch from (d.end_time - d.start_time)) * 1000 as ms,
           lag(d.start_time) over (partition by d.jobid order by d.start_time) as prev_start
      from cron.job_run_details d
     where d.start_time >= v_ws and d.jobid in (select jobid from jobs)
  ),
  agg as (
    select r.jobid,
           count(*) filter (where r.start_time >= now() - interval '24 hours') as runs_24h,
           count(*) filter (where r.start_time >= now() - interval '24 hours' and r.status = 'failed') as failed_24h,
           count(*) as runs_nd,
           count(*) filter (where r.status = 'failed') as failed_nd,
           round(avg(r.ms) filter (where r.status = 'succeeded' and r.end_time is not null))::int as avg_ms,
           round(max(r.ms) filter (where r.end_time is not null))::int as max_ms,
           min(r.start_time) as first_in_window,
           max(r.start_time) as last_start
      from runs r group by r.jobid
  ),
  gaps as (
    select r.jobid,
           sum(greatest(0, round(extract(epoch from (r.start_time - r.prev_start)) / 60.0 / j.period) - 1))::int as gap_missed
      from runs r join jobs j using (jobid)
     where r.prev_start is not null and j.period is not null
       and r.start_time - r.prev_start > make_interval(mins => j.period + v_grace)
     group by r.jobid
  ),
  latest as (
    select distinct on (d.jobid) d.jobid, d.start_time, d.end_time, d.status::text as status
      from cron.job_run_details d
     where d.jobid in (select jobid from jobs) and d.start_time >= v_ws
     order by d.jobid, d.start_time desc, d.runid desc
  ),
  streak as (
    select x.jobid, count(*) as fails
      from (
        select d.jobid, d.status::text as status,
               sum(case when d.status::text <> 'failed' then 1 else 0 end)
                 over (partition by d.jobid order by d.start_time desc, d.runid desc) as seen_ok
          from cron.job_run_details d
         where d.start_time >= v_ws and d.jobid in (select jobid from jobs)
      ) x
     where x.seen_ok = 0 and x.status = 'failed'
     group by x.jobid
  ),
  older as (
    select j.jobid,
           exists (select 1 from cron.job_run_details d where d.jobid = j.jobid and d.start_time < v_ws) as has_older
      from jobs j
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'jobid', j.jobid,
           'jobname', j.jobname,
           'schedule', j.schedule,
           'active', j.active,
           'period_min', j.period,
           'runs_24h', coalesce(a.runs_24h, 0),
           'failed_24h', coalesce(a.failed_24h, 0),
           'runs_nd', coalesce(a.runs_nd, 0),
           'failed_nd', coalesce(a.failed_nd, 0),
           'avg_ms', a.avg_ms,
           'max_ms', a.max_ms,
           'last_start', l.start_time,
           'last_end', l.end_time,
           'last_status', l.status,
           'first_in_window', a.first_in_window,
           'new_in_window', not o.has_older,
           'fail_streak', coalesce(s.fails, 0),
           'stuck', (l.status in ('running', 'starting') and l.start_time < now() - make_interval(mins => v_stuck)),
           'missed_nd', case
              when j.period is null then null
              when a.last_start is null then case when o.has_older and j.active
                then floor(extract(epoch from (now() - v_ws)) / 60.0 / j.period)::int else 0 end
              else coalesce(g.gap_missed, 0)
                 + case when o.has_older and a.first_in_window - v_ws > make_interval(mins => j.period + v_grace)
                        then floor(extract(epoch from (a.first_in_window - v_ws)) / 60.0 / j.period)::int else 0 end
                 + case when j.active and now() - a.last_start > make_interval(mins => j.period + v_grace)
                        then floor(extract(epoch from (now() - a.last_start)) / 60.0 / j.period)::int else 0 end
            end,
           'expected_nd', case when j.period is null then null
              else floor(extract(epoch from (now() - case when o.has_older then v_ws else coalesce(a.first_in_window, now()) end)) / 60.0 / j.period)::int + case when o.has_older then 0 else 1 end end,
           'overdue', (j.active and j.period is not null and a.last_start is not null
                       and now() - a.last_start > make_interval(mins => j.period + v_grace))
         ) order by j.jobname), '[]'::jsonb)
    into v_jobs
    from jobs j
    left join agg a using (jobid)
    left join gaps g using (jobid)
    left join latest l using (jobid)
    left join streak s using (jobid)
    left join older o using (jobid);

  return jsonb_build_object('ok', true, 'generated_at', now(), 'days', v_days, 'policy', v_pol, 'jobs', v_jobs);
end $$;
revoke all on function public._cron_health(integer) from public, anon, authenticated;

create or replace function public.admin_cron_health(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can read scheduled job health' using errcode = '42501';
  end if;
  return public._cron_health(p_days);
end $$;
revoke all on function public.admin_cron_health(integer) from public;
revoke all on function public.admin_cron_health(integer) from anon;
grant execute on function public.admin_cron_health(integer) to authenticated;

create or replace function public.admin_cron_job_runs(p_jobid bigint, p_limit integer default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, cron
as $$
declare v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can read scheduled job runs' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'started', r.start_time, 'ended', r.end_time, 'status', r.status,
           'ms', round(extract(epoch from (r.end_time - r.start_time)) * 1000)::int,
           'output', left(coalesce(r.return_message, ''), 160)
         ) order by r.start_time desc), '[]'::jsonb)
    into v
    from (
      select d.start_time, d.end_time, d.status::text as status, d.return_message
        from cron.job_run_details d
       where d.jobid = p_jobid
       order by d.start_time desc, d.runid desc
       limit least(greatest(coalesce(p_limit, 8), 1), 50)
    ) r;
  return jsonb_build_object('ok', true, 'runs', v);
end $$;
revoke all on function public.admin_cron_job_runs(bigint, integer) from public;
revoke all on function public.admin_cron_job_runs(bigint, integer) from anon;
grant execute on function public.admin_cron_job_runs(bigint, integer) to authenticated;

create or replace function public.admin_cron_set_active(p_jobid bigint, p_active boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, cron
as $$
declare v_name text;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can pause or resume scheduled jobs' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters.' using errcode = '22023';
  end if;
  select jobname into v_name from cron.job where jobid = p_jobid;
  if v_name is null then
    raise exception 'That scheduled job does not exist.' using errcode = '22023';
  end if;
  perform cron.alter_job(job_id := p_jobid, active := coalesce(p_active, true));
  perform public.log_console_event(case when p_active then 'cron_resume' else 'cron_pause' end,
    null, 'cron_job', jsonb_build_object('jobid', p_jobid, 'jobname', v_name, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'jobid', p_jobid, 'jobname', v_name, 'active', coalesce(p_active, true));
end $$;
revoke all on function public.admin_cron_set_active(bigint, boolean, text) from public;
revoke all on function public.admin_cron_set_active(bigint, boolean, text) from anon;
grant execute on function public.admin_cron_set_active(bigint, boolean, text) to authenticated;

-- Run a job once. pg_cron has no "run now", so a copy of the command is
-- scheduled for the next minute of THIS YEAR only (minute hour day month *).
-- If the copy fails it cannot repeat for a year, and the watcher removes it.
create or replace function public.admin_cron_run_now(p_jobid bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, cron
as $$
declare
  v_job record;
  v_at timestamp := date_trunc('minute', (now() at time zone 'GMT') + interval '1 minute');
  v_name text;
  v_sched text;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can run scheduled jobs' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters.' using errcode = '22023';
  end if;
  select jobid, jobname, command into v_job from cron.job where jobid = p_jobid;
  if v_job.jobid is null then
    raise exception 'That scheduled job does not exist.' using errcode = '22023';
  end if;
  if exists (select 1 from cron.job where jobname like 'console-run-now-' || p_jobid || '-%') then
    raise exception 'A run of this job is already queued. Wait a minute and refresh.' using errcode = '22023';
  end if;
  v_name := 'console-run-now-' || p_jobid || '-' || extract(epoch from v_at)::bigint;
  v_sched := extract(minute from v_at)::int || ' ' || extract(hour from v_at)::int || ' '
          || extract(day from v_at)::int || ' ' || extract(month from v_at)::int || ' *';
  perform cron.schedule(v_name, v_sched, v_job.command);
  perform public.log_console_event('cron_run_now', null, 'cron_job',
    jsonb_build_object('jobid', p_jobid, 'jobname', v_job.jobname, 'reason', btrim(p_reason), 'runs_at_utc', v_at));
  return jsonb_build_object('ok', true, 'jobid', p_jobid, 'jobname', v_job.jobname, 'runs_at', v_at at time zone 'GMT');
end $$;
revoke all on function public.admin_cron_run_now(bigint, text) from public;
revoke all on function public.admin_cron_run_now(bigint, text) from anon;
grant execute on function public.admin_cron_run_now(bigint, text) to authenticated;

-- ── 4. watcher ──────────────────────────────────────────────────────────────
create table if not exists public.cron_alert_state (
  jobid       bigint primary key,
  jobname     text,
  kind        text not null check (kind in ('missed', 'stuck', 'failing')),
  detail      text,
  open        boolean not null default true,
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz,
  ok_streak   integer not null default 0
);
alter table public.cron_alert_state enable row level security;
drop policy if exists cron_alert_state_read on public.cron_alert_state;
create policy cron_alert_state_read on public.cron_alert_state for select to authenticated using (public.is_super_admin());
revoke all on public.cron_alert_state from anon;
revoke insert, update, delete, truncate on public.cron_alert_state from authenticated;

create or replace function public.cron_health_watch()
returns jsonb
language plpgsql
security definer
set search_path = public, cron
as $$
declare
  v_h jsonb := public._cron_health(1);
  v_pol jsonb := public._cron_policy();
  v_streak int := (v_pol ->> 'fail_streak')::int;
  v_recover int := (v_pol ->> 'recover_ok')::int;
  j jsonb;
  v_kind text;
  v_detail text;
  v_opened int := 0;
  v_closed int := 0;
  v_state record;
begin
  -- Remove finished one-off "run now" copies (their minute has passed).
  perform cron.unschedule(jobname)
     from cron.job
    where jobname like 'console-run-now-%'
      and to_timestamp(split_part(jobname, '-', 5)::bigint) < now() - interval '10 minutes';

  if not coalesce((v_pol ->> 'enabled')::boolean, true) or coalesce(v_h ->> 'ok', 'false') <> 'true' then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;

  for j in select * from jsonb_array_elements(v_h -> 'jobs') loop
    if not coalesce((j ->> 'active')::boolean, false) then continue; end if;
    v_kind := null;
    if coalesce((j ->> 'stuck')::boolean, false) then
      v_kind := 'stuck'; v_detail := 'Running longer than the stuck threshold.';
    elsif coalesce((j ->> 'fail_streak')::int, 0) >= v_streak then
      v_kind := 'failing'; v_detail := (j ->> 'fail_streak') || ' failures in a row.';
    elsif coalesce((j ->> 'overdue')::boolean, false) then
      v_kind := 'missed'; v_detail := 'Did not start within the grace period after its planned time.';
    end if;

    select * into v_state from public.cron_alert_state where jobid = (j ->> 'jobid')::bigint;

    if v_kind is not null then
      if v_state.jobid is null or not v_state.open then
        insert into public.cron_alert_state (jobid, jobname, kind, detail, open, opened_at, closed_at, ok_streak)
        values ((j ->> 'jobid')::bigint, j ->> 'jobname', v_kind, v_detail, true, now(), null, 0)
        on conflict (jobid) do update set jobname = excluded.jobname, kind = excluded.kind, detail = excluded.detail,
          open = true, opened_at = now(), closed_at = null, ok_streak = 0;
        v_opened := v_opened + 1;
        begin
          insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
          select p.id, 'system', 'Scheduled job needs attention: ' || (j ->> 'jobname'),
                 v_detail || ' Open Developer Center to see its runs.', 'cron_job', null
            from public.profiles p
           where coalesce(p.is_super_admin, false) and coalesce(p.approved, false) and not coalesce(p.locked, false);
        exception when others then null;
        end;
      else
        update public.cron_alert_state set ok_streak = 0, kind = v_kind, detail = v_detail where jobid = v_state.jobid;
      end if;
    elsif v_state.jobid is not null and v_state.open then
      if coalesce(j ->> 'last_status', '') = 'succeeded' then
        update public.cron_alert_state set ok_streak = ok_streak + 1 where jobid = v_state.jobid
          returning * into v_state;
        if v_state.ok_streak >= v_recover then
          update public.cron_alert_state set open = false, closed_at = now() where jobid = v_state.jobid;
          v_closed := v_closed + 1;
        end if;
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'opened', v_opened, 'closed', v_closed);
end $$;
revoke all on function public.cron_health_watch() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'cron-health-watch') then
      perform cron.unschedule('cron-health-watch');
    end if;
    perform cron.schedule('cron-health-watch', '*/5 * * * *', 'select public.cron_health_watch();');
  end if;
end $$;

-- ── 5. migrations + adoption ────────────────────────────────────────────────
create or replace function public.admin_recent_migrations(p_limit integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, supabase_migrations
as $$
declare v jsonb; v_today text := to_char(now() at time zone 'Asia/Riyadh', 'YYYYMMDD');
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can read the migration history' using errcode = '42501';
  end if;
  if to_regclass('supabase_migrations.schema_migrations') is null then
    return jsonb_build_object('ok', false, 'reason', 'Migration history is not available');
  end if;
  select jsonb_build_object(
    'ok', true,
    'total', (select count(*) from supabase_migrations.schema_migrations),
    'today', (select count(*) from supabase_migrations.schema_migrations where version like v_today || '%'),
    'latest', (select max(version) from supabase_migrations.schema_migrations),
    'items', coalesce((select jsonb_agg(jsonb_build_object('version', m.version, 'name', m.name) order by m.version desc)
                         from (select version, name from supabase_migrations.schema_migrations
                                order by version desc limit least(greatest(coalesce(p_limit, 12), 1), 100)) m), '[]'::jsonb)
  ) into v;
  return v;
end $$;
revoke all on function public.admin_recent_migrations(integer) from public;
revoke all on function public.admin_recent_migrations(integer) from anon;
grant execute on function public.admin_recent_migrations(integer) to authenticated;

create or replace function public.admin_app_version_adoption()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can read app adoption' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'ok', true,
    'installs', (select count(*) from public.user_devices where not coalesce(revoked, false)),
    'active_7d', (select count(*) from public.user_devices where not coalesce(revoked, false) and last_seen_at >= now() - interval '7 days'),
    'by_version', coalesce((
      select jsonb_agg(jsonb_build_object('app_version', app_version, 'platform', platform,
                                          'installs', n, 'active_7d', a7, 'last_seen', ls)
                       order by n desc, app_version)
        from (select nullif(btrim(app_version), '') as app_version,
                     nullif(btrim(lower(platform)), '') as platform,
                     count(*) as n,
                     count(*) filter (where last_seen_at >= now() - interval '7 days') as a7,
                     max(last_seen_at) as ls
                from public.user_devices
               where not coalesce(revoked, false)
               group by 1, 2) s), '[]'::jsonb)
  ) into v;
  return v;
end $$;
revoke all on function public.admin_app_version_adoption() from public;
revoke all on function public.admin_app_version_adoption() from anon;
grant execute on function public.admin_app_version_adoption() to authenticated;

-- ── 6. releases: rollbacks recorded + errors before vs after ───────────────
alter table public.releases add column if not exists kind text;
alter table public.releases add column if not exists platform text;
alter table public.releases add column if not exists from_version text;
alter table public.releases add column if not exists to_version text;
alter table public.releases add column if not exists reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'releases_kind_check') then
    alter table public.releases add constraint releases_kind_check
      check (kind is null or kind in ('release', 'rollback'));
  end if;
end $$;

create or replace function public.admin_record_rollback(p_platform text, p_from text, p_to text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can record a rollback' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_to), '') = '' then
    raise exception 'Name the build you are rolling back to.' using errcode = '22023';
  end if;
  insert into public.releases (version, notes, released_by, kind, platform, from_version, to_version, reason)
  values (btrim(p_to), 'Rollback from ' || coalesce(nullif(btrim(p_from), ''), 'unknown') || ' to ' || btrim(p_to),
          auth.uid(), 'rollback', coalesce(nullif(btrim(p_platform), ''), 'web'), nullif(btrim(p_from), ''),
          btrim(p_to), btrim(p_reason))
  returning id into v_id;
  perform public.log_console_event('release_rollback', null, 'release',
    jsonb_build_object('release_id', v_id, 'platform', p_platform, 'from', p_from, 'to', p_to, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.admin_record_rollback(text, text, text, text) from public;
revoke all on function public.admin_record_rollback(text, text, text, text) from anon;
grant execute on function public.admin_record_rollback(text, text, text, text) to authenticated;

-- Errors logged by the apps (system_logs, error + critical) in equal windows
-- either side of each release time. When less than p_hours has passed since
-- the release, BOTH windows shrink to the time that has passed so the two
-- sides always cover the same length.
create or replace function public.admin_release_error_windows(p_at timestamptz[], p_hours numeric default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can compare release errors' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', t.at,
           'window_hours', round(extract(epoch from t.win) / 3600.0, 2),
           'complete', t.win >= make_interval(secs => greatest(coalesce(p_hours, 12), 0.25) * 3600),
           'before', (select count(*) from public.system_logs s
                       where s.severity in ('error', 'critical') and s.created_at >= t.at - t.win and s.created_at < t.at),
           'after',  (select count(*) from public.system_logs s
                       where s.severity in ('error', 'critical') and s.created_at >= t.at and s.created_at < t.at + t.win)
         ) order by t.at desc), '[]'::jsonb)
    into v
    from (
      select a as at,
             least(make_interval(secs => greatest(coalesce(p_hours, 12), 0.25) * 3600), greatest(now() - a, interval '0')) as win
        from unnest(coalesce(p_at, '{}'::timestamptz[])) a
       where a is not null and a <= now()
       limit 60
    ) t;
  return jsonb_build_object('ok', true, 'items', v);
end $$;
revoke all on function public.admin_release_error_windows(timestamptz[], numeric) from public;
revoke all on function public.admin_release_error_windows(timestamptz[], numeric) from anon;
grant execute on function public.admin_release_error_windows(timestamptz[], numeric) to authenticated;
