-- ============================================================================
-- MIGRATIONS_V153 — Speed Limiter Registry
-- ============================================================================
-- Per-asset speed-limiter configuration: the governed limit (km/h), the fitted
-- limiter/telematics device, a status lifecycle (active → disabled → fault),
-- and the last physical verification date. Backs the Speed Limiter Registry
-- module (/speed-limiter) — register a limiter, track its status, and audit the
-- last time it was verified for compliance. Org-isolated and country-scoped,
-- mirroring V127 (support_tickets) / V146 (batteries).
--
-- Writes are restricted to Admin/Manager/Director; any authenticated member of
-- the org may read.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at(), get_my_role().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.speed_limiters (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  asset_no         text NOT NULL,
  limit_kph        numeric,
  device_id        text,
  last_verified_at date,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','disabled','fault')),
  site             text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_speed_limiters_org     ON public.speed_limiters (organisation_id);
CREATE INDEX IF NOT EXISTS idx_speed_limiters_asset   ON public.speed_limiters (asset_no);
CREATE INDEX IF NOT EXISTS idx_speed_limiters_status  ON public.speed_limiters (status);
CREATE INDEX IF NOT EXISTS idx_speed_limiters_created ON public.speed_limiters (created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_speed_limiters ON public.speed_limiters;
CREATE TRIGGER set_updated_at_speed_limiters BEFORE UPDATE ON public.speed_limiters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read; only Admin/Manager/Director may
-- create, update or delete a limiter configuration.
ALTER TABLE public.speed_limiters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS speed_limiters_org_isolation ON public.speed_limiters;
CREATE POLICY speed_limiters_org_isolation ON public.speed_limiters
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS speed_limiters_read ON public.speed_limiters;
CREATE POLICY speed_limiters_read ON public.speed_limiters FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS speed_limiters_insert ON public.speed_limiters;
CREATE POLICY speed_limiters_insert ON public.speed_limiters FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS speed_limiters_update ON public.speed_limiters;
CREATE POLICY speed_limiters_update ON public.speed_limiters FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS speed_limiters_delete ON public.speed_limiters;
CREATE POLICY speed_limiters_delete ON public.speed_limiters FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.speed_limiters FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.speed_limiters TO authenticated;

-- Reversible:
--   DROP TABLE public.speed_limiters;
