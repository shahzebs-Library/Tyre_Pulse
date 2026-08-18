-- V600 - who signs. Area manager or PMV manager, not a Manager.
--
-- STATUS: APPLIED live on jhssdmeruxtrlqnwfksc.
--
-- MEASURED BEFORE TIGHTENING: 372 inspections have been approved and EVERY ONE
-- was approved by an Admin. No Manager and no Director has ever signed one, so
-- removing them costs nothing in practice. 33 are pending right now and only 2
-- people hold an area-manager / PMV role, so Admin stays as the valve that
-- clears a jam.
--
-- PROVEN LIVE by impersonating every real holder of each role against a real
-- pending inspection, rolled back: Manager REFUSED, Director REFUSED, Tyre Man
-- REFUSED, PMV Manager ACCEPTED. The Workshop Maintenance Area Manager returned
-- "already approved" rather than a permission error - it passed the role gate
-- and was stopped only by the row the PMV Manager had just decided in the same
-- transaction, which is the optimistic-concurrency guard doing its job.
--
-- ROLLBACK: re-create both functions with their V594/V599 role arrays.

create or replace function public.decide_inspection_approval(
  p_inspection_id uuid, p_decision text, p_note text default null, p_signature text default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
DECLARE
  v_role text; v_org uuid; v_email text; v_prev text; v_approver text; v_status text;
BEGIN
  v_role := public.get_my_role();
  -- Area manager or PMV manager signs. Admin kept deliberately: it is the only
  -- role that has ever approved one, and 33 are waiting.
  IF NOT public.is_super_admin() AND (v_role IS NULL OR v_role NOT IN (
      'Admin','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager')) THEN
    RAISE EXCEPTION 'Only an area manager, a PMV manager or an admin can sign off an inspection';
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

-- The checklist SUPERVISOR rung: the trades' own supervisors sign first.
-- Manager, Director and Fleet Supervisor come out - they are not who signs.
create or replace function public.checklist_is_supervisor()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.is_super_admin() or public.get_my_role() = any (array[
    'Admin','Maintenance Supervisor','Workshop Supervisor',
    'PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager'
  ]);
$function$;

do $$
begin
  -- Director must stay on the FINAL rung. Exactly one person holds an
  -- area-manager role; a closing rung nobody else can reach jams the moment
  -- they take leave. That is V594's recorded reasoning and it still holds.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'checklist_is_area_manager'
      and pg_get_functiondef(p.oid) like '%Director%'
  ) then
    raise exception 'V600: the final rung lost Director, which would jam the queue';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'checklist_is_supervisor'
      and pg_get_functiondef(p.oid) like '%''Manager''%'
  ) then
    raise exception 'V600: Manager is still on the supervisor rung';
  end if;
end $$;
