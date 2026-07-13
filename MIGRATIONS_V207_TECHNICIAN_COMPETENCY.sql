-- ============================================================================
-- MIGRATIONS_V207 — Technician Competency (Skills Matrix + Certifications)
-- ============================================================================
-- PURELY ADDITIVE. Deepens the Technician Scorecard (route /technician-scorecard)
-- from a work-order performance leaderboard into a full competency platform by
-- introducing two org-scoped tables that record, per technician (a `profiles`
-- user), the skills they hold (with an assessed proficiency level) and the
-- certifications they carry (with issue/expiry tracking for compliance).
--
-- This phase deliberately DOES NOT touch any existing table, RLS policy, or
-- operational module (work_orders / profiles remain untouched — the scorecard
-- keeps deriving performance from work_orders). Skill/cert catalogues live in
-- the application layer (src/lib/technicianScorecard.js) so the taxonomy can be
-- versioned with the code; these tables store only the org's actual records
-- against those catalogue ids. Safe to apply and to reverse (see footer) with
-- zero blast radius on current functionality.
--
-- Org-scoped (RESTRICTIVE org isolation). Reads: any authenticated org member.
-- Writes: elevated roles only (Admin/Manager/Director), matching V201/V206.
-- Depends on existing helpers: app_current_org(), get_my_role(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

-- 1. Technician skills (proficiency matrix) ----------------------------------
-- One row per (technician, skill) within an org. `skill_id` is a stable text key
-- into the application SKILL_CATALOGUE; `level` is the assessed proficiency
-- (1 Basic · 2 Proficient · 3 Expert). `assessed_by` captures who signed off.
CREATE TABLE IF NOT EXISTS public.technician_skills (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  user_id          uuid NOT NULL,
  skill_id         text NOT NULL,
  level            integer NOT NULL DEFAULT 1
                     CHECK (level BETWEEN 1 AND 3),
  notes            text,
  assessed_by      uuid DEFAULT auth.uid(),
  assessed_at      timestamptz NOT NULL DEFAULT now(),
  country          text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, skill_id, organisation_id)
);

CREATE INDEX IF NOT EXISTS idx_technician_skills_org   ON public.technician_skills (organisation_id);
CREATE INDEX IF NOT EXISTS idx_technician_skills_user  ON public.technician_skills (user_id);
CREATE INDEX IF NOT EXISTS idx_technician_skills_skill ON public.technician_skills (skill_id);

DROP TRIGGER IF EXISTS set_updated_at_technician_skills ON public.technician_skills;
CREATE TRIGGER set_updated_at_technician_skills BEFORE UPDATE ON public.technician_skills
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read; only elevated roles may mutate.
ALTER TABLE public.technician_skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS technician_skills_org_isolation ON public.technician_skills;
CREATE POLICY technician_skills_org_isolation ON public.technician_skills
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS technician_skills_read ON public.technician_skills;
CREATE POLICY technician_skills_read ON public.technician_skills FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS technician_skills_insert ON public.technician_skills;
CREATE POLICY technician_skills_insert ON public.technician_skills FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS technician_skills_update ON public.technician_skills;
CREATE POLICY technician_skills_update ON public.technician_skills FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS technician_skills_delete ON public.technician_skills;
CREATE POLICY technician_skills_delete ON public.technician_skills FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.technician_skills FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.technician_skills TO authenticated;

-- 2. Technician certifications (compliance tracking) -------------------------
-- One row per certification held by a technician. `cert_id` is a stable text key
-- into the application CERT_CATALOGUE; `expiry_date` drives expiry/renewal
-- alerts. `document_url` optionally references the stored certificate scan.
CREATE TABLE IF NOT EXISTS public.technician_certs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  user_id          uuid NOT NULL,
  cert_id          text NOT NULL,
  cert_name        text,
  issuer           text,
  issue_date       date,
  expiry_date      date,
  cert_number      text,
  document_url     text,
  recorded_by      uuid DEFAULT auth.uid(),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  country          text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_technician_certs_org    ON public.technician_certs (organisation_id);
CREATE INDEX IF NOT EXISTS idx_technician_certs_user   ON public.technician_certs (user_id);
CREATE INDEX IF NOT EXISTS idx_technician_certs_cert   ON public.technician_certs (cert_id);
CREATE INDEX IF NOT EXISTS idx_technician_certs_expiry ON public.technician_certs (expiry_date);

DROP TRIGGER IF EXISTS set_updated_at_technician_certs ON public.technician_certs;
CREATE TRIGGER set_updated_at_technician_certs BEFORE UPDATE ON public.technician_certs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.technician_certs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS technician_certs_org_isolation ON public.technician_certs;
CREATE POLICY technician_certs_org_isolation ON public.technician_certs
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS technician_certs_read ON public.technician_certs;
CREATE POLICY technician_certs_read ON public.technician_certs FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS technician_certs_insert ON public.technician_certs;
CREATE POLICY technician_certs_insert ON public.technician_certs FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS technician_certs_update ON public.technician_certs;
CREATE POLICY technician_certs_update ON public.technician_certs FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS technician_certs_delete ON public.technician_certs;
CREATE POLICY technician_certs_delete ON public.technician_certs FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.technician_certs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.technician_certs TO authenticated;

-- Reversible:
--   DROP TABLE IF EXISTS public.technician_certs;
--   DROP TABLE IF EXISTS public.technician_skills;
