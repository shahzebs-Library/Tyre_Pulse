-- ============================================================================
-- V267: mobile push notification when a NEW APPROVAL arrives (applied live
-- via Supabase MCP 2026-07-17; this file is the repo record). Next free V268.
--
-- "When new approval comes it must send a notification to mobile."
--
-- Rides the EXISTING pipeline end to end - no new delivery machinery:
--   emit trigger -> domain_events -> process_domain_events (pg_cron)
--   -> consume_event_approval_push (below) -> workflow_notifications queue
--   -> deliver_workflow_notifications (pg_cron, V119) -> workflow-notify edge fn
--   -> Expo Push API -> profiles.push_token devices.
--
-- Events:
--   inspection.approval_requested  - inspections.approval_status -> 'pending_approval'
--   checklist.approval_requested   - checklist_submissions.approval_status -> 'pending'
--
-- Recipients: profiles with role Admin/Manager/Director/Maintenance Supervisor,
-- approved, org-matched, country-visible, with a registered push_token.
-- 0 recipients -> row enqueued as 'skipped' (honest no-op).
--
-- Rollback:
--   DROP TRIGGER trg_insp_approval_requested_ins ON public.inspections;
--   DROP TRIGGER trg_insp_approval_requested_upd ON public.inspections;
--   DROP TRIGGER trg_cl_approval_requested_ins ON public.checklist_submissions;
--   DROP TRIGGER trg_cl_approval_requested_upd ON public.checklist_submissions;
--   DELETE FROM public.event_consumers WHERE consumer='consume_event_approval_push';
--   DROP FUNCTION public.consume_event_approval_push(public.domain_events);
-- ============================================================================

DROP TRIGGER IF EXISTS trg_insp_approval_requested_ins ON public.inspections;
CREATE TRIGGER trg_insp_approval_requested_ins
  AFTER INSERT ON public.inspections
  FOR EACH ROW
  WHEN (NEW.approval_status = 'pending_approval')
  EXECUTE FUNCTION public.trg_emit_domain_event(
    'inspection.approval_requested', 'inspection', 'id,title,asset_no,site,inspector,country');

DROP TRIGGER IF EXISTS trg_insp_approval_requested_upd ON public.inspections;
CREATE TRIGGER trg_insp_approval_requested_upd
  AFTER UPDATE OF approval_status ON public.inspections
  FOR EACH ROW
  WHEN (NEW.approval_status = 'pending_approval'
        AND OLD.approval_status IS DISTINCT FROM NEW.approval_status)
  EXECUTE FUNCTION public.trg_emit_domain_event(
    'inspection.approval_requested', 'inspection', 'id,title,asset_no,site,inspector,country');

DROP TRIGGER IF EXISTS trg_cl_approval_requested_ins ON public.checklist_submissions;
CREATE TRIGGER trg_cl_approval_requested_ins
  AFTER INSERT ON public.checklist_submissions
  FOR EACH ROW
  WHEN (NEW.approval_status = 'pending')
  EXECUTE FUNCTION public.trg_emit_domain_event(
    'checklist.approval_requested', 'checklist_submission', 'id,template_name,asset_no,site,country');

DROP TRIGGER IF EXISTS trg_cl_approval_requested_upd ON public.checklist_submissions;
CREATE TRIGGER trg_cl_approval_requested_upd
  AFTER UPDATE OF approval_status ON public.checklist_submissions
  FOR EACH ROW
  WHEN (NEW.approval_status = 'pending'
        AND OLD.approval_status IS DISTINCT FROM NEW.approval_status)
  EXECUTE FUNCTION public.trg_emit_domain_event(
    'checklist.approval_requested', 'checklist_submission', 'id,template_name,asset_no,site,country');

CREATE OR REPLACE FUNCTION public.consume_event_approval_push(ev public.domain_events)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_country    text  := NULLIF(ev.payload ->> 'country', '');
  v_label      text;
  v_def        text;
  v_recipients jsonb;
  v_payload    jsonb;
BEGIN
  IF ev.event_type = 'inspection.approval_requested' THEN
    v_def   := 'Inspection';
    v_label := COALESCE(NULLIF(ev.payload ->> 'asset_no', ''), NULLIF(ev.payload ->> 'title', ''), 'An inspection');
  ELSE
    v_def   := 'Checklist';
    v_label := COALESCE(NULLIF(ev.payload ->> 'template_name', ''), 'A checklist');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'user_id', p.id, 'push_token', p.push_token, 'role', p.role)), '[]'::jsonb)
    INTO v_recipients
    FROM public.profiles p
   WHERE p.role IN ('Admin', 'Manager', 'Director', 'Maintenance Supervisor')
     AND COALESCE(p.approved, false)
     AND p.push_token IS NOT NULL AND btrim(p.push_token) <> ''
     AND (ev.organisation_id IS NULL
          OR p.organisation_id = ev.organisation_id
          OR p.org_id = ev.organisation_id)
     AND (v_country IS NULL
          OR p.country IS NULL OR cardinality(p.country) = 0
          OR v_country = ANY (p.country));

  v_payload := jsonb_build_object(
    'event_type',      'workflow.step_advanced',
    'instance_id',     NULL,
    'definition_name', v_def || ' approval',
    'entity_type',     ev.entity_type,
    'entity_label',    v_label || CASE WHEN NULLIF(ev.payload ->> 'site', '') IS NOT NULL
                                       THEN ' (' || (ev.payload ->> 'site') || ')' ELSE '' END,
    'step_name',       'Supervisor approval',
    'recipients',      v_recipients);

  INSERT INTO public.workflow_notifications
    (event_id, organisation_id, instance_id, event_type, payload, recipient_count, status)
  VALUES
    (ev.id, ev.organisation_id, NULL, ev.event_type, v_payload,
     jsonb_array_length(v_recipients),
     CASE WHEN jsonb_array_length(v_recipients) = 0 THEN 'skipped' ELSE 'pending' END)
  ON CONFLICT (event_id) DO NOTHING;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.consume_event_approval_push(public.domain_events)
  FROM PUBLIC, anon, authenticated;

INSERT INTO public.event_consumers (consumer, event_types, description)
VALUES ('consume_event_approval_push',
        ARRAY['inspection.approval_requested', 'checklist.approval_requested'],
        'Pushes an Expo notification to elevated approvers (profiles.push_token) when an inspection or checklist enters the approval queue.')
ON CONFLICT (consumer) DO UPDATE
  SET enabled = true,
      event_types = EXCLUDED.event_types,
      description = EXCLUDED.description;
