-- ============================================================================
-- MIGRATIONS_V111 — close cross-org READ leaks (org-isolation hardening)
-- ============================================================================
-- Several tables carried org-isolation as a PERMISSIVE policy sitting next to an
-- open `USING (true)` SELECT policy. Multiple PERMISSIVE policies are OR-ed, so
-- the open policy defeated isolation and EVERY authenticated user could read
-- EVERY organisation's rows — including driver PII and suppliers. The correctly
-- isolated tables (vehicle_fleet, tyre_records, import_*) use a RESTRICTIVE org
-- policy (AND-ed on top of the open read). This aligns the leaking tables to
-- that pattern.
--
-- Standard predicate (matches the isolated tables): a row is visible when it has
-- no org (shared/global), belongs to the caller's org, or the caller is an org
-- admin. app_is_org_admin()/app_current_org() are existing V42 helpers.
--
-- Idempotent. Applied live in V111.
-- ============================================================================

-- ── drivers (PII) ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS drivers_org_isolation ON public.drivers;
CREATE POLICY drivers_org_isolation ON public.drivers AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NULL OR organisation_id = public.app_current_org() OR public.app_is_org_admin())
  WITH CHECK (organisation_id IS NULL OR organisation_id = public.app_current_org() OR public.app_is_org_admin());

-- ── suppliers ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS suppliers_org_isolation ON public.suppliers;
CREATE POLICY suppliers_org_isolation ON public.suppliers AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NULL OR organisation_id = public.app_current_org() OR public.app_is_org_admin())
  WITH CHECK (organisation_id IS NULL OR organisation_id = public.app_current_org() OR public.app_is_org_admin());

-- ── knowledge_documents (org SOPs / docs) — add the missing isolation ─────────
DROP POLICY IF EXISTS knowledge_documents_org_isolation ON public.knowledge_documents;
CREATE POLICY knowledge_documents_org_isolation ON public.knowledge_documents AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NULL OR organisation_id = public.app_current_org() OR public.app_is_org_admin())
  WITH CHECK (organisation_id IS NULL OR organisation_id = public.app_current_org() OR public.app_is_org_admin());

-- ── report_schedules — drop the open/tautological SELECTs, scope to org ───────
-- rs_select was `USING (true)`; report_schedules_select used `org_id = org_id`
-- (always true). Replace with a single correctly org-scoped read policy.
DROP POLICY IF EXISTS rs_select ON public.report_schedules;
DROP POLICY IF EXISTS report_schedules_select ON public.report_schedules;
CREATE POLICY report_schedules_select ON public.report_schedules FOR SELECT
  USING (org_id IS NULL OR org_id = public.app_current_org() OR public.app_is_org_admin());
