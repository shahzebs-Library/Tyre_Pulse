-- =============================================================================
-- MIGRATIONS_V75_RLS_INITPLAN.sql
-- =============================================================================
-- Purpose:
--   Fix the Supabase `auth_rls_initplan` performance advisory on 83 RLS policies
--   across 41 tables in schema `public`.
--
-- Advisory background:
--   When an RLS policy references `auth.uid()`, `auth.role()`, `auth.jwt()`,
--   `current_setting(...)`, or a STABLE SECURITY DEFINER helper that internally
--   resolves the current session (e.g. `app_current_org()`, `app_is_org_admin()`,
--   `app_is_elevated()`, `get_my_role()`, `is_approved_and_unlocked()`), Postgres
--   re-evaluates that call FOR EVERY ROW scanned. Because every such call is
--   constant for the duration of a single statement (it depends only on the
--   session / current user, never on row columns), it can be evaluated ONCE by
--   wrapping it in a scalar sub-select: `(select auth.uid())`. Postgres caches
--   the InitPlan result, eliminating the per-row overhead on large scans.
--
-- Behavior-preserving guarantee:
--   The ONLY change applied to each policy expression is wrapping the qualifying
--   function calls in `(select ...)`. No operator, column reference, literal,
--   cast, AND/OR structure, command, PERMISSIVE/RESTRICTIVE flag, or role list is
--   altered. A scalar sub-select over a constant-per-statement function returns
--   exactly the same value as the bare call, so access-control logic is identical.
--   Every helper wrapped here is STABLE, SECURITY DEFINER, zero-argument, and
--   depends only on `auth.uid()` -- verified against pg_proc -- so it is likewise
--   constant per statement and safe to wrap.
--
-- Idempotent & reversible:
--   Each policy is re-created with `DROP POLICY IF EXISTS` + `CREATE POLICY`,
--   so this migration can be re-run safely. The verbatim pre-migration
--   definition of every policy is preserved as a comment above its replacement
--   to support exact rollback and audit.
--
-- Scope: 83 policies / 41 tables. 1:1 replacement -- no policy is added, dropped,
--   merged, or renamed. Ordering from the advisory target list is preserved.
--
-- Validation: proven behavior-preserving in a rolled-back transaction. The
--   normalized-diff assertion confirmed every rewritten expression differs from
--   its original ONLY by `(select ...)` wrapping; anon SELECT on sensitive tables
--   still returns 0 rows. This file must be applied through the normal migration
--   pipeline; it was NOT applied to live during authoring.
-- =============================================================================

BEGIN;

-- ============================================================================
-- Table: public.profiles   Policy: "profiles_update_own"   (PERMISSIVE UPDATE TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (id = auth.uid())
--   WITH CHECK:
--   (id = auth.uid())
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((id = (select auth.uid())))
  WITH CHECK ((id = (select auth.uid())));

-- ============================================================================
-- Table: public.sites   Policy: "sites_write_elevated"   (PERMISSIVE ALL TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (EXISTS ( SELECT 1
--      FROM profiles
--     WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text])) AND (profiles.approved = true))))
DROP POLICY IF EXISTS "sites_write_elevated" ON public.sites;
CREATE POLICY "sites_write_elevated" ON public.sites
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'manager'::text, 'director'::text])) AND (profiles.approved = true)))));

-- ============================================================================
-- Table: public.purchase_orders   Policy: "po_insert_authenticated"   (PERMISSIVE INSERT TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   WITH CHECK:
--   ((auth.uid() = created_by) OR (created_by IS NULL))
DROP POLICY IF EXISTS "po_insert_authenticated" ON public.purchase_orders;
CREATE POLICY "po_insert_authenticated" ON public.purchase_orders
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((select auth.uid()) = created_by) OR (created_by IS NULL)));

-- ============================================================================
-- Table: public.purchase_orders   Policy: "po_update_authenticated"   (PERMISSIVE UPDATE TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   ((auth.uid() = created_by) OR (EXISTS ( SELECT 1
--      FROM profiles
--     WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'Admin'::text)))))
DROP POLICY IF EXISTS "po_update_authenticated" ON public.purchase_orders;
CREATE POLICY "po_update_authenticated" ON public.purchase_orders
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((select auth.uid()) = created_by) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'Admin'::text))))));

-- ============================================================================
-- Table: public.purchase_orders   Policy: "po_delete_admin"   (PERMISSIVE DELETE TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (EXISTS ( SELECT 1
--      FROM profiles
--     WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'Admin'::text))))
DROP POLICY IF EXISTS "po_delete_admin" ON public.purchase_orders;
CREATE POLICY "po_delete_admin" ON public.purchase_orders
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'Admin'::text)))));

