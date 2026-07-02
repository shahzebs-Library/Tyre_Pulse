-- ============================================================================
-- tests/rpc_stock_movement.sql - self-asserting test for MIGRATIONS_V52.
--
-- Proves post_stock_movement() is one atomic, guarded, audited transaction:
--   receipt/issue update stock_qty by the signed magnitude; the ledger row math
--   (qty_before/qty_change/qty_after) is correct; a movement that would drive the
--   balance negative is blocked (nothing mutated); an unknown movement_type is
--   rejected; and each successful movement writes exactly one 'stock_movement'
--   audit_log_v2 row. RAISEs 'PASS_ROLLBACK' at the end so no test data remains.
--   Verified green against the live schema.
-- ============================================================================

DO $$
DECLARE
  uid uuid := '1bf85bfd-ef76-48cc-a8b1-aac1ea511bf4';  -- approved+unlocked profile
  org uuid := '00000000-0000-0000-0000-000000000001';
  sid uuid; res jsonb; r public.stock_records%ROWTYPE; n int; bal numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
  INSERT INTO public.stock_records (site, description, stock_qty, min_level, critical_level, organisation_id)
    VALUES ('TestSite','Test Tyre 11R22.5', 10, 5, 2, org) RETURNING id INTO sid;

  -- receipt +7 -> 17
  res := public.post_stock_movement(sid, 'receipt', 7, 'GRN-1', 'PO-1');
  IF (res->>'qty_after')::numeric <> 17 OR (res->>'qty_change')::numeric <> 7 THEN RAISE EXCEPTION 'FAIL receipt %', res; END IF;
  SELECT * INTO r FROM public.stock_records WHERE id = sid;
  IF r.stock_qty <> 17 THEN RAISE EXCEPTION 'FAIL receipt balance %', r.stock_qty; END IF;

  -- issue 4 -> 13
  res := public.post_stock_movement(sid, 'issue', 4, 'WO-9', null);
  IF (res->>'qty_after')::numeric <> 13 OR (res->>'qty_change')::numeric <> -4 OR (res->>'stock_status') <> 'OK' THEN RAISE EXCEPTION 'FAIL issue %', res; END IF;
  SELECT * INTO r FROM public.stock_records WHERE id = sid;
  IF r.stock_qty <> 13 THEN RAISE EXCEPTION 'FAIL issue balance %', r.stock_qty; END IF;

  -- reconciliation: ledger sum of movements = 7 + (-4) = 3
  bal := public.current_stock_balance(sid);
  IF bal <> 3 THEN RAISE EXCEPTION 'FAIL ledger sum %', bal; END IF;

  SELECT count(*) INTO n FROM public.stock_movements WHERE stock_id = sid;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL movement count %', n; END IF;

  -- negative guard: issue 999 blocked; nothing mutates
  BEGIN
    res := public.post_stock_movement(sid, 'issue', 999, 'over', null);
    RAISE EXCEPTION 'FAIL negative guard did not block';
  EXCEPTION WHEN check_violation THEN NULL; END;
  SELECT * INTO r FROM public.stock_records WHERE id = sid;
  SELECT count(*) INTO n FROM public.stock_movements WHERE stock_id = sid;
  IF r.stock_qty <> 13 OR n <> 2 THEN RAISE EXCEPTION 'FAIL negative guard mutated qty=% n=%', r.stock_qty, n; END IF;

  -- unknown type rejected (22023)
  BEGIN
    res := public.post_stock_movement(sid, 'teleport', 1, null, null);
    RAISE EXCEPTION 'FAIL unknown type not rejected';
  EXCEPTION WHEN others THEN IF SQLSTATE <> '22023' THEN RAISE; END IF; END;

  -- audit: exactly 2 stock_movement events
  SELECT count(*) INTO n FROM public.audit_log_v2 WHERE action='stock_movement'
    AND record_id IN (SELECT id::text FROM public.stock_movements WHERE stock_id = sid);
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL audit count %', n; END IF;

  RAISE EXCEPTION 'PASS_ROLLBACK: post_stock_movement ledger+balance+guard+audit atomic ✓';
END $$;
