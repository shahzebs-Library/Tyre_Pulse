-- ============================================================================
-- V297: mobile push when a TECHNICIAN is ASSIGNED (or reassigned) to a workshop
-- job (applied live via Supabase MCP 2026-07-20; this file is the repo record).
-- Next free migration V298.
--
-- "Notify a technician the moment a job is assigned/reassigned to them."
--
-- Rides the EXISTING pipeline end to end - NO new delivery machinery, NO parallel
-- notification system:
--   emit trigger (V267 generic trg_emit_domain_event) -> domain_events
--   -> process_domain_events (pg_cron) -> consume_event_assignment_push (below)
--   -> workflow_notifications queue (V119)
--   -> deliver_workflow_notifications (pg_cron, V119) -> workflow-notify edge fn
--   -> Expo Push API -> the assignee's profiles.push_token device.
--
-- MECHANISM CHOSEN = the V267 generic emitter (reuse, least new surface):
--   * an INSERT-only AFTER trigger on wo_assignments calls the GENERIC
--     public.trg_emit_domain_event(event_type, entity_type, cols) - no bespoke
--     emitter function was written.
--   * a new consumer public.consume_event_assignment_push mirrors
--     consume_event_approval_push (V267) but targets ONLY the assignee.
--
-- WHY INSERT-only: the app's assignJob() INSERTs a new wo_assignments row, and
-- reassignJob() UPDATEs the old row(s) active=false (a release, no INSERT) then
-- INSERTs a fresh row for the NEW technician. So an INSERT-only trigger notifies
-- exactly the newly-assigned tech, ONCE, and never double-fires on the active-flag
-- flip of a reassign/release. The WHEN clause further requires a genuinely ACTIVE
-- assignment with a real user_id.
--
-- RECIPIENT / SCOPING (PII-safe): the single assignee (wo_assignments.user_id)
-- IF that profile is approved, has a non-blank push_token, is in the event's
-- organisation, and the event country is visible to them (profiles.country[] or
-- all-countries). The work order is looked up by job_id ONLY to build a
-- work_order_no + asset_no label. 0 push_token or a missing work order =>
-- enqueued as status 'skipped' (honest no-op, 0 recipients). The enqueue is
-- decoupled from and never blocks the wo_assignments INSERT (the generic emitter
-- swallows all errors; the consumer runs later under pg_cron with per-consumer
-- exception isolation).
--
-- Edge fn: workflow-notify redeployed (v3 -> v4, verify_jwt=false preserved) with
-- ONE additive buildMessage case so payload.event_type='workflow.assigned'
-- renders title "New job assigned" / body "You have been assigned <label>."
-- (every pre-existing approval case is byte-identical). Repo source updated to
-- match: supabase/functions/workflow-notify/index.ts.
--
-- LIVE VERIFICATION (rolled back via RAISE EXCEPTION, no test data persisted):
--   CASE A (assignee WITH push_token): wo_assignments INSERT ok; exactly 1
--     workflow_notifications row; recipient_count=1; status=pending;
--     payload.event_type=workflow.assigned;
--     label="work order WO-VERIFY-297 (asset ASSET-297)"; recipient_id = the tech.
--   CASE B (assignee with NO push_token): wo_assignments INSERT ok;
--     recipient_count=0; status=skipped (clean no-op).
--   Post-check: 0 leftover work_orders / domain_events / workflow_notifications;
--     consume_event_assignment_push enabled=true.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_wo_assignment_push_ins ON public.wo_assignments;
--   DELETE FROM public.event_consumers WHERE consumer='consume_event_assignment_push';
--   DROP FUNCTION IF EXISTS public.consume_event_assignment_push(public.domain_events);
--   (and redeploy workflow-notify without the workflow.assigned case, if desired)
-- ============================================================================

