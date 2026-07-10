-- ============================================================================
-- MIGRATIONS_V116_WORKFLOW_STEP_SCHEMA.sql
-- Universal Approval & Workflow Engine — Phase 0 (part 1 of 3).
--
-- APPLY ORDER (all additive & backward-compatible with V97):
--   1. MIGRATIONS_V116_WORKFLOW_STEP_SCHEMA.sql   (this file)
--   2. MIGRATIONS_V117_WORKFLOW_ACTIONS.sql
--   3. MIGRATIONS_V118_APPROVAL_DASHBOARD.sql
--
-- V116 responsibilities:
--   * Rewrite validate_workflow_steps(jsonb) to accept the expanded step
--     schema: wider approver-role set, assignee_type ('role'|'user') +
--     approver_user_id, per-step requirement flags, and an optional
--     condition object {field, op, value}.  Existing 3-role linear
--     definitions ({name, approver_role, sla_hours}) remain VALID.
--   * Add append-only capture columns to workflow_step_events
--     (signature_data, printed_name, photo_urls, gps, device_info) and
--     extend its action CHECK to include 'returned'.
--   * Extend workflow_instances.status CHECK to add 'in_review' and
--     'returned'; add returned_to_step and last_actor_id columns.
--
-- Depends on: V97 (workflow_definitions / workflow_instances /
--             workflow_step_events + validate_workflow_steps).
--
-- Rollback (revert to V97 behaviour):
--   -- Restore the V97 3-role validator, then:
--   ALTER TABLE public.workflow_step_events
--     DROP COLUMN IF EXISTS signature_data,
--     DROP COLUMN IF EXISTS printed_name,
--     DROP COLUMN IF EXISTS photo_urls,
--     DROP COLUMN IF EXISTS gps,
--     DROP COLUMN IF EXISTS device_info;
--   ALTER TABLE public.workflow_instances
--     DROP COLUMN IF EXISTS returned_to_step,
--     DROP COLUMN IF EXISTS last_actor_id;
--   -- (CHECK constraints are re-added below with fixed names for easy revert.)
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. EXPANDED STEP VALIDATION
--    Backward-compatible: any step object that passed the V97 validator still
--    passes here. New optional keys are validated only when present.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_workflow_steps(p_steps jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  s          jsonb;
  v_role     text;
  v_assignee text;
  v_cond     jsonb;
  v_op       text;
  -- Boolean requirement flags that, when present, must be a JSON boolean.
  v_bool_keys text[] := ARRAY[
    'require_signature','require_photo','require_gps',
    'require_comment_on_return','allow_return','optional'
  ];
  k text;
BEGIN
  IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array'
     OR jsonb_array_length(p_steps) = 0
     OR jsonb_array_length(p_steps) > 30 THEN
    RETURN false;
  END IF;

  FOR s IN SELECT * FROM jsonb_array_elements(p_steps) LOOP
    IF jsonb_typeof(s) <> 'object'
       OR COALESCE(trim(s ->> 'name'), '') = '' THEN
      RETURN false;
    END IF;

    -- assignee_type is optional; defaults to 'role'.
    v_assignee := lower(COALESCE(NULLIF(trim(s ->> 'assignee_type'), ''), 'role'));
    IF v_assignee NOT IN ('role','user') THEN
      RETURN false;
    END IF;

    IF v_assignee = 'user' THEN
      -- A user-assigned step must carry a UUID; role is then optional.
      IF COALESCE(trim(s ->> 'approver_user_id'), '') = ''
         OR (s ->> 'approver_user_id') !~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN false;
      END IF;
    ELSE
      -- Role-assigned step: role must be in the expanded, normalized set.
      v_role := lower(regexp_replace(COALESCE(s ->> 'approver_role', ''), '\s+', '_', 'g'));
      IF v_role NOT IN (
        'admin','manager','director','tyre_man','inspector','store_keeper',
        'fleet_supervisor','workshop_manager','procurement','finance','gm',
        'operations_manager'
      ) THEN
        RETURN false;
      END IF;
    END IF;

    -- If approver_user_id is present on a role step it must still be a UUID.
    IF s ? 'approver_user_id' AND s ->> 'approver_user_id' IS NOT NULL
       AND (s ->> 'approver_user_id') !~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN false;
    END IF;

    -- sla_hours (optional) must be a non-negative number.
    IF s ? 'sla_hours' AND s ->> 'sla_hours' IS NOT NULL
       AND (s ->> 'sla_hours') !~ '^\d+(\.\d+)?$' THEN
      RETURN false;
    END IF;

    -- Boolean requirement flags (optional) must be true booleans when present.
    FOREACH k IN ARRAY v_bool_keys LOOP
      IF s ? k AND jsonb_typeof(s -> k) NOT IN ('boolean','null') THEN
        RETURN false;
      END IF;
    END LOOP;

    -- Optional condition object: {field:text, op:enum, value:any}.
    IF s ? 'condition' AND jsonb_typeof(s -> 'condition') = 'object' THEN
      v_cond := s -> 'condition';
      v_op   := v_cond ->> 'op';
      IF COALESCE(trim(v_cond ->> 'field'), '') = ''
         OR v_op IS NULL
         OR v_op NOT IN ('=','!=','>','>=','<','<=')
         OR NOT (v_cond ? 'value') THEN
        RETURN false;
      END IF;
    ELSIF s ? 'condition' AND jsonb_typeof(s -> 'condition') NOT IN ('null') THEN
      -- condition present but not an object (and not null) → invalid.
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CAPTURE COLUMNS ON THE APPEND-ONLY AUDIT TABLE (all nullable)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.workflow_step_events
  ADD COLUMN IF NOT EXISTS signature_data text,
  ADD COLUMN IF NOT EXISTS printed_name   text,
  ADD COLUMN IF NOT EXISTS photo_urls     text[],
  ADD COLUMN IF NOT EXISTS gps            jsonb,
  ADD COLUMN IF NOT EXISTS device_info    jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. EXTEND action CHECK TO INCLUDE 'returned'
--    The V97 constraint is unnamed (inline); drop by discovered name, re-add
--    with a stable name so future migrations can target it deterministically.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_con text;
BEGIN
  SELECT conname INTO v_con
    FROM pg_constraint
   WHERE conrelid = 'public.workflow_step_events'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%action%'
   LIMIT 1;
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.workflow_step_events DROP CONSTRAINT %I', v_con);
  END IF;
END $$;

ALTER TABLE public.workflow_step_events
  ADD CONSTRAINT workflow_step_events_action_check
  CHECK (action IN ('started','approved','rejected','escalated','cancelled','returned'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. EXTEND INSTANCE STATUS + NEW COLUMNS
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_con text;
BEGIN
  SELECT conname INTO v_con
    FROM pg_constraint
   WHERE conrelid = 'public.workflow_instances'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%status%'
   LIMIT 1;
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.workflow_instances DROP CONSTRAINT %I', v_con);
  END IF;
END $$;

ALTER TABLE public.workflow_instances
  ADD CONSTRAINT workflow_instances_status_check
  CHECK (status IN ('pending','in_review','returned','approved','rejected','cancelled'));

ALTER TABLE public.workflow_instances
  ADD COLUMN IF NOT EXISTS returned_to_step int,
  ADD COLUMN IF NOT EXISTS last_actor_id    uuid;

-- Partial index to make the dashboard's "returned"/"in_review" buckets cheap.
CREATE INDEX IF NOT EXISTS idx_workflow_instances_open_status
  ON public.workflow_instances (organisation_id, status, step_started_at)
  WHERE status IN ('pending','in_review','returned');

COMMENT ON COLUMN public.workflow_step_events.signature_data IS
  'Data-URL of the captured signature image for this step action (nullable, append-only).';
COMMENT ON COLUMN public.workflow_step_events.photo_urls IS
  'Storage URLs of photos attached to this step action (nullable, append-only).';
COMMENT ON COLUMN public.workflow_step_events.gps IS
  'GPS fix captured at act time: {lat,lng,accuracy} (nullable).';
COMMENT ON COLUMN public.workflow_instances.returned_to_step IS
  'When status=returned, the step index the document was sent back to.';

COMMENT ON TABLE public.workflow_definitions IS
  'Configurable approval chains. Each step: {name, assignee_type(role|user), approver_role(expanded set)|approver_user_id, sla_hours?, require_signature?, require_photo?, require_gps?, require_comment_on_return?, allow_return?, optional?, condition?{field,op,value}}. trigger_event auto-starts via domain events.';
