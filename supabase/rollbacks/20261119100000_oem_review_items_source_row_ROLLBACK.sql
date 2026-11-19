-- Rollback for 20261119100000_oem_review_items_source_row.sql. NOT APPLIED.
-- Restores UNIQUE (manual_id, figure_id, part_no, pdf_page) and drops row_order.
-- GUARD: aborts if the queue now holds rows that the old key cannot represent (same part number twice
-- on one page in one figure). Resolve or delete those review rows first; the old key would drop them.

BEGIN;

DO $$
DECLARE dups bigint;
BEGIN
  SELECT count(*) INTO dups FROM (
    SELECT 1 FROM public.oem_review_items
     GROUP BY manual_id, figure_id, part_no, pdf_page HAVING count(*) > 1
  ) d;
  IF dups > 0 THEN
    RAISE EXCEPTION 'oem_review_items has % groups that repeat a part number on one page; the old key cannot hold them', dups;
  END IF;
END $$;

ALTER TABLE public.oem_review_items DROP CONSTRAINT IF EXISTS oem_review_items_unique;
ALTER TABLE public.oem_review_items
  ADD CONSTRAINT oem_review_items_unique UNIQUE (manual_id, figure_id, part_no, pdf_page);
ALTER TABLE public.oem_review_items DROP COLUMN IF EXISTS row_order;

COMMIT;
