-- ============================================================================
-- MIGRATIONS_V97_WORKFLOW_ENGINE.sql
-- Phase 19 (roadmap): generic, durable approval-workflow engine.
--
-- Generalizes the hand-coded accident-closure / budget / import approval
-- state machines into configurable multi-step approval chains:
--   * workflow_definitions — admin-configured chains (steps jsonb:
--     [{"name","approver_role","sla_hours"}...]), optionally auto-started by
--     a domain event (trigger_event, consumed via V96's event_consumers).
--   * workflow_instances — durable runs with a steps SNAPSHOT (definition
--     edits never affect in-flight approvals — Temporal-style determinism).
--   * workflow_step_events — append-only audit of every action.
-- RPCs: start_workflow / workflow_act / workflow_cancel / my_pending_approvals.
-- SLA escalation via pg_cron (hourly): overdue steps notify org admins once.
--
-- Depends on: V96 (domain_events, event_consumers, emit_domain_event),
--             V42 (app_current_org), V22 (notifications, is_elevated_user).
--
-- Rollback:
--   SELECT cron.unschedule('escalate-workflows');
--   DELETE FROM public.event_consumers WHERE consumer = 'consume_event_workflows';
--   DROP FUNCTION public.consume_event_workflows(public.domain_events);
--   DROP FUNCTION public.escalate_overdue_workflow_steps();
--   DROP FUNCTION public.my_pending_approvals();
--   DROP FUNCTION public.workflow_cancel(uuid,text);
--   DROP FUNCTION public.workflow_act(uuid,text,text);
--   DROP FUNCTION public.start_workflow(uuid,text,text,text,jsonb);
--   DROP FUNCTION public._workflow_launch(uuid,text,text,text,jsonb,uuid,bigint);
--   DROP FUNCTION public.notify_role_in_org(text,uuid,text,text,text,text,uuid);
--   DROP TABLE public.workflow_step_events;
--   DROP TABLE public.workflow_instances;
--   DROP TABLE public.workflow_definitions;
--   DROP FUNCTION public.validate_workflow_steps(jsonb);
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. STEP VALIDATION
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_workflow_steps(p_steps jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  s jsonb;
BEGIN
  IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array' OR jsonb_array_length(p_steps) = 0
     OR jsonb_array_length(p_steps) > 10 THEN
    RETURN false;
  END IF;
  FOR s IN SELECT * FROM jsonb_array_elements(p_steps) LOOP
    IF jsonb_typeof(s) <> 'object'
       OR COALESCE(trim(s ->> 'name'), '') = ''
       OR lower(COALESCE(s ->> 'approver_role', ''))
            NOT IN ('admin','manager','director') THEN
      RETURN false;
    END IF;
    IF s ? 'sla_hours' AND (s ->> 'sla_hours') !~ '^\d+(\.\d+)?$' THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TABLES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workflow_definitions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid DEFAULT public.app_current_org(),
  name            text NOT NULL,
  description     text,
  entity_type     text NOT NULL,                 -- 'accident','work_order','purchase_order',...
  trigger_event   text,                          -- domain event type that auto-starts this chain
  steps           jsonb NOT NULL CHECK (public.validate_workflow_steps(steps)),
  active          boolean     NOT NULL DEFAULT true,
  created_by      uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_org
  ON public.workflow_definitions (organisation_id, active);
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_trigger
  ON public.workflow_definitions (trigger_event) WHERE trigger_event IS NOT NULL AND active;

CREATE TABLE IF NOT EXISTS public.workflow_instances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id   uuid REFERENCES public.workflow_definitions(id) ON DELETE SET NULL,
  definition_name text NOT NULL,
  organisation_id uuid,
  entity_type     text NOT NULL,
  entity_id       text,
  entity_label    text,
  steps           jsonb NOT NULL,                -- snapshot at start
  current_step    int  NOT NULL DEFAULT 0,
  step_started_at timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','cancelled')),
  context         jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_event_id bigint,
  started_by      uuid,
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_org_status
  ON public.workflow_instances (organisation_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_entity
  ON public.workflow_instances (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS public.workflow_step_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instance_id     uuid NOT NULL REFERENCES public.workflow_instances(id) ON DELETE CASCADE,
  organisation_id uuid,
  step_index      int  NOT NULL,
  step_name       text,
  action          text NOT NULL CHECK (action IN ('started','approved','rejected','escalated','cancelled')),
  actor_id        uuid,
  comment         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workflow_step_events_instance
  ON public.workflow_step_events (instance_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS — reads for org members; ALL writes via SECURITY DEFINER RPCs.
--    Definitions are writable directly by elevated users in their org
--    (same pattern as module_permissions admin config).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.workflow_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_definitions_select ON public.workflow_definitions;
CREATE POLICY workflow_definitions_select ON public.workflow_definitions
  FOR SELECT TO authenticated
  USING (organisation_id IS NULL OR organisation_id = (SELECT public.app_current_org()));
DROP POLICY IF EXISTS workflow_definitions_write ON public.workflow_definitions;
CREATE POLICY workflow_definitions_write ON public.workflow_definitions
  FOR ALL TO authenticated
  USING ((SELECT public.is_elevated_user())
         AND (organisation_id IS NULL OR organisation_id = (SELECT public.app_current_org())))
  WITH CHECK ((SELECT public.is_elevated_user())
         AND (organisation_id IS NULL OR organisation_id = (SELECT public.app_current_org())));

ALTER TABLE public.workflow_instances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_instances_select ON public.workflow_instances;
CREATE POLICY workflow_instances_select ON public.workflow_instances
  FOR SELECT TO authenticated
  USING (organisation_id IS NULL OR organisation_id = (SELECT public.app_current_org()));

ALTER TABLE public.workflow_step_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_step_events_select ON public.workflow_step_events;
CREATE POLICY workflow_step_events_select ON public.workflow_step_events
  FOR SELECT TO authenticated
  USING (organisation_id IS NULL OR organisation_id = (SELECT public.app_current_org()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ORG-SCOPED ROLE NOTIFICATION (notify_elevated_users is global — this
--    one targets a role inside one organisation)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_role_in_org(
  p_role        text,
  p_org         uuid,
  p_type        text,
  p_title       text,
  p_body        text,
  p_entity_type text DEFAULT 'workflow',
  p_entity_id   uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
  SELECT id, p_type, p_title, p_body, p_entity_type, p_entity_id
    FROM public.profiles
   WHERE lower(regexp_replace(COALESCE(role, ''), '\s+', '_', 'g')) = lower(p_role)
     AND COALESCE(locked, false) = false
     AND (approved IS NULL OR approved = true)
     AND (p_org IS NULL OR organisation_id = p_org);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notify_role_in_org(text,uuid,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CORE LAUNCH (shared by the user RPC and the event consumer)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._workflow_launch(
  p_definition_id uuid,
  p_entity_type   text,
  p_entity_id     text,
  p_entity_label  text,
  p_context       jsonb,
  p_actor         uuid,
  p_source_event  bigint
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_def  public.workflow_definitions%ROWTYPE;
  v_id   uuid;
  v_step jsonb;
BEGIN
  SELECT * INTO v_def FROM public.workflow_definitions WHERE id = p_definition_id AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow definition not found or inactive';
  END IF;

  -- Idempotency: one pending run per (definition, entity). Protects against
  -- at-least-once event replays and double-clicks.
  SELECT id INTO v_id FROM public.workflow_instances
   WHERE definition_id = p_definition_id
     AND entity_type = p_entity_type
     AND entity_id IS NOT DISTINCT FROM p_entity_id
     AND status = 'pending'
   LIMIT 1;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.workflow_instances
    (definition_id, definition_name, organisation_id, entity_type, entity_id,
     entity_label, steps, context, source_event_id, started_by)
  VALUES
    (v_def.id, v_def.name, v_def.organisation_id, p_entity_type, p_entity_id,
     p_entity_label, v_def.steps, COALESCE(p_context, '{}'::jsonb), p_source_event, p_actor)
  RETURNING id INTO v_id;

  v_step := v_def.steps -> 0;
  INSERT INTO public.workflow_step_events (instance_id, organisation_id, step_index, step_name, action, actor_id)
  VALUES (v_id, v_def.organisation_id, 0, v_step ->> 'name', 'started', p_actor);

  PERFORM public.notify_role_in_org(
    v_step ->> 'approver_role', v_def.organisation_id,
    'approval',
    'Approval required: ' || v_def.name,
    COALESCE(p_entity_label, p_entity_type || ' ' || COALESCE(p_entity_id, '')) ||
      ' is waiting at step "' || (v_step ->> 'name') || '".',
    'workflow', v_id);

  PERFORM public.emit_domain_event('workflow.started', 'workflow_instance', v_id::text,
    jsonb_build_object('definition', v_def.name, 'entity_type', p_entity_type,
                       'entity_id', p_entity_id, 'step', v_step ->> 'name'),
    v_def.organisation_id, p_actor);

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._workflow_launch(uuid,text,text,text,jsonb,uuid,bigint) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. USER-FACING RPCs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_workflow(
  p_definition_id uuid,
  p_entity_type   text,
  p_entity_id     text DEFAULT NULL,
  p_entity_label  text DEFAULT NULL,
  p_context       jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_my_role() IS NULL THEN
    RAISE EXCEPTION 'not authorised';
  END IF;
  RETURN public._workflow_launch(p_definition_id, p_entity_type, p_entity_id,
                                 p_entity_label, p_context, auth.uid(), NULL);
END;
$$;
GRANT EXECUTE ON FUNCTION public.start_workflow(uuid,text,text,text,jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.start_workflow(uuid,text,text,text,jsonb) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.workflow_act(
  p_instance_id uuid,
  p_action      text,               -- 'approve' | 'reject'
  p_comment     text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst    public.workflow_instances%ROWTYPE;
  v_role    text;
  v_step    jsonb;
  v_next    jsonb;
  v_total   int;
BEGIN
  v_role := lower(regexp_replace(COALESCE(public.get_my_role(), ''), '\s+', '_', 'g'));
  IF v_role = '' THEN
    RAISE EXCEPTION 'not authorised';
  END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RAISE EXCEPTION 'invalid action %', p_action;
  END IF;

  SELECT * INTO v_inst FROM public.workflow_instances
   WHERE id = p_instance_id FOR UPDATE;
  IF NOT FOUND OR v_inst.status <> 'pending' THEN
    RAISE EXCEPTION 'workflow instance not found or already completed';
  END IF;
  IF v_inst.organisation_id IS NOT NULL AND v_inst.organisation_id <> public.app_current_org() THEN
    RAISE EXCEPTION 'not authorised';
  END IF;

  v_step  := v_inst.steps -> v_inst.current_step;
  v_total := jsonb_array_length(v_inst.steps);

  -- Only the step's approver role (or an admin) may act.
  IF v_role <> 'admin' AND v_role <> lower(v_step ->> 'approver_role') THEN
    RAISE EXCEPTION 'this step requires role %', v_step ->> 'approver_role';
  END IF;

  INSERT INTO public.workflow_step_events
    (instance_id, organisation_id, step_index, step_name, action, actor_id, comment)
  VALUES
    (v_inst.id, v_inst.organisation_id, v_inst.current_step, v_step ->> 'name',
     CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END, auth.uid(), p_comment);

  IF p_action = 'reject' THEN
    UPDATE public.workflow_instances
       SET status = 'rejected', completed_at = now()
     WHERE id = v_inst.id;
    IF v_inst.started_by IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
      VALUES (v_inst.started_by, 'approval',
              'Rejected: ' || v_inst.definition_name,
              COALESCE(v_inst.entity_label, v_inst.entity_type) || ' was rejected at step "' ||
                (v_step ->> 'name') || '"' || COALESCE(': ' || p_comment, '.'),
              'workflow', v_inst.id);
    END IF;
    PERFORM public.emit_domain_event('workflow.rejected', 'workflow_instance', v_inst.id::text,
      jsonb_build_object('definition', v_inst.definition_name, 'step', v_step ->> 'name',
                         'comment', p_comment, 'entity_type', v_inst.entity_type,
                         'entity_id', v_inst.entity_id),
      v_inst.organisation_id, auth.uid());
    RETURN jsonb_build_object('status', 'rejected');
  END IF;

  IF v_inst.current_step + 1 >= v_total THEN
    UPDATE public.workflow_instances
       SET status = 'approved', completed_at = now()
     WHERE id = v_inst.id;
    IF v_inst.started_by IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
      VALUES (v_inst.started_by, 'approval',
              'Approved: ' || v_inst.definition_name,
              COALESCE(v_inst.entity_label, v_inst.entity_type) || ' completed all approval steps.',
              'workflow', v_inst.id);
    END IF;
    PERFORM public.emit_domain_event('workflow.approved', 'workflow_instance', v_inst.id::text,
      jsonb_build_object('definition', v_inst.definition_name, 'entity_type', v_inst.entity_type,
                         'entity_id', v_inst.entity_id),
      v_inst.organisation_id, auth.uid());
    RETURN jsonb_build_object('status', 'approved');
  END IF;

  v_next := v_inst.steps -> (v_inst.current_step + 1);
  UPDATE public.workflow_instances
     SET current_step = v_inst.current_step + 1, step_started_at = now()
   WHERE id = v_inst.id;

  INSERT INTO public.workflow_step_events
    (instance_id, organisation_id, step_index, step_name, action, actor_id)
  VALUES
    (v_inst.id, v_inst.organisation_id, v_inst.current_step + 1, v_next ->> 'name', 'started', auth.uid());

  PERFORM public.notify_role_in_org(
    v_next ->> 'approver_role', v_inst.organisation_id,
    'approval',
    'Approval required: ' || v_inst.definition_name,
    COALESCE(v_inst.entity_label, v_inst.entity_type) || ' advanced to step "' ||
      (v_next ->> 'name') || '".',
    'workflow', v_inst.id);

  PERFORM public.emit_domain_event('workflow.step_advanced', 'workflow_instance', v_inst.id::text,
    jsonb_build_object('definition', v_inst.definition_name, 'step', v_next ->> 'name',
                       'step_index', v_inst.current_step + 1),
    v_inst.organisation_id, auth.uid());

  RETURN jsonb_build_object('status', 'pending', 'current_step', v_inst.current_step + 1,
                            'step', v_next ->> 'name');
END;
$$;
GRANT EXECUTE ON FUNCTION public.workflow_act(uuid,text,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.workflow_act(uuid,text,text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.workflow_cancel(p_instance_id uuid, p_comment text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst public.workflow_instances%ROWTYPE;
  v_role text := lower(regexp_replace(COALESCE(public.get_my_role(), ''), '\s+', '_', 'g'));
BEGIN
  SELECT * INTO v_inst FROM public.workflow_instances WHERE id = p_instance_id FOR UPDATE;
  IF NOT FOUND OR v_inst.status <> 'pending' THEN
    RAISE EXCEPTION 'workflow instance not found or already completed';
  END IF;
  IF v_role <> 'admin' AND v_inst.started_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'only the initiator or an admin can cancel';
  END IF;
  IF v_inst.organisation_id IS NOT NULL AND v_inst.organisation_id <> public.app_current_org() THEN
    RAISE EXCEPTION 'not authorised';
  END IF;

  UPDATE public.workflow_instances SET status = 'cancelled', completed_at = now()
   WHERE id = v_inst.id;
  INSERT INTO public.workflow_step_events
    (instance_id, organisation_id, step_index, step_name, action, actor_id, comment)
  VALUES
    (v_inst.id, v_inst.organisation_id, v_inst.current_step,
     v_inst.steps -> v_inst.current_step ->> 'name', 'cancelled', auth.uid(), p_comment);
  PERFORM public.emit_domain_event('workflow.cancelled', 'workflow_instance', v_inst.id::text,
    jsonb_build_object('definition', v_inst.definition_name, 'comment', p_comment),
    v_inst.organisation_id, auth.uid());
END;
$$;
GRANT EXECUTE ON FUNCTION public.workflow_cancel(uuid,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.workflow_cancel(uuid,text) FROM PUBLIC, anon;

-- Inbox: instances currently waiting on MY role (admins see every pending run in org).
CREATE OR REPLACE FUNCTION public.my_pending_approvals()
RETURNS SETOF public.workflow_instances
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT wi.*
    FROM public.workflow_instances wi
   WHERE wi.status = 'pending'
     AND (wi.organisation_id IS NULL OR wi.organisation_id = public.app_current_org())
     AND (
       lower(regexp_replace(COALESCE(public.get_my_role(), ''), '\s+', '_', 'g')) = 'admin'
       OR lower(wi.steps -> wi.current_step ->> 'approver_role') =
          lower(regexp_replace(COALESCE(public.get_my_role(), ''), '\s+', '_', 'g'))
     )
   ORDER BY wi.started_at;
$$;
GRANT EXECUTE ON FUNCTION public.my_pending_approvals() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.my_pending_approvals() FROM PUBLIC, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. EVENT CONSUMER — auto-start chains whose trigger_event matches
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_event_workflows(ev public.domain_events)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d record;
BEGIN
  FOR d IN
    SELECT id FROM public.workflow_definitions
     WHERE active
       AND trigger_event = ev.event_type
       AND (organisation_id IS NULL OR ev.organisation_id IS NULL
            OR organisation_id = ev.organisation_id)
  LOOP
    PERFORM public._workflow_launch(
      d.id, COALESCE(ev.entity_type, 'event'), ev.entity_id,
      COALESCE(ev.payload ->> 'asset_no', ev.entity_type || ' ' || COALESCE(ev.entity_id, '')),
      ev.payload, ev.actor_id, ev.id);
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.consume_event_workflows(public.domain_events) FROM PUBLIC, anon, authenticated;

INSERT INTO public.event_consumers (consumer, event_types, description)
VALUES ('consume_event_workflows', NULL, 'Auto-starts approval workflows whose trigger_event matches the incoming domain event.')
ON CONFLICT (consumer) DO UPDATE SET enabled = true, event_types = NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. SLA ESCALATION (hourly)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.escalate_overdue_workflow_steps()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT wi.id, wi.organisation_id, wi.definition_name, wi.entity_label, wi.entity_type,
           wi.current_step, wi.steps -> wi.current_step AS step
      FROM public.workflow_instances wi
     WHERE wi.status = 'pending'
       AND (wi.steps -> wi.current_step) ? 'sla_hours'
       AND wi.step_started_at
           + make_interval(mins => round((wi.steps -> wi.current_step ->> 'sla_hours')::numeric * 60)::int)
           < now()
       AND NOT EXISTS (
         SELECT 1 FROM public.workflow_step_events se
          WHERE se.instance_id = wi.id
            AND se.step_index = wi.current_step
            AND se.action = 'escalated')
  LOOP
    INSERT INTO public.workflow_step_events
      (instance_id, organisation_id, step_index, step_name, action, comment)
    VALUES
      (r.id, r.organisation_id, r.current_step, r.step ->> 'name', 'escalated',
       'SLA of ' || (r.step ->> 'sla_hours') || 'h exceeded');

    PERFORM public.notify_role_in_org(
      'admin', r.organisation_id, 'escalation',
      'Overdue approval: ' || r.definition_name,
      COALESCE(r.entity_label, r.entity_type) || ' has been waiting at step "' ||
        (r.step ->> 'name') || '" beyond its ' || (r.step ->> 'sla_hours') || 'h SLA.',
      'workflow', r.id);

    PERFORM public.emit_domain_event('workflow.escalated', 'workflow_instance', r.id::text,
      jsonb_build_object('definition', r.definition_name, 'step', r.step ->> 'name',
                         'sla_hours', r.step ->> 'sla_hours'),
      r.organisation_id, NULL);
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('escalated', n);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.escalate_overdue_workflow_steps() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'escalate-workflows') THEN
    PERFORM cron.unschedule('escalate-workflows');
  END IF;
END $$;

SELECT cron.schedule(
  'escalate-workflows',
  '15 * * * *',
  $$SELECT public.escalate_overdue_workflow_steps();$$
);

COMMENT ON TABLE public.workflow_definitions IS
  'Configurable approval chains. steps: [{"name","approver_role"(admin|manager|director),"sla_hours"?}]. trigger_event auto-starts via domain events.';
COMMENT ON TABLE public.workflow_instances IS
  'Durable workflow runs. steps is a snapshot taken at start — definition edits never affect in-flight approvals.';
