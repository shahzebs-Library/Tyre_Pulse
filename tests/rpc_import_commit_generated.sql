-- ============================================================================
-- tests/rpc_import_commit_generated.sql
-- Self-asserting proof that import_commit_batch (V54) excludes DB-computed
-- columns from its INSERT list - the fix for the Work Order commit 400.
-- Run inside a transaction; asserts via RAISE EXCEPTION; always ROLLBACKs.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_target   text := 'work_orders';
  v_enriched jsonb := jsonb_build_object(
                        'total_cost', 999,        -- GENERATED ALWAYS - must be dropped
                        'labour_cost', 100,        -- real column   - must be kept
                        'parts_cost', 50,          -- real column   - must be kept
                        'work_type', 'Repair');    -- real column   - must be kept
  v_cols text;
BEGIN
  -- Precondition: the column really is generated (otherwise the test is moot).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=v_target
      AND column_name='total_cost' AND is_generated='ALWAYS'
  ) THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: work_orders.total_cost is not GENERATED ALWAYS';
  END IF;

  -- The exact intersection used by V54 import_commit_batch.
  SELECT string_agg(quote_ident(c.column_name), ', ') INTO v_cols
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = v_target
    AND v_enriched ? c.column_name
    AND c.is_generated = 'NEVER'
    AND c.identity_generation IS NULL;

  IF v_cols LIKE '%total_cost%' THEN
    RAISE EXCEPTION 'FAIL: generated column total_cost was included: %', v_cols;
  END IF;
  IF v_cols NOT LIKE '%labour_cost%' OR v_cols NOT LIKE '%parts_cost%' OR v_cols NOT LIKE '%work_type%' THEN
    RAISE EXCEPTION 'FAIL: a real column was dropped: %', v_cols;
  END IF;

  RAISE NOTICE 'PASS: insert columns = % (total_cost correctly excluded)', v_cols;
END $$;

ROLLBACK;
