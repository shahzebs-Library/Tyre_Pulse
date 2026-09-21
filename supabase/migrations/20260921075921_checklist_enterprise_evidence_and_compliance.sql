-- Enterprise checklist evidence and compliance foundation.
--
-- 1. Preserve the exact published template revision used by every new
--    submission, including an offline submission that arrives after a newer
--    template version was published.
-- 2. Keep pre-migration records explicitly labelled as legacy evidence. We do
--    not pretend today's template is the one an older sheet used.
-- 3. Provide a server-side assignment denominator for practical compliance
--    monitoring. Submission volume alone is not a compliance rate.

create table public.checklist_template_revisions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  template_id uuid not null references public.checklist_templates(id) on delete restrict,
  version integer not null check (version > 0),
  snapshot jsonb not null,
  captured_by uuid,
  captured_at timestamptz not null default now(),
  unique (organisation_id, template_id, version)
);

create index checklist_template_revisions_template_idx
  on public.checklist_template_revisions (template_id, version desc);
create index checklist_template_revisions_org_idx
  on public.checklist_template_revisions (organisation_id, captured_at desc);

alter table public.checklist_template_revisions enable row level security;
revoke all on public.checklist_template_revisions from public, anon, authenticated;
grant select on public.checklist_template_revisions to authenticated;

create policy checklist_template_revisions_read
  on public.checklist_template_revisions
  for select to authenticated
  using (organisation_id is not distinct from (select public.app_current_org()));

create or replace function public.checklist_template_snapshot(p_template public.checklist_templates)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select jsonb_strip_nulls(jsonb_build_object(
    'template_id', p_template.id,
    'version', p_template.version,
    'name', p_template.name,
    'description', p_template.description,
    'category', p_template.category,
    'country', p_template.country,
    'status', p_template.status,
    'require_signature', p_template.require_signature,
    'require_approval', p_template.require_approval,
    'require_area_manager', p_template.require_area_manager,
    'scored', p_template.scored,
    'pass_threshold', p_template.pass_threshold,
    'assignee_roles', p_template.assignee_roles,
    'doc_prefix', p_template.doc_prefix,
    'min_interval_days', p_template.min_interval_days,
    'name_i18n', p_template.name_i18n,
    'description_i18n', p_template.description_i18n,
    'option_sets', p_template.option_sets,
    'fields', p_template.fields
  ));
$fn$;
revoke all on function public.checklist_template_snapshot(public.checklist_templates)
  from public, anon, authenticated;

create or replace function public.capture_checklist_template_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_snapshot jsonb;
  v_existing jsonb;
begin
  if new.status <> 'published' then
    return new;
  end if;

  v_snapshot := public.checklist_template_snapshot(new);
  insert into public.checklist_template_revisions
    (organisation_id, template_id, version, snapshot, captured_by)
  values
    (new.organisation_id, new.id, new.version, v_snapshot, auth.uid())
  on conflict (organisation_id, template_id, version) do nothing;

  select r.snapshot into v_existing
  from public.checklist_template_revisions r
  where r.organisation_id = new.organisation_id
    and r.template_id = new.id
    and r.version = new.version;

  if v_existing is distinct from v_snapshot then
    raise exception 'Published checklist version % is immutable; save this as a new version', new.version
      using errcode = '22023';
  end if;
  return new;
end;
$fn$;
revoke all on function public.capture_checklist_template_revision()
  from public, anon, authenticated;

-- Any evidence-bearing change to a published template becomes a new version.
-- Archiving alone is lifecycle administration and does not rewrite evidence.
create or replace function public.version_published_checklist_template()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if old.status = 'published'
     and new.version = old.version
     and (
       new.name is distinct from old.name
       or new.description is distinct from old.description
       or new.category is distinct from old.category
       or new.country is distinct from old.country
       or new.require_signature is distinct from old.require_signature
       or new.require_approval is distinct from old.require_approval
       or new.require_area_manager is distinct from old.require_area_manager
       or new.scored is distinct from old.scored
       or new.pass_threshold is distinct from old.pass_threshold
       or new.assignee_roles is distinct from old.assignee_roles
       or new.doc_prefix is distinct from old.doc_prefix
       or new.min_interval_days is distinct from old.min_interval_days
       or new.name_i18n is distinct from old.name_i18n
       or new.description_i18n is distinct from old.description_i18n
       or new.option_sets is distinct from old.option_sets
       or new.fields is distinct from old.fields
     ) then
    new.version := old.version + 1;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_version_published_checklist_template on public.checklist_templates;
