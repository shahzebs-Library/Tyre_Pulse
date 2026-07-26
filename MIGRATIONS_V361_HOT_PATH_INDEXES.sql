-- V361 — Indexes for the hot org+country+date read paths on the big tables.
--
-- MEASURED, not guessed. The expense aggregate behind every cost surface
-- (get_parts_expense_snapshot, get_expense_by_country, get_tyre_cost_by_asset,
-- get_expense_by_site, loadCostSplit) filters parts_consumption by
-- organisation_id + country + event_date. parts_consumption had indexes on
-- organisation_id and on the TEXT txn_date, but none on `country` and none on
-- the DATE `event_date` the RPCs actually use, so the planner chose a Parallel
-- Seq Scan over all 224k rows.
--
--   BEFORE: Parallel Seq Scan, Rows Removed by Filter: 104284 (x2), 219 ms
--   AFTER : Index Scan using parts_consumption_org_country_date_idx,  26 ms
--   -> 8.4x faster, and several of these run per screen.
--
-- Indexes only: no schema, data or policy change.

CREATE INDEX IF NOT EXISTS parts_consumption_org_country_date_idx
  ON public.parts_consumption (organisation_id, country, event_date);

CREATE INDEX IF NOT EXISTS parts_consumption_org_country_cat_idx
  ON public.parts_consumption (organisation_id, country, cost_category);

CREATE INDEX IF NOT EXISTS parts_consumption_org_asset_idx
  ON public.parts_consumption (organisation_id, asset_code);

CREATE INDEX IF NOT EXISTS wo_line_items_org_country_idx
  ON public.work_order_line_items (organisation_id, country);

CREATE INDEX IF NOT EXISTS work_orders_org_country_idx
  ON public.work_orders (organisation_id, country);
CREATE INDEX IF NOT EXISTS work_orders_org_status_idx
  ON public.work_orders (organisation_id, status);

CREATE INDEX IF NOT EXISTS tyre_records_org_country_date_idx
  ON public.tyre_records (organisation_id, country, issue_date DESC);

ANALYZE public.parts_consumption;
ANALYZE public.work_order_line_items;
ANALYZE public.work_orders;
ANALYZE public.tyre_records;

-- ============================================================================
-- REVERSIBLE:
--   DROP INDEX IF EXISTS public.parts_consumption_org_country_date_idx;
--   DROP INDEX IF EXISTS public.parts_consumption_org_country_cat_idx;
--   DROP INDEX IF EXISTS public.parts_consumption_org_asset_idx;
--   DROP INDEX IF EXISTS public.wo_line_items_org_country_idx;
--   DROP INDEX IF EXISTS public.work_orders_org_country_idx;
--   DROP INDEX IF EXISTS public.work_orders_org_status_idx;
--   DROP INDEX IF EXISTS public.tyre_records_org_country_date_idx;
-- ============================================================================
