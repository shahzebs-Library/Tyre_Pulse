-- Queue age is measured from recorded events. SLA thresholds remain an
-- operations decision and are deliberately not embedded here.
create or replace function public.checklist_approval_age_monitor(
  p_country text default null,
  p_template_id uuid default null
)
returns table (
  template_id uuid,
  template_name text,
  country text,
  site text,
  approval_stage text,
  pending_count bigint,
  oldest_pending_at timestamptz,
  oldest_age_hours numeric,
  average_age_hours numeric
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  with pending as (
    select
      s.template_id,
      coalesce(s.template_name, t.name, 'Unknown template') as template_name,
      s.country,
      coalesce(nullif(btrim(s.site), ''), 'Unassigned') as site,
      case s.approval_status
        when 'pending_area_manager' then 'area_manager'
        else 'supervisor'
      end as approval_stage,
      case s.approval_status
        when 'pending_area_manager' then coalesce(s.supervisor_at, s.submitted_at, s.created_at)
        else coalesce(s.submitted_at, s.created_at)
      end as pending_at
    from public.checklist_submissions s
    left join public.checklist_templates t on t.id = s.template_id
    where s.approval_status in ('pending', 'pending_area_manager')
      and (p_country is null or lower(s.country) = lower(p_country))
      and (p_template_id is null or s.template_id = p_template_id)
  )
  select
    p.template_id,
    p.template_name,
    p.country,
    p.site,
    p.approval_stage,
    count(*) as pending_count,
    min(p.pending_at) as oldest_pending_at,
    round(extract(epoch from (now() - min(p.pending_at))) / 3600.0, 1) as oldest_age_hours,
    round(avg(extract(epoch from (now() - p.pending_at))) / 3600.0, 1) as average_age_hours
  from pending p
  where p.pending_at is not null
  group by p.template_id, p.template_name, p.country, p.site, p.approval_stage
  order by oldest_age_hours desc, p.template_name, p.site;
$fn$;

revoke all on function public.checklist_approval_age_monitor(text,uuid)
  from public, anon;
grant execute on function public.checklist_approval_age_monitor(text,uuid)
  to authenticated;

comment on function public.checklist_approval_age_monitor(text,uuid) is
  'Pending checklist approval age by template, site and current stage. No SLA threshold is assumed.';
