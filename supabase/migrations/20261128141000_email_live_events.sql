-- =============================================================================
-- P3: connect email to real events, and schedule the dispatcher.
-- STATUS: AUTHORED, NOT APPLIED. Apply AFTER 20261128140000_email_event_settings.
--
-- What this adds (all through the existing outbox: enqueue_email + the branded
-- templates; there is no second email path):
--   1. Accident step assigned -> email to the person who now owns the step
--      (named owner, or every real person holding the owner role in the case's
--      country/site). One email per person per case per minute, listing every
--      open step they hold on that case, so a new case that hands one person
--      three steps sends ONE email. Consumer of accident.workstream_assigned.
--      (Accident REPORTED email is in 20261128140000.)
--   2. Workshop vehicles waiting -> email to each supervisor a vehicle is routed
--      to. Batched per person: the first email goes at once, after that at most
--      one every 30 minutes, always with that person's whole waiting count (the
--      same count as the in-app "N vehicles waiting for you" notice). Never one
--      email per vehicle. A 5-minute sweep catches anything held back.
--   3. Daily summary at 07:00 Asia/Riyadh for Admin / Manager / Director (the
--      roles are editable in Settings -> Email & alerts): yesterday's
--      inspections done, accidents reported, workshop vehicles in and released,
--      plus tyres needing attention and approvals waiting right now. Each number
--      is read on its own; a number that could not be read is sent as "could
--      not be read", never as 0. Scoped to the reader's own countries/sites.
--   4. pg_cron: email-dispatch every minute (calls email_dispatch_kick, which
--      reads the secret from cron_config and posts only when rows are due),
--      email-workshop-waiting every 5 minutes, email-daily-summary 04:00 UTC.
--
-- Rules kept:
--   * Only verified real addresses (enqueue_email -> notify_allowed_emails).
--   * Dedupe: every enqueue carries a stable dedupe key (unique in the outbox).
--   * Per-type on/off: email_event_settings.enabled (Settings -> Email & alerts).
--     Assignments and workshop waiting cannot be turned off by the PERSON (owner
--     decision); the daily summary is optional and honours
--     notification_preferences.channel_email = false.
--   * system_config.email_dispatch_mode stays 'dry_run': everything below queues
--     and renders, nothing is SENT until an admin sets 'live'.
--
-- VERIFY (after apply, read only):
--   select jobname, schedule from cron.job where jobname like 'email-%';
--   select consumer, event_types from public.event_consumers where consumer = 'consume_event_email_accident_step';
--   select event_key from public.email_event_catalog();          -- includes workshop.waiting, summary.daily
--   select status, count(*) from public.email_outbox group by 1;  -- dry_run rows appear as events happen
--   select public.email_daily_summary_enqueue(current_date - 1, true);  -- dry count only, queues nothing
--
-- ROLLBACK:
--   select cron.unschedule('email-dispatch'); select cron.unschedule('email-workshop-waiting');
--   select cron.unschedule('email-daily-summary');
--   update public.event_consumers set enabled = false where consumer = 'consume_event_email_accident_step';
--   re-create public.workshop_intake_notify from 20261128090000 (this file only appends one call);
--   re-create public.email_event_catalog from 20261128140000.
--   Tables email_batch_marks can stay (deny-all, no data of value).
-- =============================================================================

-- Per-person batching state for batched emails (workshop waiting today).
create table if not exists public.email_batch_marks (
  organisation_id uuid not null,
  event_key       text not null,
  user_id         uuid not null,
  last_item_at    timestamptz,
  last_sent_at    timestamptz,
  primary key (organisation_id, event_key, user_id)
);
alter table public.email_batch_marks enable row level security;
revoke all on public.email_batch_marks from public;
revoke all on public.email_batch_marks from anon;
revoke all on public.email_batch_marks from authenticated;
grant all on public.email_batch_marks to service_role;

