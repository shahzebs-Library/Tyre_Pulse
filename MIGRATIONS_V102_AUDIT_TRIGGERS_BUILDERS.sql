-- ============================================================================
-- MIGRATIONS_V102_AUDIT_TRIGGERS_BUILDERS.sql
-- Roadmap phases 13-11: Dynamic Dashboard Builder + Report Builder persistence
-- and a SERVER-SIDE full audit trail.
--
--  * Generic row-change audit triggers → audit_log_v2. Until now audit rows
--    were written only by the client (src/lib/auditLogger.js), so direct DB
--    writes, imports, RPCs and edge functions left no trail. Triggers record
--    every INSERT/UPDATE/DELETE on core business + config tables with the
--    acting user, changed-field diff (UPDATE stores only changed keys) and
--    org. Actions are namespaced 'db.insert' / 'db.update' / 'db.delete' so
--    they are distinguishable from client-side entries. Exception-safe:
--    auditing can never block the business write. Attachment is guarded by
--    to_regclass() so the migration works even if a table is absent.
--  * user_dashboards — saved dashboard layouts (widget grid jsonb) for the
--    Dashboard Builder; private by default, org-shareable.
--  * report_definitions — saved custom reports (module, columns, filters,
--    sort, optional chart) for the Report Builder; private by default,
--    org-shareable.
--
-- Rollback:
--   DROP TABLE public.report_definitions, public.user_dashboards;
--   SELECT format('DROP TRIGGER IF EXISTS trg_audit_row ON public.%I;', t)
--     FROM unnest(ARRAY['tyre_records','inspections','accidents','work_orders',
--       'vehicle_fleet','purchase_orders','stock_movements','stock_records',
--       'corrective_actions','budgets','knowledge_documents',
--       'workflow_definitions','business_rules','webhook_subscriptions',
--       'api_keys','alert_thresholds']) t;  -- \gexec
--   DROP FUNCTION public.trg_audit_row_change();
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. GENERIC AUDIT TRIGGER
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_audit_row_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old   jsonb;
  v_new   jsonb;
  v_diff_old jsonb;
  v_diff_new jsonb;
  v_email text;
  v_role  text;
  v_org   uuid;
  v_rid   text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
  ELSE
    v_old := to_jsonb(OLD);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Store only changed keys (both sides), so bulk updates stay cheap to read.
    SELECT COALESCE(jsonb_object_agg(o.key, o.value), '{}'::jsonb),
           COALESCE(jsonb_object_agg(o.key, v_new -> o.key), '{}'::jsonb)
      INTO v_diff_old, v_diff_new
      FROM jsonb_each(v_old) o
     WHERE v_new -> o.key IS DISTINCT FROM o.value;
    IF v_diff_old = '{}'::jsonb THEN
      RETURN NULL;   -- no-op update: nothing worth auditing
    END IF;
  ELSE
    v_diff_old := v_old;
    v_diff_new := v_new;
  END IF;

  SELECT email, role INTO v_email, v_role
    FROM public.profiles WHERE id = auth.uid();

  v_org := NULLIF(COALESCE(v_new ->> 'organisation_id', v_old ->> 'organisation_id'), '')::uuid;
  v_rid := COALESCE(v_new ->> 'id', v_old ->> 'id');

  INSERT INTO public.audit_log_v2
    (user_id, user_email, user_role, org_id, action, table_name, record_id, old_values, new_values)
  VALUES
    (auth.uid(), v_email, v_role, v_org,
     'db.' || lower(TG_OP), TG_TABLE_NAME, v_rid, v_diff_old, v_diff_new);

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Auditing must never break the business write.
  RETURN NULL;
END;
$$;

-- Attach to every core table that exists in this environment. Excludes
-- high-churn machine tables (domain_events, webhook_deliveries, notifications,
-- ai_messages, api_key_usage) and the audit tables themselves.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tyre_records','inspections','accidents','work_orders','vehicle_fleet',
    'purchase_orders','stock_movements','stock_records','corrective_actions',
    'budgets','knowledge_documents','workflow_definitions','business_rules',
    'webhook_subscriptions','api_keys','alert_thresholds'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_row ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.trg_audit_row_change()', t);
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. DASHBOARD BUILDER PERSISTENCE
--    layout: {"widgets":[{"id","type","size"("sm"|"md"|"lg"|"xl"),"config":{}}]}
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_dashboards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organisation_id uuid DEFAULT public.app_current_org(),
  name            text NOT NULL,
  layout          jsonb NOT NULL DEFAULT '{"widgets":[]}'::jsonb
                  CHECK (jsonb_typeof(layout -> 'widgets') = 'array'
                         AND jsonb_array_length(layout -> 'widgets') <= 40),
  is_default      boolean NOT NULL DEFAULT false,
  shared          boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_dashboards_user
  ON public.user_dashboards (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_dashboards_org_shared
  ON public.user_dashboards (organisation_id) WHERE shared;

ALTER TABLE public.user_dashboards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_dashboards_own ON public.user_dashboards;
CREATE POLICY user_dashboards_own ON public.user_dashboards
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS user_dashboards_shared_read ON public.user_dashboards;
CREATE POLICY user_dashboards_shared_read ON public.user_dashboards
  FOR SELECT TO authenticated
  USING (shared AND (organisation_id IS NULL
         OR organisation_id = (SELECT public.app_current_org())));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. REPORT BUILDER PERSISTENCE
--    filters: [{"field","operator","value"}]  sort: {"field","dir"}
--    chart:   {"type":"bar"|"line"|"pie","groupBy","aggregate","field"} | null
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.report_definitions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organisation_id uuid DEFAULT public.app_current_org(),
  name            text NOT NULL,
  description     text,
  module          text NOT NULL CHECK (module IN
                   ('tyres','inspections','work_orders','accidents','stock','fleet','purchase_orders')),
  columns         text[] NOT NULL CHECK (array_length(columns, 1) BETWEEN 1 AND 30),
  filters         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(filters) = 'array'),
  sort            jsonb,
  chart           jsonb,
  shared          boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_report_definitions_user
  ON public.report_definitions (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_definitions_org_shared
  ON public.report_definitions (organisation_id) WHERE shared;

ALTER TABLE public.report_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS report_definitions_own ON public.report_definitions;
CREATE POLICY report_definitions_own ON public.report_definitions
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS report_definitions_shared_read ON public.report_definitions;
CREATE POLICY report_definitions_shared_read ON public.report_definitions
  FOR SELECT TO authenticated
  USING (shared AND (organisation_id IS NULL
         OR organisation_id = (SELECT public.app_current_org())));

COMMENT ON TABLE public.user_dashboards IS
  'Dashboard Builder layouts: widget grid jsonb, private per user, optionally shared org-wide (read-only).';
COMMENT ON TABLE public.report_definitions IS
  'Report Builder saved reports: module + column list + filters + sort + optional chart. Private per user, optionally shared org-wide.';
