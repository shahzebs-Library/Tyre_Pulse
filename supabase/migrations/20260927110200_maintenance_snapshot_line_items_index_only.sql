-- 20260927110200_maintenance_snapshot_line_items_index_only
--
-- WHAT: (1) new covering index work_order_line_items (organisation_id, country, opened_date)
--       INCLUDE (site, task, action); (2) get_maintenance_snapshot's `li` CTE now projects
--       only (task, action) - the only line-item columns anything downstream reads
--       (line_items/tyre_lines counts, top_tasks, top_actions). The previous projection
--       (work_order_no, asset_no, site, work_type, task, action, d) was never read past
--       the CTE. WHERE clause, every org/country/site guard and every output key untouched;
--       applied as one anchored replace() that ABORTS unless the anchor occurs exactly once.
--
-- WHY: Maintenance Cost board / Workshop dashboards call get_maintenance_snapshot. KSA-only
--      Manager, KSA YTD: 1.4-8.8 s (cold 8.8, warm 1.4). EXPLAIN (ANALYZE, BUFFERS): the li
--      CTE was a Bitmap Heap Scan on wo_line_items_date_idx reading 5,261 heap blocks
--      (5,405 buffers, almost all disk reads, ~1.0 s) for 53,299 rows and discarding 15,519
--      other-country rows. The table is ~100% all-visible, so with the narrowed projection
--      the CTE becomes an index-only scan over the (org, country, date) range.
--
-- VERIFY: output md5 identical before/after (generated_at stripped) for 6 parameter sets
--      across the KSA-only Manager and the super admin (see handback report).
--
-- ROLLBACK:
--   re-run the DO block with a/b swapped;
--   drop index public.wo_line_items_org_country_opened_cov_idx;

create index if not exists wo_line_items_org_country_opened_cov_idx
  on public.work_order_line_items (organisation_id, country, opened_date)
  include (site, task, action);

analyze public.work_order_line_items;

do $mig$
declare d text := pg_get_functiondef('public.get_maintenance_snapshot(text,text,date,date)'::regprocedure);
  a text := $a$    SELECT l.work_order_no, l.asset_no, l.site, l.work_type, l.task, l.action, l.opened_date AS d
$a$;
  b text := $a$    SELECT l.task, l.action
$a$;
begin
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'anchor not found exactly once'; end if;
  execute replace(d, a, b);
end $mig$;
