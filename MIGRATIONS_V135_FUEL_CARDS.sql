-- ============================================================================
-- MIGRATIONS_V135 — Fuel Card Management
-- ============================================================================
-- Backs the Fuel Card Management module (route /fuel-cards). Registers fleet
-- fuel cards, assigns them to vehicles/drivers, and tracks monthly spend limits,
-- status and expiry so procurement/management can see which cards are active,
-- unassigned, blocked or expired and what they are authorised to spend. Org-
-- isolated and country-scoped; writes restricted to Admin/Manager/Director.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at(), get_my_role().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fuel_cards (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  card_number      text NOT NULL,
  provider         text,
  asset_no         text,
  driver_name      text,
  monthly_limit    numeric,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','blocked','expired','unassigned')),
  expiry_date      date,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fuel_cards_org_card_number_key UNIQUE (organisation_id, card_number)
);
CREATE INDEX IF NOT EXISTS idx_fuel_cards_org      ON public.fuel_cards (organisation_id);
CREATE INDEX IF NOT EXISTS idx_fuel_cards_status   ON public.fuel_cards (status);
CREATE INDEX IF NOT EXISTS idx_fuel_cards_asset_no ON public.fuel_cards (asset_no);

DROP TRIGGER IF EXISTS set_updated_at_fuel_cards ON public.fuel_cards;
CREATE TRIGGER set_updated_at_fuel_cards BEFORE UPDATE ON public.fuel_cards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read fuel cards; only Admin/Manager/
-- Director may create, update, or delete them.
ALTER TABLE public.fuel_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fuel_cards_org_isolation ON public.fuel_cards;
CREATE POLICY fuel_cards_org_isolation ON public.fuel_cards
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS fuel_cards_read ON public.fuel_cards;
CREATE POLICY fuel_cards_read ON public.fuel_cards FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS fuel_cards_insert ON public.fuel_cards;
CREATE POLICY fuel_cards_insert ON public.fuel_cards FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS fuel_cards_update ON public.fuel_cards;
CREATE POLICY fuel_cards_update ON public.fuel_cards FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS fuel_cards_delete ON public.fuel_cards;
CREATE POLICY fuel_cards_delete ON public.fuel_cards FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.fuel_cards FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fuel_cards TO authenticated;

-- Reversible:
--   DROP TABLE public.fuel_cards;
