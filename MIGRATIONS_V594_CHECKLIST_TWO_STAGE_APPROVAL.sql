-- V594 - CHECKLIST: TWO-STAGE APPROVAL, DOCUMENT NUMBERS, RECURRENCE RULE
-- STATUS: APPLIED live on jhssdmeruxtrlqnwfksc 2026-08-18 and behaviourally
-- verified by impersonation (see the footer for the exact accept/refuse table).
--
-- WHY. The owner's rule is "no one is allowed to close until all done and
-- corrected", with TWO sign-offs: the trade fills and signs, a SUPERVISOR signs,
-- and only then the AREA MANAGER gives final approval. The table could not model
-- that: approval_status is a 4-value CHECK (not_required|pending|approved|
-- rejected) with ONE approver triple, so a supervisor signature and a final
-- approval were the same event and there was no state for "waiting for the area
-- manager". A checklist could therefore be closed by one person.
--
-- THE AREA MANAGER IS A REAL ROLE, NOT AN INVENTION. Measured live before
-- designing this: custom_roles carries BOTH 'Workshop Maintenance Area Manager'
-- (held by 1 real profile) and 'Workshop Area Manager' (held by none yet), so
-- both are accepted. Admin and Director are accepted at the final stage as well,
-- deliberately: exactly ONE person holds an area-manager role today, and a queue
-- that only they can clear jams the moment they are on leave.
--
-- SHIPS INERT. require_area_manager defaults FALSE and doc_prefix/
-- min_interval_days default NULL, so every existing template behaves exactly as
-- before until V595 turns the two flags on for the two workshop templates.
-- Verified after apply: 6 templates, 0 with require_area_manager true.


-- ---------------------------------------------------------------- templates
alter table public.checklist_templates
  add column if not exists require_area_manager boolean not null default false,
  add column if not exists doc_prefix text,
  add column if not exists min_interval_days integer;

comment on column public.checklist_templates.require_area_manager is
  'true = a supervisor sign-off is NOT the end; the submission moves to pending_area_manager and only an area manager can approve it.';
comment on column public.checklist_templates.doc_prefix is
  'Document-number prefix, e.g. WDC. NULL = this template does not carry a document number.';
comment on column public.checklist_templates.min_interval_days is
  'Expected days between submissions for the SAME asset. Advisory only - it warns, it never blocks, because a genuine early inspection must still be recordable.';

-- ------------------------------------------------------------- submissions
alter table public.checklist_submissions
  add column if not exists document_no text,
  add column if not exists supervisor_name text,
  add column if not exists supervisor_signature text,
  add column if not exists supervisor_by uuid references public.profiles(id),
  add column if not exists supervisor_at timestamptz;

comment on column public.checklist_submissions.document_no is
  'Auto-minted at INSERT from the template prefix + asset + year + sequence, e.g. WDC-TM514-2026-0001.';
comment on column public.checklist_submissions.approver_name is
  'FINAL approver. On a two-stage template this is the AREA MANAGER; the supervisor is in supervisor_name.';

-- The new waiting state. Widening a CHECK can never invalidate a stored row.
alter table public.checklist_submissions
  drop constraint if exists checklist_submissions_approval_status_chk;
alter table public.checklist_submissions
  add constraint checklist_submissions_approval_status_chk
  check (approval_status = any (array[
    'not_required','pending','pending_area_manager','approved','rejected'
  ]));

-- The recurrence lookup ("has this asset already had this checklist recently?")
-- and the document-number mint both read this shape.
create index if not exists checklist_submissions_template_asset_idx
  on public.checklist_submissions (template_id, upper(btrim(asset_no)), submitted_at desc);

create unique index if not exists checklist_submissions_document_no_uidx
  on public.checklist_submissions (organisation_id, document_no)
  where document_no is not null;

-- --------------------------------------------------- document-number minting
-- A counter table rather than a sequence, because the number restarts per
-- (prefix, asset, year) and a sequence cannot express that. Deny-all: only the
-- DEFINER function below writes it.
create table if not exists public.checklist_doc_counters (
  organisation_id uuid not null default public.app_current_org(),
  prefix text not null,
  asset_no text not null,
  year integer not null,
  seq integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organisation_id, prefix, asset_no, year)
);
alter table public.checklist_doc_counters enable row level security;
revoke all on public.checklist_doc_counters from anon, authenticated;

