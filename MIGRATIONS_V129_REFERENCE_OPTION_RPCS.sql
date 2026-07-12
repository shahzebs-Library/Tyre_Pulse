-- ============================================================================
-- MIGRATIONS_V129 — Data-driven reference option RPCs (Asset / Site pickers)
-- ============================================================================
-- The checklist Asset/Site reference pickers previously read only the fleet
-- master (assets) and the `sites` master (sites). The sites master is often
-- near-empty, so the Site picker showed nothing. These RPCs derive UNIQUE site
-- and asset lists from the tenant's REAL operational data across the core
-- tables, so pickers always reflect what actually exists.
--
-- SECURITY DEFINER with explicit org scoping via app_current_org() keeps tenant
-- isolation intact while guaranteeing results regardless of per-table RLS
-- nuances. Country filter is optional ('All'/NULL = every country).
--
-- Depends on V42 helper app_current_org(). Idempotent (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reference_site_options(p_country text DEFAULT NULL)
RETURNS TABLE(name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s AS name FROM (
    SELECT DISTINCT btrim(site) AS s, country FROM public.vehicle_fleet      WHERE btrim(coalesce(site,'')) <> '' AND organisation_id = public.app_current_org()
    UNION SELECT DISTINCT btrim(site), country FROM public.tyre_records       WHERE btrim(coalesce(site,'')) <> '' AND organisation_id = public.app_current_org()
    UNION SELECT DISTINCT btrim(site), country FROM public.inspections        WHERE btrim(coalesce(site,'')) <> '' AND organisation_id = public.app_current_org()
    UNION SELECT DISTINCT btrim(site), country FROM public.accidents          WHERE btrim(coalesce(site,'')) <> '' AND organisation_id = public.app_current_org()
    UNION SELECT DISTINCT btrim(site), country FROM public.work_orders        WHERE btrim(coalesce(site,'')) <> '' AND organisation_id = public.app_current_org()
    UNION SELECT DISTINCT btrim(site), country FROM public.corrective_actions WHERE btrim(coalesce(site,'')) <> '' AND organisation_id = public.app_current_org()
    UNION SELECT DISTINCT btrim(site), country FROM public.gate_passes        WHERE btrim(coalesce(site,'')) <> '' AND organisation_id = public.app_current_org()
    UNION SELECT DISTINCT btrim(name), country FROM public.sites              WHERE btrim(coalesce(name,'')) <> '' AND coalesce(active,true) AND organisation_id = public.app_current_org()
  ) u
  WHERE p_country IS NULL OR p_country IN ('All','') OR u.country IS NULL OR u.country = p_country
  GROUP BY s
  ORDER BY s;
$$;

CREATE OR REPLACE FUNCTION public.reference_asset_options(p_country text DEFAULT NULL)
RETURNS TABLE(asset_no text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a AS asset_no FROM (
    SELECT DISTINCT btrim(asset_no) AS a, country FROM public.vehicle_fleet WHERE btrim(coalesce(asset_no,'')) <> '' AND organisation_id = public.app_current_org()
    UNION SELECT DISTINCT btrim(asset_no), country FROM public.tyre_records  WHERE btrim(coalesce(asset_no,'')) <> '' AND organisation_id = public.app_current_org()
    UNION SELECT DISTINCT btrim(asset_no), country FROM public.inspections   WHERE btrim(coalesce(asset_no,'')) <> '' AND organisation_id = public.app_current_org()
  ) u
  WHERE p_country IS NULL OR p_country IN ('All','') OR u.country IS NULL OR u.country = p_country
  GROUP BY a
  ORDER BY a;
$$;

REVOKE ALL ON FUNCTION public.reference_site_options(text)  FROM anon;
REVOKE ALL ON FUNCTION public.reference_asset_options(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reference_site_options(text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.reference_asset_options(text) TO authenticated;

-- Reversible:
--   DROP FUNCTION IF EXISTS public.reference_site_options(text);
--   DROP FUNCTION IF EXISTS public.reference_asset_options(text);
