-- ============================================================================
-- MIGRATIONS_V72_IMPORT_CROSS_FILE_MERGE.sql
-- ----------------------------------------------------------------------------
-- Cross-file MERGE on commit (cost-of-record wins) — server-side half of the
-- feature whose client library is src/lib/import/mergeCrossFile.js.
--
-- Problem
--   A single business record (a Job Card / Work Order, an insurance claim, a
--   warranty claim) is frequently described across MORE THAN ONE source file:
--     - one file carries the operational detail (asset, status, complaint …)
--       but NO cost columns, and
--     - a second file carries the COST OF RECORD (the qty-calculated amount).
--   Committing these 1:1 yields two live rows for the same natural key. The
--   legacy per-row loop (V46/V54/V60) either creates a duplicate live row or —
--   on a UNIQUE natural key such as work_orders.work_order_no — fails the second
--   row, silently discarding whichever file landed second.
--
-- Behaviour added (identical semantics to mergeCrossFile.js, at COMMIT time)
--   Before the per-row insert loop, staged rows that share the same module
--   NATURAL KEY across sheets/files are grouped and collapsed to ONE record:
--     1. The "cost row" (the contributor with the MOST populated cost fields for
--        that module) wins on every field conflict.
--     2. Fields the cost row leaves blank are enriched from the other
--        contributor(s), in source-row order (first non-blank wins).
--     3. Cost fields are NEVER back-filled from a non-cost contributor — cost of
--        record lives in exactly one source, so a blank cost stays blank.
--     4. Every source line from every contributor is rolled up verbatim into
--        custom_data.line_items (audit) with line_count / merged_row_count /
--        cross_file_merged provenance; already-aggregated line_items are reused
--        (never double-counted), mirroring V54/V60.
--
-- Gating (cost-of-record modules ONLY)
--   The merge fires for modules that have genuine cost-of-record fields AND for
--   which a repeated natural key means "same record described twice", NOT a
--   legitimate recurring event:
--       workorder  (key: country|work_order_no)                 cost: tyre_cost,
--                                                                total_cost,
--                                                                parts_cost,
--                                                                labour_cost
--       accident   (key: country|insurance_claim_no|police_...) cost: claim_amount,
--                                                                claim_approved_amount,
--                                                                repair_cost
--       warranty   (key: country|serial_number|claim_no)        cost: credit_amount
--   Lifecycle modules are EXPLICITLY excluded — most importantly `tyre`
--   (key: country|serial_no), where a repeated serial is a fitment/removal EVENT
--   and must remain two rows — and `fleet`, `stock`, `inspection`, `gatepass`,
--   `supplier`, `driver`. For every non-gated module import_commit_batch behaves
--   byte-for-byte as the V60 definition (the merge plan is empty and adds only a
--   vacuous `id <> ALL('{}')` predicate).
--
-- Divergences from src/lib/import/mergeCrossFile.js (documented, intentional)
--   * The JS COST_FIELDS map also lists `tyre`; that entry is deliberately NOT
--     mirrored here. Merging tyre lifecycle rows by serial at commit would
--     destroy fitment/removal events, which validate.js itself treats as
--     distinct events. Server gate = { workorder, accident, warranty }.
--   * Natural-key parts are joined with chr(1) (U+0001) — the SAME separator the
--     server authority public.import_existing_keys() (V47/V48) already uses,
--     rather than the JS empty-string join. This is internally consistent (all
--     grouping happens within one batch against the same builder) and is
--     collision-safe; it never affects which rows group together.
--   * The commit path operates on the EFFECTIVE record
--     (transformed_data, else mapped_data) that actually gets inserted, so JS's
--     separate transformed/mapped enrichment collapses to a single enrichment
--     over the effective view. Net inserted record is identical.
--
-- Preserved intact from V46/V54/V60
--   Caller auth (is_approved_and_unlocked), org scope, approval gate,
--   idempotency (already_committed), generated/identity column exclusion,
--   per-row sub-transaction error isolation (COMMIT_FAILED issues), batch
--   bookkeeping and the audit event. The audit/return payload GAINS a `merged`
--   counter (rows folded into a primary); all prior keys are unchanged.
--
-- Idempotent + reversible: pure CREATE OR REPLACE of functions; no schema or
-- data DDL. Rollback = re-apply the V60 definition of import_commit_batch and
-- DROP the four helper functions introduced here.
--
-- Depends on: V45 (import_* tables), V46 (import_target_table), V54/V60
-- (commit function lineage), V42 helpers (app_current_org,
-- is_approved_and_unlocked).
-- ============================================================================