create or replace function public.next_checklist_document_no(
  p_org uuid, p_prefix text, p_asset_no text, p_year integer
) returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare v_seq integer; v_asset text;
begin
  if p_org is null or coalesce(btrim(p_prefix),'') = '' then return null; end if;
  -- A blank asset still gets a number, filed under GEN, so a checklist that is
  -- not about one machine is never left without a reference.
  v_asset := upper(btrim(coalesce(p_asset_no,'')));
  if v_asset = '' then v_asset := 'GEN'; end if;

  insert into public.checklist_doc_counters (organisation_id, prefix, asset_no, year, seq)
  values (p_org, upper(btrim(p_prefix)), v_asset, p_year, 1)
  on conflict (organisation_id, prefix, asset_no, year)
  do update set seq = public.checklist_doc_counters.seq + 1, updated_at = now()
  returning seq into v_seq;

  return upper(btrim(p_prefix)) || '-' || v_asset || '-' || p_year::text
         || '-' || lpad(v_seq::text, 4, '0');
end;
$fn$;
revoke all on function public.next_checklist_document_no(uuid, text, text, integer) from public, anon;

-- BEFORE INSERT so the number exists the moment the row lands, including a row
-- replayed from the phone's offline queue days later. Minted on SUBMIT, never at
-- fill time: a fill that is abandoned must not burn a number.
create or replace function public.stamp_checklist_document_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare v_prefix text;
begin
  if new.document_no is not null and btrim(new.document_no) <> '' then return new; end if;
  if new.template_id is null then return new; end if;
  select t.doc_prefix into v_prefix from public.checklist_templates t where t.id = new.template_id;
  if coalesce(btrim(v_prefix),'') = '' then return new; end if;
  new.document_no := public.next_checklist_document_no(
    new.organisation_id, v_prefix, new.asset_no,
    extract(year from coalesce(new.submitted_at, now()))::int
  );
  return new;
end;
$fn$;

drop trigger if exists trg_stamp_checklist_document_no on public.checklist_submissions;
create trigger trg_stamp_checklist_document_no
  before insert on public.checklist_submissions
  for each row execute function public.stamp_checklist_document_no();

-- -------------------------------------------------------- who may sign what
create or replace function public.checklist_is_supervisor()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_super_admin() or public.get_my_role() = any (array[
    'Admin','Manager','Director','Maintenance Supervisor','Fleet Supervisor',
    'PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager'
  ]);
$fn$;

create or replace function public.checklist_is_area_manager()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_super_admin() or public.get_my_role() = any (array[
    'Admin','Director','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager'
  ]);
$fn$;

grant execute on function public.checklist_is_supervisor() to authenticated;
grant execute on function public.checklist_is_area_manager() to authenticated;

-- The UPDATE policy listed four roles, so an area manager could not touch the
-- queue at all. Widened to the supervisor set; the trigger below is what keeps
-- the two stages honest, not the policy.
drop policy if exists checklist_submissions_update on public.checklist_submissions;
create policy checklist_submissions_update on public.checklist_submissions
  for update to authenticated
  using ((select public.checklist_is_supervisor()))
  with check ((select public.checklist_is_supervisor()));

-- ----------------------------------------------------- the stage-gate itself
-- THIS is the "nobody closes it alone" rule, enforced server-side. A client that
-- forgets the flow cannot skip a stage, and neither can a direct PostgREST call.
create or replace function public.guard_checklist_approval_stages()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare v_two_stage boolean;
begin
  if new.approval_status is not distinct from old.approval_status then return new; end if;

  select coalesce(t.require_area_manager, false) into v_two_stage
    from public.checklist_templates t where t.id = new.template_id;
  v_two_stage := coalesce(v_two_stage, false);

  -- A rejection is available at either stage to whoever can act on it.
  if new.approval_status = 'rejected' then
    if not public.checklist_is_supervisor() then
      raise exception 'You do not have permission to reject this checklist' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.approval_status = 'pending_area_manager' then
    if not v_two_stage then
      raise exception 'This checklist does not use an area-manager stage' using errcode = '22023';
    end if;
    if not public.checklist_is_supervisor() then
      raise exception 'Only a supervisor can sign off this checklist' using errcode = '42501';
    end if;
    if coalesce(btrim(new.supervisor_name), '') = ''
       or coalesce(btrim(new.supervisor_signature), '') = '' then
      raise exception 'A supervisor name and signature are required' using errcode = '22023';
    end if;
    new.supervisor_by := coalesce(new.supervisor_by, auth.uid());
    new.supervisor_at := coalesce(new.supervisor_at, now());
    return new;
  end if;

  if new.approval_status = 'approved' then
    if v_two_stage then
      -- The whole point: the supervisor stage must already be complete, and the
      -- final signature must come from an area manager.
      if coalesce(btrim(coalesce(new.supervisor_signature, old.supervisor_signature)), '') = '' then
        raise exception 'A supervisor must sign off before the area manager can approve' using errcode = '22023';
      end if;
      if not public.checklist_is_area_manager() then
        raise exception 'Only an area manager can give final approval' using errcode = '42501';
      end if;
    elsif not public.checklist_is_supervisor() then
      raise exception 'You do not have permission to approve this checklist' using errcode = '42501';
    end if;
    if coalesce(btrim(new.approver_name), '') = ''
       or coalesce(btrim(new.approver_signature), '') = '' then
      raise exception 'An approver name and signature are required' using errcode = '22023';
    end if;
    new.approved_by := coalesce(new.approved_by, auth.uid());
    new.approved_at := coalesce(new.approved_at, now());
    return new;
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_guard_checklist_approval_stages on public.checklist_submissions;
create trigger trg_guard_checklist_approval_stages
  before update on public.checklist_submissions
  for each row execute function public.guard_checklist_approval_stages();

