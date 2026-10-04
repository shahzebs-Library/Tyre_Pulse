-- 20260930161000_alert_center_inbox.sql
-- Alert Center: one inbox over the six places alerts live today, with owner / acknowledge / snooze /
-- resolve state, plus the extra rule settings (wait, remind, recover) the rule builder writes.
--
-- WHAT IT ADDS (additive only)
--   1. public.alert_inbox_state: triage state keyed on a deduplication key (source + what happened).
--      Alerts had no owner, acknowledged or snoozed state anywhere; this is where it lives.
--      RLS on, super admin read only; writes only through set_alert_state().
--   2. get_alert_inbox()  read-only, super admin: the six source tiles and the deduplicated inbox
--      (fatal phone crashes, error log by severity, upload gap notices with a recovered flag measured
--      against the newest row of the feed, failing security checks, open trust alerts, open incidents),
--      each joined to its triage state. Crash rows in the error log are the same 5 Sentry crashes, so
--      they are counted once under Crash reports.
--   3. set_alert_state(keys[], action, owner, snooze_hours, reason)  acknowledge / snooze / resolve /
--      assign / reopen; resolve needs a reason; audited through log_console_event.
--   4. alert_thresholds gains nullable pending_checks, renotify_minutes, renotify_max, recover_after_hours
--      (Wait / Remind / Recover lines in the rule builder). Existing rules and the hourly evaluator are
--      untouched; the evaluator does not act on these yet and the screen says so.
--
-- PRE-FLIGHT
--   Data loss: none. alert_thresholds has 0 rows; four nullable columns, no default, no rewrite.
--   Locks: trivial. CHECK: new table only. RLS: new table on, super admin select, no client writes.
--   DEFINER: search_path pinned, is_super_admin() + _console_ip_allowed() in body, revoke PUBLIC then
--   anon, grant authenticated. Dynamic SQL reads only upload_feeds rows, whose table/column pairs are
--   validated against information_schema by the upload_feeds_validate() trigger, and uses format(%I).
--   Rollback: drop function get_alert_inbox(), set_alert_state(text[],text,uuid,integer,text);
--   drop table public.alert_inbox_state; alter table public.alert_thresholds drop column pending_checks,
--   drop column renotify_minutes, drop column renotify_max, drop column recover_after_hours.

create table if not exists public.alert_inbox_state (
  dedup_key       text primary key,
  source          text,
  state           text not null default 'new' check (state in ('new','acknowledged','snoozed','resolved')),
  owner_id        uuid references auth.users(id) on delete set null,
  snoozed_until   timestamptz,
  acknowledged_at timestamptz,
  resolved_at     timestamptz,
  note            text,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null
);
alter table public.alert_inbox_state enable row level security;
drop policy if exists alert_inbox_state_super_read on public.alert_inbox_state;
create policy alert_inbox_state_super_read on public.alert_inbox_state
  for select to authenticated using ((select public.is_super_admin()));
revoke all on public.alert_inbox_state from anon;
grant select on public.alert_inbox_state to authenticated;

alter table public.alert_thresholds
  add column if not exists pending_checks integer,
  add column if not exists renotify_minutes integer,
  add column if not exists renotify_max integer,
  add column if not exists recover_after_hours integer;

