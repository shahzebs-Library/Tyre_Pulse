-- ============================================================================
-- V435 - Keep Data Intake batch counters derived from staged import rows
-- ============================================================================
--
-- Scope is deliberately limited to import_batches/import_rows bookkeeping.
-- This migration does not update live business tables, row payloads, countries,
-- target_record_id, processed_at, imported_rows, skipped_rows, or reversal state.
--
-- Counter definitions remain independent, matching the existing UI semantics:
--   total_rows     = every import_rows row in the batch
--   ready_rows     = validation_status = 'ready'
--   warning_rows   = validation_status = 'warning'
--   error_rows     = validation_status = 'error'
--   duplicate_rows = dup_status = 'duplicate'
--   conflict_rows  = dup_status = 'conflict'
--
-- The helper locks affected batches in UUID order before aggregating. This
-- serializes concurrent mutations of the same batch and lets the aggregate use
-- the existing idx_import_rows_batch index. Transition-table triggers invoke it
-- once per INSERT/UPDATE/DELETE statement, not once per staged row.

CREATE OR REPLACE FUNCTION public._sync_import_batch_counters(p_batch_ids uuid[] DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_batch_ids uuid[];
BEGIN
  IF p_batch_ids IS NULL THEN
    v_batch_ids := NULL; -- NULL intentionally means every historical batch.
  ELSE
    SELECT array_agg(DISTINCT u.batch_id ORDER BY u.batch_id)
      INTO v_batch_ids
    FROM unnest(p_batch_ids) AS u(batch_id)
    WHERE u.batch_id IS NOT NULL;

    IF COALESCE(cardinality(v_batch_ids), 0) = 0 THEN
      RETURN;
    END IF;
  END IF;

  -- Deterministic lock order prevents two multi-batch updates deadlocking.
  PERFORM b.id
  FROM public.import_batches AS b
  WHERE v_batch_ids IS NULL OR b.id = ANY(v_batch_ids)
  ORDER BY b.id
  FOR UPDATE;

  WITH actual AS (
    SELECT
      b.id AS batch_id,
      count(r.id)::integer AS total_rows,
      count(r.id) FILTER (WHERE r.validation_status = 'ready')::integer AS ready_rows,
      count(r.id) FILTER (WHERE r.validation_status = 'warning')::integer AS warning_rows,
      count(r.id) FILTER (WHERE r.validation_status = 'error')::integer AS error_rows,
      count(r.id) FILTER (WHERE r.dup_status = 'duplicate')::integer AS duplicate_rows,
      count(r.id) FILTER (WHERE r.dup_status = 'conflict')::integer AS conflict_rows
    FROM public.import_batches AS b
    LEFT JOIN public.import_rows AS r ON r.batch_id = b.id
    WHERE v_batch_ids IS NULL OR b.id = ANY(v_batch_ids)
    GROUP BY b.id
  )
  UPDATE public.import_batches AS b
  SET total_rows     = a.total_rows,
      ready_rows     = a.ready_rows,
      warning_rows   = a.warning_rows,
      error_rows     = a.error_rows,
      duplicate_rows = a.duplicate_rows,
      conflict_rows  = a.conflict_rows
  FROM actual AS a
  WHERE b.id = a.batch_id
    AND ROW(
      COALESCE(b.total_rows, 0),
      COALESCE(b.ready_rows, 0),
      COALESCE(b.warning_rows, 0),
      COALESCE(b.error_rows, 0),
      COALESCE(b.duplicate_rows, 0),
      COALESCE(b.conflict_rows, 0)
    ) IS DISTINCT FROM ROW(
      a.total_rows,
      a.ready_rows,
      a.warning_rows,
      a.error_rows,
      a.duplicate_rows,
      a.conflict_rows
    );
END
$function$;

REVOKE ALL ON FUNCTION public._sync_import_batch_counters(uuid[]) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public._sync_import_batch_counters(uuid[]) IS
  'Internal V435 helper: derives validation and duplicate counters from import_rows. NULL batch IDs repairs all batches.';

CREATE OR REPLACE FUNCTION public._import_rows_sync_counters_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_batch_ids uuid[];
BEGIN
  SELECT array_agg(DISTINCT n.batch_id ORDER BY n.batch_id)
    INTO v_batch_ids
  FROM new_rows AS n;

  PERFORM public._sync_import_batch_counters(v_batch_ids);
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public._import_rows_sync_counters_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_batch_ids uuid[];
BEGIN
  SELECT array_agg(DISTINCT affected.batch_id ORDER BY affected.batch_id)
    INTO v_batch_ids
  FROM (
    SELECT o.batch_id FROM old_rows AS o
    UNION
    SELECT n.batch_id FROM new_rows AS n
  ) AS affected;

  PERFORM public._sync_import_batch_counters(v_batch_ids);
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public._import_rows_sync_counters_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_batch_ids uuid[];
BEGIN
  SELECT array_agg(DISTINCT o.batch_id ORDER BY o.batch_id)
    INTO v_batch_ids
  FROM old_rows AS o;

  PERFORM public._sync_import_batch_counters(v_batch_ids);
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public._import_rows_sync_counters_after_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM public._sync_import_batch_counters(NULL);
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public._import_rows_sync_counters_after_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_rows_sync_counters_after_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_rows_sync_counters_after_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_rows_sync_counters_after_truncate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_import_rows_sync_counters_insert ON public.import_rows;
CREATE TRIGGER trg_import_rows_sync_counters_insert
AFTER INSERT ON public.import_rows
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public._import_rows_sync_counters_after_insert();

DROP TRIGGER IF EXISTS trg_import_rows_sync_counters_update ON public.import_rows;
CREATE TRIGGER trg_import_rows_sync_counters_update
AFTER UPDATE ON public.import_rows
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public._import_rows_sync_counters_after_update();

DROP TRIGGER IF EXISTS trg_import_rows_sync_counters_delete ON public.import_rows;
CREATE TRIGGER trg_import_rows_sync_counters_delete
AFTER DELETE ON public.import_rows
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public._import_rows_sync_counters_after_delete();

DROP TRIGGER IF EXISTS trg_import_rows_sync_counters_truncate ON public.import_rows;
CREATE TRIGGER trg_import_rows_sync_counters_truncate
AFTER TRUNCATE ON public.import_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public._import_rows_sync_counters_after_truncate();

-- A direct import_batches counter write (including the legacy client
-- setBatchCounts call) is normalized to the staged rows before it can drift.
CREATE OR REPLACE FUNCTION public._import_batches_derive_row_counters()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE r.validation_status = 'ready')::integer,
    count(*) FILTER (WHERE r.validation_status = 'warning')::integer,
    count(*) FILTER (WHERE r.validation_status = 'error')::integer,
    count(*) FILTER (WHERE r.dup_status = 'duplicate')::integer,
    count(*) FILTER (WHERE r.dup_status = 'conflict')::integer
  INTO
    NEW.total_rows,
    NEW.ready_rows,
    NEW.warning_rows,
    NEW.error_rows,
    NEW.duplicate_rows,
    NEW.conflict_rows
  FROM public.import_rows AS r
  WHERE r.batch_id = NEW.id;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public._import_batches_derive_row_counters() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_import_batches_derive_counters_insert ON public.import_batches;
