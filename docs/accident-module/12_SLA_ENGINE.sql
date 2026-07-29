-- =============================================================================
-- ACCIDENT MODULE - PHASE 17: SLA ENGINE (timers, pause/resume, breach scan)
-- =============================================================================
-- STATUS: AUTHORED, NOT YET APPLIED. This is a design / review artifact. It has
--   NOT been applied to any database and carries no `supabase_migrations` row.
--   DO NOT apply, commit-to-apply, or run this file as part of authoring.
--
-- MIGRATION NUMBER: runs AFTER V417 (02_DATA_MODEL.sql, which creates
--   accident_sla_definitions / accident_sla_instances / accident_sla_pause_events)
--   and AFTER V418 (08_ENGINE_SQL_MIRROR.sql). It also depends on the PART 4 SLA
--   definition seeds in 07_SEED_CONFIG.sql. Assign the next free migration number
--   at apply time; V417 and V418 are RESERVED by the accident-module design.
--
-- WHAT THIS PROVIDES
--   1. accident_sla_start(p_accident_id, p_workstream_key)
--        Instantiates the live SLA timers for a case + workstream by reading the
--        matching active rows in accident_sla_definitions. Called when a workstream
--        is entered (from the workflow engine / guard trigger in a later phase, or
--        directly by an elevated user). Idempotent per (accident, sla_key): it will
--        not open a second running/paused timer for a definition already ticking.
--   2. accident_sla_pause(p_instance_id, p_reason, p_expected_resume_at, p_comments)
--      accident_sla_resume(p_instance_id, p_comments)
--        Stop / restart a single timer. Pause writes accident_sla_pause_events with
--        a MANDATORY reason + expected_resume_at (brief 10: cannot pause without a
--        follow-up date). Resume shifts due_at / warning_at / escalation_at forward
--        by the paused duration so a paused clock never accrues elapsed time.
--   3. accident_sla_scan()
--        The daily breach-scan. Marks genuinely-overdue RUNNING timers breached and
--        emits an `accident.sla_breach` domain event ONCE per timer, deduped via a
--        new `breached_notified` flag (the exact analogue of the V305 VOR scan's
--        vor_sla_notified_at / overdue_notified_at columns). A warning emission is
--        included the same way (deduped via `warned_notified`). Runs as the cron /
--        service role, NOT as an app user. Mirrors the live `accident-sla-scan`
--        cron pattern (V305) documented in 05_SLA_NOTIFICATIONS_ANALYTICS_QA.md A.9.
--
-- HONESTY / SCOPE
--   * The scan ONLY touches timers that are actually running (state='running' and
--     not paused). Paused, met, breached, and cancelled timers are left alone - a
--     paused clock never warns or breaches, and a breached clock is not re-fired.
--   * due_at / warning_at / escalation_at are WALL-CLOCK targets computed at start
--     and shifted forward on every resume. Business-hours-aware scheduling (the
--     definition's business_hours flag + the accident_working_calendars /
--     accident_country_holidays tables via a future sla_business_minutes()
--     function, 05 A.9) is a LATER phase. Because pauses already move the targets,
--     the scan itself never needs the calendar - it compares now() to a precomputed
--     due_at. When the calendar function lands, start/resume compute the targets
--     through it and the scan is unchanged.
--   * Every mutating user-facing function is SECURITY DEFINER, pinned search_path
--     'public', org-scoped, and gated on public.app_is_elevated() (V346 convention).
--     accident_sla_scan() is NOT user-callable (revoked) - it is cron-only and
--     iterates every org, emitting each event under that timer's own org.
--
-- ROLLBACK (if ever applied)
--   select cron.unschedule('accident-sla-scan-timers');
--   drop function if exists public.accident_sla_scan();
--   drop function if exists public.accident_sla_resume(uuid,text);
--   drop function if exists public.accident_sla_pause(uuid,text,timestamptz,text);
--   drop function if exists public.accident_sla_start(uuid,text);
--   alter table public.accident_sla_instances
--     drop column if exists breached_notified,
--     drop column if exists warned_notified,
--     drop column if exists breached_at,
--     drop column if exists warned_at;
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Notification-dedupe columns (additive, idempotent).
--    breached_notified / warned_notified are the structural once-only guards
--    (the V305 vor_sla_notified_at analogue). breached_at / warned_at record when
--    the state actually flipped, for analytics.
-- -----------------------------------------------------------------------------
alter table public.accident_sla_instances
  add column if not exists warned_at        timestamptz,
  add column if not exists warned_notified  boolean not null default false,
  add column if not exists breached_at      timestamptz,
  add column if not exists breached_notified boolean not null default false;

