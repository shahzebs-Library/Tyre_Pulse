-- ============================================================================
-- MIGRATIONS_V141 — Combination Manager: Asset Combinations
-- ============================================================================
-- Backs the Combination Manager (/combinations). Links a prime-mover asset to
-- one or more trailer assets under a named, status-tracked combination — the
-- operational unit fleets actually dispatch. Prime mover + trailer numbers are
-- stored as plain text / text[] (loosely coupled to the asset register so a
-- combination can be recorded before every asset is on-boarded).
--
-- Org-isolated (RESTRICTIVE hard boundary), country-scoped, with a lightweight
-- active/inactive lifecycle.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.asset_combinations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  name             text,
  prime_mover_no   text NOT NULL,
  trailer_nos      text[] NOT NULL DEFAULT '{}'::text[],
  site             text,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','inactive')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_combinations_org        ON public.asset_combinations (organisation_id);
CREATE INDEX IF NOT EXISTS idx_asset_combinations_mover      ON public.asset_combinations (prime_mover_no);
CREATE INDEX IF NOT EXISTS idx_asset_combinations_status     ON public.asset_combinations (status);
CREATE INDEX IF NOT EXISTS idx_asset_combinations_created    ON public.asset_combinations (created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_asset_combinations ON public.asset_combinations;
CREATE TRIGGER set_updated_at_asset_combinations BEFORE UPDATE ON public.asset_combinations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and manage combinations.
ALTER TABLE public.asset_combinations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_combinations_org_isolation ON public.asset_combinations;
CREATE POLICY asset_combinations_org_isolation ON public.asset_combinations
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS asset_combinations_read ON public.asset_combinations;
CREATE POLICY asset_combinations_read ON public.asset_combinations FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS asset_combinations_insert ON public.asset_combinations;
CREATE POLICY asset_combinations_insert ON public.asset_combinations FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS asset_combinations_update ON public.asset_combinations;
CREATE POLICY asset_combinations_update ON public.asset_combinations FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS asset_combinations_delete ON public.asset_combinations;
CREATE POLICY asset_combinations_delete ON public.asset_combinations FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.asset_combinations FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_combinations TO authenticated;

-- Reversible:
--   DROP TABLE public.asset_combinations;
