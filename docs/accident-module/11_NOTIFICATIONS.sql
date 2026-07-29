-- =============================================================================
-- 11_NOTIFICATIONS.sql  -  Accident CASE notification layer (Phase 16)
--
-- STATUS: AUTHORED, NOT YET APPLIED.
--
-- Runs AFTER: MIGRATIONS_V417 (the accident model migrations) AND
--             docs/accident-module/10_WORKSTREAM_RPCS (the workstream / approval /
--             closure RPCs that write the three case tables this file watches).
-- Re-confirm the free migration number at apply time (V417/V418 are RESERVED for
-- the accident model; this layer claims the next free number when it lands).
--
-- WHAT THIS DOES
--   Wires the accident CASE tables (accident_case_workstreams,
--   accident_case_approvals, accident_closure_reviews) into the EXISTING
--   domain-event bus + workflow_notifications delivery pipeline. NO parallel
--   notification machinery is built - everything after emit_domain_event()
--   already runs:
--
--     case table change
--       -> trg_emit_domain_event (generic, V96)  -> domain_events (status pending)
--       -> process_domain_events (pg_cron 1/min, V96)
--       -> consume_event_accident_case_notify(ev)   [this file]
--            +- ALWAYS inserts in-app notifications (one row per recipient)
--            +- IF system_config.accident_emails_enabled is true:
--                  enqueues a workflow_notifications row (dedupe on event_id)
--       -> deliver_workflow_notifications (pg_cron 1/min, V119)
--       -> workflow-notify edge fn -> Email(Resend) / Push(Expo).
--
--   This mirrors the accident status/claim notifier (V300/V304
--   consume_event_accident_notify) and the approval-push consumer (V267
--   consume_event_approval_push) EXACTLY - same signature, same gate, same
--   dedupe, same recipient-by-role-scoped-to-org+country pattern. The email
--   half is gated OFF by default by system_config.accident_emails_enabled
--   (seeded 'false' in V300), so this ships INERT for email and only ever
--   inserts in-app notifications until an admin flips the master toggle.
--
-- EVENTS EMITTED (registered on the consumer's event_types[])
--   accident.workstream_assigned  - a case workstream gains / changes an owner
--   accident.approval_requested   - a case approval row is raised (decision pending)
--   accident.closure_requested    - a closure review is opened (awaiting a reviewer)
--   accident.closure_decided      - a closure review is decided (reviewed_at set)
--
-- CONSUMER
--   public.consume_event_accident_case_notify(ev public.domain_events)
--
-- SAFETY
--   * Emit uses the schema-tolerant generic trigger (V96 trg_emit_domain_event),
--     which already swallows its own exceptions so an event can NEVER break the
--     case write. entity_id on the event is the source row id; the accident_id
--     travels in the payload so the consumer links each in-app notification to
--     the case (entity_type 'accident').
--   * The consumer is SECURITY DEFINER, search_path public, EXECUTE revoked from
--     PUBLIC/anon/authenticated (only the pg_cron dispatcher calls it).
--   * Recipients are resolved to profiles at send time by role, scoped to the
--     event org + the payload country - no employee id is hardcoded (matches the
--     live V303 routing design). A same-code case in another country is never
--     notified.
--   * 0 recipients -> the workflow_notifications row is enqueued 'skipped'
--     (honest no-op), never a phantom send.
--
-- ROLLBACK
--   DROP TRIGGER trg_ws_assigned_ins   ON public.accident_case_workstreams;
--   DROP TRIGGER trg_ws_assigned_upd   ON public.accident_case_workstreams;
--   DROP TRIGGER trg_appr_requested_ins ON public.accident_case_approvals;
--   DROP TRIGGER trg_closure_requested_ins ON public.accident_closure_reviews;
--   DROP TRIGGER trg_closure_decided_upd   ON public.accident_closure_reviews;
--   DELETE FROM public.event_consumers WHERE consumer='consume_event_accident_case_notify';
--   DROP FUNCTION public.consume_event_accident_case_notify(public.domain_events);
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PART 1 - EMIT TRIGGERS (generic V96 trg_emit_domain_event; conditions in WHEN)
-- -----------------------------------------------------------------------------
-- TG_ARGV[0] = event_type, TG_ARGV[1] = entity_type, TG_ARGV[2] = payload key
-- whitelist. Only keys present on the row are copied, so a schema drift can
-- never raise. accident_id is whitelisted on every one so the consumer can link
-- the in-app notification to the parent case.

-- 1a. Workstream owner assigned or changed -> accident.workstream_assigned
DROP TRIGGER IF EXISTS trg_ws_assigned_ins ON public.accident_case_workstreams;
CREATE TRIGGER trg_ws_assigned_ins
  AFTER INSERT ON public.accident_case_workstreams
  FOR EACH ROW
  WHEN (NEW.owner_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_emit_domain_event(
    'accident.workstream_assigned', 'accident_case_workstream',
    'accident_id,organisation_id,country,site,workstream_key,status,owner_id,owner_role,team');

DROP TRIGGER IF EXISTS trg_ws_assigned_upd ON public.accident_case_workstreams;
CREATE TRIGGER trg_ws_assigned_upd
  AFTER UPDATE OF owner_id ON public.accident_case_workstreams
  FOR EACH ROW
  WHEN (NEW.owner_id IS NOT NULL AND NEW.owner_id IS DISTINCT FROM OLD.owner_id)
  EXECUTE FUNCTION public.trg_emit_domain_event(
    'accident.workstream_assigned', 'accident_case_workstream',
    'accident_id,organisation_id,country,site,workstream_key,status,owner_id,owner_role,team');

-- 1b. A case approval is raised (decision pending) -> accident.approval_requested
DROP TRIGGER IF EXISTS trg_appr_requested_ins ON public.accident_case_approvals;
CREATE TRIGGER trg_appr_requested_ins
  AFTER INSERT ON public.accident_case_approvals
  FOR EACH ROW
  WHEN (NEW.decision = 'pending')
  EXECUTE FUNCTION public.trg_emit_domain_event(
    'accident.approval_requested', 'accident_case_approval',
    'accident_id,organisation_id,country,site,approval_type,workstream_key,amount,requested_by');

-- 1c. A closure review is opened (awaiting a reviewer) -> accident.closure_requested
--     reviewed_at NULL at insert time is the "requested / awaiting review" state.
DROP TRIGGER IF EXISTS trg_closure_requested_ins ON public.accident_closure_reviews;
CREATE TRIGGER trg_closure_requested_ins
  AFTER INSERT ON public.accident_closure_reviews
  FOR EACH ROW
  WHEN (NEW.reviewed_at IS NULL)
  EXECUTE FUNCTION public.trg_emit_domain_event(
    'accident.closure_requested', 'accident_closure_review',
    'accident_id,organisation_id,country,site,level,decision');

-- 1d. A closure review is decided (reviewed_at set) -> accident.closure_decided
DROP TRIGGER IF EXISTS trg_closure_decided_upd ON public.accident_closure_reviews;
CREATE TRIGGER trg_closure_decided_upd
  AFTER UPDATE OF reviewed_at ON public.accident_closure_reviews
  FOR EACH ROW
  WHEN (NEW.reviewed_at IS NOT NULL AND OLD.reviewed_at IS NULL)
  EXECUTE FUNCTION public.trg_emit_domain_event(
    'accident.closure_decided', 'accident_closure_review',
    'accident_id,organisation_id,country,site,level,decision,reviewer_id');

-- -----------------------------------------------------------------------------
-- PART 2 - CONSUMER
-- -----------------------------------------------------------------------------
-- Resolves recipients, ALWAYS writes in-app notifications, and (only when the
-- master email gate is on) enqueues one workflow_notifications row for delivery.
CREATE OR REPLACE FUNCTION public.consume_event_accident_case_notify(ev public.domain_events)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org        uuid := ev.organisation_id;
  v_country    text := NULLIF(ev.payload ->> 'country', '');
  v_accident   uuid := NULLIF(ev.payload ->> 'accident_id', '')::uuid;
  v_owner      uuid := NULLIF(ev.payload ->> 'owner_id', '')::uuid;
  v_requester  uuid := NULLIF(ev.payload ->> 'requested_by', '')::uuid;
  v_reviewer   uuid := NULLIF(ev.payload ->> 'reviewer_id', '')::uuid;
  v_ws         text := NULLIF(ev.payload ->> 'workstream_key', '');
  v_appr       text := NULLIF(ev.payload ->> 'approval_type', '');
  v_level      text := NULLIF(ev.payload ->> 'level', '');
  v_decision   text := NULLIF(ev.payload ->> 'decision', '');
  v_ntype      text := 'info';
  v_ref        text;
  v_asset      text;
  v_site       text;
  v_ctx        text;
  v_title      text;
  v_body       text;
  v_targets    uuid[] := '{}';
  v_recipients jsonb;
  v_wf_payload jsonb;
  v_gate       text;
  v_emails_on  boolean;
BEGIN
  -- Case context for a readable label (accident_id travels in the payload).
  IF v_accident IS NOT NULL THEN
    SELECT COALESCE(NULLIF(a.reference_no, ''), NULLIF(a.case_no, ''), 'Case'),
           COALESCE(NULLIF(a.asset_no, ''), 'Unknown asset'),
           COALESCE(NULLIF(a.site, ''), v_country, '')
      INTO v_ref, v_asset, v_site
      FROM public.accidents a
     WHERE a.id = v_accident;
  END IF;
  v_ref  := COALESCE(v_ref, 'Case');
  v_asset := COALESCE(v_asset, 'Unknown asset');
  v_ctx  := v_ref || ' | ' || v_asset || CASE WHEN NULLIF(v_site,'') IS NOT NULL
                                              THEN ' (' || v_site || ')' ELSE '' END;

  -- Build the message + recipient target set per event type.
  IF ev.event_type = 'accident.workstream_assigned' THEN
    v_ntype := 'info';
    v_title := 'Workstream assigned - ' || v_asset;
    v_body  := COALESCE(v_ws, 'A workstream') || ' assigned. ' || v_ctx;
    -- The assigned owner is the recipient; fall back to elevated when unowned.
    IF v_owner IS NOT NULL THEN
      v_targets := ARRAY[v_owner];
    END IF;

  ELSIF ev.event_type = 'accident.approval_requested' THEN
    v_ntype := 'warning';
    v_title := 'Approval requested - ' || v_asset;
    v_body  := COALESCE(v_appr, 'An approval')
               || CASE WHEN NULLIF(ev.payload ->> 'amount','') IS NOT NULL
                       THEN ' (' || (ev.payload ->> 'amount') || ')' ELSE '' END
               || ' requires a decision. ' || v_ctx;

  ELSIF ev.event_type = 'accident.closure_requested' THEN
    v_ntype := 'info';
    v_title := 'Closure requested - ' || v_asset;
    v_body  := 'Closure review'
               || CASE WHEN v_level IS NOT NULL THEN ' (' || v_level || ')' ELSE '' END
               || ' awaiting a decision. ' || v_ctx;

  ELSIF ev.event_type = 'accident.closure_decided' THEN
    v_ntype := CASE WHEN v_decision = 'approved' THEN 'success'
                    WHEN v_decision = 'rejected' THEN 'warning' ELSE 'info' END;
    v_title := 'Closure ' || COALESCE(v_decision, 'updated') || ' - ' || v_asset;
    v_body  := 'Closure review'
               || CASE WHEN v_level IS NOT NULL THEN ' (' || v_level || ')' ELSE '' END
               || ' decided: ' || COALESCE(v_decision, 'updated') || '. ' || v_ctx;
    -- Let the person who requested closure know the outcome, plus the elevated approvers.
    IF v_requester IS NOT NULL THEN v_targets := array_append(v_targets, v_requester); END IF;

  ELSE
    RETURN;  -- not one of ours
  END IF;

  -- Add the elevated approver pool (approvals + closures always; workstream only
  -- when it has no owner to notify). Scoped to org + payload country.
  IF ev.event_type IN ('accident.approval_requested','accident.closure_requested','accident.closure_decided')
     OR (ev.event_type = 'accident.workstream_assigned' AND v_owner IS NULL) THEN
    v_targets := v_targets || COALESCE((
      SELECT array_agg(p.id)
        FROM public.profiles p
       WHERE p.role IN ('Admin','Manager','Director')
         AND COALESCE(p.locked, false) = false
         AND (p.approved IS NULL OR p.approved = true)
         AND (v_org IS NULL OR p.organisation_id = v_org OR p.org_id = v_org)
         AND (v_country IS NULL
              OR p.country IS NULL OR cardinality(p.country) = 0
              OR v_country = ANY (p.country))
    ), '{}'::uuid[]);
  END IF;

  -- De-duplicate the target set.
  SELECT COALESCE(array_agg(DISTINCT t), '{}'::uuid[]) INTO v_targets
    FROM unnest(v_targets) AS t WHERE t IS NOT NULL;

  -- (a) ALWAYS write one in-app notification per recipient (linked to the case).
  IF array_length(v_targets, 1) IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
    SELECT t, v_ntype, v_title, v_body, 'accident', v_accident
      FROM unnest(v_targets) AS t;
  END IF;

  -- (b) Email/push half - gated OFF by default, mirrors the accident notifier.
  SELECT value INTO v_gate FROM public.system_config WHERE key = 'accident_emails_enabled';
  v_emails_on := lower(COALESCE(v_gate, 'false')) IN ('true','t','1','on','yes');
  IF NOT v_emails_on THEN
    RETURN;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'user_id', p.id, 'push_token', p.push_token, 'role', p.role, 'email', p.email)), '[]'::jsonb)
    INTO v_recipients
    FROM public.profiles p
   WHERE p.id = ANY (v_targets);

  v_wf_payload := jsonb_build_object(
    'event_type',      'workflow.step_advanced',
    'instance_id',     NULL,
    'definition_name', 'Accident case',
    'entity_type',     'accident',
    'entity_label',    v_ctx,
    'step_name',       v_title,
    'body',            v_body,
    'push',            jsonb_build_object('title', v_title, 'body', v_body),
    'recipients',      v_recipients);

  INSERT INTO public.workflow_notifications
    (event_id, organisation_id, instance_id, event_type, payload, recipient_count, status)
  VALUES
    (ev.id, v_org, NULL, ev.event_type, v_wf_payload,
     jsonb_array_length(v_recipients),
     CASE WHEN jsonb_array_length(v_recipients) = 0 THEN 'skipped' ELSE 'pending' END)
  ON CONFLICT (event_id) DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_event_accident_case_notify(public.domain_events)
  FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- PART 3 - REGISTER THE CONSUMER
