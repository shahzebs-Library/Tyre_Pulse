-- ============================================================================
-- MIGRATIONS_V47_WORKORDER_COST_BREAKDOWN.sql
-- ----------------------------------------------------------------------------
-- Purpose
--   Work-order imports carry cost buckets (lubricants, tyres, outside repair)
--   and hour/odometer readings that had no home column and were being kept only
--   as opaque custom JSON — so they never showed on the work-order record or in
--   its total cost. This migration adds first-class columns for those buckets
--   and a generic `custom_data` column, and extends import_commit_batch to carry
--   every preserved (unmapped) field into the live row's custom_data.
--
-- Backward compatible: all new columns are nullable / defaulted; no data change.
--
-- Rollback
--   ALTER TABLE public.work_orders
--     DROP COLUMN IF EXISTS lubricant_cost, DROP COLUMN IF EXISTS tyre_cost,
--     DROP COLUMN IF EXISTS outside_repair_cost, DROP COLUMN IF EXISTS breakdown_hours,
--     DROP COLUMN IF EXISTS standard_hours, DROP COLUMN IF EXISTS odometer,
--     DROP COLUMN IF EXISTS custom_data;
--   -- and restore import_commit_batch from MIGRATIONS_V46_IMPORT_COMMIT.sql.
-- ============================================================================

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS lubricant_cost      numeric,
  ADD COLUMN IF NOT EXISTS tyre_cost           numeric,
  ADD COLUMN IF NOT EXISTS outside_repair_cost numeric,
  ADD COLUMN IF NOT EXISTS breakdown_hours     numeric,
  ADD COLUMN IF NOT EXISTS standard_hours      numeric,
  ADD COLUMN IF NOT EXISTS odometer            numeric,
  ADD COLUMN IF NOT EXISTS custom_data         jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.work_orders.custom_data IS
  'Preserved unmapped import fields (source columns with no dedicated column). Nothing from an import is discarded.';

-- Carry preserved (unmapped) import fields into the live row's custom_data when
-- the target table has such a column. Generic: only tables with a custom_data
-- column receive it (column-intersection drops it for the rest).
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

GRANT EXECUTE ON FUNCTION public.import_commit_batch(uuid) TO authenticated;
