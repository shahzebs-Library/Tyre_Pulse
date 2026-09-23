-- Read-only captured production RPC/guard baseline, 2026-09-10.
-- Executed only in the isolated PGlite fixture, never a deployment migration.
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

  -- WHICH RUNG. Same rule as checklistApproval.nextStatusFor on both clients.
  if p_decision = 'rejected' then
    v_target := 'rejected';
  elsif v_status = 'pending' and v_two_stage then
    v_target := 'pending_area_manager';
  else
    v_target := 'approved';
  end if;

  -- A clean sentence instead of the trigger's 42501, for the one case a person
  -- will actually hit: a supervisor trying to close a two-stage sheet.
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
           -- Only a real close locks. A supervisor rung must leave the sheet
           -- editable, because the area manager may send it back.
           locked             = (v_target = 'approved')
     where id = p_submission_id
       and approval_status = v_status
       and (organisation_id = v_org or public.is_super_admin());
  end if;

  if not found then
    -- Somebody else moved it between the read and the write.
    raise exception 'This checklist was decided by someone else while you were looking at it.';
  end if;

  return jsonb_build_object('ok', true, 'decision', p_decision, 'status', v_target);
end;
$function$;

CREATE OR REPLACE FUNCTION public.decide_inspection_approval(p_inspection_id uuid, p_decision text, p_note text DEFAULT NULL::text, p_signature text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text; v_org uuid; v_email text; v_prev text; v_approver text; v_status text;
BEGIN
  v_role := public.get_my_role();
  -- Area manager, PMV manager, or Tyre Data Collector signs. Admin kept as fallback.
  IF NOT public.is_super_admin() AND (v_role IS NULL OR v_role NOT IN (
      'Admin','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager','Tyre Data Collector')) THEN
    RAISE EXCEPTION 'Only an area manager, a PMV manager, an admin or a tyre data collector can sign off an inspection';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected.';
  END IF;

  v_org := public.app_current_org();
  v_status := CASE WHEN p_decision = 'approved' THEN 'Done' ELSE 'In Progress' END;

  SELECT COALESCE(full_name, username, email, 'Approver') INTO v_approver
    FROM public.profiles WHERE id = auth.uid();
  SELECT email INTO v_email FROM public.profiles WHERE id = auth.uid();

  UPDATE public.inspections
     SET approval_status = p_decision, status = v_status, approved_by = auth.uid(),
         approver_email = v_email,
         approver_signature = COALESCE(p_signature, approver_signature),
         approved_at = now()
   WHERE id = p_inspection_id
     AND approval_status = 'pending_approval'
     AND (organisation_id = v_org OR public.is_super_admin());

  IF NOT FOUND THEN
    SELECT i.approval_status, COALESCE(pr.full_name, pr.username, 'another approver')
      INTO v_prev, v_approver
      FROM public.inspections i LEFT JOIN public.profiles pr ON pr.id = i.approved_by
     WHERE i.id = p_inspection_id;
    IF v_prev IS NULL THEN
      RAISE EXCEPTION 'That inspection no longer exists.';
    ELSIF v_prev <> 'pending_approval' THEN
      RAISE EXCEPTION 'This inspection was already % by %.', v_prev, v_approver;
    ELSE
      RAISE EXCEPTION 'You do not have access to decide this inspection.';
    END IF;
  END IF;

  IF p_note IS NOT NULL AND btrim(p_note) <> '' THEN
    INSERT INTO public.inspection_audit_log (inspection_id, changed_by, action, new_values)
    VALUES (p_inspection_id, auth.uid(), p_decision || '_note', jsonb_build_object('note', p_note));
  END IF;

  RETURN jsonb_build_object('ok', true, 'decision', p_decision);
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_checklist_approval_stages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_two_stage boolean;
  v_blocking  jsonb;
  v_bad       text;
begin
  if new.approval_status is not distinct from old.approval_status then return new; end if;

  select coalesce(t.require_area_manager, false), t.option_sets #> '{legend,blocking}'
    into v_two_stage, v_blocking
    from public.checklist_templates t where t.id = new.template_id;
  v_two_stage := coalesce(v_two_stage, false);

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
    if v_blocking is not null and jsonb_typeof(v_blocking) = 'array' then
      select string_agg(distinct a.value, ', ') into v_bad
        from jsonb_each_text(coalesce(new.answers, '{}'::jsonb)) a
       where jsonb_exists(v_blocking, a.value);
      if v_bad is not null then
        raise exception 'This checklist still has items marked "%". It cannot be closed until they are corrected or re-marked.', v_bad
          using errcode = '22023';
      end if;
    end if;

    if v_two_stage then
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
$function$;
