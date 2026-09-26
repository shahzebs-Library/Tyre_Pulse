-- 20260926101000_site_options_covering_indexes
--
-- PURPOSE
--   reference_site_options(p_country) feeds every site picker in the web + mobile
--   apps. It timed out (57014) 3 times in the last 24h and measured 9,232 ms cold /
--   622 ms warm as a real KSA Manager after the 40001 retry loop was stopped, against
--   the authenticated role's 8 s statement_timeout. The cost is the work_orders arm:
--   SELECT DISTINCT btrim(site), country ... WHERE organisation_id = app_current_org()
--   used work_orders_org_country_created_idx and then fetched the heap for every one
--   of ~93k rows (60k buffers) just to return 56 distinct sites.
--
--   A covering (organisation_id, country, site) index lets the planner answer the
--   arm with an Index Only Scan (work_orders visibility map is ~100% all-visible).
--   tyre_records gets the same shape (second largest arm).
--
-- MEASURED (rolled-back txn, whole function body, KSA, real Manager JWT, warm, run twice)
--   before: 124 ms, 61,862 shared buffers
--   after : 79 ms,  10,282 shared buffers, plan uses the new index, Index Only Scan
--
-- VERIFY
--   explain the function body as the definer with a Manager's request.jwt.claims:
--   expect "Index Only Scan using work_orders_org_country_site_idx".
--
-- ROLLBACK
--   drop index if exists public.work_orders_org_country_site_idx;
--   drop index if exists public.tyre_records_org_country_site_idx;

create index if not exists work_orders_org_country_site_idx
  on public.work_orders (organisation_id, country, site);
create index if not exists tyre_records_org_country_site_idx
  on public.tyre_records (organisation_id, country, site);

analyze public.work_orders;
analyze public.tyre_records;
