-- V232 (+V235 strict override folded in): Data Reconciliation - detect + safely resolve
-- cross-place gaps and duplicates. All SECURITY DEFINER, org-scoped via app_current_org(),
-- gated to app_is_elevated(). Detection read-only; resolution guarded so a moved/re-inspected
-- tyre (any differing column) can NEVER be auto-deleted. A duplicate = EVERY column identical
-- (except id/created_at/updated_at). Applied live 2026-07-14.

-- Orphan assets: tyres whose asset is not in the fleet register.
CREATE OR REPLACE FUNCTION public.recon_orphan_assets()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.app_current_org(); v jsonb;
BEGIN
  IF NOT public.app_is_elevated() THEN RAISE EXCEPTION 'Not permitted.' USING errcode='42501'; END IF;
  SELECT COALESCE(jsonb_agg(row_obj ORDER BY row_obj->>'asset_no'),'[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object('asset_no', tr.asset_no,'vehicle_type', max(tr.vehicle_type),
             'country', max(tr.country),'tyre_count', count(*)) AS row_obj
    FROM tyre_records tr
    WHERE tr.organisation_id = v_org AND COALESCE(tr.asset_no,'') <> ''
      AND NOT EXISTS (SELECT 1 FROM vehicle_fleet vf WHERE vf.asset_no = tr.asset_no AND vf.organisation_id = v_org)
    GROUP BY tr.asset_no) z;
  RETURN v;
END $$;

-- Strict duplicates: rows fully identical except id/created_at/updated_at (V235).
CREATE OR REPLACE FUNCTION public.recon_duplicate_tyres()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.app_current_org(); v jsonb;
BEGIN
  IF NOT public.app_is_elevated() THEN RAISE EXCEPTION 'Not permitted.' USING errcode='42501'; END IF;
  SELECT COALESCE(jsonb_agg(row_obj ORDER BY row_obj->>'serial_no'),'[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object('serial_no', min(serial_no),'asset_no', min(asset_no),'row_count', count(*),
      'keep_id',(array_agg(id ORDER BY created_at DESC NULLS LAST))[1],
      'remove_ids',(array_agg(id ORDER BY created_at DESC NULLS LAST))[2:]) AS row_obj
    FROM (SELECT id, serial_no, asset_no, created_at,(to_jsonb(t)-'id'-'created_at'-'updated_at') AS body
          FROM tyre_records t WHERE organisation_id = v_org) s
    GROUP BY body HAVING count(*) > 1) z;
  RETURN v;
END $$;

-- Serial conflicts (same serial across different assets) = legitimate tyre movement history;
-- surfaced as INFORMATION only, never removed.
CREATE OR REPLACE FUNCTION public.recon_serial_conflicts()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.app_current_org(); v jsonb;
BEGIN
  IF NOT public.app_is_elevated() THEN RAISE EXCEPTION 'Not permitted.' USING errcode='42501'; END IF;
  SELECT COALESCE(jsonb_agg(row_obj ORDER BY row_obj->>'serial_no'),'[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object('serial_no', serial_no,'asset_count', count(DISTINCT asset_no),
      'rows', jsonb_agg(jsonb_build_object('id',id,'asset_no',asset_no,'status',status,'created_at',created_at) ORDER BY created_at)) AS row_obj
    FROM tyre_records WHERE organisation_id = v_org AND COALESCE(serial_no,'') <> ''
    GROUP BY serial_no HAVING count(DISTINCT asset_no) > 1) z;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.recon_backfill_asset(p_asset_no text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.app_current_org(); v_id uuid;
BEGIN
  IF NOT public.app_is_elevated() THEN RAISE EXCEPTION 'Not permitted.' USING errcode='42501'; END IF;
  IF COALESCE(p_asset_no,'') = '' THEN RAISE EXCEPTION 'asset_no required.'; END IF;
  SELECT id INTO v_id FROM vehicle_fleet WHERE asset_no = p_asset_no AND organisation_id = v_org LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO vehicle_fleet (asset_no, vehicle_type, country, organisation_id)
  SELECT p_asset_no, max(vehicle_type), max(country), v_org FROM tyre_records WHERE asset_no = p_asset_no AND organisation_id = v_org
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.recon_backfill_all_orphan_assets()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.app_current_org(); v_n integer := 0;
BEGIN
  IF NOT public.app_is_elevated() THEN RAISE EXCEPTION 'Not permitted.' USING errcode='42501'; END IF;
  WITH ins AS (
    INSERT INTO vehicle_fleet (asset_no, vehicle_type, country, organisation_id)
    SELECT tr.asset_no, max(tr.vehicle_type), max(tr.country), v_org FROM tyre_records tr
     WHERE tr.organisation_id = v_org AND COALESCE(tr.asset_no,'') <> ''
       AND NOT EXISTS (SELECT 1 FROM vehicle_fleet vf WHERE vf.asset_no = tr.asset_no AND vf.organisation_id = v_org)
     GROUP BY tr.asset_no RETURNING 1)
  SELECT count(*) INTO v_n FROM ins;
  RETURN v_n;
END $$;

-- Merge ONLY byte-identical duplicates (V235 strict guard).
CREATE OR REPLACE FUNCTION public.recon_merge_duplicate(p_keep_id uuid, p_remove_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.app_current_org(); v_body jsonb; v_n integer := 0;
BEGIN
  IF NOT public.app_is_elevated() THEN RAISE EXCEPTION 'Not permitted.' USING errcode='42501'; END IF;
  IF p_keep_id IS NULL OR p_remove_ids IS NULL OR array_length(p_remove_ids,1) IS NULL THEN RETURN 0; END IF;
  SELECT (to_jsonb(t)-'id'-'created_at'-'updated_at') INTO v_body FROM tyre_records t WHERE id = p_keep_id AND organisation_id = v_org;
  IF v_body IS NULL THEN RAISE EXCEPTION 'Keep row not found in your organisation.'; END IF;
  IF EXISTS (SELECT 1 FROM tyre_records t WHERE t.id = ANY(p_remove_ids)
       AND (t.organisation_id <> v_org OR (to_jsonb(t)-'id'-'created_at'-'updated_at') IS DISTINCT FROM v_body)) THEN
    RAISE EXCEPTION 'Refused: a selected row is not identical to the kept row (not a true duplicate).' USING errcode='42501';
  END IF;
  DELETE FROM tyre_records WHERE id = ANY(p_remove_ids) AND id <> p_keep_id AND organisation_id = v_org;
  GET DIAGNOSTICS v_n = ROW_COUNT; RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.recon_orphan_assets(), public.recon_duplicate_tyres(), public.recon_serial_conflicts(),
  public.recon_backfill_asset(text), public.recon_backfill_all_orphan_assets(), public.recon_merge_duplicate(uuid, uuid[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.recon_orphan_assets(), public.recon_duplicate_tyres(), public.recon_serial_conflicts(),
  public.recon_backfill_asset(text), public.recon_backfill_all_orphan_assets(), public.recon_merge_duplicate(uuid, uuid[]) TO authenticated;
