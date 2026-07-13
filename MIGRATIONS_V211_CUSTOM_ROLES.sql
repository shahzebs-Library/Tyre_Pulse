-- ============================================================================
-- MIGRATIONS_V211 — Custom Roles (self-service role builder)
-- ============================================================================
-- PURELY ADDITIVE. Lets an Admin define their OWN named roles from the UI
-- (Master Access Control → Custom Roles) instead of a developer hardcoding each
-- one. A custom role is just a name + description; its actual module access is
-- granted through the EXISTING permission engine — the `set_module_permissions`
-- RPC writes `module_permissions` rows keyed by the role string, and
-- `get_user_module_permissions` / AuthContext.hasPermission enforce them live.
-- Both RPCs are already role-generic (no hardcoded role names), so a custom
-- role's access is enforced with zero new enforcement code.
--
-- This table is only the ROSTER of custom role names (so the UI can enumerate
-- them, and the user/role dropdowns can include them). No new enforcement path.
--
-- Org-scoped (RESTRICTIVE org isolation). Reads: any authenticated org member.
-- Writes: Admin only (matching set_module_permissions' own gate).
-- Depends on existing helpers: app_current_org(), get_my_role(), set_updated_at().
-- Idempotent and safe to re-run. Reversible (see footer).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.custom_roles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  name             text NOT NULL,
  description      text,
  active           boolean NOT NULL DEFAULT true,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- One role name per org (case-insensitive), and never collide with a built-in.
  CONSTRAINT custom_roles_name_not_blank CHECK (btrim(name) <> ''),
  UNIQUE (organisation_id, name)
);

CREATE INDEX IF NOT EXISTS idx_custom_roles_org ON public.custom_roles (organisation_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_roles_org_lname
  ON public.custom_roles (organisation_id, lower(btrim(name)));

DROP TRIGGER IF EXISTS set_updated_at_custom_roles ON public.custom_roles;
CREATE TRIGGER set_updated_at_custom_roles BEFORE UPDATE ON public.custom_roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_roles_org_isolation ON public.custom_roles;
CREATE POLICY custom_roles_org_isolation ON public.custom_roles
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS custom_roles_read ON public.custom_roles;
CREATE POLICY custom_roles_read ON public.custom_roles FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS custom_roles_insert ON public.custom_roles;
CREATE POLICY custom_roles_insert ON public.custom_roles FOR INSERT
  WITH CHECK (public.get_my_role() = 'Admin');

DROP POLICY IF EXISTS custom_roles_update ON public.custom_roles;
CREATE POLICY custom_roles_update ON public.custom_roles FOR UPDATE
  USING (public.get_my_role() = 'Admin')
  WITH CHECK (public.get_my_role() = 'Admin');

DROP POLICY IF EXISTS custom_roles_delete ON public.custom_roles;
CREATE POLICY custom_roles_delete ON public.custom_roles FOR DELETE
  USING (public.get_my_role() = 'Admin');

REVOKE ALL ON public.custom_roles FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_roles TO authenticated;

-- Reversible:
--   DROP TABLE IF EXISTS public.custom_roles;