-- ============================================================================
-- Table: public.vehicle_fleet   Policy: "vf_write_elevated"   (PERMISSIVE ALL TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (EXISTS ( SELECT 1
--      FROM profiles
--     WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'manager'::text])) AND (profiles.approved = true))))
DROP POLICY IF EXISTS "vf_write_elevated" ON public.vehicle_fleet;
CREATE POLICY "vf_write_elevated" ON public.vehicle_fleet
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'manager'::text])) AND (profiles.approved = true)))));

-- ============================================================================
-- Table: public.alerts   Policy: "alerts_select"   (PERMISSIVE SELECT TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.uid() IS NOT NULL)
DROP POLICY IF EXISTS "alerts_select" ON public.alerts;
CREATE POLICY "alerts_select" ON public.alerts
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (((select auth.uid()) IS NOT NULL));

-- ============================================================================
-- Table: public.stock_records   Policy: "stock_records_select"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "stock_records_select" ON public.stock_records;
CREATE POLICY "stock_records_select" ON public.stock_records
  AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.gate_passes   Policy: "gate_passes_select"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "gate_passes_select" ON public.gate_passes;
CREATE POLICY "gate_passes_select" ON public.gate_passes
  AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.gate_passes   Policy: "gate_passes_insert"   (PERMISSIVE INSERT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   WITH CHECK:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "gate_passes_insert" ON public.gate_passes;
CREATE POLICY "gate_passes_insert" ON public.gate_passes
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.gate_passes   Policy: "gate_passes_update"   (PERMISSIVE UPDATE TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "gate_passes_update" ON public.gate_passes;
CREATE POLICY "gate_passes_update" ON public.gate_passes
  AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.stock_movements   Policy: "stock_movements_select"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "stock_movements_select" ON public.stock_movements;
CREATE POLICY "stock_movements_select" ON public.stock_movements
  AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.budgets   Policy: "budgets_select"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "budgets_select" ON public.budgets;
CREATE POLICY "budgets_select" ON public.budgets
  AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.corrective_actions   Policy: "actions_select"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "actions_select" ON public.corrective_actions;
CREATE POLICY "actions_select" ON public.corrective_actions
  AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.rca_records   Policy: "rca_select"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "rca_select" ON public.rca_records;
CREATE POLICY "rca_select" ON public.rca_records
  AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.alerts   Policy: "alerts_insert"   (PERMISSIVE INSERT TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   WITH CHECK:
--   (auth.uid() IS NOT NULL)
DROP POLICY IF EXISTS "alerts_insert" ON public.alerts;
CREATE POLICY "alerts_insert" ON public.alerts
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((select auth.uid()) IS NOT NULL));

-- ============================================================================
-- Table: public.kpi_targets   Policy: "kpi_targets_select"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "kpi_targets_select" ON public.kpi_targets;
CREATE POLICY "kpi_targets_select" ON public.kpi_targets
  AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.upload_history   Policy: "upload_history_select"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "upload_history_select" ON public.upload_history;
CREATE POLICY "upload_history_select" ON public.upload_history
  AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.column_mappings   Policy: "column_mappings_select"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "column_mappings_select" ON public.column_mappings;
CREATE POLICY "column_mappings_select" ON public.column_mappings
  AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.column_mappings   Policy: "column_mappings_insert"   (PERMISSIVE INSERT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   WITH CHECK:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "column_mappings_insert" ON public.column_mappings;
CREATE POLICY "column_mappings_insert" ON public.column_mappings
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.column_mappings   Policy: "column_mappings_update"   (PERMISSIVE UPDATE TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "column_mappings_update" ON public.column_mappings;
CREATE POLICY "column_mappings_update" ON public.column_mappings
  AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.cleaning_log   Policy: "cleaning_log_select"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "cleaning_log_select" ON public.cleaning_log;
CREATE POLICY "cleaning_log_select" ON public.cleaning_log
  AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.audit_log   Policy: "audit_log_select"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "audit_log_select" ON public.audit_log;
CREATE POLICY "audit_log_select" ON public.audit_log
  AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.audit_log   Policy: "audit_log_insert"   (PERMISSIVE INSERT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   WITH CHECK:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "audit_log_insert" ON public.audit_log;
CREATE POLICY "audit_log_insert" ON public.audit_log
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.brand_aliases   Policy: "Read brand aliases"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "Read brand aliases" ON public.brand_aliases;
CREATE POLICY "Read brand aliases" ON public.brand_aliases
  AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.warranty_claims   Policy: "warranty_claims_delete"   (PERMISSIVE DELETE TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (EXISTS ( SELECT 1
--      FROM profiles
--     WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text])))))
DROP POLICY IF EXISTS "warranty_claims_delete" ON public.warranty_claims;
CREATE POLICY "warranty_claims_delete" ON public.warranty_claims
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text]))))));

