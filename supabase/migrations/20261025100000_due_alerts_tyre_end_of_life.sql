-- Tyre end of life alert: the Running and Remaining calculation already knows which tyres are past
-- or near the end of their expected life, but nobody was told. This adds the rule and its data source.
-- Reads get_tyre_running_life (due tyres only) once per scan; the cron user bypasses RLS, so each row is
-- tied to its organisation through the fleet register and the scan's recipient checks still apply.
-- Rollback: delete the rule row; re-apply 20261025090000 to restore _due_items.

insert into public.due_alert_rules (rule_key, label, module_key, severity, lead_days, lookback_days, recipient_roles)
values ('tyre_end_of_life', 'Tyre end of life', 'tyre_records', 'warning', 0, null,
        array['Admin','Manager','Director','Tire Planning Engineer','Fleet Supervisor'])
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
