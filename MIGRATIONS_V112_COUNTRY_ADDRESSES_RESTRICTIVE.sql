-- ============================================================================
-- MIGRATIONS_V112 — country_addresses org-isolation must be RESTRICTIVE
-- ============================================================================
-- V108 created country_addresses_org_isolation as a PERMISSIVE "FOR ALL" policy
-- sitting next to the open country_addresses_select (USING auth.uid() IS NOT
-- NULL). PostgreSQL OR-combines permissive policies, so the effective SELECT
-- became (org = app_current_org()) OR (authenticated) = true for any logged-in
-- user — a cross-tenant read leak of legal_name / tax_id / contact_email /
-- contact_phone. Writes leaked too (the org WITH CHECK was OR-ed with the
-- org-agnostic admin write policy).
--
-- Same defect and fix as V111 (drivers/suppliers/knowledge_documents): make the
-- org gate RESTRICTIVE so it AND-s over the open read. Applied live in V112.
-- ============================================================================

DROP POLICY IF EXISTS country_addresses_org_isolation ON public.country_addresses;
CREATE POLICY country_addresses_org_isolation ON public.country_addresses AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NULL OR organisation_id = public.app_current_org() OR public.app_is_org_admin())
  WITH CHECK (organisation_id IS NULL OR organisation_id = public.app_current_org() OR public.app_is_org_admin());
