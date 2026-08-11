-- MIGRATIONS_V494_EXPENSE_COUNTRY_ISOLATION.sql
-- STATUS: APPLIED LIVE 2026-08-10 (project jhssdmeruxtrlqnwfksc), verified by impersonation.
--
-- WHY
-- An enterprise-buyer security audit reproduced a cross-country data leak on the
-- financial ledger. `parts_consumption` (208,375 rows) and `work_order_line_items`
-- (184,025 rows) carried org isolation ONLY - no country policy - while
-- `tyre_records` / `work_orders` carry org + country + site. So an ordinary
-- approved KSA-only Manager, with no tooling, read every UAE and Egyptian cost
-- line simply by opening the Expenses page:
--
--   as a real KSA-only Manager, BEFORE:
--     KSA    108,384 rows  SAR 40,981,403
--     UAE     59,745 rows  AED 15,581,824   <-- leak
--     Egypt   40,246 rows  EGP 79,315,468   <-- leak
--
-- The SECURITY DEFINER cost RPCs were never the leak (V461 already guards the
-- Cost/M3 family with app_can_see_country); only the direct table reads leaked.
--
-- THE PREDICATE IS COPIED VERBATIM from tyre_records_country_isolation /
-- work_orders_country_isolation - do not invent a variant. The zero-arg scope
-- readers (V396) are wrapped in (select ...) so they evaluate ONCE per query as
-- an InitPlan; a row-dependent helper here would reintroduce the per-row RLS
-- cost that V396 removed.
--
-- SELECT ONLY, matching the existing pattern: writes stay governed by the role
-- policies, exactly as on tyre_records.
--
-- BLAST RADIUS MEASURED BEFORE APPLYING (36 approved, unlocked users):
--   31  scoped KSA          -> now see KSA only          (already true for tyres)
--    2  scoped Egypt        -> now see Egypt only
--    1  scoped KSA+UAE+Egypt-> unchanged, sees all three
--    2  org admins          -> unchanged, see all three
--    0  users with NO country scope -> NOBODY is blacked out by this change.
-- Both tables have ZERO null-country rows, so the `country is null` clause is
-- inert today and exists only for future rows / consistency with the pattern.
--
-- VERIFIED AFTER APPLYING (impersonation, one transaction per user because
-- app_country_scope() is STABLE and caches within a single statement - a
-- combined multi-user test silently reports one user's scope for all of them):
--   KSA-only Manager            -> parts 108,384 KSA / lines 144,895 KSA, no UAE, no Egypt
--   super admin                 -> all three countries
--   tri-country Planning Eng.   -> all three countries
--   Egypt Tyre Data Collector   -> Egypt only
--   Egypt Director (org e340fa7a) -> 0 rows BEFORE and AFTER; that is the
--     pre-existing empty-org issue already recorded in PROJECT_MEMORY, NOT
--     caused by this migration.
--
-- ROLLBACK
--   drop policy parts_consumption_country_isolation on public.parts_consumption;
--   drop policy wo_line_items_country_isolation on public.work_order_line_items;

drop policy if exists parts_consumption_country_isolation on public.parts_consumption;
create policy parts_consumption_country_isolation on public.parts_consumption
  as restrictive for select to public
  using (
    country is null
    or (select public.app_is_org_admin())
    or (select public.app_sees_all_countries())
    or lower(btrim(country::text)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))
  );

drop policy if exists wo_line_items_country_isolation on public.work_order_line_items;
create policy wo_line_items_country_isolation on public.work_order_line_items
  as restrictive for select to public
  using (
    country is null
    or (select public.app_is_org_admin())
    or (select public.app_sees_all_countries())
    or lower(btrim(country::text)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))
  );

-- STILL OPEN after this migration (recorded, deliberately not changed here):
--  * 52 policies on 52 tables use app_is_org_admin() (= super admin OR any plain
--    Admin), which is a country bypass for every plain Admin. Harmless in a
--    single-tenant deployment with 2 admins; must be narrowed before a customer
--    has regional administrators.
--  * 140 of 219 country-bearing tables still have no country policy. The two
--    fixed here are the ones holding money; the rest need the same sweep.