-- ============================================================================
-- Table: public.audit_log   Policy: "audit_select"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "audit_select" ON public.audit_log;
CREATE POLICY "audit_select" ON public.audit_log
  AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.audit_log   Policy: "audit_insert"   (PERMISSIVE INSERT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   WITH CHECK:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "audit_insert" ON public.audit_log;
CREATE POLICY "audit_insert" ON public.audit_log
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.kpi_targets   Policy: "kpi_targets_authenticated"   (PERMISSIVE ALL TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "kpi_targets_authenticated" ON public.kpi_targets;
CREATE POLICY "kpi_targets_authenticated" ON public.kpi_targets
  AS PERMISSIVE FOR ALL TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.stock_movements   Policy: "stock_movements_authenticated"   (PERMISSIVE ALL TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "stock_movements_authenticated" ON public.stock_movements;
CREATE POLICY "stock_movements_authenticated" ON public.stock_movements
  AS PERMISSIVE FOR ALL TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.profiles   Policy: "profiles_org_isolation"   (RESTRICTIVE SELECT TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   ((id = auth.uid()) OR app_is_org_admin() OR ((org_id IS NOT NULL) AND (org_id = app_current_org())))
DROP POLICY IF EXISTS "profiles_org_isolation" ON public.profiles;
CREATE POLICY "profiles_org_isolation" ON public.profiles
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (((id = (select auth.uid())) OR (select app_is_org_admin()) OR ((org_id IS NOT NULL) AND (org_id = (select app_current_org())))));

-- ============================================================================
-- Table: public.system_config   Policy: "sc_super_admin_all"   (PERMISSIVE ALL TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (EXISTS ( SELECT 1
--      FROM profiles
--     WHERE ((profiles.id = auth.uid()) AND (profiles.is_super_admin = true))))
DROP POLICY IF EXISTS "sc_super_admin_all" ON public.system_config;
CREATE POLICY "sc_super_admin_all" ON public.system_config
  AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.is_super_admin = true)))));

-- ============================================================================
-- Table: public.system_config   Policy: "sc_read_authenticated"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "sc_read_authenticated" ON public.system_config;
CREATE POLICY "sc_read_authenticated" ON public.system_config
  AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.recalls   Policy: "recalls_delete"   (PERMISSIVE DELETE TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (EXISTS ( SELECT 1
--      FROM profiles
--     WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text])))))
DROP POLICY IF EXISTS "recalls_delete" ON public.recalls;
CREATE POLICY "recalls_delete" ON public.recalls
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text]))))));

-- ============================================================================
-- Table: public.announcements   Policy: "ann_super_admin_all"   (PERMISSIVE ALL TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (EXISTS ( SELECT 1
--      FROM profiles
--     WHERE ((profiles.id = auth.uid()) AND (profiles.is_super_admin = true))))
DROP POLICY IF EXISTS "ann_super_admin_all" ON public.announcements;
CREATE POLICY "ann_super_admin_all" ON public.announcements
  AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.is_super_admin = true)))));

-- ============================================================================
-- Table: public.announcements   Policy: "ann_read_active"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   ((auth.role() = 'authenticated'::text) AND (active = true) AND (show_from <= now()) AND ((show_until IS NULL) OR (show_until > now())))
DROP POLICY IF EXISTS "ann_read_active" ON public.announcements;
CREATE POLICY "ann_read_active" ON public.announcements
  AS PERMISSIVE FOR SELECT TO public
  USING ((((select auth.role()) = 'authenticated'::text) AND (active = true) AND (show_from <= now()) AND ((show_until IS NULL) OR (show_until > now()))));

-- ============================================================================
-- Table: public.ai_usage_log   Policy: "ai_super_admin_all"   (PERMISSIVE ALL TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (EXISTS ( SELECT 1
--      FROM profiles
--     WHERE ((profiles.id = auth.uid()) AND (profiles.is_super_admin = true))))
DROP POLICY IF EXISTS "ai_super_admin_all" ON public.ai_usage_log;
CREATE POLICY "ai_super_admin_all" ON public.ai_usage_log
  AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.is_super_admin = true)))));

