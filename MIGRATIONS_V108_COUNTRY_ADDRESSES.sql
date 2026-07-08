-- ============================================================================
-- MIGRATIONS_V108 — Per-country address book
-- ============================================================================
-- Today an organisation has ONE address (organisations branding, V68). Fleets
-- operate across several countries (KSA / UAE / Egypt …) and each legal entity
-- has its own registered address, tax id and contact block that must appear on
-- that country's reports, gate passes and procurement documents.
--
-- This adds an org-scoped `country_addresses` table: one editable address per
-- (organisation, country). The UI auto-lists the operating countries and
-- pre-fills each from the org branding address; the admin overrides per country.
-- Resolution (country row → org address fallback) is done in the app so a
-- country with no row still renders a sensible address.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at(), get_my_role().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.country_addresses (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  country          text NOT NULL,                 -- 'KSA' | 'UAE' | 'Egypt' | …
  legal_name       text,                          -- registered entity name in-country
  address_line     text,                          -- street / building
  city             text,
  region           text,                          -- state / emirate / governorate
  postal_code      text,
  tax_id           text,                          -- VAT / CR / tax registration no.
  contact_person   text,
  contact_email    text,
  contact_phone    text,
  website          text,
  notes            text,
  organisation_id  uuid DEFAULT public.app_current_org(),
  created_by       uuid REFERENCES auth.users ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES auth.users ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One address per country per org. COALESCE keeps the key stable even if a legacy
-- row ever lands with a NULL org (defence-in-depth; org default is non-null).
CREATE UNIQUE INDEX IF NOT EXISTS ux_country_addresses_org_country
  ON public.country_addresses (coalesce(organisation_id, '00000000-0000-0000-0000-000000000001'::uuid), lower(btrim(country)));
CREATE INDEX IF NOT EXISTS idx_country_addresses_org
  ON public.country_addresses (organisation_id);

DROP TRIGGER IF EXISTS set_updated_at_country_addresses ON public.country_addresses;
CREATE TRIGGER set_updated_at_country_addresses BEFORE UPDATE ON public.country_addresses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS: org isolation for everyone; writes are admin-only (org config) ──────
ALTER TABLE public.country_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS country_addresses_org_isolation ON public.country_addresses;
CREATE POLICY country_addresses_org_isolation ON public.country_addresses FOR ALL
  USING (organisation_id IS NULL OR organisation_id = public.app_current_org())
  WITH CHECK (organisation_id IS NULL OR organisation_id = public.app_current_org());

-- Read: any authenticated member of the org (org isolation above still applies).
DROP POLICY IF EXISTS country_addresses_select ON public.country_addresses;
CREATE POLICY country_addresses_select ON public.country_addresses FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Write: administrators only — this is tenant configuration, like branding.
DROP POLICY IF EXISTS country_addresses_insert ON public.country_addresses;
CREATE POLICY country_addresses_insert ON public.country_addresses FOR INSERT
  WITH CHECK (public.get_my_role() = 'Admin');
DROP POLICY IF EXISTS country_addresses_update ON public.country_addresses;
CREATE POLICY country_addresses_update ON public.country_addresses FOR UPDATE
  USING (public.get_my_role() = 'Admin')
  WITH CHECK (public.get_my_role() = 'Admin');
DROP POLICY IF EXISTS country_addresses_delete ON public.country_addresses;
CREATE POLICY country_addresses_delete ON public.country_addresses FOR DELETE
  USING (public.get_my_role() = 'Admin');

REVOKE ALL ON public.country_addresses FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.country_addresses TO authenticated;
