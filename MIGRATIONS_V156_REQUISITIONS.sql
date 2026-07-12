-- ============================================================================
-- MIGRATIONS_V156 — Purchase Requisitions
-- ============================================================================
-- Internal purchase requests that precede a Purchase Order: a requester logs an
-- item, quantity, estimated cost and needed-by date; the request moves through a
-- lightweight lifecycle (draft → submitted → approved/rejected → ordered) before
-- a PO is raised. Org-isolated, country-scoped, and fully auditable.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.requisitions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  requisition_no   text,
  requester        text,
  item             text NOT NULL,
  category         text,
  quantity         numeric,
  est_cost         numeric,
  needed_by        date,
  site             text,
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','submitted','approved','rejected','ordered')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_requisitions_org       ON public.requisitions (organisation_id);
CREATE INDEX IF NOT EXISTS idx_requisitions_status    ON public.requisitions (status);
CREATE INDEX IF NOT EXISTS idx_requisitions_needed_by ON public.requisitions (needed_by);

DROP TRIGGER IF EXISTS set_updated_at_requisitions ON public.requisitions;
CREATE TRIGGER set_updated_at_requisitions BEFORE UPDATE ON public.requisitions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read and manage requisitions (procurement is a shared workflow).
ALTER TABLE public.requisitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS requisitions_org_isolation ON public.requisitions;
CREATE POLICY requisitions_org_isolation ON public.requisitions
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS requisitions_read ON public.requisitions;
CREATE POLICY requisitions_read ON public.requisitions FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS requisitions_insert ON public.requisitions;
CREATE POLICY requisitions_insert ON public.requisitions FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS requisitions_update ON public.requisitions;
CREATE POLICY requisitions_update ON public.requisitions FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS requisitions_delete ON public.requisitions;
CREATE POLICY requisitions_delete ON public.requisitions FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.requisitions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.requisitions TO authenticated;

-- Reversible:
--   DROP TABLE public.requisitions;
