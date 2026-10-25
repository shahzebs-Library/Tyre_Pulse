-- Due alerts: also send a phone push (same queue as approvals and accidents) to people who have a registered device.
-- Nobody has a token yet, so today this adds nothing; it starts working when phones register.

create or replace function public.scan_due_alerts()
returns jsonb language plpgsql security definer set search_path = public as $$
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
    pushed as (
      insert into workflow_notifications (event_id, event_type, payload, recipient_count, status)
      select gen_random_uuid(), 'due.alert',
             jsonb_build_object('event_type', 'due.alert', 'entity_type', r.rule_key,
               'push', jsonb_build_object('title', a.title, 'body', a.body),
               'recipients', t.recips),
             jsonb_array_length(t.recips), 'pending'
        from agg a
        cross join lateral (
          select coalesce(jsonb_agg(jsonb_build_object('user_id', a.uid, 'push_token', k.tok)), '[]'::jsonb) as recips
            from public._user_push_tokens(a.uid) k(tok)
        ) t
       where jsonb_array_length(t.recips) > 0
      returning 1
    )
    select (select count(*) from sent), (select count(*) from logged) into n, v_items;
    v_people := v_people + coalesce(n, 0);
  end loop;
  return jsonb_build_object('notifications', v_people);
end;
$$;
revoke all on function public.scan_due_alerts() from public, anon, authenticated;
