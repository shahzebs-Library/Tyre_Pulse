-- ============================================================================
-- MIGRATIONS_V176 — Roadside Assistance / Breakdown Callouts
-- ============================================================================
-- Backs the Breakdown Callouts module (/breakdown-callouts): every roadside
-- assistance / breakdown event raised against an asset — when it was reported,
-- dispatched, and resolved, who attended, the cost, and the outcome. Response
-- and resolution times feed availability, downtime, and vendor-performance
-- analytics, so every callout is org-isolated, country-scoped, and auditable.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.breakdown_callouts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  callout_no       text,
  asset_no         text NOT NULL,
  driver_name      text,
  location         text,
  breakdown_type   text
                     CHECK (breakdown_type IN ('tyre','engine','electrical','brakes','transmission','accident','fuel','other')),
  severity         text
                     CHECK (severity IN ('low','medium','high','critical')),
  reported_at      timestamptz,
  dispatched_at    timestamptz,
  resolved_at      timestamptz,
  provider         text,
  cost             numeric,
  currency         text,
  status           text
                     CHECK (status IN ('reported','dispatched','on_site','resolved','cancelled')),
  resolution       text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_breakdown_callouts_org      ON public.breakdown_callouts (organisation_id);
CREATE INDEX IF NOT EXISTS idx_breakdown_callouts_asset    ON public.breakdown_callouts (asset_no);
CREATE INDEX IF NOT EXISTS idx_breakdown_callouts_reported ON public.breakdown_callouts (reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_breakdown_callouts_status   ON public.breakdown_callouts (status);

DROP TRIGGER IF EXISTS set_updated_at_breakdown_callouts ON public.breakdown_callouts;
CREATE TRIGGER set_updated_at_breakdown_callouts BEFORE UPDATE ON public.breakdown_callouts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and log callouts — recording a
-- roadside breakdown is a routine field/ops activity, not a privileged one.
ALTER TABLE public.breakdown_callouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS breakdown_callouts_org_isolation ON public.breakdown_callouts;
CREATE POLICY breakdown_callouts_org_isolation ON public.breakdown_callouts
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS breakdown_callouts_read ON public.breakdown_callouts;
CREATE POLICY breakdown_callouts_read ON public.breakdown_callouts FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS breakdown_callouts_insert ON public.breakdown_callouts;
CREATE POLICY breakdown_callouts_insert ON public.breakdown_callouts FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS breakdown_callouts_update ON public.breakdown_callouts;
CREATE POLICY breakdown_callouts_update ON public.breakdown_callouts FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS breakdown_callouts_delete ON public.breakdown_callouts;
CREATE POLICY breakdown_callouts_delete ON public.breakdown_callouts FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.breakdown_callouts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.breakdown_callouts TO authenticated;

-- Reversible:
--   DROP TABLE public.breakdown_callouts;
