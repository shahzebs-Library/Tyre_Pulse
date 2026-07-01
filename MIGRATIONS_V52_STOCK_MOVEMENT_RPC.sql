-- ============================================================================
-- MIGRATIONS_V52_STOCK_MOVEMENT_RPC.sql
-- Atomic stock-movement ledger RPC + balance reconciliation.
--
-- The stock_movements ledger table existed but was written by the browser in two
-- separate client-computed statements (insert movement THEN update stock_qty) —
-- racy, unaudited, client-trusted math, could drive a balance negative. This
-- replaces that path with ONE SECURITY DEFINER transaction: row-locked,
-- permission-checked, org-scoped, negative-guarded, audited via record_audit_event.
--
-- Backward-compatible / additive. stock_records.stock_qty stays the value screens
-- read. The movement_type CHECK is EXTENDED (not replaced) to accept the canonical
-- vocabulary in addition to the legacy values already stored.
--
-- Verified green against the live schema (self-asserting tests/rpc_stock_movement.sql).
-- NOTE vs first draft: (a) the live CHECK constraint restricted movement_type to
-- legacy values — extended here or the RPC insert fails; (b) the reconciliation
-- view is named v_stock_balance_reconcile to avoid colliding with the
-- current_stock_balance(uuid) function.
--
-- Depends on: is_approved_and_unlocked(), app_is_elevated(), app_current_org(),
--   record_audit_event() (V50), tables stock_records + stock_movements.
--
-- Rollback:
--   DROP VIEW IF EXISTS public.v_stock_balance_reconcile;
--   DROP FUNCTION IF EXISTS public.current_stock_balance(uuid);
--   DROP FUNCTION IF EXISTS public.post_stock_movement(uuid, text, numeric, text, text);
--   DROP FUNCTION IF EXISTS public.stock_movement_direction(text);
--   -- (restore the original legacy-only movement_type CHECK if desired)
-- ============================================================================

-- 0. Extend the movement_type CHECK to accept canonical values (keeps legacy).
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type = ANY (ARRAY[
    'In','Out','Adjustment','Initial','Reorder','Scrap',
    'receipt','return','transfer_in','adjustment_up',
    'issue','transfer_out','scrap','adjustment_down'
  ]));

