-- V597 - TEACH THE WEB APPROVAL RPC THE SECOND RUNG.
-- STATUS: APPLIED live on jhssdmeruxtrlqnwfksc 2026-08-18 and verified end to end.
-- This is a REGRESSION I INTRODUCED IN V594 AND CAUGHT BEFORE IT SHIPPED.
--
-- decide_checklist_approval is the DEFINER RPC the web approvals surface calls.
-- V594 gave checklists a supervisor rung and this function could not express it,
-- which broke the web path three separate ways:
--   1. it writes approval_status = 'approved' straight from 'pending', so on a
--      two-stage template the new trigger REFUSES it with a raw 22023 that a
--      person cannot act on;
--   2. its WHERE required approval_status = 'pending', so a sheet a supervisor
--      had already signed off was INVISIBLE to it and could never be closed from
--      the web - it would report "already decided";
--   3. its role gate listed Admin/Manager/Director/Maintenance Supervisor and
--      therefore EXCLUDED the only account that holds an area-manager role, i.e.
--      the one person who can give final approval.
--
-- THE PUBLIC API IS UNCHANGED ('approved' | 'rejected'), so no caller has to
-- change. WHICH RUNG that means is resolved here from the template and the row's
-- own current status, by the same rule as checklistApproval.nextStatusFor on
-- both clients. The trigger remains the boundary; this function exists so a
-- person gets a sentence they can act on instead of an exception.
--
-- NOTE ON THE OPTIMISTIC-CONCURRENCY GUARD: the UPDATE still pins
-- `approval_status = v_status`, the value read a moment earlier, so two people
-- deciding the same sheet at once cannot both win - the loser is told somebody
-- else moved it rather than silently overwriting the first decision.

create or replace function public.decide_checklist_approval(
  p_submission_id uuid,
  p_decision text,
  p_note text default null,
  p_signature text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role      text;
  v_org       uuid;
  v_approver  text;
  v_status    text;
  v_two_stage boolean;
  v_target    text;
begin
  v_role := public.get_my_role();
  if not public.checklist_is_supervisor() then
    raise exception 'Only an approver can decide checklists';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;

  v_org := public.app_current_org();

  select cs.approval_status, coalesce(t.require_area_manager, false)
    into v_status, v_two_stage
    from public.checklist_submissions cs
    left join public.checklist_templates t on t.id = cs.template_id
   where cs.id = p_submission_id
     and (cs.organisation_id = v_org or public.is_super_admin());

  if v_status is null then
    raise exception 'That checklist no longer exists.';
  end if;

  if v_status not in ('pending', 'pending_area_manager') then
    select coalesce(pr.full_name, pr.username, 'another approver')
      into v_approver
      from public.checklist_submissions cs
      left join public.profiles pr on pr.id = cs.approved_by
     where cs.id = p_submission_id;
    raise exception 'This checklist was already % by %.', v_status, coalesce(v_approver, 'another approver');
  end if;

  select coalesce(full_name, username, 'Approver')
    into v_approver from public.profiles where id = auth.uid();

  if p_decision = 'rejected' then
    v_target := 'rejected';
  elsif v_status = 'pending' and v_two_stage then
    v_target := 'pending_area_manager';
  else
    v_target := 'approved';
  end if;

  if v_target = 'approved' and v_two_stage and not public.checklist_is_area_manager() then
    raise exception 'Only an area manager can give final approval on this checklist.';
  end if;
  if p_decision = 'approved' and coalesce(btrim(p_signature), '') = '' then
    raise exception 'A signature is required to sign off this checklist.';
  end if;

  if v_target = 'pending_area_manager' then
    update public.checklist_submissions
       set approval_status      = v_target,
           supervisor_by        = auth.uid(),
           supervisor_name      = v_approver,
           supervisor_signature = coalesce(p_signature, supervisor_signature),
           supervisor_at        = now(),
           review_note          = p_note
     where id = p_submission_id
       and approval_status = v_status
       and (organisation_id = v_org or public.is_super_admin());
  else
    update public.checklist_submissions
       set approval_status    = v_target,
           approved_by        = auth.uid(),
           approver_name      = v_approver,
           approver_signature = coalesce(p_signature, approver_signature),
           approved_at        = now(),
           review_note        = p_note,
           locked             = (v_target = 'approved')
     where id = p_submission_id
       and approval_status = v_status
       and (organisation_id = v_org or public.is_super_admin());
  end if;

  if not found then
    raise exception 'This checklist was decided by someone else while you were looking at it.';
  end if;

  return jsonb_build_object('ok', true, 'decision', p_decision, 'status', v_target);
end;
$function$;

revoke all on function public.decide_checklist_approval(uuid, text, text, text) from public, anon;
grant execute on function public.decide_checklist_approval(uuid, text, text, text) to authenticated, service_role;

-- VERIFIED AFTER APPLY, live, against the real Workshop Daily Checklist, as the
-- real KSA Manager then the real Workshop Maintenance Area Manager. Probe row
-- deleted afterwards.
--   1 manager signs off with NO signature       REFUSED 'A signature is required to sign off this checklist.'
--   2 manager signs off WITH a signature        {"ok":true,"status":"pending_area_manager"}
--   3 row state                                 pending_area_manager, locked=false, supervisor named
--   4 the SAME manager tries to close it        REFUSED 'Only an area manager can give final approval on this checklist.'
--   5 the area manager closes it                {"ok":true,"status":"approved"}
--   6 row state                                 approved, locked=true, approver named
--   7 deciding it again                         REFUSED 'This checklist was already approved by <name>.'
-- Every refusal is a sentence a person can act on. None is a raw trigger code.
--
-- ROLLBACK: re-apply the pre-V597 body (single rung, role gate
-- Admin/Manager/Director/Maintenance Supervisor, WHERE approval_status='pending').
-- Do NOT roll this back while V594 is applied - it re-breaks the web path.
