-- ============================================================================
-- MIGRATIONS_V49_CURRENCY_RATES.sql
-- Approval-gated FX source of truth (directive Section 12). Backward-compatible:
-- adds ONE new table; no existing table/column is altered.
--
-- The import pipeline converts a monetary value to a base currency ONLY when an
-- APPROVED rate exists here — never a silent or fabricated rate. The conversion
-- trail (exchange_rate / exchange_rate_date / amount_base_currency /
-- conversion_source) is carried in import_rows.custom_data (already committed as
-- JSONB by the column-intersection RPC), so no destination-table schema change
-- is needed. amount_original + currency_original remain preserved as before.
--
-- Rollback: DROP TABLE IF EXISTS public.currency_rates;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.currency_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.organisations(id),
  base_currency   text NOT NULL,           -- reporting/base currency, e.g. 'USD'
  quote_currency  text NOT NULL,           -- source currency of the amount, e.g. 'SAR'
  rate            numeric(20,8) NOT NULL CHECK (rate > 0), -- 1 quote_currency = rate * base_currency
  rate_date       date NOT NULL,
  source          text NOT NULL,           -- 'manual' | 'ecb' | ... (provenance, never silent)
  approved        boolean NOT NULL DEFAULT false,
  approved_by     uuid,
  approved_at     timestamptz,
  created_by      uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT currency_rates_ccy_diff CHECK (base_currency <> quote_currency)
);

-- One approved rate per org/pair/date (drafts unconstrained).
CREATE UNIQUE INDEX IF NOT EXISTS currency_rates_approved_uq
  ON public.currency_rates (organisation_id, base_currency, quote_currency, rate_date)
  WHERE approved;
CREATE INDEX IF NOT EXISTS currency_rates_lookup_idx
  ON public.currency_rates (organisation_id, quote_currency, base_currency, rate_date DESC)
  WHERE approved;

ALTER TABLE public.currency_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS currency_rates_org_isolation ON public.currency_rates;
CREATE POLICY currency_rates_org_isolation ON public.currency_rates
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (organisation_id IS NULL OR organisation_id = public.app_current_org())
  WITH CHECK (organisation_id IS NULL OR organisation_id = public.app_current_org());

DROP POLICY IF EXISTS currency_rates_select ON public.currency_rates;
CREATE POLICY currency_rates_select ON public.currency_rates
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS currency_rates_write ON public.currency_rates;
CREATE POLICY currency_rates_write ON public.currency_rates
  FOR ALL TO authenticated
  USING (public.is_approved_and_unlocked())
  WITH CHECK (public.is_approved_and_unlocked());
