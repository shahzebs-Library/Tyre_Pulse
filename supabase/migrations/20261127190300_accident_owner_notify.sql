-- =============================================================================
-- Accident notifications driven by the owner's settings (accident_notify_rules).
--
-- STATUS: AUTHORED, NOT APPLIED. Needs 20261127190100 + 20261127190200 first.
--
-- WHY DUPLICATES HAPPENED (A4, found while building this):
--   * accident.reported does NOT fire twice per insert. 58 events / 45 accidents is
--     events for accidents that were later deleted (0 accidents have 2 reported events).
--   * The duplicates are in notifications: process_domain_events re-runs EVERY
--     consumer of an event when any one consumer fails (retry up to 5x), and one
--     batch shares one now(), so the same in-app row is inserted again. Fix: every
--     accident in-app row now carries notifications.dedupe_key (unique), built from
--     event type + case + person + title + event minute (accident.reported: once per
--     case per person), and inserts use ON CONFLICT DO NOTHING. Retries and twin
--     events can no longer duplicate. Existing duplicate rows are left alone (no
--     delete here); they stop growing.
--
-- D3 DELIVERY: in-app always; push for every configured event whether or not
--   accident e-mails are on (before this, push only went out inside the e-mail
--   branch, so with e-mails off nobody's phone ever rang); e-mail stays with the
--   existing consumers and system_config.accident_emails_enabled. The push row lists
--   people with no device ('no_device') so delivery can be audited.
--
-- ROUTING: consume_event_accident_owner_notify resolves recipients from the rules:
--   step owner (named person, or every real person holding the owner role in scope),
--   roles, named people, and the driver who filed the report. Test/demo profiles and
--   the person who caused the event are excluded. Where an org has a rule for an
--   event, the two older consumers stop sending their own in-app rows / push for it
--   (they keep e-mail), so nobody gets the same message twice.
--
-- VERIFY RESULT (run live 2026-11-27, rolled back): a new case's reported event
--   told VINAY (step owner), Shahab (fleet owner) and adnan (Manager); the reporter
--   (actor) was not told; Test User / Demo Manager excluded; push row pending with 2
--   devices and no_device = [adnan]; consuming the same event again plus running the
--   older consumer added 0 rows (3 -> 3); a stage change told the driver
--   "Your accident report ... is now: Initial Review". Both older consumers patched.
-- VERIFY (rolled back): a configured event produces one in-app row per person and a
--   push row; processing the same event twice adds nothing.
--
-- ROLLBACK:
--   delete from public.event_consumers where consumer = 'consume_event_accident_owner_notify';
--   re-create consume_event_accident_notify / consume_event_accident_case_notify from
--   20261029150000 / docs/accident-module/11_NOTIFICATIONS.sql;
--   drop function public.consume_event_accident_owner_notify(public.domain_events);
--   drop function public._accident_notify_targets(uuid,text,jsonb,uuid);
--   drop function public.accident_notify_dedupe_key(text,text,uuid,text,timestamptz);
--   drop index public.notifications_dedupe_key_uidx; alter table public.notifications drop column dedupe_key;
-- =============================================================================

begin;

alter table public.notifications add column if not exists dedupe_key text;
create unique index if not exists notifications_dedupe_key_uidx
  on public.notifications (dedupe_key);

create or replace function public.accident_notify_dedupe_key(
  p_event text, p_entity text, p_user uuid, p_title text, p_at timestamptz)
returns text language sql immutable set search_path = public as $$
  select case when p_event = 'accident.reported'
    then p_event || ':' || coalesce(p_entity, '') || ':' || p_user::text
    else p_event || ':' || coalesce(p_entity, '') || ':' || p_user::text || ':'
         || md5(coalesce(p_title, '')) || ':' || to_char(p_at at time zone 'UTC', 'YYYYMMDDHH24MI')
  end;
$$;

-- People to tell for one accident + one rule event.
create or replace function public._accident_notify_targets(
  p_accident uuid, p_event text, p_payload jsonb, p_actor uuid)
returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare
  a public.accidents%rowtype;
  r record;
  v_out uuid[] := '{}';
  v_owners uuid[];
  v_ws text := nullif(p_payload ->> 'workstream_key', '');
begin
  select * into a from public.accidents where id = p_accident;
  if a.id is null then return '{}'; end if;

  for r in
    select * from public.accident_notify_rules n
     where n.organisation_id = a.organisation_id and n.active and n.event_key = p_event
  loop
    if r.only_when_serious and not (
         a.severity in ('severe','fatal') or coalesce(a.injuries, false)
         or coalesce(a.estimated_damage_cost, a.final_amount, a.repair_cost, 0) >= r.serious_cost) then
      continue;
    end if;

    if r.notify_owner then
      select coalesce(array_agg(distinct x), '{}') into v_owners from (
        -- a named owner on the matching step(s)
        select w.owner_id as x
          from public.accident_case_workstreams w
         where w.accident_id = a.id and w.owner_id is not null
           and w.status not in ('completed','not_required','cancelled')
           and (
             (v_ws is not null and w.workstream_key = v_ws)
             or (v_ws is null and p_event in ('accident.stage_changed','accident.stalled')
                 and public.accident_workstream_stage(w.workstream_key) = a.workflow_stage)
             or (v_ws is null and p_event not in ('accident.stage_changed','accident.stalled'))
           )
        union
        -- a role-owned step: every real person holding that role in scope
        select p
          from public.accident_case_workstreams w,
               lateral public.accident_people_for(a.organisation_id, array[w.owner_role], '{}', a.country, a.site) p
         where w.accident_id = a.id and w.owner_id is null and w.owner_role is not null
           and w.status not in ('completed','not_required','cancelled')
           and (
             (v_ws is not null and w.workstream_key = v_ws)
             or (v_ws is null and p_event in ('accident.stage_changed','accident.stalled')
                 and public.accident_workstream_stage(w.workstream_key) = a.workflow_stage)
             or (v_ws is null and p_event not in ('accident.stage_changed','accident.stalled'))
           )
        union
        select a.responsible_owner_id where a.responsible_owner_id is not null
      ) s where x is not null;
      v_out := v_out || v_owners;
    end if;

    if cardinality(r.roles) > 0 or cardinality(r.user_ids) > 0 then
      v_out := v_out || coalesce((select array_agg(x) from public.accident_people_for(
                 a.organisation_id, r.roles, r.user_ids, a.country, a.site) x), '{}');
    end if;

    if r.notify_driver and a.reported_by is not null
       and not public._accident_is_test_profile(a.reported_by) then
      v_out := array_append(v_out, a.reported_by);
    end if;
  end loop;

  return coalesce((select array_agg(distinct x) from unnest(v_out) x
                    where x is not null and x is distinct from p_actor
                      and not public._accident_is_test_profile(x)), '{}');
end;
$$;

-- Tell people: in-app row (deduped) + one push row listing who has no device.
-- workflow_notifications.event_id is unique and the older consumers use the real
-- event id for their e-mail row, so the push row takes a negative derived id
-- (never collides with a real event; stable, so a retry cannot add a second row).
create or replace function public._accident_deliver(
  p_ev public.domain_events, p_rule_event text, p_accident uuid, p_targets uuid[],
  p_type text, p_title text, p_body text, p_push boolean)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_n integer := 0;
  v_recipients jsonb;
  v_no_device jsonb;
begin
  if p_targets is null or cardinality(p_targets) = 0 then return 0; end if;
  select organisation_id into v_org from public.accidents where id = p_accident;

  insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
  select t, p_type, p_title, p_body, 'accident', p_accident,
         public.accident_notify_dedupe_key(p_rule_event, p_accident::text, t, p_title, p_ev.created_at)
    from unnest(p_targets) t
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;

  if p_push then
    select coalesce(jsonb_agg(jsonb_build_object('user_id', t, 'push_token', tok, 'email', null)), '[]'::jsonb)
      into v_recipients
      from unnest(p_targets) t, lateral public._user_push_tokens(t) tok;
    select coalesce(jsonb_agg(t), '[]'::jsonb) into v_no_device
      from unnest(p_targets) t
     where not exists (select 1 from public._user_push_tokens(t));
    insert into public.workflow_notifications
      (event_id, organisation_id, instance_id, event_type, payload, recipient_count, status)
    values (
      -(p_ev.id * 16 + case when p_rule_event = p_ev.event_type then 1 else 2 end), v_org, null, p_ev.event_type,
      jsonb_build_object('event_type', p_ev.event_type, 'channel', 'accident',
        'entity_id', p_accident::text,
        'push', jsonb_build_object('title', p_title, 'body', p_body,
                  'data', jsonb_build_object('type', 'accident', 'entity_id', p_accident::text,
                                             'workstream_key', p_ev.payload ->> 'workstream_key')),
        'recipients', v_recipients, 'no_device', v_no_device,
        'reason', case when jsonb_array_length(v_recipients) = 0 then 'no_device' end),
      jsonb_array_length(v_recipients),
      case when jsonb_array_length(v_recipients) = 0 then 'skipped' else 'pending' end)
    on conflict (event_id) do nothing;
  end if;
  return v_n;
end;
$$;

create or replace function public.consume_event_accident_owner_notify(ev public.domain_events)
returns void language plpgsql security definer set search_path = public as $$
declare
  a public.accidents%rowtype;
  v_acc uuid;
  v_ws text := nullif(ev.payload ->> 'workstream_key', '');
  v_ws_name text;
  v_ref text;
  v_ctx text;
  v_title text;
  v_body text;
  v_type text := 'accident';
  v_push boolean;
  v_targets uuid[];
begin
  if ev.event_type not like 'accident.%' then return; end if;
  begin
    v_acc := case when ev.entity_type = 'accident' then ev.entity_id::uuid
                  else nullif(ev.payload ->> 'accident_id', '')::uuid end;
  exception when others then return;
  end;
  if v_acc is null then return; end if;
  select * into a from public.accidents where id = v_acc;
  if a.id is null then return; end if;
  if not public.accident_notify_configured(a.organisation_id, ev.event_type)
     and ev.event_type <> 'accident.stage_changed' then
    return;
  end if;

  -- the reported event already tells the step owners; skip the burst of
  -- "step assigned" events the case bootstrap fires in the same moment
  if ev.event_type = 'accident.workstream_assigned'
     and a.created_at > ev.created_at - interval '2 minutes' then
    return;
  end if;

  v_ref := coalesce(nullif(a.reference_no, ''), nullif(a.case_no, ''), 'Case');
  v_ctx := coalesce(nullif(a.asset_no, ''), 'Unknown asset')
           || coalesce(' at ' || nullif(a.site, ''), '');
  v_ws_name := case when v_ws is not null then public.accident_workstream_name(v_ws) end;

  if public.accident_notify_configured(a.organisation_id, ev.event_type) then
    case ev.event_type
      when 'accident.reported' then
        v_title := 'New accident ' || v_ref || ' (' || public.accident_severity_label(a.severity) || ')';
        v_body := v_ctx || ' | Your steps are waiting.';
        v_type := case when a.severity in ('severe','fatal') or coalesce(a.injuries, false) then 'warning' else 'accident' end;
      when 'accident.workstream_assigned' then
        v_title := 'You own a step - ' || v_ref;
        v_body := coalesce(v_ws_name, 'A step') || ' | ' || v_ctx;
      when 'accident.stage_changed' then
        v_title := 'Accident ' || v_ref || ' -> ' || public.accident_stage_label(a.workflow_stage);
        v_body := v_ctx || ' | Next: ' || public.accident_pending_action(a.workflow_stage);
      when 'accident.claim_changed' then
        v_title := 'Claim ' || coalesce(a.claim_status, 'updated') || ' - ' || v_ref;
        v_body := v_ctx;
      when 'accident.sla_warning' then
        v_title := 'Due soon: ' || coalesce(v_ws_name, 'a step') || ' - ' || v_ref;
        v_body := v_ctx || ' | Due ' || coalesce(to_char((ev.payload ->> 'due_at')::timestamptz, 'DD Mon HH24:MI'), 'soon');
        v_type := 'warning';
      when 'accident.sla_breach' then
        v_title := 'Overdue: ' || coalesce(v_ws_name, 'a step') || ' - ' || v_ref;
        v_body := v_ctx || ' | The target time has passed.';
        v_type := 'warning';
      when 'accident.stalled' then
        v_title := 'No progress - ' || v_ref;
        v_body := v_ctx || ' | Same step for ' || coalesce(ev.payload ->> 'days', '?') || ' days: '
                  || public.accident_stage_label(a.workflow_stage);
        v_type := 'warning';
      when 'accident.closure_requested' then
        v_title := 'Closure requested - ' || v_ref;
        v_body := v_ctx || ' | Waiting for a decision.';
      when 'accident.closure_decided' then
        v_title := 'Closure ' || coalesce(ev.payload ->> 'decision', 'decided') || ' - ' || v_ref;
        v_body := v_ctx;
        v_type := case when ev.payload ->> 'decision' = 'approved' then 'success' else 'accident' end;
      else
        v_title := 'Accident ' || v_ref;
        v_body := v_ctx;
    end case;

    v_targets := public._accident_notify_targets(a.id, ev.event_type, ev.payload, ev.actor_id);
    select bool_or(n.channel_push) into v_push from public.accident_notify_rules n
     where n.organisation_id = a.organisation_id and n.active and n.event_key = ev.event_type;
    perform public._accident_deliver(ev, ev.event_type, a.id, v_targets, v_type, v_title, v_body,
                                     coalesce(v_push, true));
  end if;

  -- C4: the driver who filed the report hears about their own case (read-only).
  if ev.event_type = 'accident.stage_changed'
     and public.accident_notify_configured(a.organisation_id, 'accident.driver_status') then
    v_targets := public._accident_notify_targets(a.id, 'accident.driver_status', ev.payload, ev.actor_id);
    select bool_or(n.channel_push) into v_push from public.accident_notify_rules n
     where n.organisation_id = a.organisation_id and n.active and n.event_key = 'accident.driver_status';
    perform public._accident_deliver(ev, 'accident.driver_status', a.id, v_targets, 'info',
      'Your accident report ' || v_ref || ' is now: ' || public.accident_stage_label(a.workflow_stage),
      v_ctx, coalesce(v_push, true));
  end if;
end;
$$;

revoke all on function public.accident_notify_dedupe_key(text,text,uuid,text,timestamptz) from public, anon;
revoke all on function public._accident_notify_targets(uuid,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public._accident_deliver(public.domain_events,text,uuid,uuid[],text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.consume_event_accident_owner_notify(public.domain_events) from public, anon, authenticated;

insert into public.event_consumers (consumer, event_types, enabled, description)
values ('consume_event_accident_owner_notify',
  array['accident.reported','accident.workstream_assigned','accident.stage_changed',
        'accident.claim_changed','accident.sla_warning','accident.sla_breach',
        'accident.stalled','accident.closure_requested','accident.closure_decided'],
  true,
  'Accident notifications from the owner''s settings (accident_notify_rules): step owners, roles, named people, the driver. In-app (deduped) + push always; e-mail stays with the older consumers.')
on conflict (consumer) do update set event_types = excluded.event_types, enabled = true,
  description = excluded.description;

-- ---------------------------------------------------------------------------
-- Older consumers: stand down for configured events, dedupe what they still send.
-- Anchored replace on the live definition; aborts if an anchor is not found once.
-- ---------------------------------------------------------------------------
do $patch$
declare
  v_def text;
  pairs text[][];
  i int;
begin
  -- consume_event_accident_notify
  v_def := pg_get_functiondef('public.consume_event_accident_notify(public.domain_events)'::regprocedure);
  pairs := array[
    array[E'  v_mail_recipients jsonb;\nBEGIN',
          E'  v_mail_recipients jsonb;\n  v_cfg boolean := false;\nBEGIN'],
    array[E'acc.country = ANY(p.country));\n',
          E'acc.country = ANY(p.country));\n  v_cfg := public.accident_notify_configured(acc.organisation_id, ev.event_type);\n  v_recipients := COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(v_recipients) x\n                             WHERE NOT public._accident_is_test_profile((x->>''user_id'')::uuid)), ''[]''::jsonb);\n'],
    array[E'  IF jsonb_array_length(v_recipients) > 0 THEN\n    INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)\n    SELECT DISTINCT (r->>''user_id'')::uuid, v_ntype, v_title, v_body, ''accident'', acc.id\n    FROM jsonb_array_elements(v_recipients) r;\n  END IF;',
          E'  IF NOT v_cfg AND jsonb_array_length(v_recipients) > 0 THEN\n    INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)\n    SELECT DISTINCT (r->>''user_id'')::uuid, v_ntype, v_title, v_body, ''accident'', acc.id,\n           public.accident_notify_dedupe_key(ev.event_type, acc.id::text, (r->>''user_id'')::uuid, v_title, ev.created_at)\n    FROM jsonb_array_elements(v_recipients) r\n    ON CONFLICT (dedupe_key) DO NOTHING;\n  END IF;'],
    array[E'WHERE NULLIF(x->>''push_token'','''') IS NOT NULL), ''[]''::jsonb)',
          E'WHERE NULLIF(x->>''push_token'','''') IS NOT NULL AND NOT v_cfg), ''[]''::jsonb)'],
    array[E'v_mail_recipients := v_recipients;',
          E'v_mail_recipients := CASE WHEN v_cfg THEN COALESCE((SELECT jsonb_agg(x - ''push_token'') FROM jsonb_array_elements(v_recipients) x), ''[]''::jsonb) ELSE v_recipients END;']
  ];
  for i in 1 .. array_length(pairs, 1) loop
    if (length(v_def) - length(replace(v_def, pairs[i][1], ''))) / length(pairs[i][1]) <> 1 then
      raise exception 'consume_event_accident_notify anchor % not found exactly once', i;
    end if;
    v_def := replace(v_def, pairs[i][1], pairs[i][2]);
  end loop;
  execute v_def;

  -- consume_event_accident_case_notify
  v_def := pg_get_functiondef('public.consume_event_accident_case_notify(public.domain_events)'::regprocedure);
  pairs := array[
    array[E'  IF array_length(v_targets, 1) IS NOT NULL THEN\n    INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)\n    SELECT t, v_ntype, v_title, v_body, ''accident'', v_accident\n      FROM unnest(v_targets) AS t;\n  END IF;',
          E'  IF array_length(v_targets, 1) IS NOT NULL\n     AND NOT public.accident_notify_configured(v_org, ev.event_type) THEN\n    INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)\n    SELECT t, v_ntype, v_title, v_body, ''accident'', v_accident,\n           public.accident_notify_dedupe_key(ev.event_type, v_accident::text, t, v_title, ev.created_at)\n      FROM unnest(v_targets) AS t\n     WHERE NOT public._accident_is_test_profile(t)\n    ON CONFLICT (dedupe_key) DO NOTHING;\n  END IF;']
  ];
  for i in 1 .. array_length(pairs, 1) loop
    if (length(v_def) - length(replace(v_def, pairs[i][1], ''))) / length(pairs[i][1]) <> 1 then
      raise exception 'consume_event_accident_case_notify anchor % not found exactly once', i;
    end if;
    v_def := replace(v_def, pairs[i][1], pairs[i][2]);
  end loop;
  execute v_def;
end
$patch$;

commit;
