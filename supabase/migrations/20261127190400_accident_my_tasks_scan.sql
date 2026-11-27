-- =============================================================================
-- "My accident tasks", the who-holds-what board, stalled cases and a daily digest.
--
-- STATUS: AUTHORED, NOT APPLIED. Needs 20261127190100..190300 first.
--
-- A8  accident_my_tasks()        open steps owned by me, or by my role in my scope,
--                                with case ref, step, due, SLA state, days in step.
-- B2  accident_task_holdings()   open steps grouped by holder (person or role):
--                                count, oldest age, overdue.
-- A7  _accident_stalled_scan()   open cases stuck on one stage for the owner-set
--                                number of days (accident_notify_rules.stalled_days)
--                                emit accident.stalled once per case + stage.
-- D4  _accident_task_digest()    one in-app + push digest per person per day:
--                                "you have N open accident tasks (M overdue)".
-- Both scans run from the EXISTING daily accident_sla_scan cron (06:30 UTC); no new
-- cron. accident_sla_scan is patched by anchored replace on its live definition.
--
-- VERIFY (run live 2026-11-27, rolled back): as VINAY (Workshop Maintenance Area
--   Manager) accident_my_tasks() returned his named step (overdue) and the role step;
--   accident_task_holdings() grouped by person / role; scan 1 = {breached 1, digest 1,
--   stalled 28}, scan 2 the same day = {digest 0, stalled 0}. Digest text:
--   "You have 2 open accident tasks (1 overdue)".
--   NOTE: 28 stalled includes the 21 stuck 'reported' cases. Apply the legacy-close
--   data migration (20261127190250) before the first 06:30 scan, or the Manager gets
--   one stalled notice per legacy case on day one.
--
-- ROLLBACK: re-create accident_sla_scan from docs/accident-module/12_SLA_ENGINE.sql;
--   drop function public.accident_my_tasks(); drop function public.accident_task_holdings();
--   drop function public._accident_open_tasks(uuid); drop function public._accident_stalled_scan();
--   drop function public._accident_task_digest();
-- =============================================================================

begin;

-- Every open step in an org, with the numbers the screens need.
create or replace function public._accident_open_tasks(p_org uuid)
returns table (
  workstream_id uuid, accident_id uuid, reference_no text, asset_no text, site text,
  country text, severity text, workflow_stage text, workstream_key text,
  workstream_name text, status text, owner_id uuid, owner_role text, owner_name text,
  started_at timestamptz, days_in_step numeric, due_at timestamptz, sla_state text,
  overdue boolean)
language sql stable security definer set search_path = public as $$
  select w.id, a.id, coalesce(nullif(a.reference_no, ''), a.case_no), a.asset_no, a.site,
         a.country, a.severity, a.workflow_stage, w.workstream_key,
         public.accident_workstream_name(w.workstream_key), w.status, w.owner_id,
         w.owner_role, coalesce(nullif(btrim(p.full_name), ''), p.username),
         coalesce(w.started_at, w.assigned_at, w.created_at),
         round(extract(epoch from (now() - coalesce(w.started_at, w.assigned_at, w.created_at))) / 86400.0, 1),
         si.due_at,
         case when si.id is null then 'none'
              when si.state = 'running' and si.warning_at is not null and si.warning_at < now()
                   and si.due_at > now() then 'warning'
              else si.state end,
         coalesce(si.state = 'breached' or (si.state = 'running' and si.due_at < now()), false)
    from public.accident_case_workstreams w
    join public.accidents a on a.id = w.accident_id
    left join public.profiles p on p.id = w.owner_id
    left join lateral (
      select s.* from public.accident_sla_instances s
       where s.accident_id = w.accident_id and s.workstream_key = w.workstream_key
       order by s.start_at desc limit 1) si on true
   where w.organisation_id = p_org
     and w.status not in ('completed','not_required','cancelled')
     and coalesce(a.closure_level, 'open') not in ('legacy_closed','fully_closed')
     and a.workflow_stage not in ('closed','cancelled');
$$;

