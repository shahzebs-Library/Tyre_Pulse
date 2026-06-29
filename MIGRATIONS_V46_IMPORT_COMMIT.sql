-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V46 — Data Intake Center: server-side commit framework
--
-- The ONLY safe path from staged rows (V45) into live operational tables. These
-- SECURITY DEFINER RPCs enforce: caller active, batch approved, org/country
-- scope, idempotency, and a single transaction (all-or-nothing) — never a
-- browser insert. Each committed row is linked back to its source import_row,
-- and every action is audited.
--
-- Depends on V45 (import_* tables) + V42 helpers (app_current_org,
-- is_approved_and_unlocked, app_is_elevated).
-- ─────────────────────────────────────────────────────────────────────────────

-- Module → canonical live table. Modules without a target stay in staging.
CREATE OR REPLACE FUNCTION public.import_target_table(p_module text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT (jsonb_build_object(
    'fleet','vehicle_fleet', 'tyre','tyre_records', 'stock','stock_records',
    'accident','accidents', 'inspection','inspections', 'workorder','work_orders',
    'warranty','warranty_claims', 'gatepass','gate_passes'
  )) ->> p_module;
$$;

-- ── Commit an approved batch into its live table ─────────────────────────────
CREATE OR REPLACE FUNCTION public.import_commit_batch(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
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
BEGIN
  IF NOT public.is_approved_and_unlocked() THEN
    RAISE EXCEPTION 'Not authorised.' USING errcode = '42501';
  END IF;

  SELECT * INTO b FROM public.import_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import batch not found.'; END IF;

  -- org scope: cannot commit another organisation's batch
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

  -- Insert each ready/warning, not-yet-processed row. transformed_data preferred,
  -- else mapped_data; scope columns are stamped server-side.
  FOR r IN
    SELECT * FROM public.import_rows
    WHERE batch_id = p_batch_id
      AND action = 'insert'
      AND validation_status IN ('ready','warning')
      AND processed_at IS NULL
    ORDER BY source_row_no
  LOOP
    -- Stamp scope columns server-side. Both created_by and uploaded_by are set;
    -- the column intersection below keeps whichever the target table actually has.
    v_enriched := COALESCE(NULLIF(r.transformed_data, '{}'::jsonb), r.mapped_data)
                  || jsonb_build_object('organisation_id', v_org, 'country', b.country,
                                        'created_by', v_uid, 'uploaded_by', v_uid);

    -- only target columns that are actually present in the row (defaults apply to the rest)
    SELECT string_agg(quote_ident(c.column_name), ', ') INTO v_cols
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = v_target AND v_enriched ? c.column_name;

    IF v_cols IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    EXECUTE format(
      'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(null::public.%I, $1) AS rec RETURNING id::text',
      v_target, v_cols, v_cols, v_target)
    USING v_enriched INTO v_new_id;

    UPDATE public.import_rows
      SET target_record_id = v_new_id, target_module = b.module, processed_at = now()
      WHERE id = r.id;
    v_inserted := v_inserted + 1;
  END LOOP;

  UPDATE public.import_batches
    SET import_status = 'committed',
        imported_rows = COALESCE(imported_rows,0) + v_inserted,
        skipped_rows  = COALESCE(skipped_rows,0)  + v_skipped,
        completed_at  = now()
    WHERE id = p_batch_id;

  INSERT INTO public.import_audit_events (organisation_id, batch_id, actor, action, detail)
    VALUES (v_org, p_batch_id, v_uid, 'commit',
            jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'target', v_target));

  RETURN jsonb_build_object('status','committed','inserted',v_inserted,'skipped',v_skipped,'target',v_target);
END $fn$;

-- ── Reverse a committed batch (delete ONLY the rows this batch created) ───────
CREATE OR REPLACE FUNCTION public.import_reverse_batch(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  b        public.import_batches%ROWTYPE;
  r        public.import_rows%ROWTYPE;
  v_org    uuid := public.app_current_org();
  v_target text;
  v_deleted int := 0;
BEGIN
  -- Reversal is high-risk → elevated only.
  IF NOT public.app_is_elevated() THEN
    RAISE EXCEPTION 'Reversal requires an elevated role.' USING errcode = '42501';
  END IF;
  SELECT * INTO b FROM public.import_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import batch not found.'; END IF;
  IF b.organisation_id IS NOT NULL AND b.organisation_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'Cross-organisation reversal denied.' USING errcode = '42501';
  END IF;

  v_target := public.import_target_table(b.module);
  IF v_target IS NULL THEN RAISE EXCEPTION 'No target table for module "%".', b.module; END IF;

  -- Delete only the exact live rows created by this batch (linked via target_record_id).
  -- Note: a stricter "unmodified-since-import" guard is a follow-up; this removes
  -- the imported rows, not unrelated later business activity.
  FOR r IN SELECT * FROM public.import_rows WHERE batch_id = p_batch_id AND target_record_id IS NOT NULL
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE id::text = $1', v_target) USING r.target_record_id;
    UPDATE public.import_rows SET target_record_id = NULL, processed_at = NULL WHERE id = r.id;
    v_deleted := v_deleted + 1;
  END LOOP;

  UPDATE public.import_batches
    SET import_status = 'reversed', imported_rows = 0, completed_at = now()
    WHERE id = p_batch_id;
  INSERT INTO public.import_audit_events (organisation_id, batch_id, actor, action, detail)
    VALUES (v_org, p_batch_id, auth.uid(), 'reverse', jsonb_build_object('deleted', v_deleted, 'target', v_target));

  RETURN jsonb_build_object('status','reversed','deleted',v_deleted);
END $fn$;

-- ── Reset an uncommitted row for re-validation/reprocessing ───────────────────
CREATE OR REPLACE FUNCTION public.import_reprocess_row(p_row_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.is_approved_and_unlocked() THEN
    RAISE EXCEPTION 'Not authorised.' USING errcode = '42501';
  END IF;
  UPDATE public.import_rows
    SET validation_status = 'pending', processed_at = NULL
    WHERE id = p_row_id AND target_record_id IS NULL;  -- never touch a committed row
END $fn$;

GRANT EXECUTE ON FUNCTION public.import_target_table(text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_commit_batch(uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_reverse_batch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_reprocess_row(uuid) TO authenticated;