create or replace function public.get_alert_inbox()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_items jsonb := '[]'::jsonb;
  v_sources jsonb;
  r record;
  v_newest date;
  v_scan record;
  v_chk jsonb;
  v_failing text[];
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can read the alert inbox' using errcode = '42501';
  end if;

  -- 1. fatal phone crashes (Sentry), one grouped alert
  select count(*) n, min(alerted_at) f, max(alerted_at) l,
         count(*) filter (where alerted_at >= now() - interval '30 days') n30
    into r from public.sentry_alert_log;
  if r.n > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'key', 'crash|fatal', 'source', 'crash', 'severity', 'critical',
      'title', r.n || ' fatal Android app crashes',
      'detail', 'Last on ' || to_char(r.l at time zone 'Asia/Riyadh', 'DD Mon') ||
                case when r.n30 = 0 then '. None since.' else '. ' || r.n30 || ' in the last 30 days.' end ||
                ' The same crashes also sit in the error log as critical and are shown once here.',
      'affected', 'Phones, version not recorded', 'first_at', r.f, 'last_at', r.l, 'count', r.n, 'groups', r.n));
  end if;

  -- 2. error log by severity (Sentry rows excluded: counted above)
  for r in
    select severity, count(*) n, min(created_at) f, max(created_at) l,
           count(distinct public.system_log_group_key(source, message, error_fingerprint)) g,
           mode() within group (order by public.system_log_group_key(source, message, error_fingerprint)) top_key
    from public.system_logs
    where not resolved and lower(coalesce(source, '')) <> 'sentry'
    group by severity
  loop
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'key', 'errors|' || coalesce(r.severity, 'info'), 'source', 'error_log',
      'severity', case r.severity when 'critical' then 'critical' when 'error' then 'medium' when 'warning' then 'low' else 'info' end,
      'title', r.n || ' unresolved ' || case r.severity when 'error' then 'page errors' when 'warning' then 'warnings'
                                                       when 'critical' then 'critical errors' else 'routine info rows' end,
      'detail', 'Most common: ' || coalesce(split_part(r.top_key, '|', 2), 'N/A'),
      'affected', case r.severity when 'error' then 'Web users' else 'Nobody blocked' end,
      'first_at', r.f, 'last_at', r.l, 'count', r.n, 'groups', r.g));
  end loop;

  -- 3. upload gap notices (last 30 days), recovered when the feed has newer data
  for r in
    select n.src, n.last_data_date, n.notified_at, f.table_name, f.date_column, f.label
    from public.upload_gap_notices n
    left join public.upload_feeds f on f.src = n.src
    where n.notified_at >= now() - interval '30 days'
  loop
    v_newest := null;
    if r.table_name is not null then
      begin
        execute format('select max(%I)::date from public.%I', r.date_column, r.table_name) into v_newest;
      exception when others then v_newest := null;
      end;
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'key', 'upload|' || r.src || '|' || r.last_data_date, 'source', 'upload_gap',
      'severity', case when r.src in ('job_cards','expenses') then 'medium' else 'low' end,
      'title', coalesce(r.label, r.src) || ' stopped arriving after ' || to_char(r.last_data_date, 'DD Mon'),
      'detail', case when v_newest is null then 'Newest data could not be checked.'
                     when v_newest > r.last_data_date then 'Newer data has arrived since. Latest is dated ' || to_char(v_newest, 'DD Mon') || '.'
                     else 'No newer data yet.' end,
      'affected', coalesce(r.label, r.src) || ' reports',
      'first_at', r.notified_at, 'last_at', r.notified_at, 'count', 1, 'groups', 1,
      'recovered', coalesce(v_newest > r.last_data_date, false), 'newest_data', v_newest));
  end loop;

  -- 4. failing checks of the latest security scan
  select ran_at, result, failing into v_scan from public.security_scan_runs order by ran_at desc limit 1;
  v_failing := v_scan.failing;
  if v_scan.ran_at is not null then
    for v_chk in select c from jsonb_array_elements(coalesce(v_scan.result->'checks', '[]'::jsonb)) c
                 where c->>'status' = 'fail' or (c->>'id') = any(coalesce(v_failing, '{}'))
    loop
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'key', 'security|' || (v_chk->>'id'), 'source', 'security',
        'severity', case v_chk->>'severity' when 'critical' then 'critical' when 'high' then 'high'
                                            when 'medium' then 'medium' else 'low' end,
        'title', v_chk->>'title',
        'detail', coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(v_chk->'items') x), '') ||
                  coalesce('. Fix: ' || (v_chk->>'fix'), ''),
        'affected', 'Whole platform', 'first_at', v_scan.ran_at, 'last_at', v_scan.ran_at,
        'count', coalesce((v_chk->>'count')::int, 1), 'groups', 1));
    end loop;
  end if;

  -- 5. open trust alerts
  for r in select id, source, severity, message, created_at from public.trust_alerts where status = 'open' loop
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'key', 'trust|' || r.id, 'source', 'trust',
      'severity', case r.severity when 'critical' then 'high' when 'warning' then 'medium' else 'low' end,
      'title', left(r.message, 160), 'detail', 'Data trust check: ' || coalesce(r.source, 'N/A'),
      'affected', 'Reports using this data', 'first_at', r.created_at, 'last_at', r.created_at, 'count', 1, 'groups', 1));
  end loop;

  -- 6. open incidents
  for r in select id, title, severity, status, started_at from public.platform_incidents where status <> 'resolved' loop
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'key', 'incident|' || r.id, 'source', 'incident',
      'severity', case r.severity when 'sev1' then 'critical' when 'sev2' then 'high' else 'medium' end,
      'title', r.title, 'detail', 'Incident is ' || r.status,
      'affected', 'See the incident', 'first_at', r.started_at, 'last_at', r.started_at, 'count', 1, 'groups', 1));
  end loop;

  -- join triage state
  select coalesce(jsonb_agg(i || jsonb_build_object('state', case
            when s.dedup_key is null then 'new'
            when s.state = 'snoozed' and s.snoozed_until <= now() then 'new'
            else s.state end,
          'owner_id', s.owner_id,
          'owner_name', (select coalesce(nullif(p.full_name, ''), public.mask_email_for_console(p.email)) from public.profiles p where p.id = s.owner_id),
          'snoozed_until', s.snoozed_until, 'acknowledged_at', s.acknowledged_at, 'resolved_at', s.resolved_at,
          'note', s.note)), '[]'::jsonb)
    into v_items
    from jsonb_array_elements(v_items) i
    left join public.alert_inbox_state s on s.dedup_key = i->>'key';

  select jsonb_build_object(
    'error_log', (select jsonb_build_object('unresolved', count(*) filter (where not resolved),
                   'critical', count(*) filter (where not resolved and severity = 'critical'),
                   'routine', count(*) filter (where not resolved and severity in ('warning','info'))) from public.system_logs),
    'crash', (select jsonb_build_object('total', count(*), 'last_30d', count(*) filter (where alerted_at >= now() - interval '30 days'),
                   'last_at', max(alerted_at)) from public.sentry_alert_log),
    'upload_gap', (select jsonb_build_object('total', count(*), 'last_30d', count(*) filter (where notified_at >= now() - interval '30 days')) from public.upload_gap_notices),
    'security', (select jsonb_build_object('ran_at', ran_at, 'failing', coalesce(array_length(failing, 1), 0),
                   'critical', critical, 'high', high, 'medium', medium, 'low', low)
                 from public.security_scan_runs order by ran_at desc limit 1),
    'trust', (select jsonb_build_object('open', count(*) filter (where status = 'open'),
                   'resolved', count(*) filter (where status <> 'open'), 'last_resolved_at', max(created_at) filter (where status <> 'open')) from public.trust_alerts),
    'incidents', (select jsonb_build_object('open', count(*) filter (where status <> 'resolved'), 'ever', count(*)) from public.platform_incidents),
    'rules', (select jsonb_build_object('total', count(*), 'active', count(*) filter (where active)) from public.alert_thresholds)
  ) into v_sources;

  return jsonb_build_object('ok', true, 'generated_at', now(), 'sources', v_sources, 'items', v_items);
