-- V353 - Data Reconciliation: "Serial on multiple assets" READ-ONLY diagnostic.
--
-- Surfaces the SAME tyre serial recorded against more than one asset - usually a
-- tyre that MOVED between vehicles over its life, occasionally a data-entry error.
-- This is INFORMATIONAL ONLY: the RPC is STABLE and never mutates a row.
--
-- Follows the established recon_* RPC pattern (V232/V235/V346/V349): SECURITY
-- DEFINER, STABLE, pinned search_path 'public', app_is_elevated()-gated
-- (super-admin / Admin / Manager / Director), org-scoped via app_current_org()
-- with a super-admin cross-org branch, GRANT authenticated, REVOKE anon/PUBLIC.

CREATE OR REPLACE FUNCTION public.recon_serial_multi_asset()
  RETURNS TABLE(serial_no text, country text, asset_count bigint, assets text)
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
  SELECT tr.serial_no::text AS serial_no,
         tr.country::text AS country,
         count(DISTINCT tr.asset_no)::bigint AS asset_count,
         string_agg(DISTINCT tr.asset_no, ', ') AS assets
  FROM public.tyre_records tr
  WHERE (tr.organisation_id = v_org OR public.is_super_admin())
    AND tr.serial_no IS NOT NULL
  GROUP BY tr.serial_no, tr.country
  HAVING count(DISTINCT tr.asset_no) > 1
  ORDER BY count(DISTINCT tr.asset_no) DESC;
END $function$;

REVOKE ALL ON FUNCTION public.recon_serial_multi_asset() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.recon_serial_multi_asset() TO authenticated;

-- Reversible:
-- DROP FUNCTION IF EXISTS public.recon_serial_multi_asset();
