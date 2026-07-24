-- V354: per-country data-quality summary for the Data Reconciliation page.
--
-- Read-only reporting RPC that returns the key completeness/integrity counts for
-- every country present in tyre_records for the caller's organisation. Rendered
-- as a compact grade panel at the top of /data-reconciliation.
--
-- Follows the existing recon_* pattern (V232/V235): SECURITY DEFINER, STABLE,
-- search_path 'public', app_is_elevated()-gated, org-scoped via app_current_org().
-- No mutation. Numbers are honest counts straight from the tables.
--
-- vehicle_fleet uniqueness is per (organisation_id, country, asset_no) since V348,
-- so linkage checks match asset_no AND country within the same country bucket.

CREATE OR REPLACE FUNCTION public.recon_data_quality_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_org uuid := public.app_current_org(); v jsonb;
BEGIN
  IF NOT public.app_is_elevated() THEN RAISE EXCEPTION 'Not permitted.' USING errcode='42501'; END IF;
  SELECT COALESCE(jsonb_agg(obj ORDER BY obj->>'country'), '[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object(
      'country', c.country,
      'tyres', (SELECT count(*) FROM tyre_records tr WHERE tr.organisation_id = v_org AND COALESCE(tr.country,'') = c.country),
      'tyres_no_brand', (SELECT count(*) FROM tyre_records tr WHERE tr.organisation_id = v_org AND COALESCE(tr.country,'') = c.country AND COALESCE(NULLIF(btrim(tr.brand),''),'') = ''),
      'tyres_no_serial', (SELECT count(*) FROM tyre_records tr WHERE tr.organisation_id = v_org AND COALESCE(tr.country,'') = c.country AND COALESCE(NULLIF(btrim(tr.serial_no),''),'') = ''),
      'wo', (SELECT count(*) FROM work_orders wo WHERE wo.organisation_id = v_org AND COALESCE(wo.country,'') = c.country),
      'wo_total', (SELECT count(*) FROM work_orders wo WHERE wo.organisation_id = v_org AND COALESCE(wo.country,'') = c.country),
      'wo_linked', (SELECT count(*) FROM work_orders wo WHERE wo.organisation_id = v_org AND COALESCE(wo.country,'') = c.country
                     AND EXISTS (SELECT 1 FROM vehicle_fleet vf WHERE vf.organisation_id = v_org AND vf.asset_no = wo.asset_no AND COALESCE(vf.country,'') = c.country)),
      'tyres_linked', (SELECT count(*) FROM tyre_records tr WHERE tr.organisation_id = v_org AND COALESCE(tr.country,'') = c.country
                        AND EXISTS (SELECT 1 FROM vehicle_fleet vf WHERE vf.organisation_id = v_org AND vf.asset_no = tr.asset_no AND COALESCE(vf.country,'') = c.country)),
      'fleet', (SELECT count(*) FROM vehicle_fleet vf WHERE vf.organisation_id = v_org AND COALESCE(vf.country,'') = c.country)
    ) AS obj
    FROM (SELECT DISTINCT COALESCE(country,'') AS country FROM tyre_records WHERE organisation_id = v_org) c
  ) z;
  RETURN v;
END $function$;

REVOKE ALL ON FUNCTION public.recon_data_quality_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recon_data_quality_summary() TO authenticated;

-- Reversible:
-- DROP FUNCTION IF EXISTS public.recon_data_quality_summary();
