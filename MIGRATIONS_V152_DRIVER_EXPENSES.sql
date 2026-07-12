-- ============================================================================
-- MIGRATIONS_V152 — Driver Expenses: Expense Claims
-- ============================================================================
-- Logs driver expense claims (driver, category, amount, expense date, asset,
-- status). Backs the /driver-expenses module. Any authenticated member of the
-- org may record and manage claims. Org-isolated and country-scoped, with a
-- lightweight approval status lifecycle.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.driver_expenses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  driver_name      text NOT NULL,
  category         text,
  amount           numeric,
  expense_date     date,
  asset_no         text,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected','reimbursed')),
  description      text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_driver_expenses_org    ON public.driver_expenses (organisation_id);
CREATE INDEX IF NOT EXISTS idx_driver_expenses_status ON public.driver_expenses (status);
CREATE INDEX IF NOT EXISTS idx_driver_expenses_driver ON public.driver_expenses (driver_name);

DROP TRIGGER IF EXISTS set_updated_at_driver_expenses ON public.driver_expenses;
CREATE TRIGGER set_updated_at_driver_expenses BEFORE UPDATE ON public.driver_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and manage (create/update/delete)
-- driver expense records.
ALTER TABLE public.driver_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_expenses_org_isolation ON public.driver_expenses;
CREATE POLICY driver_expenses_org_isolation ON public.driver_expenses
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS driver_expenses_read ON public.driver_expenses;
CREATE POLICY driver_expenses_read ON public.driver_expenses FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS driver_expenses_insert ON public.driver_expenses;
CREATE POLICY driver_expenses_insert ON public.driver_expenses FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS driver_expenses_update ON public.driver_expenses;
CREATE POLICY driver_expenses_update ON public.driver_expenses FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS driver_expenses_delete ON public.driver_expenses;
CREATE POLICY driver_expenses_delete ON public.driver_expenses FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.driver_expenses FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_expenses TO authenticated;

-- Reversible:
--   DROP TABLE public.driver_expenses;