-- 1) Emit a domain event on a genuinely NEW active assignment (INSERT-only).
DROP TRIGGER IF EXISTS trg_wo_assignment_push_ins ON public.wo_assignments;
CREATE TRIGGER trg_wo_assignment_push_ins
  AFTER INSERT ON public.wo_assignments
  FOR EACH ROW
  WHEN (NEW.active = true AND NEW.user_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_emit_domain_event(
    'workshop.job_assigned', 'wo_assignment', 'id,job_id,user_id,site,country');

-- 2) Consumer: notify ONLY the assignee (user_id), PII-safe, org+country scoped.
CREATE OR REPLACE FUNCTION public.consume_event_assignment_push(ev public.domain_events)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user       uuid := NULLIF(ev.payload ->> 'user_id', '')::uuid;
  v_job        uuid := NULLIF(ev.payload ->> 'job_id', '')::uuid;
  v_country    text := NULLIF(ev.payload ->> 'country', '');
  v_wo_no      text;
  v_asset      text;
  v_label      text;
  v_recipients jsonb;
  v_payload    jsonb;
BEGIN
  IF v_user IS NULL THEN
    RETURN;  -- no assignee to notify
  END IF;

  -- Work-order label (skip cleanly if the job is missing).
  SELECT wo.work_order_no, wo.asset_no
    INTO v_wo_no, v_asset
    FROM public.work_orders wo
   WHERE wo.id = v_job
   LIMIT 1;

  v_label := COALESCE(
    CASE WHEN NULLIF(v_wo_no, '') IS NOT NULL
         THEN 'work order ' || v_wo_no
              || CASE WHEN NULLIF(v_asset, '') IS NOT NULL THEN ' (asset ' || v_asset || ')' ELSE '' END
    END,
    CASE WHEN NULLIF(v_asset, '') IS NOT NULL THEN 'a job on asset ' || v_asset END,
    'a job');

  -- Recipient = the assignee only: approved, org-matched, country-visible, push-enabled.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'user_id', p.id, 'push_token', p.push_token, 'role', p.role)), '[]'::jsonb)
    INTO v_recipients
    FROM public.profiles p
   WHERE p.id = v_user
     AND COALESCE(p.approved, false)
     AND p.push_token IS NOT NULL AND btrim(p.push_token) <> ''
     AND (ev.organisation_id IS NULL
          OR p.organisation_id = ev.organisation_id
          OR p.org_id = ev.organisation_id)
     AND (v_country IS NULL
          OR p.country IS NULL OR cardinality(p.country) = 0
          OR v_country = ANY (p.country));

  v_payload := jsonb_build_object(
    'event_type',      'workflow.assigned',   -- drives the workflow-notify edge fn message
    'instance_id',     NULL,
    'definition_name', 'Job',
    'entity_type',     'work_order',
    'entity_label',    v_label,
    'step_name',       'assignment',
    'recipients',      v_recipients);

  INSERT INTO public.workflow_notifications
    (event_id, organisation_id, instance_id, event_type, payload, recipient_count, status)
  VALUES
    (ev.id, ev.organisation_id, NULL, ev.event_type, v_payload,
     jsonb_array_length(v_recipients),
     CASE WHEN jsonb_array_length(v_recipients) = 0 THEN 'skipped' ELSE 'pending' END)
  ON CONFLICT (event_id) DO NOTHING;   -- idempotent: one notification per domain event
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_event_assignment_push(public.domain_events)
  FROM PUBLIC, anon, authenticated;

-- 3) Register the consumer for the workshop.job_assigned event type.
INSERT INTO public.event_consumers (consumer, event_types, description)
VALUES ('consume_event_assignment_push',
        ARRAY['workshop.job_assigned'],
        'Pushes an Expo notification to the assigned technician (profiles.push_token) when a workshop job/task is assigned or reassigned to them.')
ON CONFLICT (consumer) DO UPDATE
  SET enabled = true,
      event_types = EXCLUDED.event_types,
      description = EXCLUDED.description;