end;
$$;

create or replace function public.set_alert_state(
  p_keys text[], p_action text, p_owner uuid default null, p_snooze_hours integer default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int := 0; v_state text;
begin
  if not public._console_ip_allowed() then
    raise exception 'Console access is not allowed from this network' using errcode = '42501';
  end if;
  if not public.is_super_admin() then
    raise exception 'Only a super admin can change alerts' using errcode = '42501';
  end if;
  if p_action not in ('acknowledge','snooze','resolve','assign','reopen') then
    raise exception 'That alert action is not recognised' using errcode = '22023';
  end if;
  if p_action = 'resolve' and length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required to resolve alerts' using errcode = '22023';
  end if;
  if p_action = 'snooze' and (p_snooze_hours is null or p_snooze_hours < 1 or p_snooze_hours > 720) then
    raise exception 'Snooze for between 1 hour and 30 days' using errcode = '22023';
  end if;
  if p_keys is null or cardinality(p_keys) = 0 then return jsonb_build_object('ok', true, 'changed', 0); end if;
  if cardinality(p_keys) > 200 then raise exception 'Change at most 200 alerts at a time' using errcode = '22023'; end if;

  v_state := case p_action when 'acknowledge' then 'acknowledged' when 'snooze' then 'snoozed'
                           when 'resolve' then 'resolved' when 'reopen' then 'new' else null end;

  insert into public.alert_inbox_state as s (dedup_key, source, state, owner_id, snoozed_until, acknowledged_at,
                                             resolved_at, note, updated_at, updated_by)
  select k, split_part(k, '|', 1), coalesce(v_state, 'acknowledged'),
         case when p_action = 'assign' then p_owner end,
         case when p_action = 'snooze' then now() + make_interval(hours => p_snooze_hours) end,
         case when p_action in ('acknowledge','assign') then now() end,
         case when p_action = 'resolve' then now() end,
         nullif(left(btrim(coalesce(p_reason, '')), 500), ''), now(), auth.uid()
  from (select distinct k from unnest(p_keys) k where nullif(btrim(k), '') is not null) x
  on conflict (dedup_key) do update set
    state = coalesce(v_state, s.state),
    owner_id = case when p_action = 'assign' then p_owner else s.owner_id end,
    snoozed_until = case when p_action = 'snooze' then now() + make_interval(hours => p_snooze_hours)
                         when p_action in ('reopen','resolve') then null else s.snoozed_until end,
    acknowledged_at = case when p_action in ('acknowledge','assign') then coalesce(s.acknowledged_at, now())
                           when p_action = 'reopen' then null else s.acknowledged_at end,
    resolved_at = case when p_action = 'resolve' then now() when p_action = 'reopen' then null else s.resolved_at end,
    note = coalesce(nullif(left(btrim(coalesce(p_reason, '')), 500), ''), s.note),
    updated_at = now(), updated_by = auth.uid();
  get diagnostics v_n = row_count;

  perform public.log_console_event('alert_' || p_action, null, 'alert',
    jsonb_build_object('count', v_n, 'keys', to_jsonb(p_keys[1:20]), 'owner_id', p_owner,
                       'snooze_hours', p_snooze_hours, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'changed', v_n, 'state', v_state);
end;
$$;

revoke all on function public.get_alert_inbox() from public;
revoke all on function public.get_alert_inbox() from anon;
grant execute on function public.get_alert_inbox() to authenticated;
revoke all on function public.set_alert_state(text[],text,uuid,integer,text) from public;
revoke all on function public.set_alert_state(text[],text,uuid,integer,text) from anon;
grant execute on function public.set_alert_state(text[],text,uuid,integer,text) to authenticated;
