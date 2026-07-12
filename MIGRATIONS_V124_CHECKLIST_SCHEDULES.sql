-- ============================================================================
-- MIGRATIONS_V124 — Checklist scheduling & assignments (compliance program)
-- ============================================================================
-- Turns checklist templates into a managed, recurring operational program:
--   * checklist_schedules   — a recurring rule: run template T on a cadence,
--     targeting some sites/assets, optionally for a role.
--   * checklist_assignments — the concrete due instances a schedule generates
--     (one per target), tracked pending → completed / overdue.
--   * generate_checklist_assignments() — materialises due assignments and
--     advances each schedule's next_due; also ages stale pending → overdue.
--     Wired to daily pg_cron when available; also callable on demand.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at(), get_my_role().
-- Idempotent and safe to re-run.
-- ============================================================================

-- 1. SCHEDULES ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checklist_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid DEFAULT public.app_current_org(),
  country         text,
  template_id     uuid NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  name            text NOT NULL,
  cadence         text NOT NULL DEFAULT 'weekly'
                    CHECK (cadence IN ('daily','weekly','monthly','once')),
  sites           text[] NOT NULL DEFAULT '{}',
  asset_nos       text[] NOT NULL DEFAULT '{}',
  assignee_role   text,
  start_date      date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  next_due        date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  active          boolean NOT NULL DEFAULT true,
  created_by      uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checklist_sched_org      ON public.checklist_schedules (organisation_id);
CREATE INDEX IF NOT EXISTS idx_checklist_sched_template ON public.checklist_schedules (template_id);
CREATE INDEX IF NOT EXISTS idx_checklist_sched_due      ON public.checklist_schedules (next_due) WHERE active;

DROP TRIGGER IF EXISTS set_updated_at_checklist_schedules ON public.checklist_schedules;
CREATE TRIGGER set_updated_at_checklist_schedules BEFORE UPDATE ON public.checklist_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. ASSIGNMENTS -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checklist_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid DEFAULT public.app_current_org(),
  country         text,
  schedule_id     uuid REFERENCES public.checklist_schedules(id) ON DELETE SET NULL,
  template_id     uuid REFERENCES public.checklist_templates(id) ON DELETE SET NULL,
  template_name   text,
  site            text,
  asset_no        text,
  assignee_role   text,
  due_date        date NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','completed','overdue','skipped')),
  submission_id   uuid REFERENCES public.checklist_submissions(id) ON DELETE SET NULL,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checklist_assign_org      ON public.checklist_assignments (organisation_id);
CREATE INDEX IF NOT EXISTS idx_checklist_assign_status   ON public.checklist_assignments (status);
CREATE INDEX IF NOT EXISTS idx_checklist_assign_due      ON public.checklist_assignments (due_date);
CREATE INDEX IF NOT EXISTS idx_checklist_assign_template ON public.checklist_assignments (template_id);
-- One assignment per schedule/due-date/site/asset (idempotent generation).
CREATE UNIQUE INDEX IF NOT EXISTS ux_checklist_assign_dedup
  ON public.checklist_assignments (
    schedule_id, due_date,
    coalesce(site, ''), coalesce(asset_no, '')
  ) WHERE schedule_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at_checklist_assignments ON public.checklist_assignments;
CREATE TRIGGER set_updated_at_checklist_assignments BEFORE UPDATE ON public.checklist_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. RLS ---------------------------------------------------------------------
ALTER TABLE public.checklist_schedules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checklist_sched_org_isolation ON public.checklist_schedules;
CREATE POLICY checklist_sched_org_isolation ON public.checklist_schedules
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());
DROP POLICY IF EXISTS checklist_sched_read ON public.checklist_schedules;
CREATE POLICY checklist_sched_read ON public.checklist_schedules FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS checklist_sched_write ON public.checklist_schedules;
CREATE POLICY checklist_sched_write ON public.checklist_schedules FOR ALL
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS checklist_assign_org_isolation ON public.checklist_assignments;
CREATE POLICY checklist_assign_org_isolation ON public.checklist_assignments
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());
DROP POLICY IF EXISTS checklist_assign_read ON public.checklist_assignments;
CREATE POLICY checklist_assign_read ON public.checklist_assignments FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS checklist_assign_write ON public.checklist_assignments;
CREATE POLICY checklist_assign_write ON public.checklist_assignments FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