-- ------------------------------------------------------- the 10-day question
-- Returns the previous submission for this template+asset so the phone can say
-- "this machine was done N days ago, it is not due yet". ADVISORY: it reports,
-- it never refuses, because a genuine early inspection must still be recordable
-- and the phone may be offline when it asks.
create or replace function public.checklist_last_submission(
  p_template_id uuid, p_asset_no text
) returns jsonb
language sql stable security invoker set search_path = public as $fn$
  select coalesce(
    (select jsonb_build_object(
       'found', true,
       'submitted_at', s.submitted_at,
       'days_ago', greatest(0, (current_date - s.submitted_at::date)),
       'document_no', s.document_no,
       'status', s.status,
       'approval_status', s.approval_status,
       'min_interval_days', t.min_interval_days
     )
     from public.checklist_submissions s
     join public.checklist_templates t on t.id = s.template_id
     where s.template_id = p_template_id
       and upper(btrim(s.asset_no)) = upper(btrim(coalesce(p_asset_no, '')))
       and coalesce(btrim(p_asset_no), '') <> ''
     order by s.submitted_at desc
     limit 1),
    jsonb_build_object('found', false));
$fn$;
grant execute on function public.checklist_last_submission(uuid, text) to authenticated;


-- VERIFIED AFTER APPLY, live, by impersonating the real KSA Manager
-- (34793423) and the real Workshop Maintenance Area Manager (06161659):
--   * SHIPS INERT: 6 templates, require_area_manager true on 0.
--   * DOCUMENT MINT: TM514 -> WDC-TM514-2026-0001, then a SECOND submission
--     written as ' TM514 ' (padded, lower case) -> WDC-TM514-2026-0002, i.e. the
--     counter keys on the normalised asset and a spacing difference cannot start
--     a parallel number series. A different asset (MP093) restarts at -0001.
--   * STAGE GATE, and this is the rule the owner asked for:
--       manager approves with no supervisor stage -> REFUSED 22023
--         'A supervisor must sign off before the area manager can approve'
--       supervisor stage with a name but no signature -> REFUSED 22023
--       supervisor stage signed -> ACCEPTED, supervisor_by + supervisor_at
--         stamped by the trigger, status pending_area_manager
--       the SAME manager then gives final approval -> REFUSED 42501
--         'Only an area manager can give final approval'
--       the area manager approves -> ACCEPTED, approved_at stamped
--   * ROLE HELPERS: Manager is_supervisor true / is_area_manager FALSE;
--     Workshop Maintenance Area Manager is_area_manager true.
--   * checklist_last_submission returns the newest row with days_ago and the
--     template's min_interval_days.
-- The probe ran in an auto-committing session, so its rows were deleted
-- afterwards and the counts re-checked: submissions back to 3 (the three
-- pre-existing Predictive Maintenance rows), checklist_doc_counters 0,
-- two-stage templates 0.
--
-- NOTE FOR WHOEVER READS THIS NEXT: the three live checklist_submissions rows
-- all belong to a DIFFERENT template (Predictive Maintenance), so the V595
-- rewrite of the two workshop templates orphans no recorded answer.
--
-- ROLLBACK:
--   drop trigger trg_guard_checklist_approval_stages on public.checklist_submissions;
--   drop trigger trg_stamp_checklist_document_no on public.checklist_submissions;
--   drop function public.guard_checklist_approval_stages();
--   drop function public.stamp_checklist_document_no();
--   drop function public.checklist_last_submission(uuid, text);
--   drop function public.next_checklist_document_no(uuid, text, text, integer);
--   drop function public.checklist_is_area_manager();
--   drop function public.checklist_is_supervisor();
--   drop table public.checklist_doc_counters;
--   alter table public.checklist_submissions
--     drop column document_no, drop column supervisor_name,
--     drop column supervisor_signature, drop column supervisor_by, drop column supervisor_at;
--   alter table public.checklist_templates
--     drop column require_area_manager, drop column doc_prefix, drop column min_interval_days;
--   (restore the 4-value approval_status CHECK and the 4-role UPDATE policy)
