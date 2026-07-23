-- V346 - Job card date mismatch reconciliation RPCs
--
-- Read-only reconciliation surface over the existing view
-- public.v_jobcard_date_mismatch (rows where the MM/YY encoded in the Ramco
-- work_order_no disagrees with the actual work_orders.opened_at). These are
-- likely data-entry typos flagged for MANUAL correction; nothing is changed
-- automatically.
--
-- Both functions mirror the existing recon_* family: SECURITY DEFINER, STABLE,
-- pinned search_path 'public', self-gated on public.app_is_elevated() (true for
-- super-admin / Admin / Manager / Director) and org-scoped to
-- public.app_current_org() (a super-admin sees every org). EXECUTE granted to
-- authenticated only; anon/PUBLIC are never granted.

CREATE OR REPLACE FUNCTION public.recon_jobcard_mismatches(p_limit integer DEFAULT 1000)
RETURNS TABLE(
  id             uuid,
  work_order_no  text,
  opened_at      timestamptz,
  country        text,
  site           text,
  jobcard_month  integer,
  jobcard_year   integer,
  opened_month   integer,
  opened_year    integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_org uuid := public.app_current_org();
BEGIN
  IF NOT public.app_is_elevated() THEN
    RAISE EXCEPTION 'Not permitted.' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT m.id,
         m.work_order_no::text,
         m.opened_at,
         m.country::text,
         m.site::text,
         m.jobcard_month,
         m.jobcard_year,
         m.opened_month,
         m.opened_year
  FROM public.v_jobcard_date_mismatch m
  WHERE m.organisation_id = v_org OR public.is_super_admin()
  ORDER BY m.country, m.work_order_no
  LIMIT GREATEST(0, COALESCE(p_limit, 1000));
END $function$;

CREATE OR REPLACE FUNCTION public.recon_jobcard_mismatch_summary()
RETURNS TABLE(
  country     text,
  mismatches  bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_org uuid := public.app_current_org();
BEGIN
  IF NOT public.app_is_elevated() THEN
    RAISE EXCEPTION 'Not permitted.' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT m.country::text AS country, count(*)::bigint AS mismatches
  FROM public.v_jobcard_date_mismatch m
  WHERE m.organisation_id = v_org OR public.is_super_admin()
  GROUP BY m.country
  ORDER BY m.country;
END $function$;

REVOKE ALL ON FUNCTION public.recon_jobcard_mismatches(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.recon_jobcard_mismatch_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recon_jobcard_mismatches(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recon_jobcard_mismatch_summary() TO authenticated;

-- Reversible footer (rollback):
-- DROP FUNCTION IF EXISTS public.recon_jobcard_mismatches(integer);
-- DROP FUNCTION IF EXISTS public.recon_jobcard_mismatch_summary();