CREATE TRIGGER trg_import_batches_derive_counters_insert
BEFORE INSERT ON public.import_batches
FOR EACH ROW
EXECUTE FUNCTION public._import_batches_derive_row_counters();

DROP TRIGGER IF EXISTS trg_import_batches_derive_counters_update ON public.import_batches;
CREATE TRIGGER trg_import_batches_derive_counters_update
BEFORE UPDATE OF total_rows, ready_rows, warning_rows, error_rows, duplicate_rows, conflict_rows
ON public.import_batches
FOR EACH ROW
EXECUTE FUNCTION public._import_batches_derive_row_counters();

-- Repair every historical batch after all definitions are in place. Re-running
-- the migration is safe: unchanged batches are not updated.
SELECT public._sync_import_batch_counters(NULL);

-- ============================================================================
-- Verification (run manually after applying; the first query must return 0 rows)
-- ============================================================================
-- WITH actual AS (
--   SELECT b.id,
--          count(r.id)::int AS total_rows,
--          count(r.id) FILTER (WHERE r.validation_status = 'ready')::int AS ready_rows,
--          count(r.id) FILTER (WHERE r.validation_status = 'warning')::int AS warning_rows,
--          count(r.id) FILTER (WHERE r.validation_status = 'error')::int AS error_rows,
--          count(r.id) FILTER (WHERE r.dup_status = 'duplicate')::int AS duplicate_rows,
--          count(r.id) FILTER (WHERE r.dup_status = 'conflict')::int AS conflict_rows
--   FROM public.import_batches b
--   LEFT JOIN public.import_rows r ON r.batch_id = b.id
--   GROUP BY b.id
-- )
-- SELECT b.id, b.total_rows, a.total_rows AS actual_total,
--        b.ready_rows, a.ready_rows AS actual_ready,
--        b.warning_rows, a.warning_rows AS actual_warning,
--        b.error_rows, a.error_rows AS actual_error,
--        b.duplicate_rows, a.duplicate_rows AS actual_duplicate,
--        b.conflict_rows, a.conflict_rows AS actual_conflict
-- FROM public.import_batches b
-- JOIN actual a ON a.id = b.id
-- WHERE ROW(COALESCE(b.total_rows, 0), COALESCE(b.ready_rows, 0),
--           COALESCE(b.warning_rows, 0), COALESCE(b.error_rows, 0),
--           COALESCE(b.duplicate_rows, 0), COALESCE(b.conflict_rows, 0))
--       IS DISTINCT FROM
--       ROW(a.total_rows, a.ready_rows, a.warning_rows, a.error_rows,
--           a.duplicate_rows, a.conflict_rows);
--
-- Optional trigger smoke test (all writes roll back):
-- BEGIN;
-- DO $verify$
-- DECLARE
--   v_org uuid;
--   v_batch uuid := gen_random_uuid();
--   v_counts record;
-- BEGIN
--   SELECT id INTO v_org FROM public.organisations ORDER BY id LIMIT 1;
--   IF v_org IS NULL THEN RAISE EXCEPTION 'Verification needs one organisation'; END IF;
--
--   INSERT INTO public.import_batches (id, organisation_id, country, module)
--   VALUES (v_batch, v_org, 'KSA', 'tyre');
--   INSERT INTO public.import_rows
--     (organisation_id, batch_id, validation_status, dup_status)
--   VALUES
--     (v_org, v_batch, 'ready',   'none'),
--     (v_org, v_batch, 'warning', 'duplicate'),
--     (v_org, v_batch, 'error',   'conflict');
--
--   SELECT total_rows, ready_rows, warning_rows, error_rows,
--          duplicate_rows, conflict_rows
--   INTO v_counts FROM public.import_batches WHERE id = v_batch;
--   IF ROW(v_counts.total_rows, v_counts.ready_rows, v_counts.warning_rows,
--          v_counts.error_rows, v_counts.duplicate_rows, v_counts.conflict_rows)
--      IS DISTINCT FROM ROW(3, 1, 1, 1, 1, 1) THEN
--     RAISE EXCEPTION 'V435 insert synchronization failed: %', row_to_json(v_counts);
--   END IF;
--
--   UPDATE public.import_rows
--   SET validation_status = 'ready', dup_status = 'none'
--   WHERE batch_id = v_batch AND validation_status = 'error';
--   DELETE FROM public.import_rows
--   WHERE batch_id = v_batch AND validation_status = 'warning';
--
--   SELECT total_rows, ready_rows, warning_rows, error_rows,
--          duplicate_rows, conflict_rows
--   INTO v_counts FROM public.import_batches WHERE id = v_batch;
--   IF ROW(v_counts.total_rows, v_counts.ready_rows, v_counts.warning_rows,
--          v_counts.error_rows, v_counts.duplicate_rows, v_counts.conflict_rows)
--      IS DISTINCT FROM ROW(2, 2, 0, 0, 0, 0) THEN
--     RAISE EXCEPTION 'V435 update/delete synchronization failed: %', row_to_json(v_counts);
--   END IF;
-- END
-- $verify$;
-- ROLLBACK;
