-- ============================================================================
-- MIGRATIONS_V166 — EV Charging Sessions
-- ============================================================================
-- Backs the EV Charging Sessions module (/charging-sessions). Stores one row
-- per charging session for one electric asset at one station over a time window:
-- energy delivered (kWh), cost, state-of-charge (SoC) start/end, duration, and
-- session outcome. This is the energy-cost basis for EV cost-per-km, utilisation,
-- and charging-network analytics — the EV analogue of tyre/fuel spend.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.charging_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  asset_no         text,
  station_name     text,
  connector_type   text,
  started_at       timestamptz,
  ended_at         timestamptz,
  energy_kwh       numeric,
  cost             numeric,
  currency         text,
  start_soc        numeric,
  end_soc          numeric,
  duration_min     numeric,
  status           text
                     CHECK (status IN ('in_progress','completed','interrupted','failed')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_charging_sessions_org     ON public.charging_sessions (organisation_id);
CREATE INDEX IF NOT EXISTS idx_charging_sessions_asset   ON public.charging_sessions (asset_no);
CREATE INDEX IF NOT EXISTS idx_charging_sessions_started ON public.charging_sessions (started_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_charging_sessions ON public.charging_sessions;
CREATE TRIGGER set_updated_at_charging_sessions BEFORE UPDATE ON public.charging_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read sessions; authenticated members may ingest (insert) and
-- correct (update) sessions for their own org.
ALTER TABLE public.charging_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS charging_sessions_org_isolation ON public.charging_sessions;
CREATE POLICY charging_sessions_org_isolation ON public.charging_sessions
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS charging_sessions_read ON public.charging_sessions;
CREATE POLICY charging_sessions_read ON public.charging_sessions FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS charging_sessions_insert ON public.charging_sessions;
CREATE POLICY charging_sessions_insert ON public.charging_sessions FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS charging_sessions_update ON public.charging_sessions;
CREATE POLICY charging_sessions_update ON public.charging_sessions FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

REVOKE ALL ON public.charging_sessions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.charging_sessions TO authenticated;

-- Reversible:
--   DROP TABLE public.charging_sessions;
