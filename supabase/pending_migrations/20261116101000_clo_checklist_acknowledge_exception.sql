-- =====================================================================================
-- 20261116101000_clo_checklist_acknowledge_exception.sql
-- STATUS: AUTHORED, NOT APPLIED. Draft for owner approval. Tested on local staging only.
-- DEPENDS ON: 20261116100000_clo_corrective_action_review.sql (config table, review columns,
--             exception request and decision writers). Apply that one first.
--
-- WHAT IT DOES (owner decision 2026-11-15, checklist sign-off and fault handling)
--   Today a sheet with an answer marked "Not OK" can never be closed: the approval guard
--   refuses 'approved' while a blocking mark remains (V595) and no screen re-marks an answer.
--   That rule is KEPT EXACTLY AS IT IS. This draft adds a separate, explicit outcome:
--
--   1. approval_status gains 'acknowledged': the authorised signer has seen and signed a
--      sheet that carries a fault. The answer stays as recorded. The sheet is locked. It is
--      NOT approved and it is NOT compliant while a fault is open.
--   2. acknowledge_checklist_faults(): the only way to reach 'acknowledged'. It refuses a
--      clean sheet (that one is approved normally), needs a signature, follows the same
--      signing order as approval, refuses the submitter's own sheet unless the company allows
--      it, and makes sure every faulty answer has a corrective action before it signs.
--   3. A sheet becomes compliant only when every fault's corrective action is closed on
--      review (verified resolution) or closed with a documented exception (who, when,
--      reason). v_checklist_fault_compliance reports this per sheet; nothing is written back
--      to the sheet, so the record of what was found never changes.
--   4. checklist_decision_events: append-only history of every sign-off step from now on
--      (first signature, approval, rejection, acknowledgement), who and when.
--   5. checklist_is_area_manager() additionally admits the roles a company lists in
--      closure_review_config.checklist_final_signer_roles. The list is EMPTY by default, so
--      behaviour is unchanged until an administrator adds a role (for example Workshop
--      Supervisor, within the sites that person is authorised for).
--
-- NOT CHANGED: guard_checklist_approval_stages (the blocking-mark rule), decide_checklist_approval,
--   the corrective-action trigger, every existing row. No sheet is approved, rejected or
--   acknowledged by this file. Sheets routed through a published approval policy are
--   refused by the new writer (the policy engine owns those).
--
-- UNAVOIDABLE REMOVAL TEXT: a CHECK constraint cannot be widened in place, so this file
--   contains one "drop constraint" immediately followed by "add constraint" with the old
--   values plus 'acknowledged'. No data is removed.
--
-- VERIFY (rolled back):
--   begin;
--   select count(*), md5(string_agg(to_jsonb(s)::text, '' order by id)) from public.checklist_submissions s;   -- before
--   \i this file
--   select count(*), md5(string_agg((to_jsonb(s) - array['acknowledged_by','acknowledged_at','acknowledged_name',
--     'acknowledged_signature','acknowledgement_note'])::text, '' order by id)) from public.checklist_submissions s; -- same
--   select has_function_privilege('anon', 'public.acknowledge_checklist_faults(uuid,text,text)', 'execute');    -- f
--   rollback;
--
-- ROLLBACK (only if no sheet has been acknowledged; otherwise keep the status value):
--   drop trigger if exists trg_guard_checklist_acknowledge on public.checklist_submissions;
--   drop trigger if exists trg_zz_checklist_decision_event on public.checklist_submissions;
--   drop view if exists public.v_checklist_fault_compliance;
--   drop function if exists public.acknowledge_checklist_faults(uuid,text,text), public.guard_checklist_acknowledge(),
--     public.checklist_decision_event(), public.checklist_blocking_answers(public.checklist_submissions);
--   drop table if exists public.checklist_decision_events;
--   restore checklist_is_area_manager() to its five fixed roles (body in the baseline);
--   re-create checklist_submissions_approval_status_chk without 'acknowledged';
--   alter table public.checklist_submissions drop column if exists acknowledged_by, ... (five columns).
-- =====================================================================================

-- ---------------------------------------------------------------- 1. status + columns
alter table public.checklist_submissions
  drop constraint checklist_submissions_approval_status_chk,
  add constraint checklist_submissions_approval_status_chk
    check (approval_status = any (array['not_required','pending','pending_area_manager','approved','rejected','acknowledged']));

