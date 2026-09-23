-- Captured read-only from deployed schema 2026-09-10; no customer data.
CREATE OR REPLACE FUNCTION public.import_commit_batch(p_batch_id uuid, p_max_rows integer DEFAULT NULL::integer)
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
  v_existing jsonb;
  v_child_count int := 0;
  v_exact_dups int := 0;
  v_inserted int := 0;
  v_skipped  int := 0;
  v_failed   int := 0;
  v_merged   int := 0;
  v_errors   jsonb := '[]'::jsonb;
  v_msg      text;

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
    LIMIT v_limit
  LOOP
    IF v_override_tx ? r.id::text THEN
      v_data   := v_override_tx -> r.id::text;
      v_custom := v_override_cd -> r.id::text;
    ELSE
      v_data   := COALESCE(NULLIF(r.transformed_data, '{}'::jsonb), r.mapped_data);
      v_custom := r.custom_data;
    END IF;

    -- target_record_id is only a preview candidate at this point. Re-read
    -- it in this organisation and verify every uploaded target field.
    IF r.target_record_id IS NOT NULL THEN
      v_existing := NULL;
      EXECUTE format(
        'SELECT to_jsonb(t) FROM public.%I AS t WHERE t.id::text = $1 AND t.organisation_id = $2 LIMIT 1',
        v_target)
      USING r.target_record_id, v_org INTO v_existing;

      IF v_existing IS NOT NULL
         AND public.import_exact_supplied_match(v_existing, v_data, v_tcols) THEN
        v_child_count := 0;
        UPDATE public.import_rows
          SET target_module = b.module, processed_at = now(), dup_status = 'duplicate'
          WHERE id = r.id;

        IF v_children ? r.id::text THEN
          v_child_count := jsonb_array_length(v_children -> r.id::text);
          UPDATE public.import_rows
            SET target_record_id = r.target_record_id,
                target_module = b.module, processed_at = now(), dup_status = 'duplicate'
            WHERE id IN (
              SELECT (jsonb_array_elements_text(v_children -> r.id::text))::uuid
            );
        END IF;

        v_skipped := v_skipped + 1 + v_child_count;
        v_exact_dups := v_exact_dups + 1 + v_child_count;
        INSERT INTO public.import_row_issues (row_id, severity, issue_code, message)
          VALUES (r.id, 'warning', 'EXACT_LIVE_DUPLICATE',
                  'Every supplied value matches the live record; exact duplicate dropped.');
        CONTINUE;
      ELSE
        -- The live row changed after preview (or disappeared). Do not trust
        -- the stale candidate; continue through the normal insert path.
        UPDATE public.import_rows SET target_record_id = NULL WHERE id = r.id;
      END IF;
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

  SELECT count(*) INTO v_remaining
  FROM public.import_rows
  WHERE batch_id = p_batch_id
    AND action = 'insert'
    AND validation_status IN ('ready','warning')
    AND processed_at IS NULL;

  v_total_ins := COALESCE(b.imported_rows, 0) + v_inserted;

  UPDATE public.import_batches
    SET import_status = CASE WHEN v_remaining > 0 THEN 'committing'
                             WHEN v_total_ins > 0 OR v_exact_dups > 0 THEN 'committed'
                             ELSE 'failed' END,
        imported_rows = COALESCE(imported_rows,0) + v_inserted,
        skipped_rows  = COALESCE(skipped_rows,0)  + v_skipped,
        error_rows    = COALESCE(error_rows,0)    + v_failed,
        completed_at  = CASE WHEN v_remaining > 0 THEN completed_at ELSE now() END
    WHERE id = p_batch_id;

  INSERT INTO public.import_audit_events (organisation_id, batch_id, actor, action, detail)
    VALUES (v_org, p_batch_id, v_uid, 'commit',
            jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped,
                               'failed', v_failed, 'merged', v_merged, 'exact_duplicates', v_exact_dups,
                               'remaining', v_remaining, 'max_rows', v_limit,
                               'target', v_target));

  RETURN jsonb_build_object(
    'status',   CASE WHEN v_remaining > 0 THEN 'partial'
                     WHEN v_total_ins > 0 OR v_exact_dups > 0 THEN 'committed'
                     WHEN v_failed > 0 THEN 'failed'
                     ELSE 'nothing_to_commit' END,
    'inserted', v_inserted,
    'skipped',  v_skipped,
    'exact_duplicates', v_exact_dups,
    'not_eligible', coalesce((
      select jsonb_object_agg(z.k, z.n) from (
        select coalesce(ir.action, 'unset') || '/' || coalesce(ir.validation_status, 'unset') as k,
               count(*) as n
        from public.import_rows ir
        where ir.batch_id = p_batch_id
          and not (ir.action = 'insert' and ir.validation_status in ('ready', 'warning'))
        group by 1
      ) z), '{}'::jsonb),
    'failed',   v_failed,
    'merged',   v_merged,
    'remaining', v_remaining,
    'errors',   v_errors,
    'target',   v_target);
END $function$
