-- ============================================================================
-- MIGRATIONS_V154 — Driver Documents
-- ============================================================================
-- Tracks per-driver documents (licence, medical certificate, permit, visa …)
-- with issue + expiry dates and a derived lifecycle band (valid / expiring /
-- expired). Backs the Driver Documents module (route /driver-documents) so
-- compliance teams get renewal alerts before a document lapses.
--
-- Org-isolated (hard RESTRICTIVE boundary) and country-scoped. Any authenticated
-- member of the organisation may read and maintain records.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.driver_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  driver_name      text NOT NULL,
  doc_type         text,
  doc_number       text,
  issuer           text,
  issue_date       date,
  expiry_date      date,
  status           text NOT NULL DEFAULT 'valid'
                     CHECK (status IN ('valid','expiring','expired')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_documents_org    ON public.driver_documents (organisation_id);
CREATE INDEX IF NOT EXISTS idx_driver_documents_expiry ON public.driver_documents (expiry_date);
CREATE INDEX IF NOT EXISTS idx_driver_documents_driver ON public.driver_documents (driver_name);

DROP TRIGGER IF EXISTS set_updated_at_driver_documents ON public.driver_documents;
CREATE TRIGGER set_updated_at_driver_documents BEFORE UPDATE ON public.driver_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and maintain driver documents.
ALTER TABLE public.driver_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_documents_org_isolation ON public.driver_documents;
CREATE POLICY driver_documents_org_isolation ON public.driver_documents
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS driver_documents_read ON public.driver_documents;
CREATE POLICY driver_documents_read ON public.driver_documents FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS driver_documents_insert ON public.driver_documents;
CREATE POLICY driver_documents_insert ON public.driver_documents FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS driver_documents_update ON public.driver_documents;
CREATE POLICY driver_documents_update ON public.driver_documents FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS driver_documents_delete ON public.driver_documents;
CREATE POLICY driver_documents_delete ON public.driver_documents FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.driver_documents FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_documents TO authenticated;

-- Reversible:
--   DROP TABLE public.driver_documents;
