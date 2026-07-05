-- ============================================================================
-- V93 — CHUNKED COMMIT & ENRICH FOR 50K+ ROW IMPORTS
-- ----------------------------------------------------------------------------
-- Problem: import_commit_batch / import_enrich_batch process every pending row
-- in ONE statement. V83 raised the RPC timeout to 120s, which covers a few
-- thousand rows — but 50,000+ row ERP exports still blow past it.
--
-- Fix: both RPCs now accept an optional chunk size and the client loops:
--   • import_commit_batch(p_batch_id, p_max_rows) — commits at most p_max_rows
--     pending rows per call, returns {status:'partial', remaining:N} until the
--     batch is drained. Batch shows import_status='committing' between chunks
--     (already a documented state in src/lib/import/reconcile.js).
--   • import_enrich_batch(p_batch_id, p_max_rows, p_after_id) — keyset-paged
--     by row id (unique, stable) so skipped/no-match rows are never rescanned
--     within a run, while a FRESH run still retries them (e.g. after creating
--     missing vehicles via the Data Link panel).
--
-- Also in this migration (required for safe chunking + big-batch speed):
--   • Rows whose mapped columns match nothing on the target table are now
--     marked processed with a COMMIT_SKIPPED warning issue (previously they
--     stayed pending forever — harmless in one-shot mode, an infinite loop in
--     chunked mode).
--   • The per-row information_schema lookup is hoisted out of the loop (one
--     column-list fetch per call instead of one per row) — a large constant-
--     factor win on 50k-row batches.
--   • Final batch status considers rows imported by EARLIER chunks, so a last
--     chunk of pure merges/skips no longer flips a successful batch to
--     'failed'.
--
-- Backward compatible: both functions keep working when called with only
-- p_batch_id (defaults = old single-shot behaviour, plus the skip fix).
-- Old single-argument signatures are dropped to avoid PostgREST overload
-- ambiguity.
-- ============================================================================

DROP FUNCTION IF EXISTS public.import_commit_batch(uuid);

