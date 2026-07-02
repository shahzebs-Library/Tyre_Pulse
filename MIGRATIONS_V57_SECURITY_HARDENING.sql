-- ============================================================================
-- MIGRATIONS_V57_SECURITY_HARDENING.sql
-- Closes the P1 security findings from docs/PROJECT_AUDIT_2026-07.md (H1, H2,
-- H10, M8) in one backward-compatible migration. Every change was verified
-- against the live schema before writing.
--
--  H1  work_orders / purchase_orders had blanket "ALL true/true" PERMISSIVE
--      policies letting ANY authenticated user update/delete anyone's rows
--      (org-scoped only). Drop the blanket policies so the already-present
--      granular ones govern; add an approval-gated UPDATE for work_orders.
--  H2  v_accidents_secure / v_inspections_secure / v_tyre_records_secure were
--      SECURITY DEFINER views (bypass caller RLS). Switch to security_invoker.
--  H10 4 functions had a mutable search_path -> pin to public.
--  M8  ai_response_cache / document_chunks / kpi_snapshots had RLS enabled but
--      NO policy (deny-all) -> add authenticated SELECT so RAG/KPI reads work.
--      Writes stay service-role only (bypass RLS), so no write policy is added.
--
-- Backward-compatible: app insert/select paths are unchanged. Only over-broad
-- write access is removed. work_orders UPDATE now requires an approved,
-- unlocked account (is_approved_and_unlocked()), matching every other module.
--
-- Rollback:
--   CREATE POLICY auth_all_work_orders ON public.work_orders AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
--   CREATE POLICY work_orders_update_all ON public.work_orders AS PERMISSIVE FOR UPDATE TO authenticated USING (true);
--   DROP POLICY work_orders_update ON public.work_orders;
--   CREATE POLICY auth_all_purchase_orders ON public.purchase_orders AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
--   ALTER VIEW public.v_accidents_secure  SET (security_invoker = false);
--   ALTER VIEW public.v_inspections_secure SET (security_invoker = false);
--   ALTER VIEW public.v_tyre_records_secure SET (security_invoker = false);
--   ALTER FUNCTION public.touch_updated_at() RESET search_path;
--   ALTER FUNCTION public.jsonb_key_count(jsonb) RESET search_path;
--   ALTER FUNCTION public.import_target_table(text) RESET search_path;
--   ALTER FUNCTION public.stock_movement_direction(text) RESET search_path;
--   DROP POLICY ai_response_cache_read_authenticated ON public.ai_response_cache;
--   DROP POLICY document_chunks_read_authenticated   ON public.document_chunks;
--   DROP POLICY kpi_snapshots_read_authenticated      ON public.kpi_snapshots;
-- ============================================================================

-- H1: work_orders -- remove blanket write access, keep granular policies,
--     add approval-gated UPDATE (USING + WITH CHECK).
DROP POLICY IF EXISTS auth_all_work_orders  ON public.work_orders;
DROP POLICY IF EXISTS work_orders_update_all ON public.work_orders;

CREATE POLICY work_orders_update ON public.work_orders
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_approved_and_unlocked())
  WITH CHECK (is_approved_and_unlocked());

-- H1: purchase_orders -- remove blanket ALL; granular po_* policies remain.
DROP POLICY IF EXISTS auth_all_purchase_orders ON public.purchase_orders;

-- H2: SECURITY DEFINER views -> security_invoker (respect caller RLS).
ALTER VIEW public.v_accidents_secure   SET (security_invoker = true);
ALTER VIEW public.v_inspections_secure SET (security_invoker = true);
ALTER VIEW public.v_tyre_records_secure SET (security_invoker = true);

-- H10: pin search_path on the 4 flagged functions.
ALTER FUNCTION public.touch_updated_at()               SET search_path = public;
ALTER FUNCTION public.jsonb_key_count(jsonb)           SET search_path = public;
ALTER FUNCTION public.import_target_table(text)        SET search_path = public;
ALTER FUNCTION public.stock_movement_direction(text)   SET search_path = public;

-- M8: deny-all tables -> authenticated SELECT (writes remain service-role only).
CREATE POLICY ai_response_cache_read_authenticated ON public.ai_response_cache
  AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY document_chunks_read_authenticated ON public.document_chunks
  AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY kpi_snapshots_read_authenticated ON public.kpi_snapshots
  AS PERMISSIVE FOR SELECT TO authenticated USING (true);
