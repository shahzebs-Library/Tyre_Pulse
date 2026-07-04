-- V71: org-scoped 30-day tyre spend for the scheduled-report digest.
-- The digest previously called report_tyre_summary (country-only) with the
-- service role, which aggregated spend across EVERY organisation — a schedule
-- owned by org A would email org B's spend. This function scopes strictly by the
-- owning org (organisation_id). Called only by the cron edge function (service
-- role); EXECUTE is revoked from anon/authenticated to avoid exposing it.
CREATE OR REPLACE FUNCTION public.report_org_tyre_spend(p_org uuid, p_from date DEFAULT NULL)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT COALESCE(SUM(COALESCE(r.cost_per_tyre,0) * COALESCE(r.qty,1)),0)::numeric
  FROM public.tyre_records r
  WHERE (r.organisation_id = p_org OR (p_org IS NULL AND r.organisation_id IS NULL))
    AND (p_from IS NULL OR r.issue_date >= p_from);
$fn$;

REVOKE ALL ON FUNCTION public.report_org_tyre_spend(uuid, date) FROM public;
REVOKE ALL ON FUNCTION public.report_org_tyre_spend(uuid, date) FROM anon;
REVOKE ALL ON FUNCTION public.report_org_tyre_spend(uuid, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.report_org_tyre_spend(uuid, date) TO service_role;
