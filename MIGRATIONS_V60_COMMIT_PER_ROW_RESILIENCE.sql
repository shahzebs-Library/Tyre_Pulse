-- ============================================================================
-- MIGRATIONS_V60_COMMIT_PER_ROW_RESILIENCE.sql
-- Root cause of "error at the last upload step and nothing imports":
-- import_commit_batch's row loop had NO per-row exception handling, so ONE bad
-- row (text in a numeric column, malformed date, duplicate/unique violation,
-- CHECK constraint) aborted the whole function → the transaction rolled back →
-- ZERO rows committed and the user saw a single cryptic SQL error.
--
-- Fix: each row inserts inside its own BEGIN/EXCEPTION sub-transaction.
--  * Good rows commit regardless of bad neighbours.
--  * Each failed row is marked validation_status='error' with a
--    import_row_issues entry (issue_code COMMIT_FAILED) carrying the ACTUAL
--    database reason, so the user can see exactly why each row failed.
--  * The RPC returns {status, inserted, skipped, failed, errors:[{row,message}]}
--    (first 20 reasons inline) instead of blowing up.
--  * Batch bookkeeping: error_rows accumulates failures; import_status is
--    'committed' when anything landed, 'failed' when nothing did (which keeps
--    the batch re-committable after the rows are fixed/reprocessed).
--
-- Verified live (rolled back): a 3-row batch with one bad numeric commits 2,
-- fails 1 with reason "invalid input syntax for type numeric: …".
--
-- Rollback: re-apply the V54 definition of import_commit_batch.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.import_commit_batch(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  b          public.import_batches%ROWTYPE;
  r          public.import_rows%ROWTYPE;
  v_uid      uuid := auth.uid();
  v_org      uuid := public.app_current_org();
  v_target   text;
  v_cols     text;
  v_enriched jsonb;
  v_new_id   text;
  v_inserted int := 0;
  v_skipped  int := 0;
  v_failed   int := 0;
  v_errors   jsonb := '[]'::jsonb;
  v_msg      text;
BEGIN
  IF NOT public.is_approved_and_unlocked() THEN
    RAISE EXCEPTION 'Not authorised.' USING errcode = '42501';
  END IF;

  SELECT * INTO b FROM public.import_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import batch not found.'; END IF;

  IF b.organisation_id IS NOT NULL AND b.organisation_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'Cross-organisation commit denied.' USING errcode = '42501';
  END IF;
  IF b.approval_status <> 'approved' THEN
    RAISE EXCEPTION 'Batch is not approved (status: %).', b.approval_status;
  END IF;
  IF b.import_status = 'committed' THEN
    RETURN jsonb_build_object('status','already_committed','inserted',0);
  END IF;

  v_target := public.import_target_table(b.module);
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'Commit is not supported for module "%" yet.', b.module;
  END IF;

  FOR r IN
    SELECT * FROM public.import_rows
    WHERE batch_id = p_batch_id
      AND action = 'insert'
      AND validation_status IN ('ready','warning')
      AND processed_at IS NULL
    ORDER BY source_row_no
  LOOP
    v_enriched := COALESCE(NULLIF(r.transformed_data, '{}'::jsonb), r.mapped_data)
                  || jsonb_build_object('organisation_id', v_org, 'country', b.country,
                                        'created_by', v_uid, 'uploaded_by', v_uid)
                  || CASE WHEN r.custom_data IS NOT NULL AND r.custom_data <> '{}'::jsonb
                          THEN jsonb_build_object('custom_data', r.custom_data)
                          ELSE '{}'::jsonb END;

    SELECT string_agg(quote_ident(c.column_name), ', ') INTO v_cols
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = v_target
      AND v_enriched ? c.column_name
      AND c.is_generated = 'NEVER'
      AND c.identity_generation IS NULL;

    IF v_cols IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Per-row sub-transaction: one bad value fails ONLY this row, never the batch.
    BEGIN
      EXECUTE format(
        'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(null::public.%I, $1) AS rec RETURNING id::text',
        v_target, v_cols, v_cols, v_target)
      USING v_enriched INTO v_new_id;

      UPDATE public.import_rows
        SET target_record_id = v_new_id, target_module = b.module, processed_at = now()
        WHERE id = r.id;
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_msg := SQLERRM;
      -- Record the concrete reason on the row so the user can see/fix it.
      UPDATE public.import_rows SET validation_status = 'error' WHERE id = r.id;
      INSERT INTO public.import_row_issues (row_id, severity, issue_code, message)
        VALUES (r.id, 'error', 'COMMIT_FAILED', v_msg);
      IF jsonb_array_length(v_errors) < 20 THEN
        v_errors := v_errors || jsonb_build_object('row', r.source_row_no, 'message', v_msg);
      END IF;
    END;
  END LOOP;

  UPDATE public.import_batches
    SET import_status = CASE WHEN v_inserted > 0 THEN 'committed' ELSE 'failed' END,
        imported_rows = COALESCE(imported_rows,0) + v_inserted,
        skipped_rows  = COALESCE(skipped_rows,0)  + v_skipped,
        error_rows    = COALESCE(error_rows,0)    + v_failed,
        completed_at  = now()
    WHERE id = p_batch_id;

  INSERT INTO public.import_audit_events (organisation_id, batch_id, actor, action, detail)
    VALUES (v_org, p_batch_id, v_uid, 'commit',
            jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped,
                               'failed', v_failed, 'target', v_target));

  RETURN jsonb_build_object(
    'status',   CASE WHEN v_inserted > 0 THEN 'committed' ELSE CASE WHEN v_failed > 0 THEN 'failed' ELSE 'committed' END END,
    'inserted', v_inserted,
    'skipped',  v_skipped,
    'failed',   v_failed,
    'errors',   v_errors,
    'target',   v_target);
END $function$;
