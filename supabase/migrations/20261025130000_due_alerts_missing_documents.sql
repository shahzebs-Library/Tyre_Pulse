-- Vehicle documents with no dates recorded: the expiry alert cannot fire for a vehicle that has no dates, so this
-- rule tells the fleet team once a month which active vehicles have none of insurance, MVPI or operating card dates.
-- Rollback: delete the rule row; re-apply 20261025100000 and 20261025120000.

insert into public.due_alert_rules (rule_key, label, module_key, severity, lead_days, lookback_days, recipient_roles)
values ('fleet_document_missing', 'Vehicle document dates', 'fleet_master', 'info', 0, null,
        array['Admin','Manager','Director','Fleet Supervisor'])
on conflict (rule_key) do nothing;

create or replace function public._due_items(p_rule text, p_lead integer, p_lookback integer)
returns table (entity_key text, org uuid, country text, site text, label text, stage text)
language sql stable security definer set search_path = public as $$
  select id::text, organisation_id, country, site,
         trim(coalesce(asset_no || ' ', '') || coalesce(name, 'Maintenance plan')),
         case when next_due < current_date then 'overdue' else 'due_soon' end
    from pm_programs
   where p_rule = 'pm_due' and lower(coalesce(status, '')) = 'active'
     and next_due is not null and next_due <= current_date + p_lead
     and (p_lookback is null or next_due >= current_date - p_lookback)
  union all
  select id::text, organisation_id, country, site,
         coalesce(asset_no, 'Asset') || ' planned ' || to_char(scheduled_date, 'DD Mon YYYY'),
         'overdue'
    from inspection_schedules
   where p_rule = 'inspection_plan_overdue' and status = 'Scheduled'
     and completed_inspection_id is null
     and scheduled_date + coalesce(grace_days, 2) < current_date
     and (p_lookback is null or scheduled_date >= current_date - p_lookback)
  union all
  select id::text, organisation_id, country, site,
         coalesce(description, 'Stock item') || ' (' || stock_qty || ' left)',
         case when critical_level is not null and stock_qty <= critical_level then 'critical:' else 'low:' end
           || to_char(current_date, 'IYYY-IW')
    from stock_records
   where p_rule = 'stock_low' and min_level is not null and stock_qty is not null and stock_qty <= min_level
  union all
  select id::text, organisation_id, country, site,
         trim(coalesce(subject_name, '') || ' ' || coalesce(cert_type, 'certificate')),
         case when expiry_date < current_date then 'overdue' else 'due_soon' end
    from certifications
   where p_rule = 'certification_expiry' and expiry_date is not null
     and lower(coalesce(status, '')) <> 'revoked'
     and expiry_date <= current_date + greatest(p_lead, coalesce(reminder_days, 0))
     and (p_lookback is null or expiry_date >= current_date - p_lookback)
  union all
  select id::text, organisation_id, country, null::text,
         coalesce(policy_type, 'Policy') || ' ' || coalesce(policy_no, ''),
         case when period_to < current_date then 'overdue' else 'due_soon' end
    from insurance_policies
   where p_rule = 'insurance_policy_expiry' and period_to is not null
     and period_to <= current_date + p_lead
     and (p_lookback is null or period_to >= current_date - p_lookback)
  union all
  select d.id::text || ':' || d.doc, d.organisation_id, d.country, d.site,
         d.asset_no || ' ' || d.doc,
         case when d.expiry < current_date then 'overdue' else 'due_soon' end
    from (
      select id, organisation_id, country, site, asset_no, 'insurance' doc, insurance_expiry expiry from vehicle_fleet
      union all select id, organisation_id, country, site, asset_no, 'MVPI inspection', mvip_expiry from vehicle_fleet
      union all select id, organisation_id, country, site, asset_no, 'operating card', operating_card_expiry from vehicle_fleet
      union all select id, organisation_id, country, site, asset_no, 'driver licence', driver_licence_expiry from vehicle_fleet
    ) d
   where p_rule = 'fleet_document_expiry' and d.expiry is not null
     and d.expiry <= current_date + p_lead
     and (p_lookback is null or d.expiry >= current_date - p_lookback)
  union all
  select id::text, organisation_id, country, site,
         asset_no || ' has no insurance, MVPI or operating card date',
         'missing:' || to_char(current_date, 'IYYY-MM')
    from vehicle_fleet
   where p_rule = 'fleet_document_missing' and lower(coalesce(status, '')) = 'active'
     and insurance_expiry is null and mvip_expiry is null and operating_card_expiry is null
  union all
  select coalesce(r->>'serial_no', '?') || ':' || (r->>'asset_no') || ':' || coalesce(r->>'position', ''),
         f.organisation_id, r->>'country', r->>'site',
         (r->>'asset_no') || ' ' || coalesce(r->>'position', '') || ' ' || coalesce(r->>'serial_no', '')
           || ' (' || coalesce(r->>'life_used_pct', '?') || '% used)',
         case when coalesce((r->>'remaining_km')::numeric, 1) <= 0
                or coalesce((r->>'remaining_hours')::numeric, 1) <= 0 then 'overdue' else 'due_soon' end
    from jsonb_array_elements(
           case when p_rule = 'tyre_end_of_life'
                then coalesce(public.get_tyre_running_life(null, null, 0, null, true)->'rows', '[]'::jsonb)
                else '[]'::jsonb end) r
    left join lateral (select organisation_id from vehicle_fleet v
                        where v.asset_no = r->>'asset_no' and v.country = r->>'country' limit 1) f on true
$$;
revoke all on function public._due_items(text, integer, integer) from public, anon, authenticated;

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