-- ============================================================================
-- Table: public.vehicle_fleet   Policy: "vehicle_fleet_insert"   (PERMISSIVE INSERT TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   WITH CHECK:
--   ((auth.uid() IS NOT NULL) AND (auth.role() = 'authenticated'::text))
DROP POLICY IF EXISTS "vehicle_fleet_insert" ON public.vehicle_fleet;
CREATE POLICY "vehicle_fleet_insert" ON public.vehicle_fleet
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((select auth.uid()) IS NOT NULL) AND ((select auth.role()) = 'authenticated'::text)));

-- ============================================================================
-- Table: public.field_synonyms   Policy: "fs_read_all"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "fs_read_all" ON public.field_synonyms;
CREATE POLICY "fs_read_all" ON public.field_synonyms
  AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.ai_usage_log   Policy: "ai_insert_authenticated"   (PERMISSIVE INSERT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   WITH CHECK:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "ai_insert_authenticated" ON public.ai_usage_log;
CREATE POLICY "ai_insert_authenticated" ON public.ai_usage_log
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.fleet_master   Policy: "fleet_master_select_authenticated"   (PERMISSIVE SELECT TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.uid() IS NOT NULL)
DROP POLICY IF EXISTS "fleet_master_select_authenticated" ON public.fleet_master;
CREATE POLICY "fleet_master_select_authenticated" ON public.fleet_master
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (((select auth.uid()) IS NOT NULL));

-- ============================================================================
-- Table: public.work_orders   Policy: "work_orders_insert_authenticated"   (PERMISSIVE INSERT TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   WITH CHECK:
--   (auth.uid() IS NOT NULL)
DROP POLICY IF EXISTS "work_orders_insert_authenticated" ON public.work_orders;
CREATE POLICY "work_orders_insert_authenticated" ON public.work_orders
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((select auth.uid()) IS NOT NULL));

-- ============================================================================
-- Table: public.work_orders   Policy: "work_orders_delete_admin"   (PERMISSIVE DELETE TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (EXISTS ( SELECT 1
--      FROM profiles
--     WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'Admin'::text))))
DROP POLICY IF EXISTS "work_orders_delete_admin" ON public.work_orders;
CREATE POLICY "work_orders_delete_admin" ON public.work_orders
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'Admin'::text)))));

-- ============================================================================
-- Table: public.ai_usage_log   Policy: "ai_read_own"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (user_id = auth.uid())
DROP POLICY IF EXISTS "ai_read_own" ON public.ai_usage_log;
CREATE POLICY "ai_read_own" ON public.ai_usage_log
  AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = (select auth.uid())));

-- ============================================================================
-- Table: public.tyre_specifications   Policy: "tyre_specifications_delete"   (PERMISSIVE DELETE TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (EXISTS ( SELECT 1
--      FROM profiles
--     WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text])))))
DROP POLICY IF EXISTS "tyre_specifications_delete" ON public.tyre_specifications;
CREATE POLICY "tyre_specifications_delete" ON public.tyre_specifications
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text]))))));

-- ============================================================================
-- Table: public.profiles   Policy: "profiles_select"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles
  AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.alert_thresholds   Policy: "alert_thresholds_own"   (PERMISSIVE ALL TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.uid() = user_id)
DROP POLICY IF EXISTS "alert_thresholds_own" ON public.alert_thresholds;
CREATE POLICY "alert_thresholds_own" ON public.alert_thresholds
  AS PERMISSIVE FOR ALL TO public
  USING (((select auth.uid()) = user_id));

-- ============================================================================
-- Table: public.console_sessions   Policy: "cs_super_admin_all"   (PERMISSIVE ALL TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (EXISTS ( SELECT 1
--      FROM profiles
--     WHERE ((profiles.id = auth.uid()) AND (profiles.is_super_admin = true))))
DROP POLICY IF EXISTS "cs_super_admin_all" ON public.console_sessions;
CREATE POLICY "cs_super_admin_all" ON public.console_sessions
  AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.is_super_admin = true)))));

-- ============================================================================
-- Table: public.console_sessions   Policy: "cs_insert_authenticated"   (PERMISSIVE INSERT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   WITH CHECK:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "cs_insert_authenticated" ON public.console_sessions;
CREATE POLICY "cs_insert_authenticated" ON public.console_sessions
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.module_permissions   Policy: "mp_super_admin_all"   (PERMISSIVE ALL TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (EXISTS ( SELECT 1
--      FROM profiles
--     WHERE ((profiles.id = auth.uid()) AND (profiles.is_super_admin = true))))
DROP POLICY IF EXISTS "mp_super_admin_all" ON public.module_permissions;
CREATE POLICY "mp_super_admin_all" ON public.module_permissions
  AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.is_super_admin = true)))));

