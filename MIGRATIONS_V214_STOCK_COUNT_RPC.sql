-- ============================================================================
-- MIGRATIONS_V214 — Daily stock-take: set_stock_count() RPC
-- ============================================================================
-- Adds an ABSOLUTE stock-take primitive alongside the existing delta-based
-- post_stock_movement() (V-earlier). A daily physical count sets the exact
-- number on hand; this computes the change against the live balance server-side
-- (race-safe, FOR UPDATE), records it in the stock_movements ledger as a
-- 'stocktake', recomputes status, and audits — the same guards as
-- post_stock_movement so mobile daily counts and web edits stay consistent and
-- fully audited (no blind client-side stock writes).
--
-- Authorisation mirrors post_stock_movement: any approved + unlocked org member
-- may count (RLS/org checked inside). Idempotent (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_stock_count(
  p_stock_id uuid,
  p_count    numeric,
  p_reason   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid := public.app_current_org();
  v_rec public.stock_records%ROWTYPE;
  v_before numeric; v_change numeric; v_after numeric; v_status text; v_mov_id uuid;
BEGIN
  IF NOT public.is_approved_and_unlocked() THEN
    RAISE EXCEPTION 'Not authorised.' USING errcode = '42501';
  END IF;
  IF p_stock_id IS NULL THEN
    RAISE EXCEPTION 'stock_id is required.' USING errcode = '22004';
  END IF;
  IF p_count IS NULL OR p_count < 0 THEN
    RAISE EXCEPTION 'Count must be zero or positive (got %).', p_count USING errcode = '22023';
  END IF;

  SELECT * INTO v_rec FROM public.stock_records WHERE id = p_stock_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock record % not found.', p_stock_id USING errcode = 'P0002';
  END IF;
  IF v_rec.organisation_id IS NOT NULL AND v_rec.organisation_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'Cross-organisation stock update denied.' USING errcode = '42501';
  END IF;

  v_before := COALESCE(v_rec.stock_qty, 0);
  v_after  := floor(p_count);
  v_change := v_after - v_before;

  v_status := CASE
    WHEN v_after <= COALESCE(v_rec.critical_level, 0) THEN 'Critical'
    WHEN v_after <= COALESCE(v_rec.min_level, 0)      THEN 'Low'
    ELSE 'OK' END;

  -- Only record a ledger movement when the count actually changes the balance.
  IF v_change <> 0 THEN
    INSERT INTO public.stock_movements
      (stock_id, site, description, movement_type, qty_before, qty_change, qty_after,
       reason, reference_no, created_by, organisation_id)
    VALUES
      (p_stock_id, v_rec.site, v_rec.description, 'stocktake', v_before, v_change, v_after,
       NULLIF(btrim(p_reason), ''), NULL, v_uid, COALESCE(v_rec.organisation_id, v_org))
    RETURNING id INTO v_mov_id;
  END IF;

  UPDATE public.stock_records
     SET stock_qty = v_after, stock_status = v_status, updated_by = v_uid, updated_at = now()
   WHERE id = p_stock_id;

  PERFORM public.record_audit_event('stock_count', 'stock_records', p_stock_id::text,
    jsonb_build_object('qty_before', v_before),
    jsonb_build_object('movement_type', 'stocktake', 'qty_change', v_change,
      'qty_after', v_after, 'stock_status', v_status, 'reason', NULLIF(btrim(p_reason), '')));

  RETURN jsonb_build_object('status', 'counted', 'movement_id', v_mov_id, 'stock_id', p_stock_id,
    'qty_before', v_before, 'qty_change', v_change, 'qty_after', v_after, 'stock_status', v_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_stock_count(uuid, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_stock_count(uuid, numeric, text) TO authenticated, service_role;

-- Reversible:
--   DROP FUNCTION IF EXISTS public.set_stock_count(uuid, numeric, text);
