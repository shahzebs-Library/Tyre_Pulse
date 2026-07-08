-- ============================================================================
-- MIGRATIONS_V114 — make COUNTRY a real server-side isolation boundary
-- ============================================================================
-- Country scoping was CLIENT-SIDE only (SettingsContext lock + applyCountry
-- query arg). RLS enforced organisation_id but never country, so a user
-- assigned to one country could read every country in their org by dropping the
-- filter (devtools / any code path that omits it). This adds a RESTRICTIVE
-- SELECT country gate to every org+country business table.
--
-- Model (mirrors the app's own rule): elevated/org admins and users with NO
-- country assignment (or 'All') see all countries; everyone else sees only the
-- countries in their profiles.country[] (plus rows that have no country).
-- Reads only — writes stay org-scoped so the import pipeline is unaffected.
--
-- Idempotent. Applied live in V114.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.app_can_see_country(p_country text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    p_country IS NULL
    OR public.app_is_org_admin()
    OR EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.id = auth.uid()
        AND (
          pr.country IS NULL
          OR cardinality(pr.country) = 0
          OR EXISTS (
            SELECT 1 FROM unnest(pr.country) x
            WHERE lower(btrim(x)) IN ('all', '')
               OR lower(btrim(x)) = lower(btrim(p_country))
          )
        )
    )
$$;
REVOKE ALL ON FUNCTION public.app_can_see_country(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_can_see_country(text) TO authenticated, service_role;

DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'accidents','alerts','budgets','corrective_actions','gate_passes','inspections',
    'purchase_orders','rca_records','recalls','stock_records','tyre_records',
    'tyre_rotations','tyre_specifications','tyre_status_marks','vehicle_fleet',
    'warranty_claims','work_orders'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_country_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT USING (public.app_can_see_country(country))',
      t || '_country_isolation', t);
  END LOOP;
END $$;
