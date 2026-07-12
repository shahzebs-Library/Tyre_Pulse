-- ============================================================================
-- MIGRATIONS_V185 — SLA Records: Service-Level-Agreement Tracking
-- ============================================================================
-- Backs the SLA Dashboard module (/sla-dashboard). Tracks service-level
-- agreements across operational work — work orders, breakdown callouts,
-- deliveries, inspections, procurement, and support tickets — so the fleet can
-- measure responsiveness, spot at-risk commitments before they breach, and
-- report compliance to customers and management.
--
-- Each row is one tracked SLA commitment: a target resolution window
-- (target_hours) anchored to a start time (started_at) and a due time
-- (due_at), with a lifecycle status. Time-to-breach and compliance analytics
-- are derived in the pure `src/lib/slaRecords.js` helpers (no stored
-- duplication) so the definition of "at risk" / "breached" lives in one place.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sla_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  reference        text NOT NULL,
  sla_type         text NOT NULL DEFAULT 'other'
                     CHECK (sla_type IN ('work_order','breakdown','delivery',
                                         'inspection','procurement','support','other')),
  asset_no         text,
  priority         text NOT NULL DEFAULT 'medium'
                     CHECK (priority IN ('low','medium','high','critical')),
  target_hours     numeric,
  started_at       timestamptz,
  due_at           timestamptz,
  resolved_at      timestamptz,
  status           text NOT NULL DEFAULT 'on_track'
                     CHECK (status IN ('on_track','at_risk','breached','met','cancelled')),
  owner            text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sla_records_org      ON public.sla_records (organisation_id);
CREATE INDEX IF NOT EXISTS idx_sla_records_type     ON public.sla_records (sla_type);
CREATE INDEX IF NOT EXISTS idx_sla_records_due      ON public.sla_records (due_at DESC);
CREATE INDEX IF NOT EXISTS idx_sla_records_status   ON public.sla_records (status);

DROP TRIGGER IF EXISTS set_updated_at_sla_records ON public.sla_records;
CREATE TRIGGER set_updated_at_sla_records BEFORE UPDATE ON public.sla_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read records; authenticated members may create and update SLA
-- records for their own org.
ALTER TABLE public.sla_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sla_records_org_isolation ON public.sla_records;
CREATE POLICY sla_records_org_isolation ON public.sla_records
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS sla_records_read ON public.sla_records;
CREATE POLICY sla_records_read ON public.sla_records FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS sla_records_insert ON public.sla_records;
CREATE POLICY sla_records_insert ON public.sla_records FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS sla_records_update ON public.sla_records;
CREATE POLICY sla_records_update ON public.sla_records FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS sla_records_delete ON public.sla_records;
CREATE POLICY sla_records_delete ON public.sla_records FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.sla_records FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sla_records TO authenticated;

-- Reversible:
--   DROP TABLE public.sla_records;
