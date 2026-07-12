-- ============================================================================
-- MIGRATIONS_V149 — Shift Scheduling
-- ============================================================================
-- Rosters driver / technician shifts: who works, in what role, on which date,
-- from when to when, at which site, and with a lightweight status lifecycle
-- (scheduled → completed / absent / cancelled). Org-isolated and country-scoped,
-- so branch schedules stay separated across a multi-tenant fleet.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.shifts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  person_name      text NOT NULL,
  role             text,
  shift_date       date,
  start_time       text,
  end_time         text,
  site             text,
  status           text NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('scheduled','completed','absent','cancelled')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shifts_org    ON public.shifts (organisation_id);
CREATE INDEX IF NOT EXISTS idx_shifts_date   ON public.shifts (shift_date);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON public.shifts (status);

DROP TRIGGER IF EXISTS set_updated_at_shifts ON public.shifts;
CREATE TRIGGER set_updated_at_shifts BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and maintain the roster.
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shifts_org_isolation ON public.shifts;
CREATE POLICY shifts_org_isolation ON public.shifts
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS shifts_read ON public.shifts;
CREATE POLICY shifts_read ON public.shifts FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS shifts_insert ON public.shifts;
CREATE POLICY shifts_insert ON public.shifts FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS shifts_update ON public.shifts;
CREATE POLICY shifts_update ON public.shifts FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS shifts_delete ON public.shifts;
CREATE POLICY shifts_delete ON public.shifts FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.shifts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shifts TO authenticated;

-- Reversible:
--   DROP TABLE public.shifts;