-- ============================================================================
-- Table: public.module_permissions   Policy: "mp_read_authenticated"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "mp_read_authenticated" ON public.module_permissions;
CREATE POLICY "mp_read_authenticated" ON public.module_permissions
  AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.tyre_rotations   Policy: "tyre_rotations_delete"   (PERMISSIVE DELETE TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (EXISTS ( SELECT 1
--      FROM profiles
--     WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text])))))
DROP POLICY IF EXISTS "tyre_rotations_delete" ON public.tyre_rotations;
CREATE POLICY "tyre_rotations_delete" ON public.tyre_rotations
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text]))))));

-- ============================================================================
-- Table: public.supplier_ratings   Policy: "supplier_ratings_delete"   (PERMISSIVE DELETE TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (EXISTS ( SELECT 1
--      FROM profiles
--     WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text])))))
DROP POLICY IF EXISTS "supplier_ratings_delete" ON public.supplier_ratings;
CREATE POLICY "supplier_ratings_delete" ON public.supplier_ratings
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text]))))));

-- ============================================================================
-- Table: public.supplier_contracts   Policy: "supplier_contracts_delete"   (PERMISSIVE DELETE TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (EXISTS ( SELECT 1
--      FROM profiles
--     WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text])))))
DROP POLICY IF EXISTS "supplier_contracts_delete" ON public.supplier_contracts;
CREATE POLICY "supplier_contracts_delete" ON public.supplier_contracts
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text]))))));

-- ============================================================================
-- Table: public.console_sessions   Policy: "super_admin_console_sessions"   (PERMISSIVE ALL TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (( SELECT profiles.is_super_admin
--      FROM profiles
--     WHERE (profiles.id = auth.uid())) = true)
DROP POLICY IF EXISTS "super_admin_console_sessions" ON public.console_sessions;
CREATE POLICY "super_admin_console_sessions" ON public.console_sessions
  AS PERMISSIVE FOR ALL TO public
  USING ((( SELECT profiles.is_super_admin
   FROM profiles
  WHERE (profiles.id = (select auth.uid()))) = true));

-- ============================================================================
-- Table: public.module_permissions   Policy: "super_admin_manage_module_permissions"   (PERMISSIVE ALL TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (( SELECT profiles.is_super_admin
--      FROM profiles
--     WHERE (profiles.id = auth.uid())) = true)
DROP POLICY IF EXISTS "super_admin_manage_module_permissions" ON public.module_permissions;
CREATE POLICY "super_admin_manage_module_permissions" ON public.module_permissions
  AS PERMISSIVE FOR ALL TO public
  USING ((( SELECT profiles.is_super_admin
   FROM profiles
  WHERE (profiles.id = (select auth.uid()))) = true));

-- ============================================================================
-- Table: public.module_permissions   Policy: "users_read_own_org_permissions"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   ((org_id = ( SELECT profiles.organisation_id
--      FROM profiles
--     WHERE (profiles.id = auth.uid()))) OR (org_id IS NULL))
DROP POLICY IF EXISTS "users_read_own_org_permissions" ON public.module_permissions;
CREATE POLICY "users_read_own_org_permissions" ON public.module_permissions
  AS PERMISSIVE FOR SELECT TO public
  USING (((org_id = ( SELECT profiles.organisation_id
   FROM profiles
  WHERE (profiles.id = (select auth.uid())))) OR (org_id IS NULL)));

-- ============================================================================
-- Table: public.announcements   Policy: "super_admin_manage_announcements"   (PERMISSIVE ALL TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (( SELECT profiles.is_super_admin
--      FROM profiles
--     WHERE (profiles.id = auth.uid())) = true)
DROP POLICY IF EXISTS "super_admin_manage_announcements" ON public.announcements;
CREATE POLICY "super_admin_manage_announcements" ON public.announcements
  AS PERMISSIVE FOR ALL TO public
  USING ((( SELECT profiles.is_super_admin
   FROM profiles
  WHERE (profiles.id = (select auth.uid()))) = true));

-- ============================================================================
-- Table: public.announcements   Policy: "users_read_active_announcements"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   ((active = true) AND ((show_until IS NULL) OR (show_until > now())) AND ((target_org_id IS NULL) OR (target_org_id = ( SELECT profiles.organisation_id
--      FROM profiles
--     WHERE (profiles.id = auth.uid())))))
DROP POLICY IF EXISTS "users_read_active_announcements" ON public.announcements;
CREATE POLICY "users_read_active_announcements" ON public.announcements
  AS PERMISSIVE FOR SELECT TO public
  USING (((active = true) AND ((show_until IS NULL) OR (show_until > now())) AND ((target_org_id IS NULL) OR (target_org_id = ( SELECT profiles.organisation_id
   FROM profiles
  WHERE (profiles.id = (select auth.uid())))))));

-- ============================================================================
-- Table: public.system_config   Policy: "super_admin_manage_system_config"   (PERMISSIVE ALL TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (( SELECT profiles.is_super_admin
--      FROM profiles
--     WHERE (profiles.id = auth.uid())) = true)
DROP POLICY IF EXISTS "super_admin_manage_system_config" ON public.system_config;
CREATE POLICY "super_admin_manage_system_config" ON public.system_config
  AS PERMISSIVE FOR ALL TO public
  USING ((( SELECT profiles.is_super_admin
   FROM profiles
  WHERE (profiles.id = (select auth.uid()))) = true));

-- ============================================================================
-- Table: public.report_schedules   Policy: "report_schedules_select"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.uid() IN ( SELECT profiles.id
--      FROM profiles
--     WHERE (report_schedules.org_id = report_schedules.org_id)))
DROP POLICY IF EXISTS "report_schedules_select" ON public.report_schedules;
CREATE POLICY "report_schedules_select" ON public.report_schedules
  AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) IN ( SELECT profiles.id
   FROM profiles
  WHERE (report_schedules.org_id = report_schedules.org_id))));

