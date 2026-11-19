-- OEM review queue: one row per SOURCE row, not per part number.
-- STATUS: AUTHORED, NOT APPLIED. Needs owner approval. Rollback: 20261119100000_oem_review_items_source_row_ROLLBACK.sql
-- Depends on: 20261118100000_oem_catalog_advanced.sql (applied in production 2026-11-19).
--
-- Why: oem_review_items was unique on (manual_id, figure_id, part_no, pdf_page). A parts book often
-- lists the SAME part number twice on one page at different callouts (left and right bracket, two
-- bolts). The client upserted with ignoreDuplicates, so the second source row was silently dropped
-- from the review queue and could never be published. The source row is identified by its page and
-- its row order on that page, exactly like oem_parts_entries (manual_id, source_pdf_page, row_order).
--
-- What it does (additive, no row is changed except the row_order backfill from its own payload):
--   1. adds nullable row_order integer
--   2. backfills row_order from payload->>'row_order' where the payload carries a whole number
--   3. GUARD: aborts unless the table is empty or the new key has no duplicates
--   4. replaces oem_review_items_unique with UNIQUE (manual_id, pdf_page, row_order)
-- Rows without a row_order (NULL) never conflict, so nothing existing can make the new key fail.
--
-- VERIFY (run after applying):
--   select column_name, data_type from information_schema.columns
--    where table_schema='public' and table_name='oem_review_items' and column_name='row_order';      -- 1 row, integer
--   select pg_get_constraintdef(oid) from pg_constraint where conname='oem_review_items_unique';    -- UNIQUE (manual_id, pdf_page, row_order)
--   select count(*) from (select manual_id, pdf_page, row_order from public.oem_review_items
--     where row_order is not null group by 1,2,3 having count(*) > 1) d;                           -- 0
--   select count(*) filter (where row_order is null) as no_row_order, count(*) as total from public.oem_review_items;

BEGIN;

ALTER TABLE public.oem_review_items ADD COLUMN IF NOT EXISTS row_order integer;

UPDATE public.oem_review_items
   SET row_order = (payload->>'row_order')::integer
 WHERE row_order IS NULL
   AND payload->>'row_order' ~ '^[0-9]{1,9}$';

DO $$
DECLARE total bigint; dups bigint;
BEGIN
  SELECT count(*) INTO total FROM public.oem_review_items;
  SELECT count(*) INTO dups FROM (
    SELECT 1 FROM public.oem_review_items
     WHERE row_order IS NOT NULL
     GROUP BY manual_id, pdf_page, row_order HAVING count(*) > 1
  ) d;
  IF total > 0 AND dups > 0 THEN
    RAISE EXCEPTION 'oem_review_items has % duplicate (manual_id, pdf_page, row_order) groups; resolve them before applying', dups;
  END IF;
END $$;

ALTER TABLE public.oem_review_items DROP CONSTRAINT IF EXISTS oem_review_items_unique;
ALTER TABLE public.oem_review_items
  ADD CONSTRAINT oem_review_items_unique UNIQUE (manual_id, pdf_page, row_order);

COMMIT;
