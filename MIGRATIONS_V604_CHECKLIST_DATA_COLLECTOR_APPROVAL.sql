-- V604 - allow Tyre Data Collector to approve checklists and tyre inspections
--
-- STATUS: READY TO APPLY.
--
-- Adds 'Tyre Data Collector' to:
--   1. public.checklist_is_supervisor() to allow them to approve checklists at the supervisor rung.
--   2. public.decide_inspection_approval() to allow them to approve tyre inspections.
--

-- ── 1. Checklist Supervisor Rung update
create or replace function public.checklist_is_supervisor()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.is_super_admin() or public.get_my_role() = any (array[
    'Admin','Maintenance Supervisor','Workshop Supervisor',
    'PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager',
    'Tyre Data Collector'
  ]);
$function$;

-- ── 2. Inspection Approval update
create or replace function public.decide_inspection_approval(
  p_inspection_id uuid, p_decision text, p_note text default null, p_signature text default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
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
