-- ============================================================================
-- MIGRATIONS_V169 — Toll Transactions
-- ============================================================================
-- Backs the Toll Transactions module (/toll-transactions): individual toll-road
-- charges captured per asset — whether paid by electronic tag, cash, card, or on
-- account. Toll spend is a material, per-trip operating cost, so every charge is
-- org-isolated, country-scoped, and auditable for reconciliation and dispute
-- workflows.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.toll_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  asset_no         text NOT NULL,
  driver_name      text,
  tag_id           text,
  plaza_name       text,
  highway          text,
  transaction_at   timestamptz,
  amount           numeric,
  currency         text,
  payment_method   text
                     CHECK (payment_method IN ('tag','cash','card','account','other')),
  status           text
                     CHECK (status IN ('posted','disputed','reconciled','refunded')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_toll_transactions_org     ON public.toll_transactions (organisation_id);
CREATE INDEX IF NOT EXISTS idx_toll_transactions_asset   ON public.toll_transactions (asset_no);
CREATE INDEX IF NOT EXISTS idx_toll_transactions_txn_at  ON public.toll_transactions (transaction_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_toll_transactions ON public.toll_transactions;
CREATE TRIGGER set_updated_at_toll_transactions BEFORE UPDATE ON public.toll_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and record toll charges — toll
-- capture is a routine field/ops and finance activity, not a privileged one.
ALTER TABLE public.toll_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS toll_transactions_org_isolation ON public.toll_transactions;
CREATE POLICY toll_transactions_org_isolation ON public.toll_transactions
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS toll_transactions_read ON public.toll_transactions;
CREATE POLICY toll_transactions_read ON public.toll_transactions FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS toll_transactions_insert ON public.toll_transactions;
CREATE POLICY toll_transactions_insert ON public.toll_transactions FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS toll_transactions_update ON public.toll_transactions;
CREATE POLICY toll_transactions_update ON public.toll_transactions FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS toll_transactions_delete ON public.toll_transactions;
CREATE POLICY toll_transactions_delete ON public.toll_transactions FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.toll_transactions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.toll_transactions TO authenticated;

-- Reversible:
--   DROP TABLE public.toll_transactions;
