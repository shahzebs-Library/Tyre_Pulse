-- ============================================================================
-- MIGRATIONS_V206 — Organization Hierarchy (Enterprise §3, Phase 1)
-- ============================================================================
-- PURELY ADDITIVE. Introduces a governed, self-referencing organisation tree
-- (`org_units`) and a user-to-unit assignment table (`user_org_assignments`)
-- so an organisation can model its real internal structure —
-- company → country → region → branch → project → site → workshop →
-- department → team — and record which users belong where.
--
-- This phase deliberately DOES NOT touch any existing table, RLS policy, or
-- operational module, and DOES NOT add an org_unit_id column to any existing
-- table (assets/tyres/sites remain untouched — that wiring is a later phase).
-- It is safe to apply and to reverse (see footer) with zero blast radius on
-- current functionality.
--
-- Each `org_units` row is one node. `parent_id` references another node in the
-- same organisation (hard FK with ON DELETE SET NULL, so deleting a parent
-- promotes its children to roots rather than cascading a subtree away). The
-- application resolves the tree and guards cycles / orphaned parents in the
-- pure helpers (src/lib/orgUnits.js); the DB adds a belt-and-braces
-- self-reference CHECK so a node can never be its own direct parent.
--
-- Org-scoped (RESTRICTIVE org isolation). Reads: any authenticated org member.
-- Writes: elevated roles only (Admin/Manager/Director), matching V201.
-- Depends on V42 helpers: app_current_org(), get_my_role(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

-- 1. Organisation units (the hierarchy) --------------------------------------
CREATE TABLE IF NOT EXISTS public.org_units (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  parent_id        uuid REFERENCES public.org_units(id) ON DELETE SET NULL,
  unit_type        text
                     CHECK (unit_type IN
                       ('company','country','region','branch','project',
                        'site','workshop','department','team')),
  name             text NOT NULL,
  code             text,
  country          text,
  site_ref         text,
  active           boolean DEFAULT true,
  sort_order       integer,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_units_not_self CHECK (id <> parent_id)
);

CREATE INDEX IF NOT EXISTS idx_org_units_org      ON public.org_units (organisation_id);
CREATE INDEX IF NOT EXISTS idx_org_units_parent   ON public.org_units (parent_id);
CREATE INDEX IF NOT EXISTS idx_org_units_type     ON public.org_units (unit_type);
-- Normalised site_ref lookup within an org (case/space-insensitive), so a later
-- phase can reconcile units against operational site references cheaply.
CREATE INDEX IF NOT EXISTS idx_org_units_site_ref
  ON public.org_units (organisation_id, lower(btrim(coalesce(site_ref, ''))));

DROP TRIGGER IF EXISTS set_updated_at_org_units ON public.org_units;
CREATE TRIGGER set_updated_at_org_units BEFORE UPDATE ON public.org_units
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read the tree; only elevated roles may mutate it.
ALTER TABLE public.org_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_units_org_isolation ON public.org_units;
CREATE POLICY org_units_org_isolation ON public.org_units
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS org_units_read ON public.org_units;
CREATE POLICY org_units_read ON public.org_units FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS org_units_insert ON public.org_units;
CREATE POLICY org_units_insert ON public.org_units FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS org_units_update ON public.org_units;
CREATE POLICY org_units_update ON public.org_units FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS org_units_delete ON public.org_units;
CREATE POLICY org_units_delete ON public.org_units FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.org_units FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_units TO authenticated;

-- 2. User ↔ unit assignments -------------------------------------------------
-- Records membership of a user in a unit (with an optional role-at-unit and an
-- effective date window). ON DELETE CASCADE from org_units keeps assignments
-- clean when a unit is removed. One row per (user, unit).
CREATE TABLE IF NOT EXISTS public.user_org_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  user_id          uuid NOT NULL,
  org_unit_id      uuid REFERENCES public.org_units(id) ON DELETE CASCADE,
  role             text,
  is_primary       boolean DEFAULT false,
  starts_at        timestamptz,
  ends_at          timestamptz,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_unit_id)
);

CREATE INDEX IF NOT EXISTS idx_user_org_assignments_org  ON public.user_org_assignments (organisation_id);
CREATE INDEX IF NOT EXISTS idx_user_org_assignments_user ON public.user_org_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_user_org_assignments_unit ON public.user_org_assignments (org_unit_id);

DROP TRIGGER IF EXISTS set_updated_at_user_org_assignments ON public.user_org_assignments;
CREATE TRIGGER set_updated_at_user_org_assignments BEFORE UPDATE ON public.user_org_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_org_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_org_assignments_org_isolation ON public.user_org_assignments;
CREATE POLICY user_org_assignments_org_isolation ON public.user_org_assignments
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS user_org_assignments_read ON public.user_org_assignments;
CREATE POLICY user_org_assignments_read ON public.user_org_assignments FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS user_org_assignments_insert ON public.user_org_assignments;
CREATE POLICY user_org_assignments_insert ON public.user_org_assignments FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS user_org_assignments_update ON public.user_org_assignments;
CREATE POLICY user_org_assignments_update ON public.user_org_assignments FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS user_org_assignments_delete ON public.user_org_assignments;
CREATE POLICY user_org_assignments_delete ON public.user_org_assignments FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.user_org_assignments FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_org_assignments TO authenticated;

-- ----------------------------------------------------------------------------
-- Reference-only seed (NOT executed). A later phase, or an org admin, may adapt
-- this to bootstrap a starter tree. It is intentionally commented out so this
-- migration mutates nothing beyond its own two tables.
--
--   INSERT INTO public.org_units (unit_type, name, code)
--     VALUES ('company', 'Head Office', 'HQ');
--   INSERT INTO public.org_units (unit_type, name, parent_id)
--     SELECT 'country', 'Saudi Arabia', id FROM public.org_units WHERE code = 'HQ';
-- ----------------------------------------------------------------------------

-- Reversible:
--   DROP TABLE IF EXISTS public.user_org_assignments;
--   DROP TABLE IF EXISTS public.org_units;
