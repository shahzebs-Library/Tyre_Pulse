-- ============================================================================
-- MIGRATIONS_V132 — RFID Registry: Tags
-- ============================================================================
-- Backs the RFID Registry (route /rfid). Register passive/RAIN RFID tags and
-- map them to tyres (by serial) and assets, with a scan/lookup surface that
-- resolves a scanned tag to its mapping. Org-isolated, country-scoped, with a
-- lightweight status lifecycle (active / unassigned / retired).
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rfid_tags (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  tag_id           text NOT NULL,
  tyre_serial      text,
  asset_no         text,
  site             text,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','unassigned','retired')),
  last_scanned_at  timestamptz,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rfid_tags_org         ON public.rfid_tags (organisation_id);
CREATE INDEX IF NOT EXISTS idx_rfid_tags_tyre_serial ON public.rfid_tags (tyre_serial);
CREATE INDEX IF NOT EXISTS idx_rfid_tags_asset_no    ON public.rfid_tags (asset_no);
CREATE INDEX IF NOT EXISTS idx_rfid_tags_status      ON public.rfid_tags (status);
CREATE INDEX IF NOT EXISTS idx_rfid_tags_created     ON public.rfid_tags (created_at DESC);

-- One tag_id per organisation — the registry's identity guarantee for scans.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rfid_tags_org_tag
  ON public.rfid_tags (organisation_id, tag_id);

DROP TRIGGER IF EXISTS set_updated_at_rfid_tags ON public.rfid_tags;
CREATE TRIGGER set_updated_at_rfid_tags BEFORE UPDATE ON public.rfid_tags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and write the registry (register
-- tags, map to tyres/assets, record scans).
ALTER TABLE public.rfid_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rfid_tags_org_isolation ON public.rfid_tags;
CREATE POLICY rfid_tags_org_isolation ON public.rfid_tags
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS rfid_tags_read ON public.rfid_tags;
CREATE POLICY rfid_tags_read ON public.rfid_tags FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS rfid_tags_insert ON public.rfid_tags;
CREATE POLICY rfid_tags_insert ON public.rfid_tags FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS rfid_tags_update ON public.rfid_tags;
CREATE POLICY rfid_tags_update ON public.rfid_tags FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS rfid_tags_delete ON public.rfid_tags;
CREATE POLICY rfid_tags_delete ON public.rfid_tags FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.rfid_tags FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rfid_tags TO authenticated;

-- Reversible:
--   DROP TABLE public.rfid_tags;
