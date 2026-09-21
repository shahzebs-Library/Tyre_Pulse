-- Tenant-owned checklist governance. Defaults are conservative, industry-neutral
-- operating baselines; every value is editable per organisation. Existing
-- checklist wording and historical submissions remain untouched.

create table public.checklist_governance_policies (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  industry_profile text not null default 'general',
  timezone text not null default 'UTC',
  pilot_enabled boolean not null default false,
  pilot_country text,
  pilot_site text,
  pilot_start_date date,
  pilot_end_date date,
  supervisor_approval_sla_hours integer not null default 24
    check (supervisor_approval_sla_hours between 1 and 2160),
  area_manager_approval_sla_hours integer not null default 24
    check (area_manager_approval_sla_hours between 1 and 2160),
  corrective_critical_sla_hours integer not null default 24
    check (corrective_critical_sla_hours between 1 and 8760),
  corrective_high_sla_hours integer not null default 72
    check (corrective_high_sla_hours between 1 and 8760),
  corrective_medium_sla_hours integer not null default 168
    check (corrective_medium_sla_hours between 1 and 8760),
  corrective_low_sla_hours integer not null default 720
    check (corrective_low_sla_hours between 1 and 8760),
  evidence_enforcement text not null default 'monitor'
    check (evidence_enforcement in ('monitor','enforce')),
  exception_note_required boolean not null default true,
  exception_photo_required boolean not null default true,
  completion_signature_required boolean not null default true,
  gps_required boolean not null default false,
  submission_retention_months integer not null default 84
    check (submission_retention_months between 1 and 1200),
  evidence_retention_months integer not null default 84
    check (evidence_retention_months between 1 and 1200),
  audit_retention_months integer not null default 84
    check (audit_retention_months between 1 and 1200),
  retention_disposition text not null default 'review_then_archive'
    check (retention_disposition in ('review_then_archive','review_then_delete','retain')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (not pilot_enabled)
    or (pilot_site is not null and btrim(pilot_site) <> '' and pilot_start_date is not null)
  ),
  check (pilot_end_date is null or pilot_start_date is null or pilot_end_date >= pilot_start_date)
);

alter table public.checklist_governance_policies enable row level security;
revoke all on public.checklist_governance_policies from public, anon;
grant select on public.checklist_governance_policies to authenticated;

create policy checklist_governance_read
  on public.checklist_governance_policies for select to authenticated
  using (organisation_id is not distinct from (select public.app_current_org()));

-- Writes go through the validated RPC below. Direct client writes stay closed.

create or replace function public.checklist_governance_defaults()
returns jsonb
language sql immutable
set search_path = ''
as $fn$
  select jsonb_build_object(
    'industry_profile','general','timezone','UTC',
    'pilot_enabled',false,'pilot_country',null,'pilot_site',null,
    'pilot_start_date',null,'pilot_end_date',null,
    'supervisor_approval_sla_hours',24,'area_manager_approval_sla_hours',24,
    'corrective_critical_sla_hours',24,'corrective_high_sla_hours',72,
    'corrective_medium_sla_hours',168,'corrective_low_sla_hours',720,
    'evidence_enforcement','monitor','exception_note_required',true,
    'exception_photo_required',true,'completion_signature_required',true,
    'gps_required',false,'submission_retention_months',84,
    'evidence_retention_months',84,'audit_retention_months',84,
    'retention_disposition','review_then_archive'
  );
$fn$;

create or replace function public.get_checklist_governance_policy()
returns jsonb
language sql stable security invoker
set search_path = ''
as $fn$
  select public.checklist_governance_defaults() || coalesce(
    (select to_jsonb(p) - array['created_by','updated_by']
       from public.checklist_governance_policies p
      where p.organisation_id is not distinct from public.app_current_org()),
    '{}'::jsonb
  );
$fn$;

