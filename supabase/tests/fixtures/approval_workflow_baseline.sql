CREATE OR REPLACE FUNCTION public.approval_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org  uuid := public.app_current_org();
  v_role text := lower(regexp_replace(COALESCE(public.get_my_role(), ''), '\s+', '_', 'g'));
  v_out  jsonb;
BEGIN
  IF v_role = '' THEN
    RAISE EXCEPTION 'not authorised';
  END IF;
  WITH scoped AS (
    SELECT wi.*,
           (wi.status IN ('pending','in_review','returned')
            AND (wi.steps -> wi.current_step) ? 'sla_hours'
            AND wi.step_started_at
                + make_interval(mins => round(
                    (wi.steps -> wi.current_step ->> 'sla_hours')::numeric * 60)::int)
                < now()) AS is_overdue
      FROM public.workflow_instances wi
     WHERE (wi.organisation_id IS NULL OR wi.organisation_id = v_org)
  ),
  proj AS (
    SELECT id, definition_id, definition_name, entity_type, entity_id, entity_label,
           status, current_step,
           (steps -> current_step ->> 'name')         AS current_step_name,
           (steps -> current_step ->> 'approver_role') AS current_approver_role,
           (steps -> current_step ->> 'sla_hours')     AS current_sla_hours,
           step_started_at, started_at, completed_at, is_overdue
      FROM scoped
  ),
  metrics AS (
    SELECT
      count(*) FILTER (WHERE status IN ('pending','in_review'))         AS pending_count,
      count(*) FILTER (WHERE is_overdue)                                AS overdue_count,
      count(*) FILTER (WHERE status = 'returned')                       AS returned_count,
      count(*) FILTER (WHERE status = 'rejected')                       AS rejected_count,
      count(*) FILTER (WHERE status = 'approved')                       AS approved_count,
      count(*) FILTER (WHERE status = 'cancelled')                      AS cancelled_count,
      count(*)                                                          AS total_count,
      round(avg(EXTRACT(EPOCH FROM (completed_at - started_at)) / 3600.0)
            FILTER (WHERE status = 'approved' AND completed_at IS NOT NULL)::numeric, 2)
                                                                        AS avg_approval_hours
    FROM proj
  )
  SELECT jsonb_build_object(
    'metrics', (SELECT to_jsonb(m) FROM metrics m),
    'buckets', jsonb_build_object(
      'pending', COALESCE((
        SELECT jsonb_agg(to_jsonb(p) ORDER BY p.step_started_at ASC)
          FROM (SELECT * FROM proj WHERE status IN ('pending','in_review')
                 ORDER BY step_started_at ASC LIMIT 25) p), '[]'::jsonb),
      'overdue', COALESCE((
        SELECT jsonb_agg(to_jsonb(p) ORDER BY p.step_started_at ASC)
          FROM (SELECT * FROM proj WHERE is_overdue
                 ORDER BY step_started_at ASC LIMIT 25) p), '[]'::jsonb),
      'returned', COALESCE((
        SELECT jsonb_agg(to_jsonb(p) ORDER BY p.step_started_at DESC)
          FROM (SELECT * FROM proj WHERE status = 'returned'
                 ORDER BY step_started_at DESC LIMIT 25) p), '[]'::jsonb),
      'rejected', COALESCE((
        SELECT jsonb_agg(to_jsonb(p) ORDER BY p.completed_at DESC)
          FROM (SELECT * FROM proj WHERE status = 'rejected'
                 ORDER BY completed_at DESC NULLS LAST LIMIT 25) p), '[]'::jsonb),
      'recently_approved', COALESCE((
        SELECT jsonb_agg(to_jsonb(p) ORDER BY p.completed_at DESC)
          FROM (SELECT * FROM proj WHERE status = 'approved'
                 ORDER BY completed_at DESC NULLS LAST LIMIT 25) p), '[]'::jsonb)
    )
  ) INTO v_out;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.my_pending_approvals()
 RETURNS SETOF workflow_instances
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT lower(regexp_replace(COALESCE(public.get_my_role(), ''), '\s+', '_', 'g')) AS role,
           auth.uid() AS uid
  )
  SELECT wi.*
    FROM public.workflow_instances wi, me
   WHERE wi.status IN ('pending','in_review','returned')
     AND (wi.organisation_id IS NULL OR wi.organisation_id = public.app_current_org())
     AND (
       me.role = 'admin'
       OR (lower(COALESCE(wi.steps -> wi.current_step ->> 'assignee_type','role')) = 'user'
           AND (wi.steps -> wi.current_step ->> 'approver_user_id') = me.uid::text)
       OR (lower(COALESCE(wi.steps -> wi.current_step ->> 'assignee_type','role')) <> 'user'
           AND lower(regexp_replace(COALESCE(wi.steps -> wi.current_step ->> 'approver_role',''), '\s+', '_', 'g'))
               = me.role)
     )
   ORDER BY wi.started_at;
$function$;

