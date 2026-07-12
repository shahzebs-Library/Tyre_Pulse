-- ============================================================================
-- MIGRATIONS_V163 — Preventive Maintenance Programs
-- ============================================================================
-- Backs the PM Programs module (/pm-programs). Fleet teams define recurring
-- preventive-maintenance programs against an asset or asset-type: a service
-- interval (km / hours / days / months), when it was last done, and when it is
-- next due. The app derives overdue / due-soon bands from next_due and rolls
-- programs up into a status dashboard.
--
-- Org-isolated, country-scoped. Any authenticated member may read; only
-- Admin/Manager/Director may create, edit or delete programs.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at(), get_my_role().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pm_programs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  name             text NOT NULL,
  asset_no         text,
  asset_type       text,
  interval_type    text NOT NULL DEFAULT 'months'
                     CHECK (interval_type IN ('km','hours','days','months')),
  interval_value   numeric,
  last_done        date,
  next_due         date,
  site             text,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','paused','completed')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pm_programs_org      ON public.pm_programs (organisation_id);
CREATE INDEX IF NOT EXISTS idx_pm_programs_status   ON public.pm_programs (status);
CREATE INDEX IF NOT EXISTS idx_pm_programs_next_due ON public.pm_programs (next_due);

DROP TRIGGER IF EXISTS set_updated_at_pm_programs ON public.pm_programs;
CREATE TRIGGER set_updated_at_pm_programs BEFORE UPDATE ON public.pm_programs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member may read; only Admin/Manager/Director may write.
ALTER TABLE public.pm_programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pm_programs_org_isolation ON public.pm_programs;
CREATE POLICY pm_programs_org_isolation ON public.pm_programs
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS pm_programs_read ON public.pm_programs;
CREATE POLICY pm_programs_read ON public.pm_programs FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS pm_programs_insert ON public.pm_programs;
CREATE POLICY pm_programs_insert ON public.pm_programs FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS pm_programs_update ON public.pm_programs;
CREATE POLICY pm_programs_update ON public.pm_programs FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS pm_programs_delete ON public.pm_programs;
CREATE POLICY pm_programs_delete ON public.pm_programs FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.pm_programs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pm_programs TO authenticated;

-- Reversible:
--   DROP TABLE public.pm_programs;