create trigger trg_version_published_checklist_template
  before update on public.checklist_templates
  for each row execute function public.version_published_checklist_template();

drop trigger if exists trg_capture_checklist_template_revision on public.checklist_templates;
create trigger trg_capture_checklist_template_revision
  after insert or update on public.checklist_templates
  for each row execute function public.capture_checklist_template_revision();

-- Seed only what is knowable: the current published version. Older versions are
-- deliberately not reconstructed from today's fields.
insert into public.checklist_template_revisions
  (organisation_id, template_id, version, snapshot, captured_by, captured_at)
select t.organisation_id, t.id, t.version,
       public.checklist_template_snapshot(t), t.created_by, now()
from public.checklist_templates t
where t.status = 'published'
on conflict (organisation_id, template_id, version) do nothing;

alter table public.checklist_submissions
  add column template_revision_id uuid references public.checklist_template_revisions(id),
  add column template_snapshot jsonb,
  add column template_snapshot_status text not null default 'legacy_unavailable'
    check (template_snapshot_status in ('exact','missing_revision','legacy_unavailable')),
  add column template_snapshot_captured_at timestamptz;

create index checklist_submissions_revision_idx
  on public.checklist_submissions (template_revision_id)
  where template_revision_id is not null;
create index checklist_submissions_snapshot_quality_idx
  on public.checklist_submissions (organisation_id, template_snapshot_status, submitted_at desc);

create or replace function public.stamp_checklist_submission_template_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_template public.checklist_templates;
  v_revision public.checklist_template_revisions;
begin
  if new.template_snapshot is not null then
    raise exception 'Checklist template evidence is stamped by the server'
      using errcode = '42501';
  end if;
  if new.template_id is null then
    new.template_snapshot_status := 'missing_revision';
    return new;
  end if;

  select * into v_template
  from public.checklist_templates
  where id = new.template_id
    and organisation_id is not distinct from new.organisation_id;

  if not found then
    new.template_snapshot_status := 'missing_revision';
    return new;
  end if;

  new.template_version := coalesce(new.template_version, v_template.version);
  select * into v_revision
  from public.checklist_template_revisions
  where organisation_id = new.organisation_id
    and template_id = new.template_id
    and version = new.template_version;

  if found then
    new.template_revision_id := v_revision.id;
    new.template_snapshot := v_revision.snapshot;
    new.template_snapshot_status := 'exact';
    new.template_snapshot_captured_at := now();
  else
    new.template_revision_id := null;
    new.template_snapshot := null;
    new.template_snapshot_status := 'missing_revision';
    new.template_snapshot_captured_at := null;
  end if;
  return new;
end;
$fn$;
revoke all on function public.stamp_checklist_submission_template_snapshot()
  from public, anon, authenticated;

create or replace function public.guard_checklist_submission_template_snapshot()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.template_revision_id is distinct from old.template_revision_id
     or new.template_snapshot is distinct from old.template_snapshot
     or new.template_snapshot_status is distinct from old.template_snapshot_status
     or new.template_snapshot_captured_at is distinct from old.template_snapshot_captured_at then
    raise exception 'Checklist template evidence is immutable'
      using errcode = '22023';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_stamp_checklist_submission_template_snapshot on public.checklist_submissions;
create trigger trg_stamp_checklist_submission_template_snapshot
  before insert on public.checklist_submissions
  for each row execute function public.stamp_checklist_submission_template_snapshot();

drop trigger if exists trg_guard_checklist_submission_template_snapshot on public.checklist_submissions;
create trigger trg_guard_checklist_submission_template_snapshot
  before update on public.checklist_submissions
  for each row execute function public.guard_checklist_submission_template_snapshot();

