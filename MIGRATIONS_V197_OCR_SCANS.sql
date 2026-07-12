-- ============================================================================
-- MIGRATIONS_V197 — CV Inspection / OCR Scanner
-- ============================================================================
-- Backs the CV Inspection / OCR Scanner module (/ocr-scanner). Stores uploaded
-- tyre-sidewall / document image records together with any text/fields an OCR
-- or computer-vision provider extracts, and the human review outcome
-- (confirm / correct / reject).
--
-- The real OCR/CV extraction runs via an external provider that is NOT wired up
-- yet. This table intentionally models the *records + review* workflow only:
-- rows are created with honest "pending" / "needs_review" states and no
-- fabricated extraction. Once a provider is connected, extracted_text /
-- extracted_fields / confidence are populated by that integration and rows flip
-- to 'auto_extracted', then a reviewer confirms or corrects them.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ocr_scans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  scan_type        text NOT NULL
                     CHECK (scan_type IN (
                       'tyre_sidewall','dot_code','registration','odometer',
                       'document','vin','other')),
  asset_no         text,
  image_url        text,
  extracted_text   text,
  extracted_fields jsonb,
  confidence       numeric,
  review_status    text NOT NULL DEFAULT 'pending'
                     CHECK (review_status IN (
                       'pending','auto_extracted','needs_review',
                       'confirmed','rejected')),
  reviewed_by      text,
  corrected_value  text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ocr_scans_org        ON public.ocr_scans (organisation_id);
CREATE INDEX IF NOT EXISTS idx_ocr_scans_scan_type  ON public.ocr_scans (scan_type);
CREATE INDEX IF NOT EXISTS idx_ocr_scans_status     ON public.ocr_scans (review_status);
CREATE INDEX IF NOT EXISTS idx_ocr_scans_created    ON public.ocr_scans (created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_ocr_scans ON public.ocr_scans;
CREATE TRIGGER set_updated_at_ocr_scans BEFORE UPDATE ON public.ocr_scans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read scans; authenticated members may create (upload), review
-- (update) and delete scans for their own org.
ALTER TABLE public.ocr_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ocr_scans_org_isolation ON public.ocr_scans;
CREATE POLICY ocr_scans_org_isolation ON public.ocr_scans
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS ocr_scans_read ON public.ocr_scans;
CREATE POLICY ocr_scans_read ON public.ocr_scans FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ocr_scans_insert ON public.ocr_scans;
CREATE POLICY ocr_scans_insert ON public.ocr_scans FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ocr_scans_update ON public.ocr_scans;
CREATE POLICY ocr_scans_update ON public.ocr_scans FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ocr_scans_delete ON public.ocr_scans;
CREATE POLICY ocr_scans_delete ON public.ocr_scans FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.ocr_scans FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ocr_scans TO authenticated;

-- Reversible:
--   DROP TABLE public.ocr_scans;
