-- ============================================================================
-- MIGRATIONS_V175 — Vehicle Reservations / Motor Pool Booking
-- ============================================================================
-- Backs the Vehicle Reservations module (/vehicle-reservations). Stores motor
-- pool booking requests so a shared vehicle fleet can be reserved, approved,
-- checked out and returned without double-booking. Each row is one reservation
-- of one asset for one requester over a [start_at, end_at) window.
--
-- The page derives conflicts (overlapping bookings for the same asset), an
-- "currently out" count, and upcoming-booking KPIs from these rows, so it is
-- useful immediately once bookings are captured — manually, from an ERP, or
-- from a self-service portal.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.vehicle_reservations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  reference        text,
  asset_no         text NOT NULL,
  requester_name   text,
  department       text,
  purpose          text,
  start_at         timestamptz,
  end_at           timestamptz,
  pickup_location  text,
  return_location  text,
  expected_km      numeric,
  status           text
                     CHECK (status IN ('requested','approved','out','returned','cancelled')),
  approved_by      text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_reservations_org      ON public.vehicle_reservations (organisation_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_reservations_asset    ON public.vehicle_reservations (asset_no);
CREATE INDEX IF NOT EXISTS idx_vehicle_reservations_start    ON public.vehicle_reservations (start_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_reservations_status   ON public.vehicle_reservations (status);

DROP TRIGGER IF EXISTS set_updated_at_vehicle_reservations ON public.vehicle_reservations;
CREATE TRIGGER set_updated_at_vehicle_reservations BEFORE UPDATE ON public.vehicle_reservations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read reservations; authenticated members may create (insert),
-- amend (update) and cancel/remove (delete) reservations for their own org.
ALTER TABLE public.vehicle_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicle_reservations_org_isolation ON public.vehicle_reservations;
CREATE POLICY vehicle_reservations_org_isolation ON public.vehicle_reservations
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS vehicle_reservations_read ON public.vehicle_reservations;
CREATE POLICY vehicle_reservations_read ON public.vehicle_reservations FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS vehicle_reservations_insert ON public.vehicle_reservations;
CREATE POLICY vehicle_reservations_insert ON public.vehicle_reservations FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS vehicle_reservations_update ON public.vehicle_reservations;
CREATE POLICY vehicle_reservations_update ON public.vehicle_reservations FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS vehicle_reservations_delete ON public.vehicle_reservations;
CREATE POLICY vehicle_reservations_delete ON public.vehicle_reservations FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.vehicle_reservations FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_reservations TO authenticated;

-- Reversible:
--   DROP TABLE public.vehicle_reservations;
