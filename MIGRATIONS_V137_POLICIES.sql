-- ============================================================================
-- MIGRATIONS_V137 — Policy Management: Fleet Policies & SOPs
-- ============================================================================
-- Backs the Policy Management module (route /policies). Stores fleet governance
-- documents — policies, SOPs, standards — with versioning, ownership, effective
-- and review dates, and a status lifecycle. Org-isolated and country-scoped.
-- Any authenticated member may read; Admin/Manager/Director author and maintain.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at(), get_my_role().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.policies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  title            text NOT NULL,
  category         text,
  version          text,
  owner            text,
  effective_date   date,
  review_date      date,
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','active','under_review','archived')),
  body             text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_policies_org         ON public.policies (organisation_id);
CREATE INDEX IF NOT EXISTS idx_policies_status      ON public.policies (status);
CREATE INDEX IF NOT EXISTS idx_policies_review_date ON public.policies (review_date);

DROP TRIGGER IF EXISTS set_updated_at_policies ON public.policies;
CREATE TRIGGER set_updated_at_policies BEFORE UPDATE ON public.policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member may read policies in their org; only Admin/Manager/
-- Director may create, update or delete them.
ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS policies_org_isolation ON public.policies;
CREATE POLICY policies_org_isolation ON public.policies
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS policies_read ON public.policies;
CREATE POLICY policies_read ON public.policies FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS policies_insert ON public.policies;
CREATE POLICY policies_insert ON public.policies FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS policies_update ON public.policies;
CREATE POLICY policies_update ON public.policies FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS policies_delete ON public.policies;
CREATE POLICY policies_delete ON public.policies FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.policies FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.policies TO authenticated;

-- Reversible:
--   DROP TABLE public.policies;