create or replace function public.accident_my_tasks()
returns table (
  workstream_id uuid, accident_id uuid, reference_no text, asset_no text, site text,
  country text, severity text, workflow_stage text, workstream_key text,
  workstream_name text, status text, owner_id uuid, owner_role text, owner_name text,
  started_at timestamptz, days_in_step numeric, due_at timestamptz, sla_state text,
  overdue boolean, assigned_to_me boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_org uuid := public.app_current_org();
  v_role text;
begin
  if v_me is null or not public.app_is_active() then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = v_me;
  return query
    select t.*, coalesce(t.owner_id = v_me, false)
      from public._accident_open_tasks(v_org) t
     where t.owner_id = v_me
        or (t.owner_id is null and t.owner_role = v_role
            and v_me in (select public.accident_people_for(v_org, array[t.owner_role], '{}', t.country, t.site)))
     order by t.overdue desc, t.due_at nulls last, t.days_in_step desc;
end;
$$;

create or replace function public.accident_task_holdings()
returns table (holder_id uuid, holder_name text, holder_role text, open_count integer,
               overdue_count integer, oldest_days numeric, no_owner boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.app_is_active() then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  return query
    select t.owner_id, max(t.owner_name), max(t.owner_role), count(*)::int,
           count(*) filter (where t.overdue)::int, max(t.days_in_step),
           (t.owner_id is null and max(t.owner_role) is null)
      from public._accident_open_tasks(public.app_current_org()) t
     where public.app_can_see_country(t.country) and public.app_can_see_site(t.site)
     group by t.owner_id, case when t.owner_id is null then t.owner_role end
     order by count(*) filter (where t.overdue) desc, count(*) desc;
end;
$$;

-- A7: cases stuck on one stage longer than the owner-set number of days.
create or replace function public._accident_stalled_scan()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select a.id, a.organisation_id, a.workflow_stage, nr.days,
           floor(extract(epoch from (now() - coalesce(
             (select max(se.entered_at) from public.accident_stage_events se
               where se.accident_id = a.id and se.stage = a.workflow_stage), a.created_at))) / 86400.0)::int as stuck
      from public.accidents a
      join (select organisation_id, min(stalled_days) as days
              from public.accident_notify_rules
             where active and event_key = 'accident.stalled' and stalled_days is not null
             group by organisation_id) nr on nr.organisation_id = a.organisation_id
     where coalesce(a.closure_level, 'open') = 'open'
       and a.workflow_stage not in ('closed','cancelled')
  loop
    continue when r.stuck < r.days;
    continue when exists (
      select 1 from public.domain_events e
       where e.event_type = 'accident.stalled' and e.entity_id = r.id::text
         and e.payload ->> 'stage' = r.workflow_stage);
    perform public.emit_domain_event('accident.stalled', 'accident', r.id::text,
      jsonb_build_object('stage', r.workflow_stage, 'days', r.stuck), r.organisation_id, null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- D4: one digest per person per day.
create or replace function public._accident_task_digest()
returns integer language plpgsql security definer set search_path = public as $$
declare
  o record;
  u record;
  v_ev bigint;
  v_n integer := 0;
  v_title text;
  v_tokens jsonb;
begin
  for o in
    select distinct organisation_id from public.accident_notify_rules
     where active and event_key = 'accident.task_digest'
  loop
    for u in
      select person, count(*)::int as n, count(*) filter (where overdue)::int as late
        from (
          select t.owner_id as person, t.overdue
            from public._accident_open_tasks(o.organisation_id) t where t.owner_id is not null
          union all
          select p, t.overdue
            from public._accident_open_tasks(o.organisation_id) t,
                 lateral public.accident_people_for(o.organisation_id, array[t.owner_role], '{}', t.country, t.site) p
           where t.owner_id is null and t.owner_role is not null
        ) s
       where not public._accident_is_test_profile(person)
       group by person
    loop
      v_title := 'You have ' || u.n || ' open accident task' || case when u.n = 1 then '' else 's' end
                 || case when u.late > 0 then ' (' || u.late || ' overdue)' else '' end;
      insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
      values (u.person, case when u.late > 0 then 'warning' else 'info' end, v_title,
              'Open My accident tasks to see them.', 'accident_tasks', null,
              'accident.task_digest:' || u.person::text || ':' || to_char(now() at time zone 'UTC', 'YYYYMMDD'))
      on conflict (dedupe_key) do nothing;
      if not found then continue; end if;
      v_n := v_n + 1;

      select coalesce(jsonb_agg(jsonb_build_object('user_id', u.person, 'push_token', tok, 'email', null)), '[]'::jsonb)
        into v_tokens from public._user_push_tokens(u.person) tok;
      v_ev := public.emit_domain_event('accident.task_digest', 'profile', u.person::text,
                jsonb_build_object('open', u.n, 'overdue', u.late), o.organisation_id, null);
      insert into public.workflow_notifications
        (event_id, organisation_id, instance_id, event_type, payload, recipient_count, status)
      values (-(v_ev * 16 + 3), o.organisation_id, null, 'accident.task_digest',
        jsonb_build_object('event_type', 'accident.task_digest', 'channel', 'accident', 'entity_type', 'accident_tasks',
          'push', jsonb_build_object('title', v_title, 'body', 'Open My accident tasks to see them.',
                    'data', jsonb_build_object('type', 'accident_tasks')),
          'recipients', v_tokens,
          'no_device', case when jsonb_array_length(v_tokens) = 0 then jsonb_build_array(u.person) else '[]'::jsonb end,
          'reason', case when jsonb_array_length(v_tokens) = 0 then 'no_device' end),
        jsonb_array_length(v_tokens),
        case when jsonb_array_length(v_tokens) = 0 then 'skipped' else 'pending' end)
      on conflict (event_id) do nothing;
    end loop;
  end loop;
  return v_n;
end;
$$;

revoke all on function public._accident_open_tasks(uuid) from public, anon, authenticated;
revoke all on function public._accident_stalled_scan() from public, anon, authenticated;
revoke all on function public._accident_task_digest() from public, anon, authenticated;
revoke all on function public.accident_my_tasks() from public, anon;
revoke all on function public.accident_task_holdings() from public, anon;
grant execute on function public.accident_my_tasks() to authenticated;
grant execute on function public.accident_task_holdings() to authenticated;

-- Extend the existing daily scan (no second cron).
do $patch$
declare
  v_def text := pg_get_functiondef('public.accident_sla_scan()'::regprocedure);
  a1 text := E'  r          record;\nbegin';
  a2 text := E'  return jsonb_build_object(\n    ''scanned_at'', v_now,';
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1
     or (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 then
    raise exception 'accident_sla_scan anchors not found exactly once';
  end if;
  v_def := replace(v_def, a1, E'  r          record;\n  v_stalled  integer := 0;\n  v_digest   integer := 0;\nbegin');
  v_def := replace(v_def, a2, E'  v_stalled := public._accident_stalled_scan();\n  v_digest := public._accident_task_digest();\n\n  return jsonb_build_object(\n    ''stalled'', v_stalled,\n    ''digest'', v_digest,\n    ''scanned_at'', v_now,');
  execute v_def;
end
$patch$;

commit;
