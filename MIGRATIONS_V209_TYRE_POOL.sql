-- ============================================================================
-- MIGRATIONS_V209 — Tyre Pool (Hot-Spare Pool Manager)
-- ============================================================================
-- PURELY ADDITIVE. Deepens the Tyre Pool module (route /tyre-pool) from a
-- read-only pool ANALYTICS view (which derives the "unfitted / available"
-- inventory from the existing `tyre_records` table) into a full hot-spare
-- POOL MANAGER by introducing ONE org-scoped table that records the managed
-- lifecycle of each spare tyre held in a pool: where it sits, why it is held,
-- its current status, and — when deployed — which asset it is fitted to, with
-- an append-only history trail.
--
-- This phase deliberately DOES NOT touch `tyre_records`, `vehicle_fleet`, any
-- existing RLS policy, or any operational module. The existing analytics view
-- keeps deriving its pool from `tyre_records`; the new manager stores its own
-- managed pool records here. The reason / status vocabularies live in the
-- application layer (src/lib/tyrePool.js) so they can be versioned with the
-- code; this table enforces only the hard CHECK sets. Safe to apply and to
-- reverse (see footer) with zero blast radius on current functionality.
--
-- Org-scoped (RESTRICTIVE org isolation). Reads: any authenticated org member.
-- Writes: elevated roles only (Admin/Manager/Director), matching V201/V206/V207.
-- Depends on existing helpers: app_current_org(), get_my_role(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

-- 1. Tyre pool (hot-spare lifecycle) -----------------------------------------
-- One row per tyre held in a managed pool within an org. `tyre_serial` is the
-- physical tyre serial (text, matches the varied serial columns on
-- tyre_records). `pool_location` is the branch / warehouse holding the spare.
-- `reason` records why it is pooled; `status` its current lifecycle state.
-- When deployed, `assigned_to` holds the asset/vehicle it is fitted to and
-- `assigned_at` the timestamp; `returned_at` records the last return. `history`
-- is an append-only JSONB trail of assign/return events. The UNIQUE constraint
-- on (tyre_serial, organisation_id) prevents duplicate pool entries for the
-- same physical tyre within an org.
CREATE TABLE IF NOT EXISTS public.tyre_pool (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  tyre_serial      text NOT NULL,
  pool_location    text,
  reason           text NOT NULL DEFAULT 'hot_spare'
                     CHECK (reason IN ('hot_spare','seasonal_rotation','buffer_stock','warranty_replacement','retreat_return')),
  min_qty          integer NOT NULL DEFAULT 1
                     CHECK (min_qty >= 0),
  status           text NOT NULL DEFAULT 'available'
                     CHECK (status IN ('available','reserved','deployed','maintenance','retired')),
  assigned_to      text,
  assigned_at      timestamptz,
  returned_at      timestamptz,
  notes            text,
  history          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by       uuid DEFAULT auth.uid(),
  country          text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tyre_serial, organisation_id)
);

CREATE INDEX IF NOT EXISTS idx_tyre_pool_org      ON public.tyre_pool (organisation_id);
CREATE INDEX IF NOT EXISTS idx_tyre_pool_status   ON public.tyre_pool (status);
CREATE INDEX IF NOT EXISTS idx_tyre_pool_location ON public.tyre_pool (pool_location);
CREATE INDEX IF NOT EXISTS idx_tyre_pool_country  ON public.tyre_pool (country);

DROP TRIGGER IF EXISTS set_updated_at_tyre_pool ON public.tyre_pool;
CREATE TRIGGER set_updated_at_tyre_pool BEFORE UPDATE ON public.tyre_pool
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read; only elevated roles may mutate.
ALTER TABLE public.tyre_pool ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tyre_pool_org_isolation ON public.tyre_pool;
CREATE POLICY tyre_pool_org_isolation ON public.tyre_pool
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS tyre_pool_read ON public.tyre_pool;
CREATE POLICY tyre_pool_read ON public.tyre_pool FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS tyre_pool_insert ON public.tyre_pool;
CREATE POLICY tyre_pool_insert ON public.tyre_pool FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS tyre_pool_update ON public.tyre_pool;
CREATE POLICY tyre_pool_update ON public.tyre_pool FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS tyre_pool_delete ON public.tyre_pool;
CREATE POLICY tyre_pool_delete ON public.tyre_pool FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.tyre_pool FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tyre_pool TO authenticated;

-- Reversible:
--   DROP TABLE IF EXISTS public.tyre_pool;
