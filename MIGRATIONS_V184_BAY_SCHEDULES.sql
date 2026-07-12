-- ============================================================================
-- MIGRATIONS_V184 — Bay Scheduling / Workshop Capacity
-- ============================================================================
-- Backs the Bay Scheduling module (/bay-scheduling). Each row is one scheduled
-- (or in-progress / completed) job occupying a workshop bay for a window of
-- time. This is the operational backbone for workshop capacity planning: bay
-- utilisation, technician load, job overrun tracking, and scheduling-conflict
-- detection all derive from this table.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bay_schedules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  bay_name         text NOT NULL,
  workshop_site    text,
  asset_no         text,
  job_type         text
                     CHECK (job_type IN ('tyre_change','rotation','repair','inspection','service','alignment','other')),
  technician       text,
  scheduled_start  timestamptz,
  scheduled_end    timestamptz,
  actual_start     timestamptz,
  actual_end       timestamptz,
  estimated_min    numeric,
  priority         text
                     CHECK (priority IN ('low','normal','high','urgent')),
  status           text
                     CHECK (status IN ('scheduled','in_progress','completed','delayed','cancelled')),
  work_order_ref   text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bay_schedules_org       ON public.bay_schedules (organisation_id);
CREATE INDEX IF NOT EXISTS idx_bay_schedules_bay       ON public.bay_schedules (bay_name);
CREATE INDEX IF NOT EXISTS idx_bay_schedules_start     ON public.bay_schedules (scheduled_start DESC);
CREATE INDEX IF NOT EXISTS idx_bay_schedules_status    ON public.bay_schedules (status);

DROP TRIGGER IF EXISTS set_updated_at_bay_schedules ON public.bay_schedules;
CREATE TRIGGER set_updated_at_bay_schedules BEFORE UPDATE ON public.bay_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read schedules; authenticated members may create, update, and
-- delete schedules for their own org.
ALTER TABLE public.bay_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bay_schedules_org_isolation ON public.bay_schedules;
CREATE POLICY bay_schedules_org_isolation ON public.bay_schedules
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS bay_schedules_read ON public.bay_schedules;
CREATE POLICY bay_schedules_read ON public.bay_schedules FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS bay_schedules_insert ON public.bay_schedules;
CREATE POLICY bay_schedules_insert ON public.bay_schedules FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS bay_schedules_update ON public.bay_schedules;
CREATE POLICY bay_schedules_update ON public.bay_schedules FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS bay_schedules_delete ON public.bay_schedules;
CREATE POLICY bay_schedules_delete ON public.bay_schedules FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.bay_schedules FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bay_schedules TO authenticated;

-- Reversible:
--   DROP TABLE public.bay_schedules;