CREATE OR REPLACE FUNCTION public.import_commit_batch(p_batch_id uuid, p_max_rows integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $function$
DECLARE
  b          public.import_batches%ROWTYPE;
  r          public.import_rows%ROWTYPE;
  v_uid      uuid := auth.uid();
  v_org      uuid := public.app_current_org();
  v_target   text;
  v_tcols    text[];
  v_cols     text;
  v_enriched jsonb;
  v_data     jsonb;
  v_custom   jsonb;
  v_new_id   text;
  v_inserted int := 0;
  v_skipped  int := 0;
  v_failed   int := 0;
  v_merged   int := 0;
  v_errors   jsonb := '[]'::jsonb;
  v_msg      text;

  -- Chunking (V93)
  v_limit     int := CASE WHEN p_max_rows IS NULL OR p_max_rows <= 0
                          THEN NULL ELSE LEAST(p_max_rows, 10000) END;
  v_remaining int := 0;
  v_total_ins int := 0;

  v_cost_fields text[];
  v_merge_on    boolean := false;
  v_override_tx jsonb := '{}'::jsonb;
  v_override_cd jsonb := '{}'::jsonb;
  v_absorbed    uuid[] := ARRAY[]::uuid[];
  v_children    jsonb := '{}'::jsonb;

  grp          record;
  mem          record;
  v_kv         record;
  v_primary_id uuid;
  v_primary_d  jsonb;
  v_primary_c  jsonb;
  v_best       int;
  v_score      int;
  v_merged_d   jsonb;
  v_merged_c   jsonb;
  v_lines      jsonb;
  v_count      int;
  v_child_ids  jsonb;
BEGIN
  IF NOT public.is_approved_and_unlocked() THEN
    RAISE EXCEPTION 'Not authorised.' USING errcode = '42501';
  END IF;

  SELECT * INTO b FROM public.import_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import batch not found.'; END IF;

  IF b.organisation_id IS NOT NULL AND b.organisation_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'Cross-organisation commit denied.' USING errcode = '42501';
  END IF;
  IF NOT public.import_user_can_commit_country(b.country) THEN
    RAISE EXCEPTION 'Cross-country commit denied: you are not assigned to country %.', b.country USING errcode = '42501';
  END IF;
  IF b.approval_status <> 'approved' THEN
    RAISE EXCEPTION 'Batch is not approved (status: %).', b.approval_status;
  END IF;
  IF b.import_status = 'committed' THEN
    RETURN jsonb_build_object('status','already_committed','inserted',0,'remaining',0);
  END IF;

  v_target := public.import_target_table(b.module);
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'Commit is not supported for module "%" yet.', b.module;
  END IF;

  v_cost_fields := public.import_cost_fields(b.module);
  v_merge_on    := v_cost_fields IS NOT NULL;

  -- ── Cross-file merge pre-pass (V-earlier, unchanged): group pending rows by
  --    natural key, pick the best-cost primary, absorb the rest as children.
  --    Recomputed each chunk over the still-pending rows only, so it shrinks
  --    as the batch drains.
  IF v_merge_on THEN
    FOR grp IN
      SELECT s.nk, array_agg(s.id ORDER BY s.source_row_no, s.id) AS ids
      FROM (
        SELECT ir.id, ir.source_row_no,
               public.import_merge_key(
                 b.module,
                 COALESCE(NULLIF(ir.transformed_data, '{}'::jsonb), ir.mapped_data)
               ) AS nk
        FROM public.import_rows ir
        WHERE ir.batch_id = p_batch_id
          AND ir.action = 'insert'
          AND ir.validation_status IN ('ready','warning')
          AND ir.processed_at IS NULL
      ) s
      WHERE s.nk IS NOT NULL
      GROUP BY s.nk
      HAVING count(*) > 1
    LOOP
      v_primary_id := NULL;
      v_best       := -1;
      v_lines      := '[]'::jsonb;
      v_count      := 0;
      FOR mem IN
        SELECT ir.id, ir.source_row_no,
               COALESCE(NULLIF(ir.transformed_data, '{}'::jsonb), ir.mapped_data) AS d,
               COALESCE(ir.custom_data, '{}'::jsonb) AS c,
               COALESCE(ir.raw_source_data, '{}'::jsonb) AS raw
        FROM public.import_rows ir
        WHERE ir.id = ANY(grp.ids)
        ORDER BY ir.source_row_no, ir.id
      LOOP
        v_count := v_count + 1;
        IF jsonb_typeof(mem.c -> 'line_items') = 'array'
           AND jsonb_array_length(mem.c -> 'line_items') > 0 THEN
          v_lines := v_lines || (mem.c -> 'line_items');
        ELSE
          v_lines := v_lines || jsonb_build_array(mem.raw);
        END IF;

        v_score := public.import_cost_score(b.module, mem.d);
        IF v_score > v_best THEN
          v_best       := v_score;
          v_primary_id := mem.id;
          v_primary_d  := mem.d;
          v_primary_c  := mem.c;
        END IF;
      END LOOP;

      v_merged_d  := v_primary_d;
      v_merged_c  := v_primary_c;
      v_child_ids := '[]'::jsonb;
      FOR mem IN
        SELECT ir.id,
               COALESCE(NULLIF(ir.transformed_data, '{}'::jsonb), ir.mapped_data) AS d,
               COALESCE(ir.custom_data, '{}'::jsonb) AS c
        FROM public.import_rows ir
        WHERE ir.id = ANY(grp.ids) AND ir.id <> v_primary_id
        ORDER BY ir.source_row_no, ir.id
      LOOP
        FOR v_kv IN SELECT key, value FROM jsonb_each(mem.d) LOOP
          IF v_kv.key = ANY(v_cost_fields) THEN CONTINUE; END IF;
          IF public.import_jsonb_blank(v_merged_d -> v_kv.key)
             AND NOT public.import_jsonb_blank(v_kv.value) THEN
            v_merged_d := jsonb_set(v_merged_d, ARRAY[v_kv.key], v_kv.value, true);
          END IF;
        END LOOP;

        FOR v_kv IN SELECT key, value FROM jsonb_each(mem.c) LOOP
          IF v_kv.key = ANY(v_cost_fields) THEN CONTINUE; END IF;
          IF v_kv.key IN ('line_items','line_count','merged_row_count','cross_file_merged') THEN
            CONTINUE;
          END IF;
          IF public.import_jsonb_blank(v_merged_c -> v_kv.key)
             AND NOT public.import_jsonb_blank(v_kv.value) THEN
            v_merged_c := jsonb_set(v_merged_c, ARRAY[v_kv.key], v_kv.value, true);
          END IF;
        END LOOP;

        v_child_ids := v_child_ids || to_jsonb(mem.id::text);
        v_absorbed  := v_absorbed || mem.id;
      END LOOP;

      v_merged_c := v_merged_c || jsonb_build_object(
                      'line_items',       v_lines,
                      'line_count',       jsonb_array_length(v_lines),
                      'merged_row_count', v_count,
                      'cross_file_merged', true);

      v_override_tx := jsonb_set(v_override_tx, ARRAY[v_primary_id::text], v_merged_d, true);
      v_override_cd := jsonb_set(v_override_cd, ARRAY[v_primary_id::text], v_merged_c, true);
      v_children    := jsonb_set(v_children,    ARRAY[v_primary_id::text], v_child_ids, true);
    END LOOP;
  END IF;

  -- One column-list lookup per call (was per row — dominant cost on big files).
  SELECT array_agg(c.column_name::text) INTO v_tcols
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = v_target
    AND c.is_generated = 'NEVER'
    AND c.identity_generation IS NULL;

  FOR r IN
    SELECT * FROM public.import_rows
    WHERE batch_id = p_batch_id
      AND action = 'insert'
      AND validation_status IN ('ready','warning')
      AND processed_at IS NULL
      AND id <> ALL(v_absorbed)
    ORDER BY source_row_no, id
    LIMIT v_limit          -- NULL ⇒ no limit (legacy single-shot behaviour)
  LOOP
    IF v_override_tx ? r.id::text THEN
      v_data   := v_override_tx -> r.id::text;
      v_custom := v_override_cd -> r.id::text;
    ELSE
      v_data   := COALESCE(NULLIF(r.transformed_data, '{}'::jsonb), r.mapped_data);
      v_custom := r.custom_data;
    END IF;

    v_enriched := v_data
                  || jsonb_build_object('organisation_id', v_org, 'country', b.country,
                                        'created_by', v_uid, 'uploaded_by', v_uid)
                  || CASE WHEN v_custom IS NOT NULL AND v_custom <> '{}'::jsonb
                          THEN jsonb_build_object('custom_data', v_custom)
                          ELSE '{}'::jsonb END;

    SELECT string_agg(quote_ident(k), ', ') INTO v_cols
    FROM jsonb_object_keys(v_enriched) k
    WHERE k = ANY(v_tcols);

    IF v_cols IS NULL THEN
      -- Nothing maps to the target table: mark processed so chunked commits
      -- can't rescan this row forever, and leave a visible audit trail.
      v_skipped := v_skipped + 1;
      UPDATE public.import_rows
        SET target_module = b.module, processed_at = now()
        WHERE id = r.id;
      INSERT INTO public.import_row_issues (row_id, severity, issue_code, message)
        VALUES (r.id, 'warning', 'COMMIT_SKIPPED',
                'No mapped column matches the target table; row was not imported.');
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format(
        'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(null::public.%I, $1) AS rec RETURNING id::text',
        v_target, v_cols, v_cols, v_target)
      USING v_enriched INTO v_new_id;

      UPDATE public.import_rows
        SET target_record_id = v_new_id, target_module = b.module, processed_at = now()
        WHERE id = r.id;
      v_inserted := v_inserted + 1;

      IF v_children ? r.id::text THEN
        UPDATE public.import_rows
          SET target_record_id = v_new_id,
              target_module     = b.module,
              processed_at      = now(),
              dup_status        = 'duplicate'
          WHERE id IN (
            SELECT (jsonb_array_elements_text(v_children -> r.id::text))::uuid
          );
        v_merged := v_merged + jsonb_array_length(v_children -> r.id::text);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_msg := SQLERRM;
      UPDATE public.import_rows SET validation_status = 'error' WHERE id = r.id;
      INSERT INTO public.import_row_issues (row_id, severity, issue_code, message)
        VALUES (r.id, 'error', 'COMMIT_FAILED', v_msg);
      IF jsonb_array_length(v_errors) < 20 THEN
        v_errors := v_errors || jsonb_build_object('row', r.source_row_no, 'message', v_msg);
      END IF;
    END;
  END LOOP;

  -- Rows still pending after this chunk (children of unprocessed primaries
  -- included — they commit alongside their primary in a later chunk).
  SELECT count(*) INTO v_remaining
  FROM public.import_rows
  WHERE batch_id = p_batch_id
    AND action = 'insert'
    AND validation_status IN ('ready','warning')
    AND processed_at IS NULL;

  v_total_ins := COALESCE(b.imported_rows, 0) + v_inserted;  -- across all chunks

  UPDATE public.import_batches
    SET import_status = CASE WHEN v_remaining > 0 THEN 'committing'
                             WHEN v_total_ins > 0 THEN 'committed'
                             ELSE 'failed' END,
        imported_rows = COALESCE(imported_rows,0) + v_inserted,
        skipped_rows  = COALESCE(skipped_rows,0)  + v_skipped,
        error_rows    = COALESCE(error_rows,0)    + v_failed,
        completed_at  = CASE WHEN v_remaining > 0 THEN completed_at ELSE now() END
    WHERE id = p_batch_id;

  INSERT INTO public.import_audit_events (organisation_id, batch_id, actor, action, detail)
    VALUES (v_org, p_batch_id, v_uid, 'commit',
            jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped,
                               'failed', v_failed, 'merged', v_merged,
                               'remaining', v_remaining, 'max_rows', v_limit,
                               'target', v_target));

  RETURN jsonb_build_object(
    'status',   CASE WHEN v_remaining > 0 THEN 'partial'
                     WHEN v_total_ins > 0 THEN 'committed'
                     WHEN v_failed > 0 THEN 'failed'
                     ELSE 'committed' END,
    'inserted', v_inserted,
    'skipped',  v_skipped,
    'failed',   v_failed,
    'merged',   v_merged,
    'remaining', v_remaining,
    'errors',   v_errors,
    'target',   v_target);
