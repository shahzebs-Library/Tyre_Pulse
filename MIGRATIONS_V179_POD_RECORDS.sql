-- ============================================================================
-- MIGRATIONS_V179 — Proof of Delivery (POD) Records
-- ============================================================================
-- Backs the Proof of Delivery module (/proof-of-delivery). Stores one row per
-- delivery event: which asset ran the job, who the customer was, where it was
-- delivered, who received it, and the captured signature/photo evidence. This
-- closes the operational loop between dispatch and confirmed delivery and feeds
-- delivery-reliability KPIs (delivery rate, failed/returned rates by driver).
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pod_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid DEFAULT public.app_current_org(),
  country           text,
  pod_no            text,
  asset_no          text,
  driver_name       text,
  customer_name     text,
  delivery_address  text,
  order_ref         text,
  delivered_at      timestamptz,
  received_by       text,
  signature_url     text,
  photo_url         text,
  items_count       integer,
  status            text
                      CHECK (status IN ('pending','delivered','partial','failed','returned')),
  failure_reason    text,
  notes             text,
  created_by        uuid DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pod_records_org       ON public.pod_records (organisation_id);
CREATE INDEX IF NOT EXISTS idx_pod_records_asset     ON public.pod_records (asset_no);
CREATE INDEX IF NOT EXISTS idx_pod_records_delivered ON public.pod_records (delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_pod_records_status    ON public.pod_records (status);

DROP TRIGGER IF EXISTS set_updated_at_pod_records ON public.pod_records;
CREATE TRIGGER set_updated_at_pod_records BEFORE UPDATE ON public.pod_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read POD records; authenticated members may capture (insert) and
-- correct (update/delete) records for their own org.
ALTER TABLE public.pod_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pod_records_org_isolation ON public.pod_records;
CREATE POLICY pod_records_org_isolation ON public.pod_records
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS pod_records_read ON public.pod_records;
CREATE POLICY pod_records_read ON public.pod_records FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS pod_records_insert ON public.pod_records;
CREATE POLICY pod_records_insert ON public.pod_records FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS pod_records_update ON public.pod_records;
CREATE POLICY pod_records_update ON public.pod_records FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS pod_records_delete ON public.pod_records;
CREATE POLICY pod_records_delete ON public.pod_records FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.pod_records FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pod_records TO authenticated;

-- Reversible:
--   DROP TABLE public.pod_records;