alter table public.checklist_submissions
  add column if not exists acknowledged_by        uuid,
  add column if not exists acknowledged_at        timestamptz,
  add column if not exists acknowledged_name      text,
  add column if not exists acknowledged_signature text,
  add column if not exists acknowledgement_note   text;

-- ---------------------------------------------------------------- 2. final signer roles per company
create or replace function public.checklist_is_area_manager()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.is_super_admin() or public.get_my_role() = any (array[
    'Admin','Director','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager'
  ]) or public.closure_role_in(public.get_my_role(),
        (select c.checklist_final_signer_roles from public.closure_review_config c
          where c.organisation_id = public.app_current_org()));
$$;

-- ---------------------------------------------------------------- 3. the faulty answers of a sheet
-- Same reading as _raise_checklist_corrective_actions: the legend the sheet was filled
-- against wins over the current form.
create or replace function public.checklist_blocking_answers(s public.checklist_submissions)
returns table (field_key text, mark text, field_label text)
language sql stable set search_path to 'public' as $$
  with cfg as (
    select coalesce(s.template_snapshot #> '{option_sets,legend,blocking}', t.option_sets #> '{legend,blocking}') as blocking,
           coalesce(s.template_snapshot -> 'fields', t.fields) as fields
      from (select 1) one left join public.checklist_templates t on t.id = s.template_id
  )
  select a.key, a.value, public.checklist_field_label(cfg.fields, a.key)
    from cfg, jsonb_each_text(coalesce(s.answers, '{}'::jsonb)) a
   where jsonb_typeof(cfg.blocking) = 'array' and jsonb_exists(cfg.blocking, a.value);
$$;
revoke all on function public.checklist_blocking_answers(public.checklist_submissions) from public;
revoke all on function public.checklist_blocking_answers(public.checklist_submissions) from anon;
grant execute on function public.checklist_blocking_answers(public.checklist_submissions) to authenticated;

-- ---------------------------------------------------------------- 4. history
create table if not exists public.checklist_decision_events (
  id              bigint generated always as identity primary key,
  organisation_id uuid,
  submission_id   uuid not null,          -- no foreign key: history outlives the sheet
  from_status     text,
  to_status       text not null,
  actor_id        uuid,
  actor_role      text,
  note            text,
  detail          jsonb not null default '{}'::jsonb,
  country         text,
  site            text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_checklist_decision_events_sub on public.checklist_decision_events (submission_id, created_at);
alter table public.checklist_decision_events enable row level security;
revoke all on public.checklist_decision_events from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.checklist_decision_events from authenticated;
grant select on public.checklist_decision_events to authenticated;
create policy checklist_decision_events_org_isolation on public.checklist_decision_events as restrictive for select to authenticated
  using (organisation_id is not distinct from (select public.app_current_org()) or (select public.is_super_admin()));
create policy checklist_decision_events_scope on public.checklist_decision_events as restrictive for select to authenticated
  using ((select public.app_is_active()) is true and public.app_write_country_ok(country) and public.app_can_see_site(site) is not false);
create policy checklist_decision_events_read on public.checklist_decision_events for select to authenticated using (true);
create trigger trg_checklist_decision_events_immutable before update or delete on public.checklist_decision_events
  for each row execute function public.closure_events_immutable();
create trigger trg_checklist_decision_events_no_truncate before truncate on public.checklist_decision_events
  for each statement execute function public.closure_events_immutable();

create or replace function public.checklist_decision_event()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.approval_status is not distinct from old.approval_status then return null; end if;
  insert into public.checklist_decision_events
    (organisation_id, submission_id, from_status, to_status, actor_id, actor_role, note, detail, country, site)
  values (new.organisation_id, new.id, old.approval_status, new.approval_status, auth.uid(), public.get_my_role(),
          nullif(btrim(coalesce(case when new.approval_status = 'acknowledged' then new.acknowledgement_note else new.review_note end, '')), ''),
          jsonb_strip_nulls(jsonb_build_object(
            'document_no', new.document_no, 'asset_no', new.asset_no, 'template_id', new.template_id,
            'supervisor_by', new.supervisor_by, 'approved_by', new.approved_by, 'acknowledged_by', new.acknowledged_by,
            'open_faults', case when new.approval_status = 'acknowledged'
                                then (select count(*) from public.checklist_blocking_answers(new)) end)),
          new.country, new.site);
  return null;
end $$;
revoke all on function public.checklist_decision_event() from public;
revoke all on function public.checklist_decision_event() from anon, authenticated;
create trigger trg_zz_checklist_decision_event after update on public.checklist_submissions
  for each row execute function public.checklist_decision_event();

-- ---------------------------------------------------------------- 5. guard for the new status
create or replace function public.guard_checklist_acknowledge()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_via boolean := coalesce(current_setting('tp.checklist_ack', true), '') = 'on';
begin
  if old.approval_status = 'acknowledged' then
    if new.approval_status is distinct from old.approval_status then
      raise exception 'This checklist was acknowledged with a recorded fault and keeps that decision. Resolve the fault through its corrective action.' using errcode = '22023';
    end if;
    if new.answers is distinct from old.answers
       or (new.acknowledged_by, new.acknowledged_at, new.acknowledged_name, new.acknowledged_signature, new.acknowledgement_note)
          is distinct from
          (old.acknowledged_by, old.acknowledged_at, old.acknowledged_name, old.acknowledged_signature, old.acknowledgement_note) then
      raise exception 'An acknowledged checklist cannot be edited. The recorded fault is kept as evidence.' using errcode = '22023';
    end if;
    return new;
  end if;

  if not v_via then
    if new.approval_status = 'acknowledged' then
      raise exception 'Use the acknowledge step to sign a checklist that carries a fault.' using errcode = '42501';
    end if;
    if (new.acknowledged_by, new.acknowledged_at, new.acknowledged_name, new.acknowledged_signature, new.acknowledgement_note)
       is distinct from
       (old.acknowledged_by, old.acknowledged_at, old.acknowledged_name, old.acknowledged_signature, old.acknowledgement_note) then
      raise exception 'Acknowledgement details are recorded by the acknowledge step only.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_checklist_acknowledge() from public;
revoke all on function public.guard_checklist_acknowledge() from anon, authenticated;
create trigger trg_guard_checklist_acknowledge before update on public.checklist_submissions
  for each row execute function public.guard_checklist_acknowledge();

-- ---------------------------------------------------------------- 6. the acknowledge step
create or replace function public.acknowledge_checklist_faults(p_submission_id uuid, p_note text default null, p_signature text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  s public.checklist_submissions; c public.closure_review_config;
  v_two_stage boolean; v_name text; v_faults integer; v_uncovered integer; v_both boolean := false;
begin
  if auth.uid() is null or public.app_is_active() is not true then
    raise exception 'Sign in to sign checklists.' using errcode = '42501';
  end if;
  if public.app_cap_revoked('checklists', 'approve') then
    raise exception 'You are not permitted to approve or decide this record.' using errcode = '42501';
  end if;

  select cs.* into s from public.checklist_submissions cs
   where cs.id = p_submission_id
     and (cs.organisation_id = public.app_current_org() or public.is_super_admin())
     and public.app_write_country_ok(cs.country)
     and (cs.site is null or btrim(cs.site) = '' or public.app_can_see_site(cs.site) is not false)
   for update;
  if not found then
    raise exception 'That checklist does not exist or is outside your company, country or sites.' using errcode = '42501';
  end if;
  if s.approval_status not in ('pending', 'pending_area_manager') then
    raise exception 'This checklist is not waiting for a signature.' using errcode = 'PT409';
  end if;
  if s.approval_policy_required or s.approval_workflow_id is not null then
    raise exception 'This checklist is routed through an approval policy. Decide it in the approval queue.' using errcode = '42501';
  end if;

  select count(*) into v_faults from public.checklist_blocking_answers(s);
  if v_faults = 0 then
    raise exception 'This checklist has no recorded fault. Approve it in the normal way.' using errcode = '22023';
  end if;

  c := public.closure_review_settings(s.organisation_id);
  if s.submitted_by = auth.uid() and not c.checklist_allow_self_ack then
    raise exception 'You submitted this checklist, so another signer has to acknowledge it.' using errcode = '42501';
  end if;

  select coalesce(t.require_area_manager, false) into v_two_stage
    from public.checklist_templates t where t.id = s.template_id;
  v_two_stage := coalesce(v_two_stage, false);

  if v_two_stage then
    if not public.checklist_is_area_manager() then
      if s.approval_status = 'pending' and public.checklist_is_supervisor() then
        raise exception 'Give the supervisor signature first. The final signer then acknowledges the fault.' using errcode = '42501';
      end if;
      raise exception 'Only a final signer can acknowledge this checklist.' using errcode = '42501';
    end if;
    v_both := (s.approval_status = 'pending');
  elsif not public.checklist_is_supervisor() then
    raise exception 'You do not have permission to sign this checklist.' using errcode = '42501';
  end if;

  if coalesce(btrim(p_signature), '') = '' then
    raise exception 'A signature is required to acknowledge this checklist.' using errcode = '22023';
  end if;

  -- Every fault must be linked to a corrective action before the sheet is signed.
  perform public._raise_checklist_corrective_actions(s.id, false);
  select count(*) into v_uncovered
    from public.checklist_blocking_answers(s) b
   where not exists (select 1 from public.corrective_actions a
                      where a.source_type = 'checklist' and a.source_id = s.id and a.source_detail = b.field_label);
  if v_uncovered > 0 then
    raise exception '% fault(s) on this checklist have no corrective action yet. Raise them first.', v_uncovered using errcode = '22023';
  end if;

  select coalesce(full_name, username, 'Signer') into v_name from public.profiles where id = auth.uid();

  perform set_config('tp.checklist_ack', 'on', true);
  update public.checklist_submissions
     set approval_status        = 'acknowledged',
         supervisor_by          = case when v_both then auth.uid() else supervisor_by end,
         supervisor_name        = case when v_both then v_name else supervisor_name end,
         supervisor_signature   = case when v_both then p_signature else supervisor_signature end,
         supervisor_at          = case when v_both then now() else supervisor_at end,
         acknowledged_by        = auth.uid(),
         acknowledged_at        = now(),
         acknowledged_name      = v_name,
         acknowledged_signature = p_signature,
         acknowledgement_note   = nullif(btrim(coalesce(p_note, '')), ''),
         locked                 = true
   where id = s.id and approval_status = s.approval_status;
  perform set_config('tp.checklist_ack', '', true);

  return jsonb_build_object('ok', true, 'status', 'acknowledged', 'open_faults', v_faults, 'both_steps', v_both);
end $$;
revoke all on function public.acknowledge_checklist_faults(uuid, text, text) from public;
revoke all on function public.acknowledge_checklist_faults(uuid, text, text) from anon;
grant execute on function public.acknowledge_checklist_faults(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- 7. compliance, derived
-- security_invoker: the reader's own row policies on checklist_submissions and
-- corrective_actions decide what is visible.
create or replace view public.v_checklist_fault_compliance with (security_invoker = on) as
select s.id as submission_id, s.organisation_id, s.country, s.site, s.asset_no, s.document_no,
       s.template_id, s.approval_status, s.submitted_at, s.acknowledged_at,
       f.fault_count, f.linked_count, f.resolved_count, f.exception_count,
       f.fault_count - f.resolved_count - f.exception_count as open_count,
       case when f.fault_count = 0 then 'no_fault'
            when f.fault_count - f.resolved_count - f.exception_count > 0 then 'fault_open'
            when f.exception_count > 0 then 'exception'
            else 'fault_resolved' end as fault_state,
       case when s.approval_status = 'approved' then true
            when s.approval_status in ('acknowledged', 'not_required')
              then f.fault_count - f.resolved_count - f.exception_count = 0
            else false end as compliant
  from public.checklist_submissions s
  cross join lateral (
    select count(*)::int as fault_count,
           count(a.id)::int as linked_count,
           count(*) filter (where a.status = 'Closed' and a.review_status is distinct from 'exception')::int as resolved_count,
           count(*) filter (where a.status = 'Closed' and a.review_status = 'exception')::int as exception_count
      from public.checklist_blocking_answers(s) b
      left join lateral (
        select x.id, x.status, x.review_status from public.corrective_actions x
         where x.source_type = 'checklist' and x.source_id = s.id and x.source_detail = b.field_label
         order by (x.status = 'Closed') desc, x.created_at desc limit 1) a on true
  ) f;
revoke all on public.v_checklist_fault_compliance from public, anon;
grant select on public.v_checklist_fault_compliance to authenticated;

select anum_integration.apply_reader_policies();