REVOKE ALL ON public.checklist_schedules   FROM anon;
REVOKE ALL ON public.checklist_assignments FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_schedules   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_assignments TO authenticated;

-- 4. GENERATOR ---------------------------------------------------------------
-- Materialises due assignments for every active schedule whose next_due has
-- arrived, one row per target (each site, else each asset, else one general),
-- then advances next_due by the cadence ('once' deactivates). Also ages stale
-- pending assignments to 'overdue'. SECURITY DEFINER so pg_cron (no JWT) can run
-- it; org scoping is intrinsic because each row copies its schedule's org.
CREATE OR REPLACE FUNCTION public.generate_checklist_assignments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s        record;
  tpl      record;
  v_made   integer := 0;
  v_today  date := (now() AT TIME ZONE 'UTC')::date;
  target   text;
BEGIN
  FOR s IN
    SELECT * FROM public.checklist_schedules
    WHERE active AND next_due <= v_today
  LOOP
    SELECT id, name, country INTO tpl FROM public.checklist_templates WHERE id = s.template_id;
    IF tpl.id IS NULL THEN CONTINUE; END IF;

    IF array_length(s.sites, 1) IS NOT NULL THEN
      FOREACH target IN ARRAY s.sites LOOP
        INSERT INTO public.checklist_assignments
          (organisation_id, country, schedule_id, template_id, template_name, site, assignee_role, due_date)
        VALUES (s.organisation_id, s.country, s.id, s.template_id, tpl.name, target, s.assignee_role, s.next_due)
        ON CONFLICT DO NOTHING;
        v_made := v_made + 1;
      END LOOP;
    ELSIF array_length(s.asset_nos, 1) IS NOT NULL THEN
      FOREACH target IN ARRAY s.asset_nos LOOP
        INSERT INTO public.checklist_assignments
          (organisation_id, country, schedule_id, template_id, template_name, asset_no, assignee_role, due_date)
        VALUES (s.organisation_id, s.country, s.id, s.template_id, tpl.name, target, s.assignee_role, s.next_due)
        ON CONFLICT DO NOTHING;
        v_made := v_made + 1;
      END LOOP;
    ELSE
      INSERT INTO public.checklist_assignments
        (organisation_id, country, schedule_id, template_id, template_name, assignee_role, due_date)
      VALUES (s.organisation_id, s.country, s.id, s.template_id, tpl.name, s.assignee_role, s.next_due)
      ON CONFLICT DO NOTHING;
      v_made := v_made + 1;
    END IF;

    UPDATE public.checklist_schedules
    SET next_due = CASE s.cadence
                     WHEN 'daily'   THEN s.next_due + 1
                     WHEN 'weekly'  THEN s.next_due + 7
                     WHEN 'monthly' THEN (s.next_due + interval '1 month')::date
                     ELSE s.next_due
                   END,
        active   = CASE WHEN s.cadence = 'once' THEN false ELSE active END
    WHERE id = s.id;
  END LOOP;

  -- Age stale pending assignments.
  UPDATE public.checklist_assignments
  SET status = 'overdue'
  WHERE status = 'pending' AND due_date < v_today;

  RETURN v_made;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_checklist_assignments() FROM anon;
GRANT EXECUTE ON FUNCTION public.generate_checklist_assignments() TO authenticated;

-- 5. Daily cron (best-effort; only if pg_cron is installed) -------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'checklist_assignments_daily') THEN
      PERFORM cron.unschedule('checklist_assignments_daily');
    END IF;
    PERFORM cron.schedule('checklist_assignments_daily', '15 0 * * *',
      $cron$ SELECT public.generate_checklist_assignments(); $cron$);
  END IF;
END $$;

-- Reversible:
--   DROP FUNCTION public.generate_checklist_assignments();
--   DROP TABLE public.checklist_assignments;
--   DROP TABLE public.checklist_schedules;
--   (and: SELECT cron.unschedule('checklist_assignments_daily'); if scheduled)
