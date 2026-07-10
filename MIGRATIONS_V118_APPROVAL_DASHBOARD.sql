-- ============================================================================
-- MIGRATIONS_V118_APPROVAL_DASHBOARD.sql
-- Universal Approval & Workflow Engine — Phase 0 (part 3 of 3).
--
-- APPLY ORDER: run AFTER MIGRATIONS_V117_WORKFLOW_ACTIONS.sql.
--
-- V118 responsibilities:
--   * approval_dashboard() — a SECURITY DEFINER, org-scoped manager RPC
--     returning bucketed instance lists (pending, overdue, returned,
--     rejected, recently_approved) plus headline metrics (counts, avg
--     approval time). Overdue = step_started_at + sla_hours < now() for a
--     still-open instance.
--   * my_pending_approvals() — extended so it also matches steps assigned
--     to the caller by approver_user_id (assignee_type='user'), not only by
--     role, and includes 'in_review'/'returned' open states.
--
-- Backward-compatible: my_pending_approvals keeps its signature and return
-- type (SETOF workflow_instances).
--
-- Rollback: re-create the V97 my_pending_approvals(); DROP approval_dashboard().
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. EXTENDED my_pending_approvals — role OR specific-user assignment,
--    including in_review / returned open states.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_pending_approvals()
RETURNS SETOF public.workflow_instances
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
       -- specific-user assignment on the current step
       OR (lower(COALESCE(wi.steps -> wi.current_step ->> 'assignee_type','role')) = 'user'
           AND (wi.steps -> wi.current_step ->> 'approver_user_id') = me.uid::text)
       -- role assignment on the current step
       OR (lower(COALESCE(wi.steps -> wi.current_step ->> 'assignee_type','role')) <> 'user'
           AND lower(regexp_replace(COALESCE(wi.steps -> wi.current_step ->> 'approver_role',''), '\s+', '_', 'g'))
               = me.role)
     )
   ORDER BY wi.started_at;
$$;
GRANT  EXECUTE ON FUNCTION public.my_pending_approvals() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.my_pending_approvals() FROM PUBLIC, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. approval_dashboard — org-scoped buckets + metrics for the manager page.
--    Returns:
--      { metrics: {...}, buckets: { pending[], overdue[], returned[],
--                                   rejected[], recently_approved[] } }
--    Buckets are capped (25 each) to keep the payload bounded; metrics are
--    computed over the full org set.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approval_dashboard()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
           -- Overdue only meaningful while the instance is still open.
           (wi.status IN ('pending','in_review','returned')
            AND (wi.steps -> wi.current_step) ? 'sla_hours'
            AND wi.step_started_at
                + make_interval(mins => round(
                    (wi.steps -> wi.current_step ->> 'sla_hours')::numeric * 60)::int)
                < now()) AS is_overdue
      FROM public.workflow_instances wi
     WHERE (wi.organisation_id IS NULL OR wi.organisation_id = v_org)
  ),
  -- Compact projection for bucket payloads (avoid dumping full snapshots).
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
      -- Average approval time (hours) across completed-approved runs.
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
$$;
GRANT  EXECUTE ON FUNCTION public.approval_dashboard() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.approval_dashboard() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.approval_dashboard() IS
  'Org-scoped approval manager dashboard: {metrics, buckets{pending,overdue,returned,rejected,recently_approved}}. Overdue = open instance past its current step SLA.';
