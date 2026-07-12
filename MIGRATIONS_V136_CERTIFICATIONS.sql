-- ============================================================================
-- MIGRATIONS_V136 — Certifications & Licenses
-- ============================================================================
-- Tracks driver, vehicle, technician and site certifications / licenses with
-- issue + expiry dates so the fleet can act on renewals before they lapse.
-- Any authenticated member of the org may read and maintain records; org
-- isolation is the hard boundary (RESTRICTIVE), matching V127.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.certifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  subject_type     text NOT NULL DEFAULT 'driver'
                     CHECK (subject_type IN ('driver','vehicle','technician','site')),
  subject_name     text NOT NULL,
  cert_type        text,
  cert_number      text,
  issuer           text,
  issue_date       date,
  expiry_date      date,
  status           text NOT NULL DEFAULT 'valid'
                     CHECK (status IN ('valid','expiring','expired','revoked')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_certifications_org          ON public.certifications (organisation_id);
CREATE INDEX IF NOT EXISTS idx_certifications_expiry       ON public.certifications (expiry_date);
CREATE INDEX IF NOT EXISTS idx_certifications_subject_type ON public.certifications (subject_type);

DROP TRIGGER IF EXISTS set_updated_at_certifications ON public.certifications;
CREATE TRIGGER set_updated_at_certifications BEFORE UPDATE ON public.certifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org can read and write certification records.
ALTER TABLE public.certifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS certifications_org_isolation ON public.certifications;
CREATE POLICY certifications_org_isolation ON public.certifications
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS certifications_read ON public.certifications;
CREATE POLICY certifications_read ON public.certifications FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS certifications_insert ON public.certifications;
CREATE POLICY certifications_insert ON public.certifications FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS certifications_update ON public.certifications;
CREATE POLICY certifications_update ON public.certifications FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS certifications_delete ON public.certifications;
CREATE POLICY certifications_delete ON public.certifications FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.certifications FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.certifications TO authenticated;

-- Reversible:
--   DROP TABLE public.certifications;
