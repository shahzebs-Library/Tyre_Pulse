-- ============================================================================
-- MIGRATIONS_V94_DOMAIN_EVENTS.sql
-- Phase 20 (roadmap): Event-Driven Architecture foundation.
--
-- Adds a transactional outbox (`domain_events`) that business tables publish
-- into via exception-safe AFTER triggers, a consumer registry
-- (`event_consumers`) whose handlers later migrations register (workflows
-- V95, webhooks V97, business rules V98), and a pg_cron-driven processor
-- (`process_domain_events`) that dispatches pending events to every enabled
-- consumer with per-event retry (at-least-once delivery — consumers must
-- tolerate replays).
--
-- Emit triggers are schema-tolerant: payloads are built from a whitelist of
-- keys applied to to_jsonb(row), so they compile and keep working even if
-- individual columns differ between environments. Emission failures NEVER
-- block the source write (caught + swallowed).
--
-- Rollback:
--   SELECT cron.unschedule('process-domain-events');
--   DROP TRIGGER ... (see trigger names below) on each table;
--   DROP FUNCTION public.process_domain_events(int);
--   DROP FUNCTION public.trg_emit_domain_event();
--   DROP FUNCTION public.trg_emit_status_change();
--   DROP FUNCTION public.emit_domain_event(text,text,text,jsonb,uuid,uuid);
--   DROP TABLE public.event_consumers;
--   DROP TABLE public.domain_events;
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. OUTBOX TABLE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.domain_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type      text        NOT NULL,           -- e.g. 'inspection.completed'
  entity_type     text,                           -- e.g. 'inspection'
  entity_id       text,                           -- source row id (text: not all PKs are uuid)
  organisation_id uuid,                           -- tenant scope (NULL = platform-wide)
  actor_id        uuid,                           -- auth.uid() of the user who caused it, when known
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','processed','failed')),
  attempts        int         NOT NULL DEFAULT 0,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_domain_events_pending
  ON public.domain_events (id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_domain_events_type_time
  ON public.domain_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_events_org_time
  ON public.domain_events (organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_events_entity
  ON public.domain_events (entity_type, entity_id);

ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;

-- Elevated users can read their org's event stream (Event Log UI).
-- All writes happen via SECURITY DEFINER functions / cron — no client policies.
DROP POLICY IF EXISTS domain_events_select_elevated ON public.domain_events;
CREATE POLICY domain_events_select_elevated ON public.domain_events
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_elevated_user())
    AND (organisation_id IS NULL OR organisation_id = (SELECT public.app_current_org()))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CONSUMER REGISTRY
--    Each row names a plpgsql function `public.<consumer>(public.domain_events)`
--    RETURNS void. Later migrations INSERT here to subscribe.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_consumers (
  consumer    text PRIMARY KEY,
  event_types text[],                              -- NULL = subscribe to all events
  enabled     boolean     NOT NULL DEFAULT true,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_consumers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_consumers_select_elevated ON public.event_consumers;
CREATE POLICY event_consumers_select_elevated ON public.event_consumers
  FOR SELECT TO authenticated USING ((SELECT public.is_elevated_user()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. EMITTER (internal — never granted to clients)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_event_type  text,
  p_entity_type text DEFAULT NULL,
  p_entity_id   text DEFAULT NULL,
  p_payload     jsonb DEFAULT '{}'::jsonb,
  p_org         uuid  DEFAULT NULL,
  p_actor       uuid  DEFAULT NULL
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.domain_events (event_type, entity_type, entity_id, organisation_id, actor_id, payload)
  VALUES (p_event_type, p_entity_type, p_entity_id, p_org, p_actor, COALESCE(p_payload, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.emit_domain_event(text,text,text,jsonb,uuid,uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. SCHEMA-TOLERANT EMIT TRIGGERS
--    TG_ARGV[0] = event_type, TG_ARGV[1] = entity_type,
--    TG_ARGV[2] = comma-separated payload key whitelist.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_emit_domain_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row     jsonb;
  v_payload jsonb;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;

  SELECT COALESCE(jsonb_object_agg(k, v_row -> k), '{}'::jsonb)
    INTO v_payload
    FROM unnest(string_to_array(TG_ARGV[2], ',')) AS k
   WHERE v_row ? k;

  PERFORM public.emit_domain_event(
    TG_ARGV[0],
    TG_ARGV[1],
    v_row ->> 'id',
    v_payload,
    NULLIF(v_row ->> 'organisation_id', '')::uuid,
    auth.uid()
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Event emission must never break the business write.
  RETURN NULL;
END;
$$;

-- Status-change variant: TG_ARGV[2] = status column, TG_ARGV[3] = extra payload keys.
CREATE OR REPLACE FUNCTION public.trg_emit_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old     jsonb := to_jsonb(OLD);
  v_new     jsonb := to_jsonb(NEW);
  v_col     text  := TG_ARGV[2];
  v_payload jsonb;
BEGIN
  IF (v_old ->> v_col) IS NOT DISTINCT FROM (v_new ->> v_col) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_object_agg(k, v_new -> k), '{}'::jsonb)
    INTO v_payload
    FROM unnest(string_to_array(COALESCE(TG_ARGV[3], ''), ',')) AS k
   WHERE v_new ? k;

  v_payload := v_payload
    || jsonb_build_object('old_' || v_col, v_old ->> v_col, 'new_' || v_col, v_new ->> v_col);

  PERFORM public.emit_domain_event(
    TG_ARGV[0],
    TG_ARGV[1],
    v_new ->> 'id',
    v_payload,
    NULLIF(v_new ->> 'organisation_id', '')::uuid,
    auth.uid()
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- Inspections
DROP TRIGGER IF EXISTS trg_ev_inspection_completed ON public.inspections;
CREATE TRIGGER trg_ev_inspection_completed
  AFTER INSERT ON public.inspections FOR EACH ROW
  EXECUTE FUNCTION public.trg_emit_domain_event(
    'inspection.completed', 'inspection',
    'asset_no,site,inspection_type,status,scheduled_date,completed_date,inspector_name,tread_depth,pressure_reading,findings,organisation_id');

-- Tyres
DROP TRIGGER IF EXISTS trg_ev_tyre_installed ON public.tyre_records;
CREATE TRIGGER trg_ev_tyre_installed
  AFTER INSERT ON public.tyre_records FOR EACH ROW
  EXECUTE FUNCTION public.trg_emit_domain_event(
    'tyre.installed', 'tyre_record',
    'asset_no,site,brand,serial_no,position,cost_per_tyre,issue_date,qty,category,risk_level,organisation_id');

-- Accidents
DROP TRIGGER IF EXISTS trg_ev_accident_reported ON public.accidents;
CREATE TRIGGER trg_ev_accident_reported
  AFTER INSERT ON public.accidents FOR EACH ROW
  EXECUTE FUNCTION public.trg_emit_domain_event(
    'accident.reported', 'accident',
    'asset_no,site,severity,status,accident_date,description,driver_name,organisation_id');

DROP TRIGGER IF EXISTS trg_ev_accident_closure_changed ON public.accidents;
CREATE TRIGGER trg_ev_accident_closure_changed
  AFTER UPDATE ON public.accidents FOR EACH ROW
  EXECUTE FUNCTION public.trg_emit_status_change(
    'accident.closure_changed', 'accident', 'closure_status', 'asset_no,site,severity');

-- Work orders
DROP TRIGGER IF EXISTS trg_ev_workorder_created ON public.work_orders;
CREATE TRIGGER trg_ev_workorder_created
  AFTER INSERT ON public.work_orders FOR EACH ROW
  EXECUTE FUNCTION public.trg_emit_domain_event(
    'workorder.created', 'work_order',
    'asset_no,site,status,wo_no,wo_number,total_cost,description,organisation_id');

DROP TRIGGER IF EXISTS trg_ev_workorder_status_changed ON public.work_orders;
CREATE TRIGGER trg_ev_workorder_status_changed
  AFTER UPDATE ON public.work_orders FOR EACH ROW
  EXECUTE FUNCTION public.trg_emit_status_change(
    'workorder.status_changed', 'work_order', 'status', 'asset_no,site,wo_no,wo_number,total_cost');

-- Corrective actions
DROP TRIGGER IF EXISTS trg_ev_corrective_action_created ON public.corrective_actions;
CREATE TRIGGER trg_ev_corrective_action_created
  AFTER INSERT ON public.corrective_actions FOR EACH ROW
  EXECUTE FUNCTION public.trg_emit_domain_event(
    'corrective_action.created', 'corrective_action',
    'asset_no,site,action,status,due_date,priority,organisation_id');

-- Stock movements
DROP TRIGGER IF EXISTS trg_ev_stock_movement ON public.stock_movements;
CREATE TRIGGER trg_ev_stock_movement
  AFTER INSERT ON public.stock_movements FOR EACH ROW
  EXECUTE FUNCTION public.trg_emit_domain_event(
    'stock.movement', 'stock_movement',
    'item,sku,brand,tyre_size,quantity,movement_type,site,reason,organisation_id');

-- Purchase orders
DROP TRIGGER IF EXISTS trg_ev_purchase_order_created ON public.purchase_orders;
CREATE TRIGGER trg_ev_purchase_order_created
  AFTER INSERT ON public.purchase_orders FOR EACH ROW
  EXECUTE FUNCTION public.trg_emit_domain_event(
    'purchase.order_created', 'purchase_order',
    'po_no,po_number,supplier,vendor,status,total,total_cost,site,organisation_id');

-- Knowledge documents (V96 auto-embedding consumes this)
DROP TRIGGER IF EXISTS trg_ev_knowledge_document_added ON public.knowledge_documents;
CREATE TRIGGER trg_ev_knowledge_document_added
  AFTER INSERT ON public.knowledge_documents FOR EACH ROW
  EXECUTE FUNCTION public.trg_emit_domain_event(
    'knowledge.document_added', 'knowledge_document',
    'title,doc_type,site,asset_no,organisation_id');

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. PROCESSOR (pg_cron, every minute)
--    At-least-once: an event is retried whole if ANY consumer fails, so
--    consumers must be idempotent or cheap to replay. 5 attempts → 'failed'.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.process_domain_events(p_batch int DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ev          public.domain_events%ROWTYPE;
  c           record;
  v_ok        boolean;
  v_err       text;
  n_processed int := 0;
  n_failed    int := 0;
BEGIN
  FOR ev IN
    SELECT * FROM public.domain_events
     WHERE status = 'pending'
     ORDER BY id
     LIMIT GREATEST(p_batch, 1)
     FOR UPDATE SKIP LOCKED
  LOOP
    v_ok  := true;
    v_err := NULL;

    FOR c IN
      SELECT consumer FROM public.event_consumers
       WHERE enabled
         AND (event_types IS NULL OR ev.event_type = ANY (event_types))
       ORDER BY consumer
    LOOP
      BEGIN
        EXECUTE format('SELECT public.%I($1)', c.consumer) USING ev;
      EXCEPTION WHEN OTHERS THEN
        v_ok  := false;
        v_err := left(COALESCE(v_err || ' | ', '') || c.consumer || ': ' || SQLERRM, 2000);
      END;
    END LOOP;

    IF v_ok THEN
      UPDATE public.domain_events
         SET status = 'processed', processed_at = now(), last_error = NULL
       WHERE id = ev.id;
      n_processed := n_processed + 1;
    ELSE
      UPDATE public.domain_events
         SET attempts   = ev.attempts + 1,
             last_error = v_err,
             status     = CASE WHEN ev.attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END,
             processed_at = CASE WHEN ev.attempts + 1 >= 5 THEN now() ELSE NULL END
       WHERE id = ev.id;
      n_failed := n_failed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('processed', n_processed, 'failed', n_failed);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.process_domain_events(int) FROM PUBLIC, anon, authenticated;

-- Schedule (idempotent: unschedule an existing job of the same name first).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-domain-events') THEN
    PERFORM cron.unschedule('process-domain-events');
  END IF;
END $$;

SELECT cron.schedule(
  'process-domain-events',
  '* * * * *',
  $$SELECT public.process_domain_events(200);$$
);

COMMENT ON TABLE public.domain_events IS
  'Transactional outbox: business events published by triggers/RPCs, dispatched to event_consumers by process_domain_events() (pg_cron, every minute). At-least-once delivery.';
COMMENT ON TABLE public.event_consumers IS
  'Registry of event handler functions public.<consumer>(public.domain_events) RETURNS void. NULL event_types = all events.';
