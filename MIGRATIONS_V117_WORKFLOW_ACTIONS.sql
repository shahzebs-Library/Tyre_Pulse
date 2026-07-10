-- ============================================================================
-- MIGRATIONS_V117_WORKFLOW_ACTIONS.sql
-- Universal Approval & Workflow Engine — Phase 0 (part 2 of 3).
--
-- APPLY ORDER: run AFTER MIGRATIONS_V116_WORKFLOW_STEP_SCHEMA.sql.
--
-- V117 responsibilities — replace workflow_act with a richer, server-
-- authoritative version:
--   * p_action in (approve | reject | return) plus capture args
--     (p_comment, p_signature_data, p_printed_name, p_photo_urls text[],
--     p_gps jsonb, p_device_info jsonb).
--   * SECURITY BOUNDARY — the current step's require_signature /
--     require_photo / require_gps flags are enforced HERE. The act is
--     rejected if a required capture is missing, regardless of what the
--     client sent. Never trust the client.
--   * 'return' → status 'returned', current_step jumps to the prior step
--     (or 0), mandatory comment, initiator notified, a 'returned' step
--     event recorded. returned_to_step / last_actor_id stored.
--   * On approve-advance, the NEXT step's `condition` is evaluated against
--     workflow_instances.context; steps whose condition is false are
--     auto-skipped (recorded as 'started' with a skip note is avoided —
--     skipped steps simply aren't opened). If all remaining steps are
--     skipped, the instance is approved/completed.
--   * A returned instance can be re-acted on (it is "open" like pending).
--
-- Backward-compatible: the old 3-arg call site
-- workflow_act(uuid, text, text) is preserved as a thin wrapper so existing
-- callers keep working. The new signature adds the capture params with
-- defaults.
--
-- Keeps the V97 GRANT/REVOKE pattern and emits the same domain events
-- (plus workflow.returned).
--
-- Rollback: DROP the new overload and wrapper, then re-create the V97
-- workflow_act(uuid,text,text).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. PURE CONDITION EVALUATOR (mirrors src/lib/workflow/conditions.js).
--    Returns true when a step with no condition should run; evaluates
--    {field, op, value} against the instance context. Missing field → false.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.workflow_step_condition_passes(
  p_step jsonb, p_context jsonb
)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_cond   jsonb;
  v_field  text;
  v_op     text;
  v_raw    jsonb;          -- expected value (from step)
  v_actual jsonb;          -- actual value (from context)
  v_a_num  numeric;
  v_e_num  numeric;
  v_numeric boolean;
BEGIN
  -- No condition object → step always runs.
  IF p_step IS NULL OR NOT (p_step ? 'condition')
     OR jsonb_typeof(p_step -> 'condition') <> 'object' THEN
    RETURN true;
  END IF;

  v_cond  := p_step -> 'condition';
  v_field := v_cond ->> 'field';
  v_op    := v_cond ->> 'op';
  v_raw   := v_cond -> 'value';

  IF v_field IS NULL OR v_op IS NULL THEN
    RETURN true;   -- malformed → do not block (validated at write time)
  END IF;

  -- Missing field in context → condition is false (skip the step).
  IF p_context IS NULL OR NOT (p_context ? v_field)
     OR jsonb_typeof(p_context -> v_field) = 'null' THEN
    RETURN false;
  END IF;

  v_actual := p_context -> v_field;

  -- Numeric comparison when both sides parse as numbers; else string compare.
  v_numeric := (v_actual ->> 0 IS NOT NULL);
  BEGIN
    v_a_num := (v_actual #>> '{}')::numeric;
    v_e_num := (v_raw    #>> '{}')::numeric;
    v_numeric := true;
  EXCEPTION WHEN others THEN
    v_numeric := false;
  END;

  IF v_numeric THEN
    RETURN CASE v_op
      WHEN '='  THEN v_a_num =  v_e_num
      WHEN '!=' THEN v_a_num <> v_e_num
      WHEN '>'  THEN v_a_num >  v_e_num
      WHEN '>=' THEN v_a_num >= v_e_num
      WHEN '<'  THEN v_a_num <  v_e_num
      WHEN '<=' THEN v_a_num <= v_e_num
      ELSE false
    END;
  ELSE
    -- String / boolean comparison on the text projection.
    RETURN CASE v_op
      WHEN '='  THEN (v_actual #>> '{}') =  (v_raw #>> '{}')
      WHEN '!=' THEN (v_actual #>> '{}') <> (v_raw #>> '{}')
      WHEN '>'  THEN (v_actual #>> '{}') >  (v_raw #>> '{}')
      WHEN '>=' THEN (v_actual #>> '{}') >= (v_raw #>> '{}')
      WHEN '<'  THEN (v_actual #>> '{}') <  (v_raw #>> '{}')
      WHEN '<=' THEN (v_actual #>> '{}') <= (v_raw #>> '{}')
      ELSE false
    END;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.workflow_step_condition_passes(jsonb,jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.workflow_step_condition_passes(jsonb,jsonb) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Find the next runnable step index from a given position (exclusive),
--    honouring per-step `condition` against context. Returns NULL if none.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._workflow_next_runnable_step(
  p_steps jsonb, p_from int, p_context jsonb
)
RETURNS int LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_total int := jsonb_array_length(p_steps);
  i int;
BEGIN
  i := p_from + 1;
  WHILE i < v_total LOOP
    IF public.workflow_step_condition_passes(p_steps -> i, p_context) THEN
      RETURN i;
    END IF;
    i := i + 1;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._workflow_next_runnable_step(jsonb,int,jsonb) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. NEW workflow_act OVERLOAD (approve | reject | return + capture args).
--    The V97 3-arg workflow_act had a DEFAULT on p_comment; CREATE OR REPLACE
--    cannot alter defaults, so drop it first, then redefine the pair below.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.workflow_act(uuid, text, text);

CREATE OR REPLACE FUNCTION public.workflow_act(
  p_instance_id    uuid,
  p_action         text,                 -- 'approve' | 'reject' | 'return'
  p_comment        text   DEFAULT NULL,
  p_signature_data text   DEFAULT NULL,
  p_printed_name   text   DEFAULT NULL,
  p_photo_urls     text[] DEFAULT NULL,
  p_gps            jsonb  DEFAULT NULL,
  p_device_info    jsonb  DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst      public.workflow_instances%ROWTYPE;
  v_role      text;
  v_step      jsonb;
  v_next_idx  int;
  v_next      jsonb;
  v_prev_idx  int;
  v_step_user text;
BEGIN
  v_role := lower(regexp_replace(COALESCE(public.get_my_role(), ''), '\s+', '_', 'g'));
  IF v_role = '' THEN
    RAISE EXCEPTION 'not authorised';
  END IF;
  IF p_action NOT IN ('approve','reject','return') THEN
    RAISE EXCEPTION 'invalid action %', p_action;
  END IF;

  SELECT * INTO v_inst FROM public.workflow_instances
   WHERE id = p_instance_id FOR UPDATE;
  IF NOT FOUND OR v_inst.status NOT IN ('pending','in_review','returned') THEN
    RAISE EXCEPTION 'workflow instance not found or already completed';
  END IF;
  IF v_inst.organisation_id IS NOT NULL AND v_inst.organisation_id <> public.app_current_org() THEN
    RAISE EXCEPTION 'not authorised';
  END IF;

  v_step := v_inst.steps -> v_inst.current_step;

  -- ── Authorisation: role step → step role or admin; user step → that user or admin.
  v_step_user := v_step ->> 'approver_user_id';
  IF lower(COALESCE(v_step ->> 'assignee_type', 'role')) = 'user'
     AND COALESCE(v_step_user, '') <> '' THEN
    IF v_role <> 'admin' AND auth.uid()::text <> v_step_user THEN
      RAISE EXCEPTION 'this step is assigned to a specific user';
    END IF;
  ELSE
    IF v_role <> 'admin'
       AND v_role <> lower(regexp_replace(COALESCE(v_step ->> 'approver_role',''), '\s+', '_', 'g')) THEN
      RAISE EXCEPTION 'this step requires role %', v_step ->> 'approver_role';
    END IF;
  END IF;

  -- ── SECURITY BOUNDARY: enforce per-step capture requirements server-side.
  -- Requirements apply to approve (and to any act that records a signature).
  IF p_action = 'approve' THEN
    IF COALESCE((v_step ->> 'require_signature')::boolean, false)
       AND COALESCE(trim(p_signature_data), '') = '' THEN
      RAISE EXCEPTION 'signature is required for this step';
    END IF;
    IF COALESCE((v_step ->> 'require_photo')::boolean, false)
       AND (p_photo_urls IS NULL OR array_length(p_photo_urls, 1) IS NULL) THEN
      RAISE EXCEPTION 'at least one photo is required for this step';
    END IF;
    IF COALESCE((v_step ->> 'require_gps')::boolean, false)
       AND (p_gps IS NULL
            OR NOT (p_gps ? 'lat') OR NOT (p_gps ? 'lng')) THEN
      RAISE EXCEPTION 'GPS location is required for this step';
    END IF;
  END IF;

  -- ── RETURN: send back to the prior step, mandatory comment.
  IF p_action = 'return' THEN
    IF COALESCE((v_step ->> 'allow_return')::boolean, true) = false THEN
      RAISE EXCEPTION 'this step does not allow return';
    END IF;
    IF COALESCE(trim(p_comment), '') = '' THEN
      RAISE EXCEPTION 'a comment is required to return for correction';
    END IF;

    v_prev_idx := GREATEST(v_inst.current_step - 1, 0);

    INSERT INTO public.workflow_step_events
      (instance_id, organisation_id, step_index, step_name, action, actor_id,
       comment, signature_data, printed_name, photo_urls, gps, device_info)
    VALUES
      (v_inst.id, v_inst.organisation_id, v_inst.current_step, v_step ->> 'name',
       'returned', auth.uid(), p_comment, p_signature_data, p_printed_name,
       p_photo_urls, p_gps, p_device_info);

    UPDATE public.workflow_instances
       SET status = 'returned',
           current_step = v_prev_idx,
           returned_to_step = v_prev_idx,
           last_actor_id = auth.uid(),
           step_started_at = now()
     WHERE id = v_inst.id;

    IF v_inst.started_by IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
      VALUES (v_inst.started_by, 'approval',
              'Returned for correction: ' || v_inst.definition_name,
              COALESCE(v_inst.entity_label, v_inst.entity_type) ||
                ' was returned at step "' || (v_step ->> 'name') || '": ' || p_comment,
              'workflow', v_inst.id);
    END IF;

    PERFORM public.emit_domain_event('workflow.returned', 'workflow_instance', v_inst.id::text,
      jsonb_build_object('definition', v_inst.definition_name, 'step', v_step ->> 'name',
                         'returned_to_step', v_prev_idx, 'comment', p_comment,
                         'entity_type', v_inst.entity_type, 'entity_id', v_inst.entity_id),
      v_inst.organisation_id, auth.uid());

    RETURN jsonb_build_object('status', 'returned', 'current_step', v_prev_idx);
  END IF;

  -- ── Record the approve/reject action (with captured evidence).
  INSERT INTO public.workflow_step_events
    (instance_id, organisation_id, step_index, step_name, action, actor_id,
     comment, signature_data, printed_name, photo_urls, gps, device_info)
  VALUES
    (v_inst.id, v_inst.organisation_id, v_inst.current_step, v_step ->> 'name',
     CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END, auth.uid(),
     p_comment, p_signature_data, p_printed_name, p_photo_urls, p_gps, p_device_info);

  -- ── REJECT: terminal.
  IF p_action = 'reject' THEN
    UPDATE public.workflow_instances
       SET status = 'rejected', completed_at = now(), last_actor_id = auth.uid()
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

  -- ── APPROVE: find the next runnable step (auto-skip conditional-false steps).
  v_next_idx := public._workflow_next_runnable_step(v_inst.steps, v_inst.current_step, v_inst.context);

  IF v_next_idx IS NULL THEN
    UPDATE public.workflow_instances
       SET status = 'approved', completed_at = now(), last_actor_id = auth.uid()
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

  v_next := v_inst.steps -> v_next_idx;
  UPDATE public.workflow_instances
     SET current_step = v_next_idx, step_started_at = now(),
         status = 'in_review', last_actor_id = auth.uid()
   WHERE id = v_inst.id;

  INSERT INTO public.workflow_step_events
    (instance_id, organisation_id, step_index, step_name, action, actor_id)
  VALUES
    (v_inst.id, v_inst.organisation_id, v_next_idx, v_next ->> 'name', 'started', auth.uid());

  -- Notify the next assignee (specific user, else the role).
  IF lower(COALESCE(v_next ->> 'assignee_type','role')) = 'user'
     AND COALESCE(v_next ->> 'approver_user_id','') <> '' THEN
    INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
    VALUES ((v_next ->> 'approver_user_id')::uuid, 'approval',
            'Approval required: ' || v_inst.definition_name,
            COALESCE(v_inst.entity_label, v_inst.entity_type) ||
              ' advanced to step "' || (v_next ->> 'name') || '".',
            'workflow', v_inst.id);
  ELSE
    PERFORM public.notify_role_in_org(
      regexp_replace(COALESCE(v_next ->> 'approver_role',''), '\s+', '_', 'g'),
      v_inst.organisation_id, 'approval',
      'Approval required: ' || v_inst.definition_name,
      COALESCE(v_inst.entity_label, v_inst.entity_type) || ' advanced to step "' ||
        (v_next ->> 'name') || '".',
      'workflow', v_inst.id);
  END IF;

  PERFORM public.emit_domain_event('workflow.step_advanced', 'workflow_instance', v_inst.id::text,
    jsonb_build_object('definition', v_inst.definition_name, 'step', v_next ->> 'name',
                       'step_index', v_next_idx),
    v_inst.organisation_id, auth.uid());

  RETURN jsonb_build_object('status', 'in_review', 'current_step', v_next_idx,
                            'step', v_next ->> 'name');
END;
$$;
GRANT  EXECUTE ON FUNCTION public.workflow_act(uuid,text,text,text,text,text[],jsonb,jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.workflow_act(uuid,text,text,text,text,text[],jsonb,jsonb) FROM PUBLIC, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. BACKWARD-COMPATIBLE 3-ARG WRAPPER (preserves the V97 call site).
--    Existing callers `workflow_act(id, action, comment)` keep working and
--    route into the new engine with no captured evidence.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.workflow_act(
  p_instance_id uuid, p_action text, p_comment text
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.workflow_act(p_instance_id, p_action, p_comment,
                             NULL, NULL, NULL::text[], NULL::jsonb, NULL::jsonb);
$$;
GRANT  EXECUTE ON FUNCTION public.workflow_act(uuid,text,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.workflow_act(uuid,text,text) FROM PUBLIC, anon;
