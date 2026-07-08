-- ============================================================================
-- MIGRATIONS_V109 — Sites master (per country)
-- ============================================================================
-- "Site" is entered as free text across ~40 pages (each derives its own dropdown
-- from whatever data happens to exist), so the same physical depot is spelled
-- three ways and filters never agree. This adds a governed, org-scoped `sites`
-- master — one canonical list of sites/branches per country — so every filter
-- and form can offer the SAME selectable options.
--
-- This migration lands the master + management surface. Wiring the existing
-- free-text site inputs onto the shared list is a later, page-by-page pass;
-- until then nothing changes for those pages (purely additive).
--
-- Depends on V42 helpers: app_current_org(), set_updated_at(), get_my_role().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sites (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  country          text NOT NULL,                 -- 'KSA' | 'UAE' | 'Egypt' | …
  site_name        text NOT NULL,                 -- canonical display name (identity)
  site_code        text,                          -- short code / ERP id
  site_type        text NOT NULL DEFAULT 'other', -- depot|workshop|warehouse|camp|branch|project|yard|other
  address_line     text,
  city             text,
  region           text,
  contact_person   text,
  contact_phone    text,
  status           text NOT NULL DEFAULT 'active',-- active | inactive
  notes            text,
  organisation_id  uuid DEFAULT public.app_current_org(),
  created_by       uuid REFERENCES auth.users ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES auth.users ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sites_status_check    CHECK (status IN ('active','inactive')),
  CONSTRAINT sites_site_type_check CHECK (site_type IN ('depot','workshop','warehouse','camp','branch','project','yard','other'))
);

-- One canonical site name per country per org (case/space-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS ux_sites_org_country_name
  ON public.sites (
    coalesce(organisation_id, '00000000-0000-0000-0000-000000000001'::uuid),
    lower(btrim(country)),
    lower(btrim(site_name))
  );
CREATE INDEX IF NOT EXISTS idx_sites_org          ON public.sites (organisation_id);
CREATE INDEX IF NOT EXISTS idx_sites_country      ON public.sites (country);
CREATE INDEX IF NOT EXISTS idx_sites_status       ON public.sites (status);

DROP TRIGGER IF EXISTS set_updated_at_sites ON public.sites;
CREATE TRIGGER set_updated_at_sites BEFORE UPDATE ON public.sites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS: org isolation for everyone; writes for Admin + Manager (ops master) ──
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sites_org_isolation ON public.sites;
CREATE POLICY sites_org_isolation ON public.sites FOR ALL
  USING (organisation_id IS NULL OR organisation_id = public.app_current_org())
  WITH CHECK (organisation_id IS NULL OR organisation_id = public.app_current_org());

-- Read: any authenticated member of the org (isolation above still applies), so
-- every page's dropdown can load the shared list.
DROP POLICY IF EXISTS sites_select ON public.sites;
CREATE POLICY sites_select ON public.sites FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Write: administrators and managers curate the master.
DROP POLICY IF EXISTS sites_insert ON public.sites;
CREATE POLICY sites_insert ON public.sites FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager'));
DROP POLICY IF EXISTS sites_update ON public.sites;
CREATE POLICY sites_update ON public.sites FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager'));
DROP POLICY IF EXISTS sites_delete ON public.sites;
CREATE POLICY sites_delete ON public.sites FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager'));

REVOKE ALL ON public.sites FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sites TO authenticated;