-- ============================================================================
-- Table: public.report_schedules   Policy: "report_schedules_insert"   (PERMISSIVE INSERT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   WITH CHECK:
--   (auth.uid() IN ( SELECT profiles.id
--      FROM profiles
--     WHERE ((report_schedules.org_id = report_schedules.org_id) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text])))))
DROP POLICY IF EXISTS "report_schedules_insert" ON public.report_schedules;
CREATE POLICY "report_schedules_insert" ON public.report_schedules
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) IN ( SELECT profiles.id
   FROM profiles
  WHERE ((report_schedules.org_id = report_schedules.org_id) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text]))))));

-- ============================================================================
-- Table: public.report_schedules   Policy: "report_schedules_update"   (PERMISSIVE UPDATE TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.uid() IN ( SELECT profiles.id
--      FROM profiles
--     WHERE ((report_schedules.org_id = report_schedules.org_id) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text])))))
DROP POLICY IF EXISTS "report_schedules_update" ON public.report_schedules;
CREATE POLICY "report_schedules_update" ON public.report_schedules
  AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) IN ( SELECT profiles.id
   FROM profiles
  WHERE ((report_schedules.org_id = report_schedules.org_id) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text]))))));

-- ============================================================================
-- Table: public.report_schedules   Policy: "report_schedules_delete"   (PERMISSIVE DELETE TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.uid() IN ( SELECT profiles.id
--      FROM profiles
--     WHERE ((report_schedules.org_id = report_schedules.org_id) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text])))))
DROP POLICY IF EXISTS "report_schedules_delete" ON public.report_schedules;
CREATE POLICY "report_schedules_delete" ON public.report_schedules
  AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) IN ( SELECT profiles.id
   FROM profiles
  WHERE ((report_schedules.org_id = report_schedules.org_id) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text]))))));

-- ============================================================================
-- Table: public.notifications   Policy: "notifications_select_own"   (PERMISSIVE SELECT TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (user_id = auth.uid())
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = (select auth.uid())));

-- ============================================================================
-- Table: public.notifications   Policy: "notifications_update_own"   (PERMISSIVE UPDATE TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (user_id = auth.uid())
--   WITH CHECK:
--   (user_id = auth.uid())
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

-- ============================================================================
-- Table: public.inspection_schedules   Policy: "inspection_schedules_delete"   (PERMISSIVE DELETE TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (EXISTS ( SELECT 1
--      FROM profiles
--     WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text])))))
DROP POLICY IF EXISTS "inspection_schedules_delete" ON public.inspection_schedules;
CREATE POLICY "inspection_schedules_delete" ON public.inspection_schedules
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text]))))));

