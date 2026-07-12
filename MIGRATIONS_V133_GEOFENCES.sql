-- ============================================================================
-- MIGRATIONS_V133 — Geofencing: Geofence Zones
-- ============================================================================
-- Backs the Geofencing module (/geofencing). Fleet operators define virtual
-- boundaries — sites, restricted/service zones or custom areas — as a centre
-- point (lat/lng) plus a radius. Org-isolated, country-scoped, list/coordinate
-- based (no map dependency). Any authenticated member may read; Admin / Manager
-- / Director maintain the zones.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at(), get_my_role().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.geofences (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  name             text NOT NULL,
  zone_type        text NOT NULL DEFAULT 'custom'
                     CHECK (zone_type IN ('site','restricted','service','custom')),
  center_lat       numeric,
  center_lng       numeric,
  radius_m         numeric,
  site             text,
  active           boolean NOT NULL DEFAULT true,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_geofences_org  ON public.geofences (organisation_id);
CREATE INDEX IF NOT EXISTS idx_geofences_site ON public.geofences (site);

DROP TRIGGER IF EXISTS set_updated_at_geofences ON public.geofences;
CREATE TRIGGER set_updated_at_geofences BEFORE UPDATE ON public.geofences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member may read the org's zones; Admin/Manager/Director may
-- create, update and delete them.
ALTER TABLE public.geofences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS geofences_org_isolation ON public.geofences;
CREATE POLICY geofences_org_isolation ON public.geofences
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS geofences_read ON public.geofences;
CREATE POLICY geofences_read ON public.geofences FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS geofences_insert ON public.geofences;
CREATE POLICY geofences_insert ON public.geofences FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS geofences_update ON public.geofences;
CREATE POLICY geofences_update ON public.geofences FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS geofences_delete ON public.geofences;
CREATE POLICY geofences_delete ON public.geofences FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.geofences FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geofences TO authenticated;

-- Reversible:
--   DROP TABLE public.geofences;
