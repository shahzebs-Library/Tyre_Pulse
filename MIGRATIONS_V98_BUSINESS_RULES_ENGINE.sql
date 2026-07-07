-- ============================================================================
-- MIGRATIONS_V98_BUSINESS_RULES_ENGINE.sql
-- Phase 14 (roadmap): Business Rules Engine.
--
--  * business_rules — org-configurable "if condition then action" rules.
--    trigger_type 'event' rules evaluate their conditions against V94 domain
--    event payloads (via the consume_event_rules consumer). Actions:
--    notify_role (in-app notifications to a role in the org) and emit_event
--    (publishes a 'rule.*' domain event — webhooks/workflows can react).
--  * rule_executions — append-only evaluation audit.
--  * evaluate_alert_thresholds() — finally evaluates the legacy per-user
--    alert_thresholds table SERVER-SIDE (hourly): tread_depth, pressure,
--    tyre_age_days, inspection_overdue_days. (cpk stays client-evaluated in
--    src/lib/alertEngine.js — odometer-dependent.) Fires in-app
--    notifications, bumps triggered_count / last_triggered_at (previously
--    never written), and emits 'threshold.triggered' events. 23h re-alert
--    suppression per rule.
--
-- Loop safety: rule-emitted events are always prefixed 'rule.'; a rule that
-- SUBSCRIBES to 'rule.%' events may not itself have emit_event actions
-- (enforced by validate_business_rule).
--
-- Depends on: V94 (domain_events, event_consumers), V95 (notify_role_in_org),
--             alert_thresholds table, V22 (inspections.tread_depth/pressure_reading).
--
-- Rollback:
--   SELECT cron.unschedule('evaluate-alert-thresholds');
--   DELETE FROM public.event_consumers WHERE consumer = 'consume_event_rules';
--   DROP FUNCTION public.evaluate_alert_thresholds();
--   DROP FUNCTION public.consume_event_rules(public.domain_events);
--   DROP FUNCTION public.rule_condition_passes(jsonb,jsonb);
--   DROP TABLE public.rule_executions, public.business_rules;
--   DROP FUNCTION public.validate_business_rule(text,text[],jsonb,jsonb);
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. VALIDATION
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_business_rule(
  p_trigger_type text,
  p_event_types  text[],
  p_conditions   jsonb,
  p_actions      jsonb
)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  c jsonb;
  a jsonb;
  v_has_emit boolean := false;
  v_listens_rule boolean := false;
BEGIN
  IF p_trigger_type <> 'event' THEN RETURN false; END IF;
  IF p_event_types IS NULL OR array_length(p_event_types, 1) IS NULL THEN RETURN false; END IF;

  IF p_conditions IS NULL OR jsonb_typeof(p_conditions) <> 'array'
     OR jsonb_array_length(p_conditions) > 10 THEN
    RETURN false;
  END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(p_conditions) LOOP
    IF jsonb_typeof(c) <> 'object'
       OR COALESCE(trim(c ->> 'field'), '') = ''
       OR COALESCE(c ->> 'operator', '') NOT IN ('lt','lte','gt','gte','eq','neq','contains')
       OR NOT (c ? 'value') THEN
      RETURN false;
    END IF;
  END LOOP;

  IF p_actions IS NULL OR jsonb_typeof(p_actions) <> 'array'
     OR jsonb_array_length(p_actions) = 0 OR jsonb_array_length(p_actions) > 5 THEN
    RETURN false;
  END IF;
  FOR a IN SELECT * FROM jsonb_array_elements(p_actions) LOOP
    IF jsonb_typeof(a) <> 'object' THEN RETURN false; END IF;
    CASE a ->> 'type'
      WHEN 'notify_role' THEN
        IF lower(COALESCE(a ->> 'role', '')) NOT IN ('admin','manager','director') THEN
          RETURN false;
        END IF;
      WHEN 'emit_event' THEN
        IF COALESCE(trim(a ->> 'event_type'), '') = '' THEN RETURN false; END IF;
        v_has_emit := true;
      ELSE
        RETURN false;
    END CASE;
  END LOOP;

  SELECT bool_or(t LIKE 'rule.%') INTO v_listens_rule FROM unnest(p_event_types) t;
  IF v_has_emit AND COALESCE(v_listens_rule, false) THEN
    RETURN false;  -- would allow rule→rule emit loops
  END IF;

  RETURN true;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TABLES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.business_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  name             text NOT NULL,
  description      text,
  trigger_type     text NOT NULL DEFAULT 'event' CHECK (trigger_type IN ('event')),
  event_types      text[],
  conditions       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- ANDed: [{"field","operator","value"}]
  actions          jsonb NOT NULL,                       -- [{"type":"notify_role","role",...}|{"type":"emit_event","event_type"}]
  active           boolean NOT NULL DEFAULT true,
  cooldown_minutes int NOT NULL DEFAULT 0 CHECK (cooldown_minutes BETWEEN 0 AND 10080),
  triggered_count  int NOT NULL DEFAULT 0,
  last_triggered_at timestamptz,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (public.validate_business_rule(trigger_type, event_types, conditions, actions))
);
CREATE INDEX IF NOT EXISTS idx_business_rules_org ON public.business_rules (organisation_id, active);