-- A partial index so the daily scan reads only live timers, not the whole table.
create index if not exists accident_sla_instances_scan_idx
  on public.accident_sla_instances (due_at)
  where state = 'running' and paused = false;

-- =============================================================================
-- 1. accident_sla_start - instantiate timers for a case + workstream.
-- =============================================================================
create or replace function public.accident_sla_start(
  p_accident_id  uuid,
  p_workstream_key text
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org      uuid := public.app_current_org();
  v_country  text;
  v_site     text;
  v_created  integer := 0;
  d          record;
  v_start    timestamptz := now();
begin
  if not public.app_is_elevated() then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  if p_accident_id is null or coalesce(btrim(p_workstream_key), '') = '' then
    raise exception 'accident id and workstream key are required.'
      using errcode = '22023';
  end if;

  -- The case must belong to the caller org (or a super admin). country / site are
  -- denormalized onto every case-scoped row from the parent accident.
  select a.country, a.site
    into v_country, v_site
  from public.accidents a
  where a.id = p_accident_id
    and (a.organisation_id = v_org or public.is_super_admin());

  if not found then
    raise exception 'Accident not found in your organisation.'
      using errcode = 'P0002';
  end if;

  -- One instance per active definition matching this workstream. Skip a definition
  -- that already has a live (running / paused) timer on this case so re-entering a
  -- workstream never double-counts the clock.
  for d in
    select sd.*
    from public.accident_sla_definitions sd
    where sd.organisation_id = v_org
      and sd.active
      and sd.workstream_key = p_workstream_key
  loop
    if exists (
      select 1 from public.accident_sla_instances si
      where si.accident_id = p_accident_id
        and si.sla_key = d.sla_key
        and si.state in ('running', 'paused')
    ) then
      continue;
    end if;

    insert into public.accident_sla_instances (
      organisation_id, accident_id, country, site,
      sla_key, sla_definition_id, name, workstream_key,
      team, start_at, target_minutes, due_at, warning_at, escalation_at,
      state, paused
    )
    values (
      v_org, p_accident_id, v_country, v_site,
      d.sla_key, d.id, d.name, d.workstream_key,
      d.responsible_team, v_start, d.target_minutes,
      v_start + make_interval(mins => d.target_minutes),
      v_start + make_interval(mins => greatest(0, round(d.target_minutes * coalesce(d.warning_pct, 80) / 100.0))::int),
      v_start + make_interval(mins => greatest(0, round(d.target_minutes * coalesce(d.escalation_pct, 100) / 100.0))::int),
      'running', false
    );

    v_created := v_created + 1;
  end loop;

  return v_created;
end;
$function$;

-- =============================================================================
-- 2. accident_sla_pause - stop the clock with a mandatory reason + resume date.
-- =============================================================================
create or replace function public.accident_sla_pause(
  p_instance_id       uuid,
  p_reason            text,
  p_expected_resume_at timestamptz,
  p_comments          text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.app_current_org();
  v_i   record;
begin
  if not public.app_is_elevated() then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  if p_expected_resume_at is null then
    raise exception 'A pause requires an expected resume date.'
      using errcode = '22023';
  end if;

  select si.* into v_i
  from public.accident_sla_instances si
  where si.id = p_instance_id
    and (si.organisation_id = v_org or public.is_super_admin())
  for update;

  if not found then
    raise exception 'SLA timer not found in your organisation.'
      using errcode = 'P0002';
  end if;

  if v_i.state <> 'running' then
    raise exception 'Only a running SLA timer can be paused (current state: %).', v_i.state
      using errcode = '22023';
  end if;

  -- The pause event carries the reason + expected_resume_at (CHECK-constrained
  -- reason vocabulary lives on the table). This is the audit trail of WHY the
  -- clock stopped (waiting_external et al).
  insert into public.accident_sla_pause_events (
    organisation_id, accident_id, sla_instance_id, country, site,
    reason, comments, paused_at, expected_resume_at, paused_by
  )
  values (
    v_i.organisation_id, v_i.accident_id, v_i.id, v_i.country, v_i.site,
    p_reason, p_comments, now(), p_expected_resume_at, auth.uid()
  );

  update public.accident_sla_instances
     set state = 'paused',
         paused = true,
         updated_at = now()
   where id = v_i.id;
end;
$function$;

-- =============================================================================
-- 3. accident_sla_resume - restart the clock, shifting targets by paused time.
-- =============================================================================
create or replace function public.accident_sla_resume(
  p_instance_id uuid,
  p_comments    text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org        uuid := public.app_current_org();
  v_i          record;
  v_pause      record;
  v_now        timestamptz := now();
  v_paused_min integer;
begin
  if not public.app_is_elevated() then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select si.* into v_i
  from public.accident_sla_instances si
  where si.id = p_instance_id
    and (si.organisation_id = v_org or public.is_super_admin())
  for update;

  if not found then
    raise exception 'SLA timer not found in your organisation.'
      using errcode = 'P0002';
  end if;

  if v_i.state <> 'paused' then
    raise exception 'Only a paused SLA timer can be resumed (current state: %).', v_i.state
      using errcode = '22023';
  end if;

  -- Close the open pause window (the latest one with no resumed_at). If for some
  -- reason none is open, resume anyway rather than trapping the timer paused.
  select pe.* into v_pause
  from public.accident_sla_pause_events pe
  where pe.sla_instance_id = v_i.id
    and pe.resumed_at is null
  order by pe.paused_at desc
  limit 1;

  if found then
    v_paused_min := greatest(0, ceil(extract(epoch from (v_now - v_pause.paused_at)) / 60.0)::int);
    update public.accident_sla_pause_events
       set resumed_at = v_now,
           comments   = coalesce(p_comments, comments),
           updated_at = now()
     where id = v_pause.id;
  else
    v_paused_min := 0;
  end if;

  -- Shift every future target forward by the paused duration so the elapsed clock
  -- excludes the pause. total_paused_minutes accumulates for reporting.
  update public.accident_sla_instances
     set state = 'running',
         paused = false,
         total_paused_minutes = total_paused_minutes + v_paused_min,
         due_at        = due_at        + make_interval(mins => v_paused_min),
         warning_at    = case when warning_at    is not null then warning_at    + make_interval(mins => v_paused_min) else warning_at end,
         escalation_at = case when escalation_at is not null then escalation_at + make_interval(mins => v_paused_min) else escalation_at end,
         updated_at = now()
   where id = v_i.id;
end;
$function$;

-- =============================================================================
-- 4. accident_sla_scan - the daily breach scan (cron-only).
-- =============================================================================
-- Emits `accident.sla_breach` (and `accident.sla_warning`) on the existing domain
-- event bus, once per timer, deduped structurally by breached_notified /
-- warned_notified. The bus consumer (consume_event_accident_notify) resolves
-- recipients and delivers in-app + email exactly as the V305 VOR scan does - this
-- function adds NO new delivery path. Iterates every org; each event carries its
-- own timer's organisation_id.
-- =============================================================================
create or replace function public.accident_sla_scan()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now      timestamptz := now();
  v_warned   integer := 0;
  v_breached integer := 0;
  r          record;
begin
  -- 1. Flip genuinely-overdue RUNNING timers to breached. Only running + not paused
  --    + not already breached are eligible - a paused or terminal timer is never
  --    touched. warning_at may be null (business_hours=false definitions); the
  --    warning branch below guards for that.
  update public.accident_sla_instances si
     set state         = 'breached',
         breached       = true,
         breached_at    = coalesce(si.breached_at, v_now),
         breach_minutes = greatest(0, ceil(extract(epoch from (v_now - si.due_at)) / 60.0)::int),
         updated_at     = v_now
   where si.state = 'running'
     and si.paused = false
     and si.breached = false
     and si.due_at is not null
     and si.due_at < v_now;

  -- 2. Mark a warning on running timers past their warning threshold but not yet
  --    breached. This is separate state bookkeeping used only to fire the warning
  --    notice once; it does NOT change the 'running' state.
  for r in
    select si.id, si.accident_id, si.organisation_id, si.sla_key, si.name,
           si.workstream_key, si.team, si.due_at, si.warning_at, si.target_minutes
    from public.accident_sla_instances si
    where si.state = 'running'
      and si.paused = false
      and si.warned_notified = false
      and si.warning_at is not null
      and si.warning_at < v_now
  loop
    perform public.emit_domain_event(
      'accident.sla_warning', 'accident', r.accident_id::text,
      jsonb_build_object(
        'sla_instance_id', r.id,
        'sla_key', r.sla_key,
        'name', r.name,
        'workstream_key', r.workstream_key,
        'team', r.team,
        'due_at', r.due_at,
        'level', 1
      ),
      r.organisation_id, null);

    update public.accident_sla_instances
       set warned_notified = true,
           warned_at = coalesce(warned_at, v_now),
           updated_at = v_now
     where id = r.id;

    v_warned := v_warned + 1;
  end loop;

  -- 3. Emit one breach notice per newly-breached timer (structural once-only via
  --    breached_notified). A timer breached in step 1 above, or already breached on
  --    a prior run but never notified (e.g. a mid-flight failure), is caught here.
  for r in
    select si.id, si.accident_id, si.organisation_id, si.sla_key, si.name,
           si.workstream_key, si.team, si.due_at, si.breach_minutes
    from public.accident_sla_instances si
    where si.state = 'breached'
      and si.breached = true
      and si.breached_notified = false
  loop
    perform public.emit_domain_event(
      'accident.sla_breach', 'accident', r.accident_id::text,
      jsonb_build_object(
        'sla_instance_id', r.id,
        'sla_key', r.sla_key,
        'name', r.name,
        'workstream_key', r.workstream_key,
        'team', r.team,
        'due_at', r.due_at,
        'breach_minutes', r.breach_minutes,
        'level', 2
      ),
      r.organisation_id, null);

    update public.accident_sla_instances
       set breached_notified = true,
           updated_at = v_now
     where id = r.id;

    v_breached := v_breached + 1;
  end loop;

  return jsonb_build_object(
    'scanned_at', v_now,
    'warned', v_warned,
    'breached', v_breached);
end;
$function$;

-- =============================================================================
-- 5. GRANTS - user functions self-gate on app_is_elevated(); the scan is cron-only.
-- =============================================================================
revoke all on function public.accident_sla_start(uuid,text)                     from public, anon;
revoke all on function public.accident_sla_pause(uuid,text,timestamptz,text)     from public, anon;
revoke all on function public.accident_sla_resume(uuid,text)                     from public, anon;
revoke all on function public.accident_sla_scan()                               from public, anon, authenticated;

grant execute on function public.accident_sla_start(uuid,text)                   to authenticated;
grant execute on function public.accident_sla_pause(uuid,text,timestamptz,text)  to authenticated;
grant execute on function public.accident_sla_resume(uuid,text)                  to authenticated;
-- accident_sla_scan() is executed by the pg_cron / service role only.

-- =============================================================================
-- 6. CRON SCHEDULE (commented - enable at apply time).
--    Mirrors the live V305 `accident-sla-scan` cadence. This engine can either run
--    as its own daily job (below) or be folded into the existing accident-sla-scan
--    job's body. The task calls this a DAILY breach scan; 06:30 UTC = 09:30 Riyadh,
--    matching the V305 accident SLA scan window. Use */15 for near-real-time.
-- -----------------------------------------------------------------------------
-- do $$ begin perform cron.unschedule('accident-sla-scan-timers');
--   exception when others then null; end $$;
-- select cron.schedule('accident-sla-scan-timers', '30 6 * * *',
--   $job$select public.accident_sla_scan();$job$);
-- =============================================================================