-- One row per template/site with an assignment denominator. RLS on schedules,
-- assignments and linked submissions remains the access boundary because this
-- function is SECURITY INVOKER.
create or replace function public.checklist_compliance_monitor(
  p_from date,
  p_to date,
  p_country text default null,
  p_site text default null,
  p_template_id uuid default null
)
returns table (
  template_id uuid,
  template_name text,
  country text,
  site text,
  due_count bigint,
  completed_count bigint,
  completed_on_time_count bigint,
  completed_late_count bigint,
  pending_count bigint,
  overdue_count bigint,
  skipped_count bigint,
  unlinked_completion_count bigint,
  exact_evidence_count bigint,
  evidence_gap_count bigint,
  compliance_pct numeric,
  on_time_pct numeric
)
language sql
stable
security invoker
set search_path = public
as $fn$
  select
    a.template_id,
    coalesce(a.template_name, t.name, 'Unknown template') as template_name,
    a.country,
    coalesce(nullif(btrim(a.site), ''), 'Unassigned') as site,
    count(*) as due_count,
    count(*) filter (where a.status = 'completed') as completed_count,
    count(*) filter (where a.status = 'completed' and a.completed_at::date <= a.due_date) as completed_on_time_count,
    count(*) filter (where a.status = 'completed' and a.completed_at::date > a.due_date) as completed_late_count,
    count(*) filter (where a.status = 'pending' and a.due_date >= current_date) as pending_count,
    count(*) filter (where a.status = 'overdue' or (a.status = 'pending' and a.due_date < current_date)) as overdue_count,
    count(*) filter (where a.status = 'skipped') as skipped_count,
    count(*) filter (where a.status = 'completed' and a.submission_id is null) as unlinked_completion_count,
    count(*) filter (where a.status = 'completed' and s.template_snapshot_status = 'exact') as exact_evidence_count,
    count(*) filter (where a.status = 'completed' and (s.id is null or s.template_snapshot_status <> 'exact')) as evidence_gap_count,
    round(100.0 * count(*) filter (where a.status = 'completed') / nullif(count(*) filter (where a.status <> 'skipped'), 0), 1) as compliance_pct,
    round(100.0 * count(*) filter (where a.status = 'completed' and a.completed_at::date <= a.due_date) / nullif(count(*) filter (where a.status = 'completed'), 0), 1) as on_time_pct
  from public.checklist_assignments a
  left join public.checklist_templates t on t.id = a.template_id
  left join public.checklist_submissions s on s.id = a.submission_id
  where p_from is not null and p_to is not null and p_from <= p_to
    and a.due_date between p_from and p_to
    and (p_country is null or lower(a.country) = lower(p_country))
    and (p_site is null or lower(a.site) = lower(p_site))
    and (p_template_id is null or a.template_id = p_template_id)
  group by a.template_id, coalesce(a.template_name, t.name, 'Unknown template'), a.country,
           coalesce(nullif(btrim(a.site), ''), 'Unassigned')
  order by a.country nulls last, site, template_name;
$fn$;

revoke all on function public.checklist_compliance_monitor(date,date,text,text,uuid)
  from public, anon;
grant execute on function public.checklist_compliance_monitor(date,date,text,text,uuid)
  to authenticated;

-- Trigger-only helpers are never client APIs. Restricting EXECUTE also prevents
-- callers from bypassing the surrounding table policies through definer code.
revoke all on function public.checklist_template_snapshot(public.checklist_templates)
  from public, anon, authenticated;
revoke all on function public.capture_checklist_template_revision()
  from public, anon, authenticated;
revoke all on function public.version_published_checklist_template()
  from public, anon, authenticated;
revoke all on function public.stamp_checklist_submission_template_snapshot()
  from public, anon, authenticated;
revoke all on function public.guard_checklist_submission_template_snapshot()
  from public, anon, authenticated;

comment on function public.checklist_compliance_monitor(date,date,text,text,uuid) is
  'Assignment-based checklist compliance. Skips are excluded from the compliance denominator; evidence gaps remain explicit.';