-- ============================================================================
-- Table: public.pending_uploads   Policy: "pending_uploads_insert"   (PERMISSIVE INSERT TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   WITH CHECK:
--   (uploaded_by = auth.uid())
DROP POLICY IF EXISTS "pending_uploads_insert" ON public.pending_uploads;
CREATE POLICY "pending_uploads_insert" ON public.pending_uploads
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((uploaded_by = (select auth.uid())));

-- ============================================================================
-- Table: public.pending_uploads   Policy: "pending_uploads_select"   (PERMISSIVE SELECT TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   ((uploaded_by = auth.uid()) OR (get_my_role() = ANY (ARRAY['Admin'::text, 'Manager'::text])))
DROP POLICY IF EXISTS "pending_uploads_select" ON public.pending_uploads;
CREATE POLICY "pending_uploads_select" ON public.pending_uploads
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (((uploaded_by = (select auth.uid())) OR ((select get_my_role()) = ANY (ARRAY['Admin'::text, 'Manager'::text]))));

-- ============================================================================
-- Table: public.inspection_audit_log   Policy: "insp_audit_select"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   (auth.role() = 'authenticated'::text)
DROP POLICY IF EXISTS "insp_audit_select" ON public.inspection_audit_log;
CREATE POLICY "insp_audit_select" ON public.inspection_audit_log
  AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================================
-- Table: public.profiles   Policy: "profiles_insert_new_user"   (PERMISSIVE INSERT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   WITH CHECK:
--   ((auth.uid() = id) OR (get_my_role() = 'Admin'::text))
DROP POLICY IF EXISTS "profiles_insert_new_user" ON public.profiles;
CREATE POLICY "profiles_insert_new_user" ON public.profiles
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((((select auth.uid()) = id) OR ((select get_my_role()) = 'Admin'::text)));

-- ============================================================================
-- Table: public.system_config   Policy: "system_config_read"   (PERMISSIVE SELECT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   ((auth.role() = 'authenticated'::text) OR (key = ANY (ARRAY['maintenance_mode'::text, 'maintenance_message'::text, 'allow_signups'::text, 'registration_open'::text, 'require_approval'::text, 'app_version'::text, 'default_currency'::text, 'password_min_length'::text, 'two_factor_required'::text, 'session_timeout_hours'::text])))
DROP POLICY IF EXISTS "system_config_read" ON public.system_config;
CREATE POLICY "system_config_read" ON public.system_config
  AS PERMISSIVE FOR SELECT TO public
  USING ((((select auth.role()) = 'authenticated'::text) OR (key = ANY (ARRAY['maintenance_mode'::text, 'maintenance_message'::text, 'allow_signups'::text, 'registration_open'::text, 'require_approval'::text, 'app_version'::text, 'default_currency'::text, 'password_min_length'::text, 'two_factor_required'::text, 'session_timeout_hours'::text]))));

-- ============================================================================
-- Table: public.organisation_memberships   Policy: "org_memberships_read"   (PERMISSIVE SELECT TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   ((user_id = auth.uid()) OR app_is_elevated())
DROP POLICY IF EXISTS "org_memberships_read" ON public.organisation_memberships;
CREATE POLICY "org_memberships_read" ON public.organisation_memberships
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = (select auth.uid())) OR (select app_is_elevated())));

-- ============================================================================
-- Table: public.file_metadata   Policy: "file_metadata_insert"   (PERMISSIVE INSERT TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   WITH CHECK:
--   ((owner_id = auth.uid()) AND is_approved_and_unlocked())
DROP POLICY IF EXISTS "file_metadata_insert" ON public.file_metadata;
CREATE POLICY "file_metadata_insert" ON public.file_metadata
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((owner_id = (select auth.uid())) AND (select is_approved_and_unlocked())));

-- ============================================================================
-- Table: public.file_metadata   Policy: "file_metadata_delete"   (PERMISSIVE DELETE TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   ((owner_id = auth.uid()) OR app_is_elevated())
DROP POLICY IF EXISTS "file_metadata_delete" ON public.file_metadata;
CREATE POLICY "file_metadata_delete" ON public.file_metadata
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (((owner_id = (select auth.uid())) OR (select app_is_elevated())));

-- ============================================================================
-- Table: public.vehicle_fleet   Policy: "vehicle_fleet_update"   (PERMISSIVE UPDATE TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   ((auth.uid() IS NOT NULL) AND (auth.role() = 'authenticated'::text))
--   WITH CHECK:
--   ((auth.uid() IS NOT NULL) AND (auth.role() = 'authenticated'::text))
DROP POLICY IF EXISTS "vehicle_fleet_update" ON public.vehicle_fleet;
CREATE POLICY "vehicle_fleet_update" ON public.vehicle_fleet
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((select auth.uid()) IS NOT NULL) AND ((select auth.role()) = 'authenticated'::text)))
  WITH CHECK ((((select auth.uid()) IS NOT NULL) AND ((select auth.role()) = 'authenticated'::text)));

-- ============================================================================
-- Table: public.vehicle_fleet   Policy: "vehicle_fleet_delete"   (PERMISSIVE DELETE TO authenticated)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   ((auth.uid() IS NOT NULL) AND (auth.role() = 'authenticated'::text))
DROP POLICY IF EXISTS "vehicle_fleet_delete" ON public.vehicle_fleet;
CREATE POLICY "vehicle_fleet_delete" ON public.vehicle_fleet
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((((select auth.uid()) IS NOT NULL) AND ((select auth.role()) = 'authenticated'::text)));

-- ============================================================================
-- Table: public.suppliers   Policy: "suppliers_insert"   (PERMISSIVE INSERT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   WITH CHECK:
--   ((auth.uid() IS NOT NULL) AND (auth.role() = 'authenticated'::text))
DROP POLICY IF EXISTS "suppliers_insert" ON public.suppliers;
CREATE POLICY "suppliers_insert" ON public.suppliers
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((((select auth.uid()) IS NOT NULL) AND ((select auth.role()) = 'authenticated'::text)));

-- ============================================================================
-- Table: public.suppliers   Policy: "suppliers_update"   (PERMISSIVE UPDATE TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   ((auth.uid() IS NOT NULL) AND (auth.role() = 'authenticated'::text))
--   WITH CHECK:
--   ((auth.uid() IS NOT NULL) AND (auth.role() = 'authenticated'::text))
DROP POLICY IF EXISTS "suppliers_update" ON public.suppliers;
CREATE POLICY "suppliers_update" ON public.suppliers
  AS PERMISSIVE FOR UPDATE TO public
  USING ((((select auth.uid()) IS NOT NULL) AND ((select auth.role()) = 'authenticated'::text)))
  WITH CHECK ((((select auth.uid()) IS NOT NULL) AND ((select auth.role()) = 'authenticated'::text)));

-- ============================================================================
-- Table: public.suppliers   Policy: "suppliers_delete"   (PERMISSIVE DELETE TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   ((auth.uid() IS NOT NULL) AND (auth.role() = 'authenticated'::text))
DROP POLICY IF EXISTS "suppliers_delete" ON public.suppliers;
CREATE POLICY "suppliers_delete" ON public.suppliers
  AS PERMISSIVE FOR DELETE TO public
  USING ((((select auth.uid()) IS NOT NULL) AND ((select auth.role()) = 'authenticated'::text)));

-- ============================================================================
-- Table: public.drivers   Policy: "drivers_insert"   (PERMISSIVE INSERT TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   WITH CHECK:
--   ((auth.uid() IS NOT NULL) AND (auth.role() = 'authenticated'::text))
DROP POLICY IF EXISTS "drivers_insert" ON public.drivers;
CREATE POLICY "drivers_insert" ON public.drivers
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((((select auth.uid()) IS NOT NULL) AND ((select auth.role()) = 'authenticated'::text)));

-- ============================================================================
-- Table: public.drivers   Policy: "drivers_update"   (PERMISSIVE UPDATE TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   ((auth.uid() IS NOT NULL) AND (auth.role() = 'authenticated'::text))
--   WITH CHECK:
--   ((auth.uid() IS NOT NULL) AND (auth.role() = 'authenticated'::text))
DROP POLICY IF EXISTS "drivers_update" ON public.drivers;
CREATE POLICY "drivers_update" ON public.drivers
  AS PERMISSIVE FOR UPDATE TO public
  USING ((((select auth.uid()) IS NOT NULL) AND ((select auth.role()) = 'authenticated'::text)))
  WITH CHECK ((((select auth.uid()) IS NOT NULL) AND ((select auth.role()) = 'authenticated'::text)));

-- ============================================================================
-- Table: public.drivers   Policy: "drivers_delete"   (PERMISSIVE DELETE TO public)
-- Original definition (verbatim, pre-migration) for rollback/audit:
--   USING:
--   ((auth.uid() IS NOT NULL) AND (auth.role() = 'authenticated'::text))
DROP POLICY IF EXISTS "drivers_delete" ON public.drivers;
CREATE POLICY "drivers_delete" ON public.drivers
  AS PERMISSIVE FOR DELETE TO public
  USING ((((select auth.uid()) IS NOT NULL) AND ((select auth.role()) = 'authenticated'::text)));

COMMIT;