-- The catalogue gains the two new email types (same shape as 20261128140000).
create or replace function public.email_event_catalog()
returns table (event_key text, default_roles text[], assignee_based boolean, optional boolean)
language sql immutable
set search_path to 'public'
as $$
  values
    ('accident.reported'::text,   '{}'::text[],                 false, false),
    ('accident.update',           '{}'::text[],                 false, false),
    ('accident.escalation',       '{}'::text[],                 false, false),
    ('assignment.new',            '{}'::text[],                 true,  false),
    ('workshop.waiting',          '{}'::text[],                 true,  false),
    ('user.signup_pending',       array['Admin']::text[],       false, false),
    ('digest.daily',              array['Admin','Manager']::text[], false, true),
    ('summary.daily',             array['Admin','Manager','Director']::text[], false, true)
$$;

-- Is this email type on for the org? No row = on (the catalogue default).
-- Assignee-based types also stop when the admin turned "email the assignee" off.
create or replace function public.email_event_enabled(p_org uuid, p_event_key text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce((select s.enabled and (s.include_assignee
                          or not coalesce((select c.assignee_based from public.email_event_catalog() c
                                            where c.event_key = p_event_key), false))
                     from public.email_event_settings s
                    where s.organisation_id = p_org and s.event_key = p_event_key), true)
$$;

-- ---------------------------------------------------------------------------
-- 1. Accident step assigned.
-- ---------------------------------------------------------------------------
create or replace function public.consume_event_email_accident_step(ev public.domain_events)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  w        public.accident_case_workstreams%rowtype;
  a        public.accidents%rowtype;
  v_users  uuid[];
  v_u      uuid;
  v_role   text;
  v_steps  text[];
  v_queued int := 0;
begin
  if ev.event_type <> 'accident.workstream_assigned' then return; end if;
  begin
    select * into w from public.accident_case_workstreams where id = ev.entity_id::uuid;
  exception when others then return; end;
  if w.id is null or w.status in ('completed','not_required','cancelled') then return; end if;
  select * into a from public.accidents where id = w.accident_id;
  if a.id is null then return; end if;
  if not public.email_event_enabled(a.organisation_id, 'assignment.new') then return; end if;

  if w.owner_id is not null then
    v_users := array[w.owner_id];
  elsif nullif(btrim(coalesce(w.owner_role, '')), '') is not null then
    select coalesce(array_agg(x), '{}') into v_users
      from public.accident_people_for(a.organisation_id, array[w.owner_role], '{}'::uuid[], a.country, a.site) x;
  end if;

  for v_u in select distinct x from unnest(coalesce(v_users, '{}')) x
              where x is not null and x is distinct from ev.actor_id loop
    if public._accident_is_test_profile(v_u) then continue; end if;
    select p.role into v_role from public.profiles p where p.id = v_u;
    -- Every open step this person holds on the case (named, or by their role).
    select array_agg(distinct s.workstream_key order by s.workstream_key) into v_steps
      from public.accident_case_workstreams s
     where s.accident_id = a.id
       and s.status not in ('completed','not_required','cancelled')
       and (s.owner_id = v_u or (s.owner_id is null and s.owner_role is not null and s.owner_role = v_role));
    if v_steps is null then v_steps := array[w.workstream_key]; end if;

    if public.enqueue_email(
         a.organisation_id, 'accident.step_assigned', 'accident.step_assigned', v_u, null,
         'accident', a.id::text,
         jsonb_build_object(
           'reference_no', a.reference_no, 'asset_no', a.asset_no, 'site', a.site,
           'severity', a.severity, 'stage', a.workflow_stage, 'incident_date', a.incident_date,
           'steps', to_jsonb(v_steps), 'step', w.workstream_key),
         'accident.step:' || a.id || ':' || v_u || ':' || to_char(ev.created_at at time zone 'UTC', 'YYYYMMDDHH24MI')
       ) is not null then
      v_queued := v_queued + 1;
    end if;
  end loop;
  if v_queued > 0 then perform public.email_dispatch_kick(); end if;
exception when others then
  -- Email must never make the domain-event batch retry the other consumers.
  null;
end;
$$;

insert into public.event_consumers (consumer, event_types, enabled, description)
values ('consume_event_email_accident_step', array['accident.workstream_assigned'], true,
        'Emails the person who owns a newly assigned accident step (outbox, verified addresses only, one email per person per case per minute).')
on conflict (consumer) do update set event_types = excluded.event_types, enabled = true,
  description = excluded.description;

-- ---------------------------------------------------------------------------
-- 2. Workshop vehicles waiting for a supervisor.
--   p_users null = every person with something waiting (the 5-minute sweep).
--   Sends when there is a vehicle routed after the last one we told them about
--   AND we have not emailed them in the last 30 minutes.
-- ---------------------------------------------------------------------------
create or replace function public.email_workshop_waiting_sweep(p_org uuid default null, p_users uuid[] default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r        record;
  m        public.email_batch_marks%rowtype;
  v_queued int := 0;
begin
  for r in
    select rec.organisation_id as org, u as user_id, count(*)::int as n,
           max(coalesce(rec.routed_at, rec.submitted_at, rec.created_at)) as newest,
           (array_agg(rec.asset_no order by coalesce(rec.routed_at, rec.submitted_at, rec.created_at) desc))[1:15] as assets
      from public.workshop_status_records rec, unnest(rec.routed_to) u
     where rec.current_active and rec.deleted_at is null and rec.confirm_status = 'pending_confirm'
       and (p_org is null or rec.organisation_id = p_org)
       and (p_users is null or u = any (p_users))
     group by rec.organisation_id, u
  loop
    if not public.email_event_enabled(r.org, 'workshop.waiting') then continue; end if;
    select * into m from public.email_batch_marks
     where organisation_id = r.org and event_key = 'workshop.waiting' and user_id = r.user_id;
    if m.user_id is not null then
      if r.newest <= coalesce(m.last_item_at, '-infinity'::timestamptz) then continue; end if;
      if m.last_sent_at > now() - interval '30 minutes' then continue; end if;
    end if;

    if public.enqueue_email(
         r.org, 'workshop.waiting', 'workshop.waiting', r.user_id, null, 'workshop_intake', null,
         jsonb_build_object('count', r.n, 'assets', to_jsonb(r.assets)),
         'workshop.waiting:' || r.org || ':' || r.user_id || ':' || floor(extract(epoch from r.newest))::bigint
       ) is not null then
      v_queued := v_queued + 1;
    end if;
    -- Mark as considered even when the person has no verified address, so the
    -- sweep does not re-check the same vehicles every 5 minutes.
    insert into public.email_batch_marks (organisation_id, event_key, user_id, last_item_at, last_sent_at)
    values (r.org, 'workshop.waiting', r.user_id, r.newest, now())
    on conflict (organisation_id, event_key, user_id)
      do update set last_item_at = excluded.last_item_at, last_sent_at = excluded.last_sent_at;
  end loop;
  if v_queued > 0 then perform public.email_dispatch_kick(); end if;
  return v_queued;
end;
$$;

-- Same body as 20261128090000 (live, byte-checked 2026-11-28), plus one
-- best-effort call at the end so the first email goes at once.
create or replace function public.workshop_intake_notify(p_org uuid, p_users uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_u uuid; v_n int; v_assets text[]; v_sent int := 0;
begin
  for v_u in select distinct u from unnest(coalesce(p_users, '{}')) u where u is not null loop
    select count(*)::int, (array_agg(r.asset_no order by r.submitted_at desc))[1:5]
      into v_n, v_assets
      from public.workshop_status_records r
     where r.organisation_id = p_org and r.current_active and r.deleted_at is null
       and r.confirm_status = 'pending_confirm' and v_u = any (r.routed_to);
    if v_n > 0 then
      perform public.workshop_status_notice_send(p_org, v_u, 'workshop_intake_pending',
        case when v_n = 1 then '1 vehicle waiting for you to confirm'
             else v_n || ' vehicles waiting for you to confirm' end,
        public.workshop_status_asset_list(v_assets),
        'workshop_status', null, '/daily-ops/workshop?tab=intake&view=waiting');
      v_sent := v_sent + 1;
    end if;
  end loop;
  begin
    perform public.email_workshop_waiting_sweep(p_org, p_users);
  exception when others then
    null;  -- email must never block the intake
  end;
  return v_sent;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Daily summary.
-- ---------------------------------------------------------------------------
-- Row visible to this reader? Mirrors app_can_see_country / app_can_see_site
-- (V309): Admin and super admin see everything; others need the country in
-- their list and the site in their sites (or the 'ALL' / '*' sentinel). A row
-- with no country / no site is visible to everyone, as in the app.
create or replace function public._email_scope_ok(p_user uuid, p_country text, p_site text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce((
    select lower(coalesce(p.role, '')) = 'admin' or coalesce(p.is_super_admin, false)
        or ((p_country is null or p_country = any (coalesce(p.country, '{}'::text[])))
            and (p_site is null or btrim(p_site) = ''
                 or exists (select 1 from unnest(coalesce(p.sites, '{}'::text[])) x
                             where x in ('ALL','*') or upper(x) = upper(p_site))))
      from public.profiles p where p.id = p_user), false)
$$;

-- Yesterday's numbers for one reader. Each number is read on its own; a read
-- that fails becomes null ("could not be read"), never a fabricated 0.
create or replace function public._email_daily_summary_data(p_org uuid, p_user uuid, p_day date, p_tyres jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_from timestamptz := (p_day::timestamp) at time zone 'Asia/Riyadh';
  v_to   timestamptz := ((p_day + 1)::timestamp) at time zone 'Asia/Riyadh';
  v_insp int; v_acc int; v_in int; v_out int; v_tyres int; v_appr int; v_appr2 int;
begin
  begin
    select count(*)::int into v_insp from public.inspections i
     where i.organisation_id = p_org and i.status = 'Done'
       and coalesce(i.completed_date, i.inspection_date) = p_day
       and public._email_scope_ok(p_user, i.country, i.site);
  exception when others then v_insp := null; end;

  begin
    select count(*)::int into v_acc from public.accidents x
     where x.organisation_id = p_org and x.created_at >= v_from and x.created_at < v_to
       and public._email_scope_ok(p_user, x.country, x.site);
  exception when others then v_acc := null; end;

  begin
    select count(*)::int into v_in from public.workshop_status_records w
     where w.organisation_id = p_org and w.deleted_at is null
       and coalesce(w.first_seen_at, w.created_at) >= v_from and coalesce(w.first_seen_at, w.created_at) < v_to
       and public._email_scope_ok(p_user, w.country, w.site);
  exception when others then v_in := null; end;

  begin
    select count(*)::int into v_out from public.workshop_status_records w
     where w.organisation_id = p_org and w.deleted_at is null
       and w.removed_at >= v_from and w.removed_at < v_to
       and public._email_scope_ok(p_user, w.country, w.site);
  exception when others then v_out := null; end;

  if p_tyres is null then
    v_tyres := null;
  else
    begin
      select count(*)::int into v_tyres from jsonb_array_elements(p_tyres) t
       where public._email_scope_ok(p_user, t->>'country', t->>'site');
    exception when others then v_tyres := null; end;
  end if;

  begin
    select count(*)::int into v_appr from public.inspections i
     where i.organisation_id = p_org and i.approval_status = 'pending_approval'
       and public._email_scope_ok(p_user, i.country, i.site);
    select count(*)::int into v_appr2 from public.checklist_submissions c
     where c.organisation_id = p_org and c.approval_status in ('pending','pending_area_manager')
       and public._email_scope_ok(p_user, c.country, c.site);
    v_appr := v_appr + v_appr2;
  exception when others then v_appr := null; end;

  return jsonb_build_object(
    'summary_date', p_day, 'summary_label', to_char(p_day, 'DD Mon YYYY'),
    'inspections_done', v_insp, 'accidents_reported', v_acc,
    'workshop_in', v_in, 'workshop_released', v_out,
    'tyres_attention', v_tyres, 'approvals_waiting', v_appr,
    'unreadable', (v_insp is null)::int + (v_acc is null)::int + (v_in is null)::int
                  + (v_out is null)::int + (v_tyres is null)::int + (v_appr is null)::int);
end;
$$;

-- Queue the morning summary for every reader. p_dry = true returns the counts
-- of who WOULD get it and queues nothing (safe to run on production to check).
create or replace function public.email_daily_summary_enqueue(
  p_day date default ((now() at time zone 'Asia/Riyadh')::date - 1),
  p_dry boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  o        record;
  r        record;
  v_tyres  jsonb;
  v_lead   int;
  v_back   int;
  v_queued int := 0;
  v_people int := 0;
  v_optout int := 0;
begin
  for o in
    select distinct p.organisation_id as id from public.profiles p
     where p.organisation_id is not null and coalesce(p.approved, true) and not coalesce(p.locked, false)
  loop
    if not public.email_event_enabled(o.id, 'summary.daily') then continue; end if;

    -- Tyres at or past end of life: the same engine as the due alerts. Read
    -- once per organisation; null when it cannot be read.
    begin
      select coalesce(r2.lead_days, 0), r2.lookback_days into v_lead, v_back
        from public.due_alert_rules r2 where r2.rule_key = 'tyre_end_of_life';
      select coalesce(jsonb_agg(jsonb_build_object('country', d.country, 'site', d.site)), '[]'::jsonb)
        into v_tyres
        from public._due_items('tyre_end_of_life', coalesce(v_lead, 0), v_back) d
       where d.org = o.id;
    exception when others then v_tyres := null; end;

    for r in
      select distinct e.user_id from public.email_event_recipients(o.id, 'summary.daily') e
       where e.user_id is not null
    loop
      v_people := v_people + 1;
      if exists (select 1 from public.notification_preferences np
                  where np.user_id = r.user_id and np.channel_email = false) then
        v_optout := v_optout + 1;
        continue;
      end if;
      if p_dry then continue; end if;
      if public.enqueue_email(
           o.id, 'summary.daily', 'summary.daily', r.user_id, null, 'digest', null,
           public._email_daily_summary_data(o.id, r.user_id, p_day, v_tyres),
           'summary.daily:' || o.id || ':' || r.user_id || ':' || p_day
         ) is not null then
        v_queued := v_queued + 1;
      end if;
    end loop;
  end loop;
  if v_queued > 0 then perform public.email_dispatch_kick(); end if;
  return jsonb_build_object('day', p_day, 'dry_run', p_dry, 'readers', v_people,
                            'opted_out', v_optout, 'queued', v_queued);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: none of these is callable by clients.
-- ---------------------------------------------------------------------------
do $grants$
declare f text;
begin
  foreach f in array array[
    'public.email_event_enabled(uuid,text)',
    'public.consume_event_email_accident_step(public.domain_events)',
    'public.email_workshop_waiting_sweep(uuid,uuid[])',
    'public._email_scope_ok(uuid,text,text)',
    'public._email_daily_summary_data(uuid,uuid,date,jsonb)',
    'public.email_daily_summary_enqueue(date,boolean)'
  ] loop
    execute format('grant execute on function %s to service_role', f);
    execute format('revoke execute on function %s from public', f);
    execute format('revoke execute on function %s from anon', f);
    execute format('revoke execute on function %s from authenticated', f);
  end loop;
end
$grants$;

-- ---------------------------------------------------------------------------
-- 4. Schedules. Commands carry no secret: email_dispatch_kick reads it from
--    cron_config at run time (the same pattern as the other cron -> edge jobs).
-- ---------------------------------------------------------------------------
do $cron$
begin
  if not exists (select 1 from cron.job where jobname = 'email-dispatch') then
    perform cron.schedule('email-dispatch', '* * * * *', 'select public.email_dispatch_kick()');
  end if;
  if not exists (select 1 from cron.job where jobname = 'email-workshop-waiting') then
    perform cron.schedule('email-workshop-waiting', '*/5 * * * *', 'select public.email_workshop_waiting_sweep()');
  end if;
  -- 04:00 UTC = 07:00 Asia/Riyadh (no daylight saving).
  if not exists (select 1 from cron.job where jobname = 'email-daily-summary') then
    perform cron.schedule('email-daily-summary', '0 4 * * *', 'select public.email_daily_summary_enqueue()');
  end if;
end
$cron$;
