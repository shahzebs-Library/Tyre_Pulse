-- V349 - Data Reconciliation: possible duplicate tyres (READ ONLY review)
--
-- A "possible duplicate" is a group of tyre_records that share the same
-- (serial_no, asset_no, issue_date, country) natural fitment key but may
-- differ in other columns. This is DISTINCT from recon_duplicate_tyres
-- (V235), which finds byte-identical rows that are safe to merge. These
-- groups are flagged for MANUAL review only - never auto-deleted - because
-- differing columns can carry real, non-redundant data.
--
-- Single SECURITY DEFINER, org-scoped, elevated-gated RPC that mirrors the
-- existing recon_* family (app_is_elevated() self-gate, app_current_org()
-- scope, pinned search_path). GRANT to authenticated, REVOKE from anon/PUBLIC.

CREATE OR REPLACE FUNCTION public.recon_duplicate_key_tyres()
  RETURNS TABLE(
    serial_no  text,
    asset_no   text,
    issue_date date,
    country    text,
    copies     bigint
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
  SELECT t.serial_no, t.asset_no, t.issue_date, t.country, count(*) AS copies
    FROM public.tyre_records t
   WHERE (t.organisation_id = v_org OR public.is_super_admin())
     AND t.serial_no IS NOT NULL
   GROUP BY t.serial_no, t.asset_no, t.issue_date, t.country
  HAVING count(*) > 1
   ORDER BY count(*) DESC;
END $function$;

REVOKE ALL ON FUNCTION public.recon_duplicate_key_tyres() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recon_duplicate_key_tyres() TO authenticated;

-- Reversible:
-- DROP FUNCTION IF EXISTS public.recon_duplicate_key_tyres();
