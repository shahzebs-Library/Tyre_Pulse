-- V387. The correct index for the reviewed-master lookup in the classifier.
--
-- KEEP THE HONEST FRAMING BELOW. A profiling agent reported this index as a
-- 2.89x end-to-end win (0.9027 -> 0.3120 ms/row) and called it the single
-- biggest server-side lever. I could NOT reproduce that, and the record should
-- say so rather than carry a number the next person will trust.
--
-- WHAT IS TRUE AND VERIFIED - the plan really was wrong:
--   before: Index Scan using material_master_review_idx (reviewed, txn_value)
--             Index Cond: (reviewed = true)
--             Filter: organisation_id, country, item_code
--             Rows Removed by Filter: 536      Buffers: shared hit=513
--   after:  Index Scan using mm_reviewed_lookup
--             Index Cond: (organisation_id, country, item_code)
--             Rows Removed by Filter: 0        Buffers: shared read=2
-- The old plan matched on `reviewed` alone and filtered the rest in memory, and
-- material_master_org_country_code_uidx could not serve it because the query
-- also filters on `reviewed`. 513 buffers -> 2 is a real, objective improvement.
--
-- WHAT DID NOT HOLD UP - the timing claim:
--   same-transaction A/B, 3,000 rows each, one repeated code
--       with 0.3467 ms/row   without 0.3681   -> 1.06x
--   same transaction, master forced FULLY reviewed (22,089 codes), varied codes,
--   warm-up insert discarded first
--       without 0.2753 ms/row   with 0.3001   -> no gain, slightly worse
-- Both differences sit inside the call-to-call variance of this instance, which
-- the agent itself measured at 5-7x. So the 2.89x does not reproduce, and
-- neither does the "40x worse as review progresses" extrapolation: forcing all
-- 22,089 codes reviewed did NOT slow inserts down.
--
-- WHY the plan win does not become a time win: material_master is 17 MB and
-- fully resident, so those 513 buffers were shared *hits*, not disk reads -
-- roughly tens of microseconds against a ~0.3 ms/row insert.
--
-- KEPT ANYWAY, on cost rather than on the claimed speedup: it is the
-- semantically correct index for the query, it is small, it removes 511 buffer
-- touches per row, and it is the difference between a lookup that is bounded by
-- the number of reviewed codes and one that is bounded by nothing. That
-- protection costs almost nothing today and matters if the table ever grows
-- past cache. Do NOT cite it as an import speed fix.
--
-- The real server-side cost is elsewhere: classify_parts_consumption is ~90% of
-- every parts_consumption insert, and the remaining per-row cost is inherent to
-- what it does rather than to one bad index.
--
-- Plain CREATE INDEX rather than CONCURRENTLY: 22,089 rows builds in
-- milliseconds, so the brief lock is not worth the transaction gymnastics.
create index if not exists mm_reviewed_lookup
  on public.material_master (organisation_id, country, item_code)
  where reviewed;

comment on index public.mm_reviewed_lookup is
  'Serves the reviewed-master lookup in classify_parts_consumption. Fixes a plan that matched on `reviewed` alone and filtered org/country/item_code in memory (513 buffers -> 2). NOT a measurable insert-speed win on current data - see MIGRATIONS_V387 for the measurements.';

analyze public.material_master;