ALTER TABLE public.business_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_rules_select ON public.business_rules;
CREATE POLICY business_rules_select ON public.business_rules
  FOR SELECT TO authenticated
  USING (organisation_id IS NULL OR organisation_id = (SELECT public.app_current_org()));
DROP POLICY IF EXISTS business_rules_write ON public.business_rules;
CREATE POLICY business_rules_write ON public.business_rules
  FOR ALL TO authenticated
  USING ((SELECT public.is_elevated_user())
         AND (organisation_id IS NULL OR organisation_id = (SELECT public.app_current_org())))
  WITH CHECK ((SELECT public.is_elevated_user())
         AND (organisation_id IS NULL OR organisation_id = (SELECT public.app_current_org())));

CREATE TABLE IF NOT EXISTS public.rule_executions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_id         uuid REFERENCES public.business_rules(id) ON DELETE CASCADE,
  organisation_id uuid,
  event_id        bigint,
  status          text NOT NULL CHECK (status IN ('actioned','conditions_not_met','skipped_cooldown','error')),
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rule_executions_rule
  ON public.rule_executions (rule_id, created_at DESC);

ALTER TABLE public.rule_executions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rule_executions_select ON public.rule_executions;
CREATE POLICY rule_executions_select ON public.rule_executions
  FOR SELECT TO authenticated
  USING ((SELECT public.is_elevated_user())
         AND (organisation_id IS NULL OR organisation_id = (SELECT public.app_current_org())));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CONDITION EVALUATION
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rule_condition_passes(p_payload jsonb, p_cond jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_actual text := p_payload ->> (p_cond ->> 'field');
  v_expect text := p_cond ->> 'value';
  v_op     text := p_cond ->> 'operator';
  v_a      numeric;
  v_b      numeric;
BEGIN
  IF v_actual IS NULL THEN RETURN false; END IF;

  IF v_op IN ('lt','lte','gt','gte') THEN
    BEGIN
      v_a := v_actual::numeric;
      v_b := v_expect::numeric;
    EXCEPTION WHEN OTHERS THEN
      RETURN false;
    END;
    RETURN CASE v_op
      WHEN 'lt'  THEN v_a <  v_b
      WHEN 'lte' THEN v_a <= v_b
      WHEN 'gt'  THEN v_a >  v_b
      WHEN 'gte' THEN v_a >= v_b
    END;
  ELSIF v_op = 'eq' THEN
    RETURN lower(v_actual) = lower(COALESCE(v_expect, ''));
  ELSIF v_op = 'neq' THEN
    RETURN lower(v_actual) <> lower(COALESCE(v_expect, ''));
  ELSIF v_op = 'contains' THEN
    RETURN v_actual ILIKE '%' || COALESCE(v_expect, '') || '%';
  END IF;
  RETURN false;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. EVENT CONSUMER
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_event_rules(ev public.domain_events)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r       public.business_rules%ROWTYPE;
  a       jsonb;
  v_pass  boolean;
  v_emit  text;
BEGIN
  FOR r IN
    SELECT * FROM public.business_rules
     WHERE active
       AND trigger_type = 'event'
       AND ev.event_type = ANY (event_types)
       AND (organisation_id IS NULL OR ev.organisation_id IS NULL
            OR organisation_id = ev.organisation_id)
  LOOP
    -- Replay guard (at-least-once events): one execution per (rule, event).
    IF EXISTS (SELECT 1 FROM public.rule_executions
                WHERE rule_id = r.id AND event_id = ev.id) THEN
      CONTINUE;
    END IF;

    IF r.cooldown_minutes > 0 AND r.last_triggered_at IS NOT NULL
       AND r.last_triggered_at + make_interval(mins => r.cooldown_minutes) > now() THEN
      INSERT INTO public.rule_executions (rule_id, organisation_id, event_id, status)
      VALUES (r.id, ev.organisation_id, ev.id, 'skipped_cooldown');
      CONTINUE;
    END IF;

    SELECT COALESCE(bool_and(public.rule_condition_passes(ev.payload, c)), true)
      INTO v_pass
      FROM jsonb_array_elements(r.conditions) c;

    IF NOT v_pass THEN
      INSERT INTO public.rule_executions (rule_id, organisation_id, event_id, status)
      VALUES (r.id, ev.organisation_id, ev.id, 'conditions_not_met');
      CONTINUE;
    END IF;

    FOR a IN SELECT * FROM jsonb_array_elements(r.actions) LOOP
      IF a ->> 'type' = 'notify_role' THEN
        PERFORM public.notify_role_in_org(
          a ->> 'role', ev.organisation_id, 'rule',
          COALESCE(a ->> 'title', 'Rule triggered: ' || r.name),
          COALESCE(a ->> 'message',
                   r.name || ' matched ' || ev.event_type ||
                   COALESCE(' for ' || (ev.payload ->> 'asset_no'), '') || '.'),
          'business_rule', r.id);
      ELSIF a ->> 'type' = 'emit_event' THEN
        v_emit := a ->> 'event_type';
        IF v_emit NOT LIKE 'rule.%' THEN
          v_emit := 'rule.' || v_emit;
        END IF;
        PERFORM public.emit_domain_event(
          v_emit, 'business_rule', r.id::text,
          ev.payload || jsonb_build_object('rule_name', r.name, 'source_event', ev.event_type),
          ev.organisation_id, NULL);
      END IF;
    END LOOP;

    UPDATE public.business_rules
       SET triggered_count = triggered_count + 1, last_triggered_at = now()
     WHERE id = r.id;

    INSERT INTO public.rule_executions (rule_id, organisation_id, event_id, status, detail)
    VALUES (r.id, ev.organisation_id, ev.id, 'actioned',
            jsonb_build_object('event_type', ev.event_type, 'actions', r.actions));
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.consume_event_rules(public.domain_events) FROM PUBLIC, anon, authenticated;

INSERT INTO public.event_consumers (consumer, event_types, description)
VALUES ('consume_event_rules', NULL, 'Evaluates active business_rules against each domain event and executes their actions.')
ON CONFLICT (consumer) DO UPDATE SET enabled = true, event_types = NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. LEGACY alert_thresholds — SERVER-SIDE EVALUATION (hourly)
--    Supported metrics: tread_depth, pressure (last 25h of inspection
--    readings), tyre_age_days, inspection_overdue_days (fleet state).
--    'cpk' stays client-side in alertEngine.js (odometer-dependent).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.evaluate_alert_thresholds()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t         record;
  v_count   int;
  v_fired   int := 0;
  v_op      text;
BEGIN
  FOR t IN
    SELECT * FROM public.alert_thresholds
     WHERE active
       AND metric IN ('tread_depth','pressure','tyre_age_days','inspection_overdue_days')
       AND (last_triggered_at IS NULL OR last_triggered_at < now() - interval '23 hours')
  LOOP
    v_op := CASE t.operator
              WHEN 'lt' THEN '<' WHEN 'lte' THEN '<='
              WHEN 'gt' THEN '>' WHEN 'gte' THEN '>=' ELSE '=' END;
    v_count := 0;

    IF t.metric IN ('tread_depth','pressure') THEN
      EXECUTE format(
        'SELECT count(*) FROM public.inspections
          WHERE created_at > now() - interval ''25 hours''
            AND %I IS NOT NULL AND %I %s $1
            AND ($2 IS NULL OR site = $2)',
        CASE t.metric WHEN 'tread_depth' THEN 'tread_depth' ELSE 'pressure_reading' END,
        CASE t.metric WHEN 'tread_depth' THEN 'tread_depth' ELSE 'pressure_reading' END,
        v_op)
      INTO v_count
      USING t.threshold, NULLIF(t.site_filter, '');

    ELSIF t.metric = 'tyre_age_days' THEN
      EXECUTE format(
        'SELECT count(*) FROM public.tyre_records
          WHERE issue_date IS NOT NULL
            AND (current_date - issue_date) %s $1
            AND ($2 IS NULL OR site = $2)
            AND ($3 IS NULL OR brand = $3)',
        v_op)
      INTO v_count
      USING t.threshold::int, NULLIF(t.site_filter, ''), NULLIF(t.brand_filter, '');

    ELSIF t.metric = 'inspection_overdue_days' THEN
      EXECUTE format(
        'SELECT count(*) FROM (
           SELECT asset_no,
                  current_date - max(COALESCE(completed_date, scheduled_date)) AS days_since
             FROM public.inspections
            WHERE asset_no IS NOT NULL
              AND ($2 IS NULL OR site = $2)
            GROUP BY asset_no
         ) x WHERE x.days_since %s $1',
        v_op)
      INTO v_count
      USING t.threshold::int, NULLIF(t.site_filter, '');
    END IF;

    IF COALESCE(v_count, 0) > 0 THEN
      IF COALESCE(t.notify_in_app, true) AND t.user_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
        VALUES (t.user_id, 'threshold',
                'Threshold triggered: ' || t.name,
                v_count || ' record(s) matched ' || t.metric || ' ' || t.operator || ' ' || t.threshold ||
                  COALESCE(' at ' || NULLIF(t.site_filter, ''), '') || '.',
                'alert_threshold', t.id);
      END IF;

      UPDATE public.alert_thresholds
         SET triggered_count = COALESCE(triggered_count, 0) + 1,
             last_triggered_at = now()
       WHERE id = t.id;

      PERFORM public.emit_domain_event('threshold.triggered', 'alert_threshold', t.id::text,
        jsonb_build_object('name', t.name, 'metric', t.metric, 'operator', t.operator,
                           'threshold', t.threshold, 'matched', v_count,
                           'site_filter', t.site_filter),
        NULL, t.user_id);

      v_fired := v_fired + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('fired', v_fired);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.evaluate_alert_thresholds() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'evaluate-alert-thresholds') THEN
    PERFORM cron.unschedule('evaluate-alert-thresholds');
  END IF;
END $$;

SELECT cron.schedule(
  'evaluate-alert-thresholds',
  '5 * * * *',
  $$SELECT public.evaluate_alert_thresholds();$$
);

COMMENT ON TABLE public.business_rules IS
  'Org-configurable event rules: conditions (ANDed field/operator/value vs event payload) → actions (notify_role, emit_event ''rule.*''). Evaluated by consume_event_rules via V94.';
