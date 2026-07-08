-- ============================================================================
-- MIGRATIONS_V113 — org-isolate the remaining unscoped tables
-- ============================================================================
-- Deep isolation audit found these tables readable across ALL tenants:
--   * stock            — inventory + unit_cost, no org column, open read
--   * kpi_snapshots    — financial/operational KPI aggregates, no org, open read
--   * report_send_log  — scheduled-report recipient EMAILS, no org, open read
--   * organisations    — full tenant enumeration + cross-org write
--
-- Adds org scoping using the established RESTRICTIVE pattern (V111/V112).
-- Idempotent. Applied live in V113.
-- ============================================================================

-- ── stock (0 rows today) ─────────────────────────────────────────────────────
ALTER TABLE public.stock ADD COLUMN IF NOT EXISTS organisation_id uuid DEFAULT public.app_current_org();
UPDATE public.stock SET organisation_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE organisation_id IS NULL;
DROP POLICY IF EXISTS stock_org_isolation ON public.stock;
CREATE POLICY stock_org_isolation ON public.stock AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NULL OR organisation_id = public.app_current_org() OR public.app_is_org_admin())
  WITH CHECK (organisation_id IS NULL OR organisation_id = public.app_current_org() OR public.app_is_org_admin());

-- ── kpi_snapshots (0 rows today) ─────────────────────────────────────────────
ALTER TABLE public.kpi_snapshots ADD COLUMN IF NOT EXISTS organisation_id uuid DEFAULT public.app_current_org();
UPDATE public.kpi_snapshots SET organisation_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE organisation_id IS NULL;
DROP POLICY IF EXISTS kpi_snapshots_org_isolation ON public.kpi_snapshots;
CREATE POLICY kpi_snapshots_org_isolation ON public.kpi_snapshots AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NULL OR organisation_id = public.app_current_org() OR public.app_is_org_admin())
  WITH CHECK (organisation_id IS NULL OR organisation_id = public.app_current_org() OR public.app_is_org_admin());

-- ── report_send_log (86 rows; backfill from parent schedule) ─────────────────
ALTER TABLE public.report_send_log ADD COLUMN IF NOT EXISTS organisation_id uuid;
UPDATE public.report_send_log l
   SET organisation_id = s.org_id
  FROM public.report_schedules s
 WHERE l.schedule_id = s.id AND l.organisation_id IS NULL;
-- Robustly stamp org on every future insert (incl. the service-role cron writer)
-- from the owning schedule, so new delivery logs are never left globally visible.
CREATE OR REPLACE FUNCTION public.report_send_log_set_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.organisation_id IS NULL AND NEW.schedule_id IS NOT NULL THEN
    SELECT org_id INTO NEW.organisation_id FROM public.report_schedules WHERE id = NEW.schedule_id;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_report_send_log_set_org ON public.report_send_log;
CREATE TRIGGER trg_report_send_log_set_org BEFORE INSERT ON public.report_send_log
  FOR EACH ROW EXECUTE FUNCTION public.report_send_log_set_org();
DROP POLICY IF EXISTS report_send_log_read ON public.report_send_log;
DROP POLICY IF EXISTS report_send_log_org_isolation ON public.report_send_log;
-- Recipient emails are admin/report-center data: scope to org AND elevated roles.
CREATE POLICY report_send_log_read ON public.report_send_log FOR SELECT
  USING (
    (organisation_id IS NULL OR organisation_id = public.app_current_org() OR public.app_is_org_admin())
    AND public.get_my_role() = ANY (ARRAY['Admin','Manager','Director'])
  );

-- ── organisations — scope reads/writes to the caller's own org ───────────────
DROP POLICY IF EXISTS organisations_select ON public.organisations;
CREATE POLICY organisations_select ON public.organisations FOR SELECT
  USING (id = public.app_current_org() OR public.is_super_admin() OR public.app_is_org_admin());
DROP POLICY IF EXISTS organisations_write ON public.organisations;
CREATE POLICY organisations_write ON public.organisations FOR ALL
  USING ((id = public.app_current_org() AND public.get_my_role() = 'Admin') OR public.is_super_admin())
  WITH CHECK ((id = public.app_current_org() AND public.get_my_role() = 'Admin') OR public.is_super_admin());