create or replace function public.save_checklist_governance_policy(p_policy jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_role text := public.get_my_role();
  v jsonb := public.checklist_governance_defaults() || coalesce(p_policy, '{}'::jsonb);
  v_row public.checklist_governance_policies;
begin
  if auth.uid() is null or v_org is null then
    raise exception 'An authenticated organisation is required' using errcode = '42501';
  end if;
  if not public.is_super_admin() and v_role <> all(array[
    'Admin','Director','PMV Manager','Workshop Area Manager',
    'Workshop Maintenance Area Manager'
  ]) then
    raise exception 'Checklist governance requires an authorised manager' using errcode = '42501';
  end if;

  insert into public.checklist_governance_policies as p (
    organisation_id, industry_profile, timezone,
    pilot_enabled, pilot_country, pilot_site, pilot_start_date, pilot_end_date,
    supervisor_approval_sla_hours, area_manager_approval_sla_hours,
    corrective_critical_sla_hours, corrective_high_sla_hours,
    corrective_medium_sla_hours, corrective_low_sla_hours,
    evidence_enforcement, exception_note_required, exception_photo_required,
    completion_signature_required, gps_required,
    submission_retention_months, evidence_retention_months, audit_retention_months,
    retention_disposition, created_by, updated_by
  ) values (
    v_org, coalesce(nullif(btrim(v->>'industry_profile'),''),'general'), coalesce(nullif(btrim(v->>'timezone'),''),'UTC'),
    coalesce((v->>'pilot_enabled')::boolean,false), nullif(btrim(v->>'pilot_country'),''),
    nullif(btrim(v->>'pilot_site'),''), (v->>'pilot_start_date')::date,
    (v->>'pilot_end_date')::date,
    (v->>'supervisor_approval_sla_hours')::integer,
    (v->>'area_manager_approval_sla_hours')::integer,
    (v->>'corrective_critical_sla_hours')::integer,
    (v->>'corrective_high_sla_hours')::integer,
    (v->>'corrective_medium_sla_hours')::integer,
    (v->>'corrective_low_sla_hours')::integer,
    v->>'evidence_enforcement', (v->>'exception_note_required')::boolean,
    (v->>'exception_photo_required')::boolean,
    (v->>'completion_signature_required')::boolean, (v->>'gps_required')::boolean,
    (v->>'submission_retention_months')::integer,
    (v->>'evidence_retention_months')::integer,
    (v->>'audit_retention_months')::integer, v->>'retention_disposition',
    auth.uid(), auth.uid()
  )
  on conflict (organisation_id) do update set
    industry_profile=excluded.industry_profile, timezone=excluded.timezone,
    pilot_enabled=excluded.pilot_enabled, pilot_country=excluded.pilot_country,
    pilot_site=excluded.pilot_site, pilot_start_date=excluded.pilot_start_date,
    pilot_end_date=excluded.pilot_end_date,
    supervisor_approval_sla_hours=excluded.supervisor_approval_sla_hours,
    area_manager_approval_sla_hours=excluded.area_manager_approval_sla_hours,
    corrective_critical_sla_hours=excluded.corrective_critical_sla_hours,
    corrective_high_sla_hours=excluded.corrective_high_sla_hours,
    corrective_medium_sla_hours=excluded.corrective_medium_sla_hours,
    corrective_low_sla_hours=excluded.corrective_low_sla_hours,
    evidence_enforcement=excluded.evidence_enforcement,
    exception_note_required=excluded.exception_note_required,
    exception_photo_required=excluded.exception_photo_required,
    completion_signature_required=excluded.completion_signature_required,
    gps_required=excluded.gps_required,
    submission_retention_months=excluded.submission_retention_months,
    evidence_retention_months=excluded.evidence_retention_months,
    audit_retention_months=excluded.audit_retention_months,
    retention_disposition=excluded.retention_disposition,
    updated_by=auth.uid(), updated_at=now()
  returning p.* into v_row;
  return to_jsonb(v_row) - array['created_by','updated_by'];
end;
$fn$;

revoke all on function public.checklist_governance_defaults() from public, anon;
revoke all on function public.get_checklist_governance_policy() from public, anon;
revoke all on function public.save_checklist_governance_policy(jsonb) from public, anon;
grant execute on function public.get_checklist_governance_policy() to authenticated;
grant execute on function public.save_checklist_governance_policy(jsonb) to authenticated;
grant execute on function public.checklist_governance_defaults() to authenticated;

-- Schedules must identify a real operational scope. Existing production has no
-- schedules, so this closes the unsafe "All" target before rollout begins.
alter table public.checklist_schedules
  add column pilot boolean not null default false,
  add column end_date date,
  add constraint checklist_schedule_has_scope
    check (coalesce(cardinality(sites),0) > 0 or coalesce(cardinality(asset_nos),0) > 0),
  add constraint checklist_schedule_end_after_start
    check (end_date is null or end_date >= start_date);

-- No schedule may silently run outside the configured pilot boundary.
create or replace function public.guard_checklist_schedule_governance()
returns trigger
language plpgsql security definer
set search_path = ''
as $fn$
declare p public.checklist_governance_policies;
begin
  if new.end_date is not null and new.next_due > new.end_date then
    new.active := false;
  end if;
  select * into p from public.checklist_governance_policies
   where organisation_id is not distinct from new.organisation_id;
  if new.pilot then
    if p.organisation_id is null or not p.pilot_enabled then
      raise exception 'Enable and configure the checklist pilot before creating a pilot schedule'
        using errcode='22023';
    end if;
    if p.pilot_country is not null and lower(coalesce(new.country,'')) <> lower(p.pilot_country) then
      raise exception 'Pilot schedule country must match the governance policy' using errcode='22023';
    end if;
    if not (p.pilot_site = any(new.sites)) then
      raise exception 'Pilot schedule must include the configured pilot site' using errcode='22023';
    end if;
    if new.start_date < p.pilot_start_date
       or (p.pilot_end_date is not null and coalesce(new.end_date,new.start_date) > p.pilot_end_date) then
      raise exception 'Pilot schedule dates must stay inside the configured pilot window' using errcode='22023';
    end if;
  end if;
  return new;
end;
$fn$;

create trigger trg_guard_checklist_schedule_governance
before insert or update on public.checklist_schedules
for each row execute function public.guard_checklist_schedule_governance();

-- Retention is review-driven. Records are never automatically deleted, and a
-- legal hold is explicit and auditable on the source submission.
alter table public.checklist_submissions
  add column retention_hold boolean not null default false,
  add column retention_hold_reason text,
  add column retention_hold_at timestamptz,
  add column retention_hold_by uuid references auth.users(id) on delete set null,
  add column gps_latitude numeric,
  add column gps_longitude numeric,
  add column evidence_policy_status text not null default 'legacy_unassessed'
    check (evidence_policy_status in ('legacy_unassessed','compliant','gaps')),
  add column evidence_policy_gaps jsonb not null default '{}'::jsonb;

create or replace function public.evaluate_checklist_submission_evidence()
returns trigger
language plpgsql security definer
set search_path = ''
as $fn$
declare
  v jsonb;
  exception_keys text[];
  missing_notes integer := 0;
  missing_photos integer := 0;
  gaps jsonb := '{}'::jsonb;
begin
  select public.checklist_governance_defaults() || coalesce(to_jsonb(p),'{}'::jsonb)
    into v from public.checklist_governance_policies p
   where p.organisation_id is not distinct from new.organisation_id;
  v := coalesce(v, public.checklist_governance_defaults());

  select coalesce(array_agg(a.key),'{}'::text[]) into exception_keys
  from jsonb_each_text(coalesce(new.answers,'{}'::jsonb)) a
  where lower(btrim(a.value)) = any(array[
    'no','fail','failed','defect','defective','unsafe','not ok','not_ok','non-compliant','noncompliant'
  ]);

  if (v->>'exception_note_required')::boolean then
    select count(*) into missing_notes from unnest(exception_keys) k
     where nullif(btrim(coalesce(new.notes->>k,'')),'') is null;
    if missing_notes > 0 then gaps := gaps || jsonb_build_object('exception_notes_missing',missing_notes); end if;
  end if;
  if (v->>'exception_photo_required')::boolean then
    select count(*) into missing_photos from unnest(exception_keys) k
     where not coalesce(new.photos,'{}'::jsonb) ? k
        or coalesce(new.photos->k,'null'::jsonb) in ('null'::jsonb,'[]'::jsonb,'{}'::jsonb,'""'::jsonb);
    if missing_photos > 0 then gaps := gaps || jsonb_build_object('exception_photos_missing',missing_photos); end if;
  end if;
  if (v->>'completion_signature_required')::boolean
     and nullif(btrim(coalesce(new.signature_data,'')),'') is null then
    gaps := gaps || jsonb_build_object('completion_signature_missing',true);
  end if;
  if (v->>'gps_required')::boolean
     and (new.gps_latitude is null or new.gps_longitude is null) then
    gaps := gaps || jsonb_build_object('gps_missing',true);
  end if;

  new.evidence_policy_gaps := gaps;
  new.evidence_policy_status := case when gaps='{}'::jsonb then 'compliant' else 'gaps' end;
  if gaps <> '{}'::jsonb and v->>'evidence_enforcement'='enforce' then
    raise exception 'Checklist evidence policy is not satisfied: %', gaps using errcode='22023';
  end if;
  return new;
end;
$fn$;

create trigger trg_evaluate_checklist_submission_evidence
before insert or update of answers,photos,notes,signature_data,gps_latitude,gps_longitude
on public.checklist_submissions
for each row execute function public.evaluate_checklist_submission_evidence();

create or replace function public.checklist_evidence_policy_monitor(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  evidence_policy_status text,
  submission_count bigint,
  exception_notes_missing bigint,
  exception_photos_missing bigint,
  completion_signatures_missing bigint,
  gps_missing bigint
)
language sql stable security invoker
set search_path = ''
as $fn$
  select s.evidence_policy_status, count(*),
    coalesce(sum((s.evidence_policy_gaps->>'exception_notes_missing')::bigint),0),
    coalesce(sum((s.evidence_policy_gaps->>'exception_photos_missing')::bigint),0),
    count(*) filter (where s.evidence_policy_gaps ? 'completion_signature_missing'),
    count(*) filter (where s.evidence_policy_gaps ? 'gps_missing')
  from public.checklist_submissions s
  where (p_from is null or s.created_at >= p_from)
    and (p_to is null or s.created_at < p_to)
  group by s.evidence_policy_status
  order by s.evidence_policy_status;
$fn$;
revoke all on function public.checklist_evidence_policy_monitor(timestamptz,timestamptz) from public, anon;
grant execute on function public.checklist_evidence_policy_monitor(timestamptz,timestamptz) to authenticated;

create or replace function public.checklist_retention_monitor()
returns table (
  submission_review_due bigint,
  evidence_review_due bigint,
  held_records bigint,
  submission_retention_months integer,
  evidence_retention_months integer,
  disposition text
)
language sql stable security invoker
set search_path = ''
as $fn$
  with p as (select public.get_checklist_governance_policy() v)
  select
    count(*) filter (where not s.retention_hold and s.created_at < now() - make_interval(months => (p.v->>'submission_retention_months')::integer)),
    count(*) filter (where not s.retention_hold and s.photos <> '{}'::jsonb and s.created_at < now() - make_interval(months => (p.v->>'evidence_retention_months')::integer)),
    count(*) filter (where s.retention_hold),
    (p.v->>'submission_retention_months')::integer,
    (p.v->>'evidence_retention_months')::integer,
    p.v->>'retention_disposition'
  from public.checklist_submissions s cross join p
  group by p.v;
$fn$;
revoke all on function public.checklist_retention_monitor() from public, anon;
grant execute on function public.checklist_retention_monitor() to authenticated;

-- Missing corrective-action due dates get a severity-based tenant SLA. An
-- explicitly supplied due date always wins.
create or replace function public.default_corrective_action_due_date()
returns trigger
language plpgsql security definer
set search_path = ''
as $fn$
declare
  v jsonb;
  h integer;
begin
  if new.due_date is not null then return new; end if;
  select public.checklist_governance_defaults() || coalesce(to_jsonb(p),'{}'::jsonb)
    into v from public.checklist_governance_policies p
   where p.organisation_id is not distinct from new.organisation_id;
  v := coalesce(v, public.checklist_governance_defaults());
  h := case lower(coalesce(new.priority,'medium'))
    when 'critical' then (v->>'corrective_critical_sla_hours')::integer
    when 'urgent' then (v->>'corrective_critical_sla_hours')::integer
    when 'high' then (v->>'corrective_high_sla_hours')::integer
    when 'low' then (v->>'corrective_low_sla_hours')::integer
    else (v->>'corrective_medium_sla_hours')::integer end;
  new.due_date := (coalesce(new.created_at,now()) + make_interval(hours => h))::date;
  return new;
end;
$fn$;
create trigger trg_default_corrective_action_due_date
before insert on public.corrective_actions
for each row execute function public.default_corrective_action_due_date();

-- SLA-aware approval monitor. The original age RPC remains backward compatible.
create or replace function public.checklist_approval_sla_monitor(
  p_country text default null,
  p_template_id uuid default null
)
returns table (
  template_id uuid, template_name text, country text, site text,
  approval_stage text, pending_count bigint, oldest_pending_at timestamptz,
  oldest_age_hours numeric, average_age_hours numeric,
  target_hours integer, breached_count bigint, oldest_breached boolean
)
language sql stable security invoker
set search_path = ''
as $fn$
  with policy as (select public.get_checklist_governance_policy() v),
  pending as (
    select s.template_id, coalesce(s.template_name,t.name,'Unknown template') template_name,
      s.country, coalesce(nullif(btrim(s.site),''),'Unassigned') site,
      case when s.approval_status='pending_area_manager' then 'area_manager' else 'supervisor' end approval_stage,
      case when s.approval_status='pending_area_manager' then coalesce(s.supervisor_at,s.submitted_at,s.created_at)
           else coalesce(s.submitted_at,s.created_at) end pending_at,
      case when s.approval_status='pending_area_manager'
        then (policy.v->>'area_manager_approval_sla_hours')::integer
        else (policy.v->>'supervisor_approval_sla_hours')::integer end target_hours
    from public.checklist_submissions s
    left join public.checklist_templates t on t.id=s.template_id
    cross join policy
    where s.approval_status in ('pending','pending_area_manager')
      and (p_country is null or lower(s.country)=lower(p_country))
      and (p_template_id is null or s.template_id=p_template_id)
  )
  select p.template_id,p.template_name,p.country,p.site,p.approval_stage,count(*),min(p.pending_at),
    round(extract(epoch from (now()-min(p.pending_at)))/3600.0,1),
    round(avg(extract(epoch from (now()-p.pending_at)))/3600.0,1),max(p.target_hours),
    count(*) filter (where now() > p.pending_at + make_interval(hours=>p.target_hours)),
    now() > min(p.pending_at) + make_interval(hours=>max(p.target_hours))
  from pending p where p.pending_at is not null
  group by p.template_id,p.template_name,p.country,p.site,p.approval_stage
  order by 12 desc, 8 desc;
$fn$;
revoke all on function public.checklist_approval_sla_monitor(text,uuid) from public, anon;
grant execute on function public.checklist_approval_sla_monitor(text,uuid) to authenticated;

revoke all on function public.guard_checklist_schedule_governance() from public, anon, authenticated;
revoke all on function public.default_corrective_action_due_date() from public, anon, authenticated;
revoke all on function public.evaluate_checklist_submission_evidence() from public, anon, authenticated;

comment on table public.checklist_governance_policies is
  'Tenant-configurable checklist pilot, SLA, evidence and retention policy.';
comment on function public.checklist_retention_monitor() is
  'Review queue only. Never deletes business records or evidence automatically.';
