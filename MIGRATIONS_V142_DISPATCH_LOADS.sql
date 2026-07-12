-- ============================================================================
-- MIGRATIONS_V142 — Dispatch / Load Planning
-- ============================================================================
-- Backs the Dispatch Planning module (route /dispatch). Plans and tracks loads:
-- a load is assigned to an asset + driver with origin/destination, cargo,
-- weight and a scheduled window, then progresses through a status lifecycle
-- (planned → dispatched → in_transit → delivered / cancelled).
--
-- Org-isolated, country-scoped, with a lightweight status lifecycle and an
-- updated_at trigger. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dispatch_loads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  load_no          text,
  asset_no         text,
  driver_name      text,
  origin           text,
  destination      text,
  cargo            text,
  weight_kg        numeric,
  scheduled_at     timestamptz,
  status           text NOT NULL DEFAULT 'planned'
                     CHECK (status IN ('planned','dispatched','in_transit','delivered','cancelled')),
  site             text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dispatch_loads_org       ON public.dispatch_loads (organisation_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_loads_status    ON public.dispatch_loads (status);
CREATE INDEX IF NOT EXISTS idx_dispatch_loads_asset     ON public.dispatch_loads (asset_no);
CREATE INDEX IF NOT EXISTS idx_dispatch_loads_scheduled ON public.dispatch_loads (scheduled_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_dispatch_loads ON public.dispatch_loads;
CREATE TRIGGER set_updated_at_dispatch_loads BEFORE UPDATE ON public.dispatch_loads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and manage dispatch loads (planning
-- is an operational, shared workflow).
ALTER TABLE public.dispatch_loads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dispatch_loads_org_isolation ON public.dispatch_loads;
CREATE POLICY dispatch_loads_org_isolation ON public.dispatch_loads
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS dispatch_loads_read ON public.dispatch_loads;
CREATE POLICY dispatch_loads_read ON public.dispatch_loads FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS dispatch_loads_insert ON public.dispatch_loads;
CREATE POLICY dispatch_loads_insert ON public.dispatch_loads FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS dispatch_loads_update ON public.dispatch_loads;
CREATE POLICY dispatch_loads_update ON public.dispatch_loads FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS dispatch_loads_delete ON public.dispatch_loads;
CREATE POLICY dispatch_loads_delete ON public.dispatch_loads FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.dispatch_loads FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_loads TO authenticated;

-- Reversible:
--   DROP TABLE public.dispatch_loads;
