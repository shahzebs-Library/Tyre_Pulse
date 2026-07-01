-- ============================================================================
-- MIGRATIONS_V50_TYRE_CHANGE_RPC.sql
-- Phase 2 (data integrity): canonical audit writer + ATOMIC tyre-change RPC.
-- Additive, backward-compatible: the existing append-row flow (a bare
-- tyre_records insert) keeps working; this adds a single-transaction path so a
-- tyre change (close removed + fit replacement + audit) can never leave a
-- half-finished state.
--
-- SECURITY DEFINER + is_approved_and_unlocked() gate + org scope (mirrors
-- import_commit_batch). Mobile never chooses a table — apply_tyre_change hard-
-- codes tyre_records server-side.
--
-- NOTE: tyre_records.fitment_date is a GENERATED column (= issue_date) and must
-- NOT be inserted; the RPC sets issue_date only. (Verified against live schema;
-- an earlier draft that inserted fitment_date failed 428C9 and was corrected.)
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.apply_tyre_change(jsonb);
--   DROP FUNCTION IF EXISTS public.record_audit_event(text,text,text,jsonb,jsonb);
-- ============================================================================

-- 1) Canonical audit writer → exactly one audit_log_v2 row.
CREATE OR REPLACE FUNCTION public.record_audit_event(
  p_action text, p_table text, p_record_id text,
  p_old jsonb DEFAULT NULL, p_new jsonb DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_email text; v_site text; v_country text; v_id uuid;
BEGIN
  IF NOT public.is_approved_and_unlocked() THEN
    RAISE EXCEPTION 'Not authorised.' USING errcode = '42501'; END IF;
  IF p_action IS NULL OR btrim(p_action) = '' THEN
    RAISE EXCEPTION 'Audit action is required.' USING errcode = '22004'; END IF;
  SELECT p.email, p.site, (p.country)[1] INTO v_email, v_site, v_country
    FROM public.profiles p WHERE p.id = v_uid;   -- profiles.country is text[]; take primary
  INSERT INTO public.audit_log_v2
    (user_id, user_email, action, table_name, record_id, old_data, new_data, site, country)
  VALUES (v_uid, v_email, p_action, p_table, p_record_id, p_old, p_new, v_site, v_country)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $fn$;

-- 2) Atomic tyre change: close removed row + insert fitment + one audit event.
CREATE OR REPLACE FUNCTION public.apply_tyre_change(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_org uuid := public.app_current_org();
  v_removed_id uuid; v_removed public.tyre_records%ROWTYPE; v_new_id uuid;
  v_asset  text := NULLIF(btrim(p->>'asset_no'),'');
  v_position text := NULLIF(btrim(p->>'position'),'');
  v_site   text := NULLIF(btrim(p->>'site'),'');
  v_reason text := NULLIF(btrim(p->>'removal_reason'),'');
  v_rem_date date := COALESCE((p->>'removal_date')::date, current_date);
  v_issue_date date := COALESCE((p->>'issue_date')::date, (p->>'fitment_date')::date, current_date);
BEGIN
  IF NOT public.is_approved_and_unlocked() THEN
    RAISE EXCEPTION 'Not authorised.' USING errcode = '42501'; END IF;
  IF v_asset IS NULL THEN RAISE EXCEPTION 'asset_no is required.' USING errcode='22004'; END IF;
  IF v_position IS NULL THEN RAISE EXCEPTION 'position is required.' USING errcode='22004'; END IF;
  v_removed_id := NULLIF(p->>'removed_record_id','')::uuid;

  -- (1) close removed tyre (org-scoped; NULL org legacy allowed), row-locked.
  IF v_removed_id IS NOT NULL THEN
    SELECT * INTO v_removed FROM public.tyre_records WHERE id = v_removed_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Removed tyre record % not found.', v_removed_id USING errcode='P0002'; END IF;
    IF v_removed.organisation_id IS NOT NULL AND v_removed.organisation_id IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'Cross-organisation tyre change denied.' USING errcode='42501'; END IF;
    UPDATE public.tyre_records
      SET km_at_removal = COALESCE((p->>'km_at_removal')::numeric, km_at_removal),
          removal_date = v_rem_date,
          removal_reason = COALESCE(v_reason, removal_reason),
          status = 'Removed'
      WHERE id = v_removed_id;
  END IF;

  -- (2) insert replacement fitment (scope stamped server-side). fitment_date is
  -- generated from issue_date and is intentionally omitted.
  INSERT INTO public.tyre_records
    (asset_no, serial_no, brand, site, country, cost_per_tyre, qty,
     position, tyre_position, km_at_fitment, removal_reason,
     issue_date, status, risk_level, category, uploaded_by, organisation_id)
  VALUES
    (v_asset, NULLIF(btrim(p->>'serial_no'),''), NULLIF(btrim(p->>'brand'),''), v_site,
     NULLIF(btrim(p->>'country'),''), (p->>'cost_per_tyre')::numeric, COALESCE((p->>'qty')::int,1),
     v_position, v_position, (p->>'km_at_fitment')::numeric, v_reason,
     v_issue_date,
     COALESCE(NULLIF(btrim(p->>'status'),''),'Fitted'),
     COALESCE(NULLIF(btrim(p->>'risk_level'),''),'Low'),
     COALESCE(NULLIF(btrim(p->>'category'),''),'Tyre Change'),
     v_uid, v_org)
  RETURNING id INTO v_new_id;

  -- (3) one canonical audit event.
  PERFORM public.record_audit_event('tyre_change','tyre_records', v_new_id::text,
    CASE WHEN v_removed_id IS NULL THEN NULL ELSE jsonb_build_object(
      'removed_record_id', v_removed_id, 'asset_no', v_removed.asset_no,
      'serial_no', v_removed.serial_no, 'position', v_removed.position,
      'km_at_removal', COALESCE((p->>'km_at_removal')::numeric, v_removed.km_at_removal),
      'removal_reason', v_reason, 'status', 'Removed') END,
    jsonb_build_object('fitment_record_id', v_new_id, 'asset_no', v_asset,
      'serial_no', NULLIF(btrim(p->>'serial_no'),''), 'brand', NULLIF(btrim(p->>'brand'),''),
      'position', v_position, 'site', v_site, 'cost_per_tyre', (p->>'cost_per_tyre')::numeric,
      'km_at_fitment', (p->>'km_at_fitment')::numeric, 'fitment_date', v_issue_date));
  RETURN v_new_id;
END; $fn$;

REVOKE ALL ON FUNCTION public.record_audit_event(text,text,text,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_tyre_change(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_audit_event(text,text,text,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_tyre_change(jsonb) TO authenticated;
