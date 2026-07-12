-- ============================================================================
-- MIGRATIONS_V189 — Fleet Groups: Holding-Company Hierarchy
-- ============================================================================
-- Backs the Fleet Groups module (/fleet-groups). Lets an organisation model its
-- real corporate/operational structure — holding companies, subsidiaries,
-- divisions, depots, cost centres, and custom groupings — as a self-referencing
-- hierarchy. Assets roll up through the tree so cost, budget, and utilisation
-- can be reported at any node (a depot, a division, or the whole holding).
--
-- Each row is one group. `parent_group` references another group by name within
-- the same organisation (soft reference — the page resolves the tree and guards
-- cycles / orphaned parents), so re-parenting never requires cascading rewrites
-- and importing a partial hierarchy never fails a foreign-key check.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run. Reversible (see footer).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fleet_groups (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  group_name       text NOT NULL,
  group_code       text,
  group_type       text
                     CHECK (group_type IN
                       ('holding','subsidiary','division','depot','cost_center','custom')),
  parent_group     text,
  manager          text,
  region           text,
  asset_count      integer,
  active           boolean DEFAULT true,
  budget           numeric,
  currency         text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fleet_groups_org        ON public.fleet_groups (organisation_id);
CREATE INDEX IF NOT EXISTS idx_fleet_groups_type       ON public.fleet_groups (group_type);
CREATE INDEX IF NOT EXISTS idx_fleet_groups_parent     ON public.fleet_groups (parent_group);
CREATE INDEX IF NOT EXISTS idx_fleet_groups_created_at ON public.fleet_groups (created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_fleet_groups ON public.fleet_groups;
CREATE TRIGGER set_updated_at_fleet_groups BEFORE UPDATE ON public.fleet_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read groups; authenticated members may create, amend, and remove
-- groups for their own org.
ALTER TABLE public.fleet_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fleet_groups_org_isolation ON public.fleet_groups;
CREATE POLICY fleet_groups_org_isolation ON public.fleet_groups
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS fleet_groups_read ON public.fleet_groups;
CREATE POLICY fleet_groups_read ON public.fleet_groups FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS fleet_groups_insert ON public.fleet_groups;
CREATE POLICY fleet_groups_insert ON public.fleet_groups FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS fleet_groups_update ON public.fleet_groups;
CREATE POLICY fleet_groups_update ON public.fleet_groups FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS fleet_groups_delete ON public.fleet_groups;
CREATE POLICY fleet_groups_delete ON public.fleet_groups FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.fleet_groups FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_groups TO authenticated;

-- Reversible:
--   DROP TABLE IF EXISTS public.fleet_groups;