-- 1. Direction map: +1 add / -1 subtract / NULL unknown (canonical + legacy aliases).
CREATE OR REPLACE FUNCTION public.stock_movement_direction(p_type text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(btrim(p_type))
    WHEN 'receipt' THEN 1 WHEN 'return' THEN 1 WHEN 'transfer_in' THEN 1 WHEN 'adjustment_up' THEN 1
    WHEN 'in' THEN 1 WHEN 'reorder' THEN 1 WHEN 'initial' THEN 1
    WHEN 'issue' THEN -1 WHEN 'transfer_out' THEN -1 WHEN 'scrap' THEN -1 WHEN 'adjustment_down' THEN -1
    WHEN 'out' THEN -1
    ELSE NULL END;
$$;

-- 2. Atomic ledger post.
CREATE OR REPLACE FUNCTION public.post_stock_movement(
  p_stock_id uuid, p_type text, p_qty numeric, p_reason text DEFAULT NULL, p_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_org uuid := public.app_current_org();
  v_rec public.stock_records%ROWTYPE; v_dir int; v_type text := lower(btrim(p_type));
  v_qty numeric := p_qty; v_before numeric; v_change numeric; v_after numeric; v_status text; v_mov_id uuid;
BEGIN
  IF NOT public.is_approved_and_unlocked() THEN RAISE EXCEPTION 'Not authorised.' USING errcode='42501'; END IF;
  IF p_stock_id IS NULL THEN RAISE EXCEPTION 'stock_id is required.' USING errcode='22004'; END IF;
  v_dir := public.stock_movement_direction(v_type);
  IF v_dir IS NULL THEN RAISE EXCEPTION 'Unknown movement_type "%".', p_type USING errcode='22023'; END IF;
  IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be a positive magnitude (got %).', p_qty USING errcode='22023'; END IF;

  SELECT * INTO v_rec FROM public.stock_records WHERE id = p_stock_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stock record % not found.', p_stock_id USING errcode='P0002'; END IF;
  IF v_rec.organisation_id IS NOT NULL AND v_rec.organisation_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'Cross-organisation stock movement denied.' USING errcode='42501'; END IF;

  v_before := COALESCE(v_rec.stock_qty, 0);
  v_change := v_dir * v_qty;
  v_after  := v_before + v_change;
  IF v_after < 0 THEN
    IF NOT (v_type = 'adjustment_down' AND public.app_is_elevated()) THEN
      RAISE EXCEPTION 'Movement would drive stock negative (before=%, change=%, after=%). Only an elevated adjustment_down may override.',
        v_before, v_change, v_after USING errcode='23514';
    END IF;
  END IF;

  INSERT INTO public.stock_movements
    (stock_id, site, description, movement_type, qty_before, qty_change, qty_after, reason, reference_no, created_by, organisation_id)
  VALUES
    (p_stock_id, v_rec.site, v_rec.description, v_type, v_before, v_change, v_after,
     NULLIF(btrim(p_reason),''), NULLIF(btrim(p_reference),''), v_uid, COALESCE(v_rec.organisation_id, v_org))
  RETURNING id INTO v_mov_id;

  v_status := CASE
    WHEN v_after <= COALESCE(v_rec.critical_level, 0) THEN 'Critical'
    WHEN v_after <= COALESCE(v_rec.min_level, 0)      THEN 'Low'
    ELSE 'OK' END;

  UPDATE public.stock_records
    SET stock_qty = v_after, stock_status = v_status, updated_by = v_uid, updated_at = now()
    WHERE id = p_stock_id;

  PERFORM public.record_audit_event('stock_movement','stock_movements', v_mov_id::text,
    jsonb_build_object('stock_id', p_stock_id, 'qty_before', v_before),
    jsonb_build_object('stock_id', p_stock_id, 'movement_type', v_type, 'qty_change', v_change,
      'qty_after', v_after, 'stock_status', v_status,
      'reason', NULLIF(btrim(p_reason),''), 'reference_no', NULLIF(btrim(p_reference),'')));

  RETURN jsonb_build_object('status','posted','movement_id',v_mov_id,'stock_id',p_stock_id,
    'qty_before',v_before,'qty_change',v_change,'qty_after',v_after,'stock_status',v_status);
END; $fn$;

-- 3. Ledger-derived balance (reconciliation).
CREATE OR REPLACE FUNCTION public.current_stock_balance(p_stock_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(m.qty_change), 0)
  FROM public.stock_movements m
  WHERE m.stock_id = p_stock_id
    AND (m.organisation_id IS NULL OR m.organisation_id = public.app_current_org());
$$;

CREATE OR REPLACE VIEW public.v_stock_balance_reconcile
WITH (security_invoker = true) AS
SELECT s.id AS stock_id, s.site, s.description, s.organisation_id,
  s.stock_qty AS recorded_qty,
  COALESCE(l.ledger_qty, 0) AS ledger_qty,
  s.stock_qty - COALESCE(l.ledger_qty, 0) AS drift,
  (s.stock_qty <> COALESCE(l.ledger_qty, 0)) AS has_drift
FROM public.stock_records s
LEFT JOIN (SELECT stock_id, SUM(qty_change) AS ledger_qty FROM public.stock_movements GROUP BY stock_id) l
  ON l.stock_id = s.id;

-- 4. Grants.
REVOKE ALL ON FUNCTION public.stock_movement_direction(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_stock_movement(uuid, text, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_stock_balance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stock_movement_direction(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_stock_movement(uuid, text, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_stock_balance(uuid) TO authenticated;
GRANT SELECT ON public.v_stock_balance_reconcile TO authenticated;
