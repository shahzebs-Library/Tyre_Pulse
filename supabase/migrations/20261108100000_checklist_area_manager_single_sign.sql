-- Two-stage checklists: an area manager who signs a sheet still waiting for
-- the supervisor closes it in ONE signature.
--
-- STATUS: APPLIED LIVE 2026-11-08 (project jhssdmeruxtrlqnwfksc).
--
-- Bug (owner: "as the manager signs it is still asking supervisor
-- signatures"): decide_checklist_approval treated the FIRST signature on a
-- two-stage sheet as the supervisor rung whoever gave it. A PMV Manager /
-- Workshop (Maintenance) Area Manager / Admin / Director signing a 'pending'
-- sheet moved it to 'pending_area_manager' and then had to sign it AGAIN.
-- Live at the time: 80 Workshop Daily sheets pending, 9 at the area-manager
-- step.
--
-- Rule now: at 'pending' on a two-stage template, a caller who passes
-- checklist_is_area_manager() closes the sheet ('approved'); their name and
-- signature are written to BOTH the supervisor and approver columns, so the
-- record shows one person signed both steps. A supervisor who is not an area
-- manager still moves it to 'pending_area_manager' exactly as before.
-- guard_checklist_approval_stages is unchanged and accepts this transition
-- (supervisor signature present + area manager).
--
-- The same rule is mirrored in src/lib/checklist/checklistApproval.js
-- (nextStatusFor), mobile/lib/checklistApproval.ts and the Flutter
-- checklist_approval.dart. Change them together.
--
-- ROLLBACK: restore the previous body (the `elsif v_status = 'pending' and
-- v_two_stage then` branch without the area-manager test, and the approved
-- UPDATE without the supervisor_* coalesce lines).

CREATE OR REPLACE FUNCTION public.decide_checklist_approval(p_submission_id uuid, p_decision text, p_note text DEFAULT NULL::text, p_signature text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role      text;
  v_org       uuid;
  v_approver  text;
  v_prev      text;
  v_status    text;
  v_two_stage boolean;
  v_target    text;
  v_both      boolean := false;
begin
  -- cap-guard:approve
  if public.app_cap_revoked('checklists','approve') then
    raise exception 'You are not permitted to approve or decide this record.' using errcode = '42501';
  end if;
  v_role := public.get_my_role();
  if not (public.checklist_is_supervisor() or public.checklist_is_area_manager() or public.app_cap_granted('checklists','approve')) then
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
     and (cs.organisation_id = v_org or public.is_super_admin())
     -- Country + site boundary (audit 2026-09-30).
     and public.app_write_country_ok(cs.country)
     and (cs.site is null or btrim(cs.site) = '' or public.app_can_see_site(cs.site) is not false);

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

  -- WHICH RUNG. Same rule as checklistApproval.nextStatusFor on every client.
  if p_decision = 'rejected' then
    v_target := 'rejected';
  elsif v_status = 'pending' and v_two_stage and not public.checklist_is_area_manager() then
    v_target := 'pending_area_manager';
  else
    v_target := 'approved';
    -- An area manager signing the supervisor step closes both steps at once.
    v_both := (v_status = 'pending' and v_two_stage);
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
       set approval_status      = v_target,
           supervisor_by        = case when v_both then auth.uid() else supervisor_by end,
           supervisor_name      = case when v_both then v_approver else supervisor_name end,
           supervisor_signature = case when v_both then coalesce(p_signature, supervisor_signature) else supervisor_signature end,
           supervisor_at        = case when v_both then now() else supervisor_at end,
           approved_by          = auth.uid(),
           approver_name        = v_approver,
           approver_signature   = coalesce(p_signature, approver_signature),
           approved_at          = now(),
           review_note          = p_note,
           -- Only a real close locks. A supervisor rung must leave the sheet
           -- editable, because the area manager may send it back.
           locked               = (v_target = 'approved')
     where id = p_submission_id
       and approval_status = v_status
       and (organisation_id = v_org or public.is_super_admin());
  end if;

  if not found then
    raise exception 'This checklist was decided by someone else while you were looking at it.';
  end if;

  return jsonb_build_object('ok', true, 'decision', p_decision, 'status', v_target, 'both_steps', v_both);
end;
$function$;
