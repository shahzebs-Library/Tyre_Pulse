-- ============================================================================
-- MIGRATIONS_V174 — Service Requests (workshop request intake queue)
-- ============================================================================
-- Backs the Service Requests module (/service-requests). A lightweight ticketed
-- request queue that precedes work orders: customers or internal staff raise a
-- service request (tyre, mechanical, electrical, bodywork, inspection,
-- breakdown, or other), it is triaged, worked, and resolved/closed. Each row is
-- one request against one asset (or general) with priority, status, assignment,
-- and resolution tracking.
--
-- Feeds intake throughput, backlog, and resolution-time analytics ahead of the
-- formal work-order lifecycle.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.service_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  request_no       text,
  asset_no         text,
  requester_name   text,
  contact          text,
  category         text
                     CHECK (category IN ('tyre','mechanical','electrical','bodywork','inspection','breakdown','other')),
  priority         text
                     CHECK (priority IN ('low','medium','high','urgent')),
  status           text
                     CHECK (status IN ('new','triaged','in_progress','resolved','closed','cancelled')),
  subject          text NOT NULL,
  description      text,
  requested_at     timestamptz,
  resolved_at      timestamptz,
  assigned_to      text,
  resolution       text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_requests_org       ON public.service_requests (organisation_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_asset     ON public.service_requests (asset_no);
CREATE INDEX IF NOT EXISTS idx_service_requests_requested ON public.service_requests (requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_requests_status    ON public.service_requests (status);

DROP TRIGGER IF EXISTS set_updated_at_service_requests ON public.service_requests;
CREATE TRIGGER set_updated_at_service_requests BEFORE UPDATE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read requests; authenticated members may raise (insert), update,
-- and delete requests for their own org.
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_requests_org_isolation ON public.service_requests;
CREATE POLICY service_requests_org_isolation ON public.service_requests
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS service_requests_read ON public.service_requests;
CREATE POLICY service_requests_read ON public.service_requests FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS service_requests_insert ON public.service_requests;
CREATE POLICY service_requests_insert ON public.service_requests FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS service_requests_update ON public.service_requests;
CREATE POLICY service_requests_update ON public.service_requests FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS service_requests_delete ON public.service_requests;
CREATE POLICY service_requests_delete ON public.service_requests FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.service_requests FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_requests TO authenticated;

-- Reversible:
--   DROP TABLE public.service_requests;
