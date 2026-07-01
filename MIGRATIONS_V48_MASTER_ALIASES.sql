-- ============================================================================
-- MIGRATIONS_V48_MASTER_ALIASES.sql
-- Master-data alias control (directive Section 9). Backward-compatible.
-- One org-scoped table mapping raw source spellings → canonical master values
-- (site / supplier / brand / …). Imports normalise inconsistent spellings on the
-- way in WITHOUT ever auto-creating master records (canonical_id is optional and
-- only set when an operator picks an existing master).
--
-- RLS mirrors import_mapping_profiles: RESTRICTIVE org isolation + permissive
-- read (authenticated) + permissive write requiring is_approved_and_unlocked().
--
-- Rollback: DROP TABLE IF EXISTS public.import_master_aliases;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.import_master_aliases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.organisations(id),
  country          text,                       -- null = applies to all countries in the org
  entity_type      text NOT NULL,              -- site | supplier | brand | driver | make | model | ...
  raw_value        text NOT NULL,              -- as it appears in source files (verbatim)
  raw_value_norm   text NOT NULL,              -- normalised key for exact lookup
  canonical_value  text NOT NULL,              -- the value to rewrite raw_value to
  canonical_id     uuid,                       -- optional link to a master record (NOT auto-created)
  active           boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by      uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_import_master_aliases_key
  ON public.import_master_aliases (organisation_id, COALESCE(country,''), entity_type, raw_value_norm);

CREATE INDEX IF NOT EXISTS idx_import_master_aliases_lookup
  ON public.import_master_aliases (entity_type, country, active);

ALTER TABLE public.import_master_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_master_aliases_org_isolation ON public.import_master_aliases;
CREATE POLICY import_master_aliases_org_isolation ON public.import_master_aliases
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (organisation_id IS NULL OR organisation_id = public.app_current_org())
  WITH CHECK (organisation_id IS NULL OR organisation_id = public.app_current_org());

DROP POLICY IF EXISTS import_master_aliases_read ON public.import_master_aliases;
CREATE POLICY import_master_aliases_read ON public.import_master_aliases
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS import_master_aliases_write ON public.import_master_aliases;
CREATE POLICY import_master_aliases_write ON public.import_master_aliases
  FOR ALL TO authenticated
  USING (public.is_approved_and_unlocked())
  WITH CHECK (public.is_approved_and_unlocked());