END $function$;

REVOKE ALL ON FUNCTION public.import_commit_batch(uuid, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.import_commit_batch(uuid, integer) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.import_enrich_batch(uuid);

CREATE OR REPLACE FUNCTION public.import_enrich_batch(
  p_batch_id uuid,
  p_max_rows integer DEFAULT NULL,
  p_after_id uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $function$
DECLARE
  b public.import_batches%ROWTYPE; r public.import_rows%ROWTYPE;
  v_uid uuid := auth.uid(); v_org uuid := public.app_current_org();
  v_target text; v_key text; v_live_id text; v_live jsonb; v_data jsonb; v_patch jsonb;
  v_set text; v_enriched int := 0; v_skipped int := 0; v_nomatch int := 0;
  v_ecols text[]; k text;
  v_limit int := CASE WHEN p_max_rows IS NULL OR p_max_rows <= 0
                      THEN NULL ELSE LEAST(p_max_rows, 5000) END;
  v_scanned int := 0;
  v_last_id uuid := p_after_id;
  v_done boolean;
BEGIN
  IF NOT public.is_approved_and_unlocked() THEN RAISE EXCEPTION 'Not authorised.' USING errcode='42501'; END IF;
  SELECT * INTO b FROM public.import_batches WHERE id=p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import batch not found.'; END IF;
  IF b.organisation_id IS NOT NULL AND b.organisation_id IS DISTINCT FROM v_org THEN RAISE EXCEPTION 'Cross-organisation enrich denied.' USING errcode='42501'; END IF;
  IF NOT public.import_user_can_commit_country(b.country) THEN RAISE EXCEPTION 'Cross-country enrich denied.' USING errcode='42501'; END IF;
  v_target := public.import_target_table(b.module);
  IF v_target IS NULL THEN RAISE EXCEPTION 'Enrich not supported for module %', b.module; END IF;

  -- One column-list lookup per call (was per row).
  SELECT array_agg(c.column_name::text) INTO v_ecols
  FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name=v_target
    AND c.is_generated='NEVER' AND c.identity_generation IS NULL
    AND c.column_name NOT IN ('id','organisation_id','country','created_by','created_at');

  -- Keyset pagination on id (unique + stable): a chunked run never rescans
  -- skipped/no-match rows, while a fresh run (p_after_id NULL) retries them.
  FOR r IN SELECT * FROM public.import_rows WHERE batch_id=p_batch_id AND action='update'
             AND validation_status IN ('ready','warning') AND processed_at IS NULL
             AND (p_after_id IS NULL OR id > p_after_id)
           ORDER BY id
           LIMIT v_limit LOOP
    v_scanned := v_scanned + 1;
    v_last_id := r.id;

    v_data := COALESCE(NULLIF(r.transformed_data,'{}'::jsonb), r.mapped_data);
    v_key := public.import_natural_key(b.module, v_data);
    IF v_key IS NULL THEN v_skipped := v_skipped+1; CONTINUE; END IF;
    EXECUTE format('SELECT id::text, to_jsonb(t) FROM public.%I t WHERE public.import_natural_key(%L, to_jsonb(t)) = %L AND (t.organisation_id = %L OR t.organisation_id IS NULL) LIMIT 1',
                   v_target, b.module, v_key, v_org) INTO v_live_id, v_live;
    IF v_live_id IS NULL THEN v_nomatch := v_nomatch+1; CONTINUE; END IF;
    v_patch := '{}'::jsonb;
    FOREACH k IN ARRAY COALESCE(v_ecols, '{}'::text[]) LOOP
      IF NOT (v_data ? k) THEN CONTINUE; END IF;
      IF public.import_jsonb_blank(v_data -> k) THEN CONTINUE; END IF;
      IF NOT public.import_jsonb_blank(v_live -> k) THEN CONTINUE; END IF;
      v_patch := v_patch || jsonb_build_object(k, v_data -> k);
    END LOOP;
    IF v_patch = '{}'::jsonb THEN v_skipped := v_skipped+1; CONTINUE; END IF;
    v_set := (SELECT string_agg(format('%I = (jsonb_populate_record(t, %L::jsonb)).%I', kk, v_patch, kk), ', ') FROM jsonb_object_keys(v_patch) kk);
    EXECUTE format('UPDATE public.%I t SET %s WHERE id = %L', v_target, v_set, v_live_id);
    UPDATE public.import_rows SET target_record_id=v_live_id, target_module=b.module, processed_at=now(), dup_status='enriched' WHERE id=r.id;
    v_enriched := v_enriched+1;
  END LOOP;

  v_done := (v_limit IS NULL) OR (v_scanned < v_limit);

  INSERT INTO public.import_audit_events (organisation_id, batch_id, actor, action, detail)
    VALUES (v_org, p_batch_id, v_uid, 'enrich',
            jsonb_build_object('enriched',v_enriched,'skipped',v_skipped,'no_match',v_nomatch,
                               'scanned',v_scanned,'done',v_done,'target',v_target));

  RETURN jsonb_build_object('enriched',v_enriched,'skipped',v_skipped,'no_match',v_nomatch,
                            'scanned',v_scanned,'done',v_done,
                            'last_id', CASE WHEN v_scanned > 0 THEN v_last_id::text ELSE NULL END);
END $function$;

REVOKE ALL ON FUNCTION public.import_enrich_batch(uuid, integer, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.import_enrich_batch(uuid, integer, uuid) TO authenticated;
