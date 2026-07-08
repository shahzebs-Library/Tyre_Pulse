-- ============================================================================
-- MIGRATIONS_V109 — Sites master (per country): align & repair
-- ============================================================================
-- A `sites` table already existed (id, name, country, region, city, active,
-- notes, org, audit) but was unusable as a master:
--   * its write policy checked LOWERCASE roles ('admin','manager','director')
--     while profiles.role stores 'Admin'/'Manager'/'Director', so the WITH CHECK
--     never matched and NO ONE could insert a site;
--   * its unique key was global (name,country), not org-scoped;
--   * it lacked a site code / type for categorisation.
--
-- This migration turns it into a real, governed master used by the Sites panel
-- and the shared useSites() dropdown source, without disturbing the existing row.
-- Idempotent and safe to re-run.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at(), get_my_role().
-- ============================================================================

-- 1. Categorisation columns (additive)
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS site_code text;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS site_type text NOT NULL DEFAULT 'other';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sites_site_type_check' AND conrelid = 'public.sites'::regclass
  ) THEN
    ALTER TABLE public.sites
      ADD CONSTRAINT sites_site_type_check
      CHECK (site_type IN ('depot','workshop','warehouse','camp','branch','project','yard','other'));
  END IF;
END $$;

-- 2. Org-scoped canonical key (name is unique per org+country, case/space-insensitive)
-- The old (name,country) uniqueness is a table CONSTRAINT (drops its own index).
ALTER TABLE public.sites DROP CONSTRAINT IF EXISTS sites_name_country_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_sites_org_country_name
  ON public.sites (
    coalesce(organisation_id, '00000000-0000-0000-0000-000000000001'::uuid),
    lower(btrim(country)),
    lower(btrim(name))
  );
CREATE INDEX IF NOT EXISTS idx_sites_country ON public.sites (country);
CREATE INDEX IF NOT EXISTS idx_sites_active  ON public.sites (active);

-- 3. updated_at trigger
DROP TRIGGER IF EXISTS set_updated_at_sites ON public.sites;
CREATE TRIGGER set_updated_at_sites BEFORE UPDATE ON public.sites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Fix the write policy: correct, case-accurate role check via get_my_role().
--    (Replaces the broken lowercase-role policy that blocked every insert.)
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sites_write_elevated ON public.sites;
DROP POLICY IF EXISTS sites_write ON public.sites;
CREATE POLICY sites_write ON public.sites FOR ALL
  USING (public.get_my_role() IN ('Admin','Manager'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager'));

-- Read stays open to authenticated members (org isolation restrictive policy,
-- already present, still scopes rows to the caller's org).
DROP POLICY IF EXISTS sites_read ON public.sites;
CREATE POLICY sites_read ON public.sites FOR SELECT
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.sites FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sites TO authenticated;