-- ── Helper 1: cost-of-record fields per module (mirrors mergeCrossFile.js) ────
-- Returns NULL for any module that is NOT a cost-of-record merge target; that
-- NULL is the single source of truth for the merge gate below. `tyre` is
-- intentionally absent (see header).
CREATE OR REPLACE FUNCTION public.import_cost_fields(p_module text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_module
    WHEN 'workorder' THEN ARRAY['tyre_cost','total_cost','parts_cost','labour_cost']
    WHEN 'accident'  THEN ARRAY['claim_amount','claim_approved_amount','repair_cost']
    WHEN 'warranty'  THEN ARRAY['credit_amount']
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.import_cost_fields(text) IS
  'Cost-of-record fields per module (mirrors src/lib/import/mergeCrossFile.js COST_FIELDS). NULL = module is not a cross-file merge target. Drives import_commit_batch cost-row selection and the never-back-fill rule. tyre is deliberately excluded server-side (lifecycle serial = event, not duplicate).';


-- ── Helper 2: JS isEmpty() over a jsonb value ─────────────────────────────────
-- Blank = SQL NULL (missing key), JSON null, or a string that trims to empty.
-- Numbers (incl. 0) and booleans (incl. false) are REAL values, matching the JS.
CREATE OR REPLACE FUNCTION public.import_jsonb_blank(p_v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_v IS NULL
      OR jsonb_typeof(p_v) = 'null'
      OR (jsonb_typeof(p_v) = 'string' AND btrim(p_v #>> '{}') = '');
$$;

COMMENT ON FUNCTION public.import_jsonb_blank(jsonb) IS
  'True when a jsonb field is empty per mergeCrossFile.js isEmpty(): NULL/JSON-null/blank-string. Zero and false are real values.';


-- ── Helper 3: cost score — count of populated cost fields on a record ─────────
CREATE OR REPLACE FUNCTION public.import_cost_score(p_module text, p_d jsonb)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
           count(*) FILTER (WHERE NOT public.import_jsonb_blank(p_d -> f)),
           0)::int
  FROM unnest(COALESCE(public.import_cost_fields(p_module), ARRAY[]::text[])) AS f;
$$;

COMMENT ON FUNCTION public.import_cost_score(text, jsonb) IS
  'Number of populated cost fields on a staged record; the contributor with the highest score wins the cross-file merge (mergeCrossFile.js costScore).';


-- ── Helper 4: module natural key over staged jsonb (validate.js NATURAL_KEY) ──
-- Mirrors src/lib/import/validate.js NATURAL_KEY + keyParts() exactly for the
-- merge-eligible modules: norm(v)=lower(btrim(v)); a NULL/missing component is
-- an empty string; parts joined with chr(1) (server convention, V47/V48).
-- Returns NULL when the identifying component is absent (keyParts null guard),
-- so such a row never groups and passes through unchanged.
CREATE OR REPLACE FUNCTION public.import_merge_key(p_module text, p_d jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  c    text := lower(btrim(coalesce(p_d ->> 'country', '')));  -- part 0 (country)
  id1  text;                                                    -- part 1 (primary id)
  id2  text;                                                    -- part 2 (secondary id)
BEGIN
  CASE p_module
    -- workorder: country|work_order_no. 2-part keyParts → NULL iff work_order_no blank.
    WHEN 'workorder' THEN
      id1 := lower(btrim(coalesce(p_d ->> 'work_order_no', '')));
      IF id1 = '' THEN RETURN NULL; END IF;
      RETURN c || chr(1) || id1;

    -- accident: country|(insurance_claim_no || police_report_no). `a || b` (JS)
    -- picks the first NON-EMPTY value. 2-part → NULL iff both identifiers blank.
    WHEN 'accident' THEN
      id1 := lower(btrim(coalesce(
               nullif(btrim(coalesce(p_d ->> 'insurance_claim_no', '')), ''),
               p_d ->> 'police_report_no', '')));
      IF id1 = '' THEN RETURN NULL; END IF;
      RETURN c || chr(1) || id1;

    -- warranty: country|serial_number|claim_no. 3-part keyParts → NULL iff the
    -- last part (claim_no) AND part 1 (serial_number) are BOTH blank.
    WHEN 'warranty' THEN
      id1 := lower(btrim(coalesce(p_d ->> 'serial_number', '')));
      id2 := lower(btrim(coalesce(p_d ->> 'claim_no', '')));
      IF id2 = '' AND id1 = '' THEN RETURN NULL; END IF;
      RETURN c || chr(1) || id1 || chr(1) || id2;

    ELSE
      RETURN NULL;  -- not a merge-eligible module
  END CASE;
END $$;

COMMENT ON FUNCTION public.import_merge_key(text, jsonb) IS
  'Cross-file merge natural key over staged jsonb, mirroring validate.js NATURAL_KEY + keyParts() for merge-eligible modules (workorder/accident/warranty). norm=lower(btrim), chr(1) separator (V47/V48 server convention). NULL when the identifying component is missing → row is never merged.';


-- ── Redefine import_commit_batch: pre-insert cross-file MERGE + V60 behaviour ─
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
  v_data     jsonb;   -- effective record (transformed|mapped) OR merge override
  v_custom   jsonb;   -- custom_data OR merge override
  v_new_id   text;
  v_inserted int := 0;
  v_skipped  int := 0;
  v_failed   int := 0;
  v_merged   int := 0;                    -- rows folded into a merge primary
  v_errors   jsonb := '[]'::jsonb;
  v_msg      text;

  -- Cross-file merge plan (empty for non-cost modules → V60 behaviour unchanged)
  v_cost_fields text[];
  v_merge_on    boolean := false;
  v_override_tx jsonb := '{}'::jsonb;     -- primary row_id(text) → merged effective data
  v_override_cd jsonb := '{}'::jsonb;     -- primary row_id(text) → merged custom_data
  v_absorbed    uuid[] := ARRAY[]::uuid[];-- contributor rows folded away (skip in loop)
  v_children    jsonb := '{}'::jsonb;     -- primary row_id(text) → jsonb[] absorbed row_ids

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
  -- ── Authorisation / scope / idempotency (verbatim from V60) ────────────────
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

  -- ── Cross-file MERGE planning (cost-of-record modules ONLY) ────────────────
  -- Gate: only modules with a cost-field set are merged; all others fall through
  -- with an empty plan and commit exactly as V60 did.
  v_cost_fields := public.import_cost_fields(b.module);
  v_merge_on    := v_cost_fields IS NOT NULL;

  IF v_merge_on THEN
    -- Group the SAME staged rows the insert loop will process, by natural key,
    -- keeping only cross-file/duplicate groups (>1 contributor).
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
      -- Pass 1: pick the cost row (highest cost score; ties → lowest
      -- source_row_no, i.e. first occurrence) and roll up audit line items.
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
        -- Reuse already-aggregated line_items (never double-count); otherwise the
        -- contributor's raw source row is one audit line (mergeCrossFile lineItemsOf).
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

      -- Pass 2: cost row wins; enrich its blanks from the other contributors in
      -- source order; cost fields are NEVER back-filled.
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
        -- Enrich the winning record: fill blanks with the contributor's values,
        -- but never touch a cost field.
        FOR v_kv IN SELECT key, value FROM jsonb_each(mem.d) LOOP
          IF v_kv.key = ANY(v_cost_fields) THEN CONTINUE; END IF;
          IF public.import_jsonb_blank(v_merged_d -> v_kv.key)
             AND NOT public.import_jsonb_blank(v_kv.value) THEN
            v_merged_d := jsonb_set(v_merged_d, ARRAY[v_kv.key], v_kv.value, true);
          END IF;
        END LOOP;

        -- Enrich custom_data blanks (skip cost fields + rollup bookkeeping keys).
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

      -- Audit provenance on the merged record's custom_data.
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

  -- ── Per-row insert loop (absorbed contributors excluded) ───────────────────
  -- For non-cost modules v_absorbed is empty → `id <> ALL('{}')` is TRUE for all
  -- rows and this is exactly the V60 loop.
  FOR r IN
    SELECT * FROM public.import_rows
    WHERE batch_id = p_batch_id
      AND action = 'insert'
      AND validation_status IN ('ready','warning')
      AND processed_at IS NULL
      AND id <> ALL(v_absorbed)
    ORDER BY source_row_no
  LOOP
    -- Effective record + custom_data, overridden by the merge plan when this row
    -- is a merge primary.
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

    -- Column intersection, excluding DB-computed columns (V54).
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

    -- Per-row sub-transaction: one bad value fails ONLY this row (V60).
    BEGIN
      EXECUTE format(
        'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(null::public.%I, $1) AS rec RETURNING id::text',
        v_target, v_cols, v_cols, v_target)
      USING v_enriched INTO v_new_id;

      UPDATE public.import_rows
        SET target_record_id = v_new_id, target_module = b.module, processed_at = now()
        WHERE id = r.id;
      v_inserted := v_inserted + 1;

      -- Link the absorbed contributors to the primary's live record (audit
      -- trail), mark them processed so they never re-commit, count them merged.
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
      -- NOTE: absorbed contributors of a FAILED primary are intentionally left
      -- unprocessed (processed_at IS NULL) so a later re-commit of the fixed
      -- batch can re-plan and land them; they were only excluded from THIS run.
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
                               'failed', v_failed, 'merged', v_merged, 'target', v_target));

  RETURN jsonb_build_object(
    'status',   CASE WHEN v_inserted > 0 THEN 'committed'
                     ELSE CASE WHEN v_failed > 0 THEN 'failed' ELSE 'committed' END END,
    'inserted', v_inserted,
    'skipped',  v_skipped,
    'failed',   v_failed,
    'merged',   v_merged,
    'errors',   v_errors,
    'target',   v_target);
END $function$;

GRANT EXECUTE ON FUNCTION public.import_cost_fields(text)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_jsonb_blank(jsonb)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_cost_score(text, jsonb)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_merge_key(text, jsonb)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_commit_batch(uuid)         TO authenticated;

-- ============================================================================
-- SELF-ASSERTING TEST (rolled-back; leaves the database byte-for-byte unchanged)
-- ----------------------------------------------------------------------------
-- Run manually with psql (never committed):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f MIGRATIONS_V72_IMPORT_CROSS_FILE_MERGE.sql
-- ...or execute the block below inside a single BEGIN; ... ROLLBACK; transaction.
-- Proves:
--   A) workorder — two files, same work_order_no, one carrying cost → ONE live
--      row; cost file's costs win; the non-cost file's asset_no/status enrich the
--      blanks (asset_no is NOT NULL on work_orders, so this is what makes the
--      merged row insertable); provenance recorded; result inserted=1, merged=1;
--      both source rows link to the single live record.
--   B) tyre — same serial twice (a lifecycle event) is NOT merged: two live rows,
--      merged=0.
--
--   BEGIN;
--   DO $test$
--   DECLARE
--     uid uuid; org uuid; bid uuid; tid uuid;
--     res jsonb; cnt int; wo public.work_orders%ROWTYPE; cd jsonb;
--   BEGIN
--     -- Act as a real approved+unlocked user in the default org.
--     SELECT id INTO uid FROM public.profiles
--       WHERE COALESCE(approved,false) AND NOT COALESCE(locked,false) LIMIT 1;
--     IF uid IS NULL THEN RAISE EXCEPTION 'no approved profile to test with'; END IF;
--     PERFORM set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
--     org := public.app_current_org();
--
--     -- ── A) workorder cross-file merge ───────────────────────────────────────
--     INSERT INTO public.import_batches (organisation_id, country, module, approval_status, import_status, created_by)
--       VALUES (org, 'KSA', 'workorder', 'approved', 'ready', uid) RETURNING id INTO bid;
--     -- File 1 (complaints): operational detail, NO cost.
--     INSERT INTO public.import_rows (organisation_id, batch_id, sheet_name, source_row_no, raw_source_data, transformed_data, validation_status, action)
--       VALUES (org, bid, 'Complaints', 1,
--               '{"WO":"WO-V72-1","Asset":"AST-9"}'::jsonb,
--               '{"work_order_no":"WO-V72-1","asset_no":"AST-9","status":"Open"}'::jsonb,
--               'ready','insert');
--     -- File 2 (WO details): the COST OF RECORD, no asset/status.
--     INSERT INTO public.import_rows (organisation_id, batch_id, sheet_name, source_row_no, raw_source_data, transformed_data, validation_status, action)
--       VALUES (org, bid, 'WO Details', 2,
--               '{"WO":"WO-V72-1","Tyre":500,"Parts":200,"Labour":100}'::jsonb,
--               '{"work_order_no":"WO-V72-1","tyre_cost":500,"parts_cost":200,"labour_cost":100}'::jsonb,
--               'ready','insert');
--
--     res := public.import_commit_batch(bid);
--     IF (res->>'inserted')::int <> 1 THEN RAISE EXCEPTION 'A: inserted=% expected 1 (%)', res->>'inserted', res; END IF;
--     IF (res->>'merged')::int   <> 1 THEN RAISE EXCEPTION 'A: merged=% expected 1 (%)', res->>'merged', res; END IF;
--
--     SELECT count(*) INTO cnt FROM public.work_orders WHERE work_order_no='WO-V72-1' AND organisation_id=org;
--     IF cnt <> 1 THEN RAISE EXCEPTION 'A: expected exactly 1 live work order, got %', cnt; END IF;
--
--     SELECT * INTO wo FROM public.work_orders WHERE work_order_no='WO-V72-1' AND organisation_id=org;
--     IF wo.tyre_cost   IS DISTINCT FROM 500 THEN RAISE EXCEPTION 'A: cost row lost — tyre_cost=%', wo.tyre_cost; END IF;
--     IF wo.parts_cost  IS DISTINCT FROM 200 THEN RAISE EXCEPTION 'A: parts_cost=%', wo.parts_cost; END IF;
--     IF wo.labour_cost IS DISTINCT FROM 100 THEN RAISE EXCEPTION 'A: labour_cost=%', wo.labour_cost; END IF;
--     IF wo.total_cost  IS DISTINCT FROM 300 THEN RAISE EXCEPTION 'A: generated total_cost=% expected 300', wo.total_cost; END IF;
--     IF wo.asset_no    IS DISTINCT FROM 'AST-9' THEN RAISE EXCEPTION 'A: blank not enriched — asset_no=%', wo.asset_no; END IF;
--     IF wo.status      IS DISTINCT FROM 'Open'  THEN RAISE EXCEPTION 'A: blank not enriched — status=%', wo.status; END IF;
--
--     cd := wo.custom_data;
--     IF (cd->>'cross_file_merged') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'A: provenance missing (%)', cd; END IF;
--     IF (cd->>'merged_row_count')::int <> 2 THEN RAISE EXCEPTION 'A: merged_row_count=% expected 2', cd->>'merged_row_count'; END IF;
--     IF (cd->>'line_count')::int       <> 2 THEN RAISE EXCEPTION 'A: line_count=% expected 2', cd->>'line_count'; END IF;
--
--     SELECT count(*) INTO cnt FROM public.import_rows
--       WHERE batch_id=bid AND target_record_id = wo.id::text;
--     IF cnt <> 2 THEN RAISE EXCEPTION 'A: both source rows should link to the merged record, got %', cnt; END IF;
--
--     -- ── B) tyre lifecycle: same serial twice must NOT merge ─────────────────
--     INSERT INTO public.import_batches (organisation_id, country, module, approval_status, import_status, created_by)
--       VALUES (org, 'KSA', 'tyre', 'approved', 'ready', uid) RETURNING id INTO tid;
--     INSERT INTO public.import_rows (organisation_id, batch_id, sheet_name, source_row_no, transformed_data, validation_status, action)
--       VALUES (org, tid, 'Fitment', 1, '{"serial_no":"SER-V72","brand":"B","site":"Riyadh","km_at_fitment":100}'::jsonb, 'ready','insert');
--     INSERT INTO public.import_rows (organisation_id, batch_id, sheet_name, source_row_no, transformed_data, validation_status, action)
--       VALUES (org, tid, 'Removal', 2, '{"serial_no":"SER-V72","brand":"B","site":"Riyadh","km_at_removal":5000}'::jsonb, 'ready','insert');
--
--     res := public.import_commit_batch(tid);
--     IF (res->>'merged')::int   <> 0 THEN RAISE EXCEPTION 'B: tyre must NOT merge — merged=% (%)', res->>'merged', res; END IF;
--     IF (res->>'inserted')::int <> 2 THEN RAISE EXCEPTION 'B: expected 2 separate tyre rows, inserted=% (%)', res->>'inserted', res; END IF;
--     SELECT count(*) INTO cnt FROM public.tyre_records WHERE serial_no='SER-V72' AND organisation_id=org;
--     IF cnt <> 2 THEN RAISE EXCEPTION 'B: expected 2 live tyre rows (event, not duplicate), got %', cnt; END IF;
--
--     RAISE NOTICE 'V72 cross-file merge test PASSED (A: workorder merged 2→1 cost-wins+enriched; B: tyre 2 events not merged)';
--   END $test$;
--   ROLLBACK;
-- ============================================================================
