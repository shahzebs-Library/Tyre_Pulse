-- Due alerts: the hourly scan has failed on every run since 2026-10-25.
--
-- STATUS: APPLIED LIVE 2026-11-08 (project jhssdmeruxtrlqnwfksc).
--
-- Cause: the push step (20261025120000, repeated in 130000) inserted
-- gen_random_uuid() into workflow_notifications.event_id, which is BIGINT and
-- UNIQUE. Postgres rejects the type at plan time, so the WHOLE statement
-- failed: no in-app notice, no push, and no due_alert_notices row (so nothing
-- was lost; the backlog is delivered on the first good run, once per person,
-- rule and stage, as designed).
--
-- Fix: mint one processed domain_events row per push (the same pattern the
-- workshop-status and broadcast senders use) and use its id as event_id.
-- Everything else in scan_due_alerts() is unchanged.
--
-- VERIFY: select public.scan_due_alerts(); returns {"notifications": n};
-- cron job 'due-alerts-scan' shows status succeeded on its next run.
-- ROLLBACK: re-apply the body from 20261025130000 (it will fail again).

CREATE OR REPLACE FUNCTION public.scan_due_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_people integer := 0;
  v_items integer := 0;
  n integer;
begin
  for r in select * from due_alert_rules where enabled and cardinality(recipient_roles) > 0 loop
    with items as (
      select * from _due_items(r.rule_key, r.lead_days, r.lookback_days)
    ),
    pairs as (
      select i.entity_key, i.label, i.stage, p.id as uid
        from items i
        join profiles p
          on p.approved and not coalesce(p.locked, false)
         and p.role = any (r.recipient_roles)
         and (i.org is null or p.org_id = i.org or p.organisation_id = i.org)
         and (p.is_super_admin or p.role = 'Admin'
              or i.country is null
              or exists (select 1 from unnest(coalesce(p.country, '{}')) c
                          where lower(btrim(c)) in ('all', lower(btrim(i.country)))))
         and (p.is_super_admin or p.role = 'Admin'
              or i.site is null or btrim(i.site) = ''
              or exists (select 1 from unnest(coalesce(p.sites, '{}')) s
                          where upper(btrim(s)) in ('ALL', '*', upper(btrim(i.site)))))
       where not exists (select 1 from due_alert_notices x
                          where x.rule_key = r.rule_key and x.entity_key = i.entity_key
                            and x.stage = i.stage and x.user_id = p.id)
    ),
    logged as (
      insert into due_alert_notices (rule_key, entity_key, stage, user_id)
      select r.rule_key, entity_key, stage, uid from pairs
      on conflict do nothing
      returning 1
    ),
    agg as (
      select uid, stage,
             r.label || case when stage like 'overdue%' then ' overdue'
                             when stage like 'critical%' then ' critical'
                             when stage like 'low%' then ' running low'
                             when stage like 'missing%' then ' not recorded'
                             else ' due soon' end
               || ' (' || count(*) || ')' as title,
             (array_to_string((array_agg(label order by label))[1:5], ', ')
               || case when count(*) > 5 then ' and ' || (count(*) - 5) || ' more' else '' end) as body
        from pairs
       group by uid, stage
    ),
    sent as (
      insert into notifications (user_id, type, title, body, entity_type)
      select uid, 'due_' || r.rule_key, title, body, r.rule_key from agg
      returning 1
    ),
    tokens as (
      select a.uid, a.title, a.body, t.recips,
             (select coalesce(p.org_id, p.organisation_id) from profiles p where p.id = a.uid) as org
        from agg a
        cross join lateral (
          select coalesce(jsonb_agg(jsonb_build_object('user_id', a.uid, 'push_token', k.tok)), '[]'::jsonb) as recips
            from public._user_push_tokens(a.uid) k(tok)
        ) t
       where jsonb_array_length(t.recips) > 0
    ),
    ev as (
      -- One processed event per push: workflow_notifications.event_id is a
      -- unique BIGINT pointing at domain_events, never a uuid.
      insert into domain_events (event_type, entity_type, entity_id, organisation_id, payload, status, processed_at)
      select 'due.alert', r.rule_key, tk.uid::text, tk.org,
             jsonb_build_object('event_type', 'due.alert', 'entity_type', r.rule_key,
               'push', jsonb_build_object('title', tk.title, 'body', tk.body),
               'recipients', tk.recips),
             'processed', clock_timestamp()
        from tokens tk
      returning id, organisation_id, payload
    ),
    pushed as (
      insert into workflow_notifications (event_id, organisation_id, event_type, payload, recipient_count, status)
      select e.id, e.organisation_id, 'due.alert', e.payload, jsonb_array_length(e.payload->'recipients'), 'pending'
        from ev e
      returning 1
    )
    select (select count(*) from sent), (select count(*) from logged) into n, v_items;
    v_people := v_people + coalesce(n, 0);
  end loop;
  return jsonb_build_object('notifications', v_people);
end;
$function$;
