-- Due alerts: one scheduled engine that tells the right people, by role, site and country, when
-- something is due or overdue. Replaces "only shown on a screen" for maintenance, inspection plans,
-- stock, certifications, insurance policies and vehicle documents.
--
-- Recipient roles list only roles whose web route can open the target page (pm-programs and insurance-policies are
-- Admin-only routes; certifications is Admin/Manager/Director). Widen a rule's roles together with its route.
--
-- Design
--  * due_alert_rules   : one row per alert (module, lead days, recipient roles, on/off). Editable by Admin.
--  * due_alert_notices : what was already sent, so nobody is told twice for the same item and stage.
--  * _due_items()      : the only place that knows where each alert's data lives (fixed list, no dynamic SQL).
--  * scan_due_alerts() : cron entry point. One digest notification per person per rule per stage.
-- Recipients must be approved, unlocked, in the item's organisation, hold one of the rule's roles, and be
-- allowed to see the item's country and site (same rules as app_can_see_country / app_can_see_site).
-- Rollback: select cron.unschedule('due-alerts-scan'); drop function scan_due_alerts, _due_items; drop table due_alert_notices, due_alert_rules;

create table if not exists public.due_alert_rules (
  rule_key        text primary key,
  label           text not null,
  module_key      text not null,
  severity        text not null default 'warning' check (severity in ('info','warning','critical')),
  lead_days       integer not null default 7 check (lead_days between 0 and 365),
  lookback_days   integer check (lookback_days is null or lookback_days between 1 and 3650),
  recipient_roles text[] not null default '{}',
  enabled         boolean not null default true,
  updated_at      timestamptz not null default now()
);
comment on column public.due_alert_rules.lookback_days is
  'Overdue items older than this many days are not announced (stops an old backlog flooding people). NULL = always.';

create table if not exists public.due_alert_notices (
  rule_key   text not null,
  entity_key text not null,
  stage      text not null,
  user_id    uuid not null,
  sent_at    timestamptz not null default now(),
  primary key (rule_key, entity_key, stage, user_id)
);
create index if not exists due_alert_notices_sent_idx on public.due_alert_notices (sent_at);

alter table public.due_alert_rules enable row level security;
alter table public.due_alert_notices enable row level security;

create policy due_alert_rules_read on public.due_alert_rules for select to authenticated using (true);
create policy due_alert_rules_write on public.due_alert_rules for all to authenticated
  using ((select public.is_super_admin()) or (select public.get_my_role()) = 'Admin')
  with check ((select public.is_super_admin()) or (select public.get_my_role()) = 'Admin');
revoke all on public.due_alert_notices from anon, authenticated;
revoke all on public.due_alert_rules from anon;

insert into public.due_alert_rules (rule_key, label, module_key, severity, lead_days, lookback_days, recipient_roles) values
 ('pm_due',                 'Maintenance',                 'pm_programs',      'warning',  7, null,
   array['Admin']),
 ('inspection_plan_overdue','Inspection plan',             'inspection_planner','warning', 0, 30,
   array['Admin','Manager','Director','Inspector','PMV Manager','Workshop Maintenance Area Manager','Fleet Supervisor']),
 ('stock_low',              'Tyre stock',                  'stock',            'critical', 0, null,
   array['Admin','Manager','Director','Store Keeper','Tire Planning Engineer','Fleet Supervisor']),
 ('certification_expiry',   'Certification expiry',        'certifications',   'warning', 30, 30,
   array['Admin','Manager','Director']),
 ('insurance_policy_expiry','Insurance policy expiry',     'insurance_policies','critical',30, 30,
   array['Admin']),
 ('fleet_document_expiry',  'Vehicle document expiry',     'fleet_master',     'warning', 30, 30,
   array['Admin','Manager','Director','Fleet Supervisor','Insurance Officer'])
on conflict (rule_key) do nothing;

-- The one list of where each alert's data lives. Stage decides the wording and the de-duplication:
-- due_soon / overdue are sent once per item; low / critical stock repeats weekly while it stays low.
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
    sent as (
      insert into notifications (user_id, type, title, body, entity_type)
      select uid,
             'due_' || r.rule_key,
             r.label || case when stage like 'overdue%' then ' overdue'
                             when stage like 'critical%' then ' critical'
                             when stage like 'low%' then ' running low'
                             else ' due soon' end
               || ' (' || count(*) || ')',
             (array_to_string((array_agg(label order by label))[1:5], ', ')
               || case when count(*) > 5 then ' and ' || (count(*) - 5) || ' more' else '' end),
             r.rule_key
        from pairs
       group by uid, stage
      returning 1
    )
    select (select count(*) from sent), (select count(*) from logged) into n, v_items;
    v_people := v_people + coalesce(n, 0);
  end loop;
  return jsonb_build_object('notifications', v_people);
end;
$$;
revoke all on function public.scan_due_alerts() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'due-alerts-scan') then
    perform cron.schedule('due-alerts-scan', '40 * * * *', 'select public.scan_due_alerts()');
  end if;
end $$;