-- -----------------------------------------------------------------------------
INSERT INTO public.event_consumers (consumer, event_types, description)
VALUES ('consume_event_accident_case_notify',
        ARRAY['accident.workstream_assigned','accident.approval_requested',
              'accident.closure_requested','accident.closure_decided'],
        'Accident CASE layer: in-app notifications (always) + gated workflow_notifications for workstream assignment, approval requests, and closure request/decision. Recipients resolved by role scoped to org + country.')
ON CONFLICT (consumer) DO UPDATE
  SET enabled     = true,
      event_types = EXCLUDED.event_types,
      description = EXCLUDED.description;

-- =============================================================================
-- VERIFY (after apply, impersonating a real user - app_current_org() is NULL in
-- an MCP session, so emit + consume both need a session org)
--   1. Assign a workstream owner   -> 1 domain_events row accident.workstream_assigned,
--      1 notifications row to that owner, workflow_notifications skipped (gate off).
--   2. Raise a pending approval    -> accident.approval_requested to elevated approvers.
--   3. Open a closure review       -> accident.closure_requested to elevated approvers.
--   4. Decide the closure review   -> accident.closure_decided to requester + approvers.
--   5. Flip system_config.accident_emails_enabled='true' and repeat step 2 ->
--      a workflow_notifications row is enqueued 'pending' for delivery.
-- All 4 in one rolled-back transaction; confirm 0 rows persist.
-- =============================================================================
