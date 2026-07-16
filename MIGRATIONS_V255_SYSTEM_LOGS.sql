-- =============================================================================
-- MIGRATIONS_V255_SYSTEM_LOGS.sql  (applied live)
-- Admin Control Module 1: unified application error / event log `system_logs`.
-- Any authenticated browser may append an error (fire-and-forget); Admin / super
-- admin read + resolve. Org-isolated (null org from early-boot errors allowed).
-- + resolve_system_logs(module, severity) bulk-resolve RPC (Admin/super only).
-- Idempotent + reversible (DROP TABLE / DROP FUNCTION).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.system_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  module_id        text,
  severity         text NOT NULL DEFAULT 'error'
                     CHECK (severity IN ('info','warning','error','critical')),
  source           text,
  message          text NOT NULL,
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb,
  reference_id     text,
  url              text,
  user_id          uuid DEFAULT auth.uid(),
  user_email       text,
  resolved         boolean NOT NULL DEFAULT false,
  resolved_by      uuid,
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_logs_org      ON public.system_logs (organisation_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_severity ON public.system_logs (severity);
CREATE INDEX IF NOT EXISTS idx_system_logs_resolved ON public.system_logs (resolved);
CREATE INDEX IF NOT EXISTS idx_system_logs_module   ON public.system_logs (module_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_created  ON public.system_logs (created_at DESC);

ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_logs_org_isolation ON public.system_logs;
CREATE POLICY system_logs_org_isolation ON public.system_logs
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NULL OR organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NULL OR organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS system_logs_read ON public.system_logs;
CREATE POLICY system_logs_read ON public.system_logs
  FOR SELECT USING (public.is_super_admin() OR public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS system_logs_insert ON public.system_logs;
CREATE POLICY system_logs_insert ON public.system_logs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS system_logs_update ON public.system_logs;
CREATE POLICY system_logs_update ON public.system_logs
  FOR UPDATE USING (public.is_super_admin() OR public.get_my_role() = 'Admin')
  WITH CHECK (public.is_super_admin() OR public.get_my_role() = 'Admin');

REVOKE ALL ON public.system_logs FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.system_logs TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_system_logs(p_module text DEFAULT NULL, p_severity text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_n integer; v_org uuid := public.app_current_org();
BEGIN
  IF NOT (public.is_super_admin() OR public.get_my_role() = 'Admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.system_logs SET resolved = true, resolved_by = auth.uid(), resolved_at = now()
  WHERE resolved = false
    AND (organisation_id IS NOT DISTINCT FROM v_org)
    AND (p_module IS NULL OR module_id = p_module)
    AND (p_severity IS NULL OR severity = p_severity);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END; $$;
REVOKE ALL ON FUNCTION public.resolve_system_logs(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_system_logs(text,text) TO authenticated;
