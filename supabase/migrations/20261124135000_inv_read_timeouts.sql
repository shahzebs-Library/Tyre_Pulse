-- =============================================================================
-- 20261124135000_inv_read_timeouts.sql
-- STATUS: NOT APPLIED. Read-path speed only: no table, column, policy or data change.
--
-- Why: live logs (2026-11-23/24) show these reads hitting the 8 s statement timeout
-- (HTTP 500) for real KSA users:
--   * v_inv_valuation pages offset 3000/4000 (4 failures)
--   * v_inv_erp_reconciliation 'differences' page (2 failures)
--   * work_orders open job cards, country KSA (3 failures)
--   * get_asset_master (1 failure, see note at the end)
--
-- Measured in rolled-back transactions as a real approved KSA Manager
-- (set_config('request.jwt.claims') + set local role authenticated):
--   v_inv_valuation, offset 3000 limit 1000:
--       before 4,644 ms / 444,086 buffers   after 389 ms / 52,058 buffers
--   work_orders open-only list, KSA, limit 1000:
--       before 7,661 ms cold (262 ms warm) / 89-90k buffers   after 1.9-5.7 ms / 79-959 buffers
--   v_inv_erp_reconciliation, month >= 2026-06-01, limit 1000:
--       before ~1,000 ms / ~11,200 buffers   after ~350 ms / 7,436 buffers
--   v_inv_erp_reconciliation 'differences' page + its exact count:
--       before 2 x ~1,000 ms (two aggregations), after one RPC call (one aggregation)
-- Results identical (md5 of every ordered row, as the KSA user, before vs after):
--   v_inv_erp_reconciliation all 48,090 rows and the 25-row page: identical.
--   work_orders open list: 6f427a10485ebad7101eeebe6fb8fcb6 before and after.
--   v_inv_valuation: definition unchanged (index only).
--   inv_erp_reconciliation_page rows + total equal the view page and its count.
--
-- Review A20 (2026-11-24), a DELIBERATE semantics change, documented here:
--   * an ERP line with no cost (parts_consumption.line_cost NULL, or a slip line with neither a line cost nor a
--     unit cost) was counted as 0 and made the row look "matched" or "value_diff"; it is now UNVALUED:
--     erp_value is NULL when every ERP line of the row is unvalued (0 only when the row has no ERP line at all),
--     value_difference is NULL when any ERP line is unvalued, and status reads 'unvalued' for such a row;
--   * new column erp_unvalued_lines (appended at the end, so existing column positions are unchanged).
--   The earlier "identical md5" statement below refers to the speed rewrite before this change.
--
-- REVIEW FIXES + ROLLED-BACK PROOF, ROUND 2 (2026-11-24). All 8 files applied in order (090000, 091000, 130000,
-- 131000, 132000, 133000, 120000, 135000; the 135000 work_orders index build left out of the run because of its
-- SHARE lock) in ONE implicit transaction through the Supabase CLI, then a test block as real users (claims + role
-- authenticated) ending in RAISE EXCEPTION, so everything rolled back; re-checked afterwards: purchase_orders 0,
-- test suppliers 0, test grants 0, procurement_rfqs and _inv_job_card_resolve absent, purchase_orders.updated_by
-- absent. Users: super admin d2d43a5f (SA), Store Keeper 69faeb71 (SK), Managers 34793423 (M1) / ecdcdb9e (M2);
-- extra stock / fleet grants were given INSIDE the transaction. Script: scratchpad review_round2_proof.sql.
--   A20 in the run: rows with an unvalued ERP line / erp_value NULL / status 'unvalued' = 0 / 0 / 0 today (no ERP
--   oil or parts line is currently stored without a cost), so today's numbers do not move; the work_orders partial
--   index statement was left out of this run (SHARE lock) and is unchanged from the earlier proof.
-- Not changed: get_asset_master warms at ~230 ms; the one failure was a cold read
-- under load (2,533 blocks read). Extra covering indexes were measured and gave no
-- gain, so none are added.
--
-- Locking: plain CREATE INDEX takes a SHARE lock (writes wait) while it builds;
-- work_orders is ~181 MB. Apply in a quiet window, or run the two CREATE INDEX
-- statements first as CREATE INDEX CONCURRENTLY outside a transaction.
--
-- Rollback:
--   drop function if exists public.inv_erp_reconciliation_page(text, text, text, date, date, text, integer, integer);
--   drop index if exists public.work_orders_open_opened_idx;
--   drop index if exists public.inventory_cost_reconciliations_open_stock_idx;
--   then restore the previous view text (20261120109000, lines 26-97):
--   -- =============================================================================
--   begin;
--   
--   create or replace view public.v_inv_erp_reconciliation with (security_invoker = on) as
--   with inv as (
--     select m.organisation_id, m.country, upper(btrim(coalesce(m.site, ''))) as site,
--            date_trunc('month', coalesce(ia.effective_at, m.effective_at))::date as month,
--            upper(btrim(mm.item_code)) as item_code, upper(coalesce(m.currency, public.currency_for_country(m.country))) as currency,
--            sum(-m.qty_change) as inv_qty,
--            sum(-coalesce(m.value_change, 0)) as inv_value,
--            -- unvalued + still undecided; a decided split moves its undecided count to valued/unvalued
--            sum(case when m.qty_change > 0 then -m.unvalued_qty else m.unvalued_qty end + m.pending_out_change) as inv_unvalued_qty,
--            count(*) filter (where m.movement_type <> 'cost_allocation') as inv_movements
--       from public.stock_movements m
--       join public.material_master mm on mm.id = m.item_id
--       left join public.stock_movements o on o.id = m.reverses_movement_id
--       left join public.stock_movements ia on m.movement_type = 'cost_allocation' and m.source_doc_type = 'issue_allocation'
--             and ia.id::text = m.source_doc_id
--      where m.movement_type in ('issue', 'issue_return')
--         or (m.movement_type = 'reversal' and o.movement_type in ('issue', 'issue_return'))
--         or (m.movement_type = 'cost_allocation' and ia.movement_type = 'issue')
--      group by 1, 2, 3, 4, 5, 6
--   ), pc as (
--     select p.organisation_id, p.country, upper(btrim(coalesce(p.site, ''))) as site,
--            date_trunc('month', p.event_date)::date as month, upper(btrim(p.item_code)) as item_code,
--            upper(coalesce(p.currency, public.currency_for_country(p.country))) as currency,
--            coalesce(p.qty_n, 0) as qty, coalesce(p.line_cost, 0) as value
--       from public.parts_consumption p
--      where p.event_date is not null and nullif(btrim(p.item_code), '') is not null
--   ), mi as (
--     select h.organisation_id, h.country, upper(btrim(coalesce(h.site, ''))) as site,
--            date_trunc('month', h.issued_at)::date as month, upper(btrim(l.item_code)) as item_code,
--            upper(public.currency_for_country(h.country)) as currency,
--            coalesce(l.qty, 0) as qty, coalesce(l.line_cost, coalesce(l.qty, 0) * l.unit_cost, 0) as value
--       from public.material_issues h
--       join public.material_issue_lines l on l.issue_id = h.id
--      where h.issued_at is not null and nullif(btrim(l.item_code), '') is not null
--        and lower(coalesce(h.status, '')) not in ('cancelled', 'canceled', 'void', 'draft')
--        and not exists (select 1 from public.parts_consumption p
--                         where p.organisation_id = h.organisation_id and p.issue_number = h.issue_number)
--   ), erp as (
--     select organisation_id, country, site, month, item_code, currency,
--            sum(qty) as erp_qty, sum(value) as erp_value, count(*) as erp_lines
--       from (select * from pc union all select * from mi) x
--      group by 1, 2, 3, 4, 5, 6
--   ), j as (
--     select coalesce(i.organisation_id, e.organisation_id) as organisation_id,
--            coalesce(i.country, e.country) as country, coalesce(i.site, e.site) as site,
--            coalesce(i.month, e.month) as month, coalesce(i.item_code, e.item_code) as item_code,
--            coalesce(i.currency, e.currency) as currency,
--            i.inv_qty, i.inv_value, i.inv_unvalued_qty, i.inv_movements, e.erp_qty, e.erp_value, e.erp_lines
--       from inv i
--       full join erp e on e.organisation_id = i.organisation_id and e.country is not distinct from i.country
--        and e.site = i.site and e.month = i.month and e.item_code = i.item_code and e.currency is not distinct from i.currency
--   )
--   select organisation_id, country, nullif(site, '') as site, month, item_code, currency,
--          coalesce(inv_qty, 0) as inventory_qty,
--          case when (select public.inv_can('view_value')) then round(coalesce(inv_value, 0), 2) end as inventory_value,
--          coalesce(inv_unvalued_qty, 0) as inventory_unvalued_qty,
--          coalesce(inv_movements, 0)::int as inventory_movements,
--          coalesce(erp_qty, 0) as erp_qty, round(coalesce(erp_value, 0), 2) as erp_value,
--          coalesce(erp_lines, 0)::int as erp_lines,
--          coalesce(inv_qty, 0) - coalesce(erp_qty, 0) as qty_difference,
--          case when (select public.inv_can('view_value')) then round(coalesce(inv_value, 0) - coalesce(erp_value, 0), 2) end
--            as value_difference,
--          case when inv_movements is null then 'erp_only'
--               when erp_lines is null then 'inventory_only'
--               when coalesce(inv_unvalued_qty, 0) > 0 then 'unvalued'
--               when abs(coalesce(inv_qty, 0) - coalesce(erp_qty, 0)) > 0.0001 then 'qty_diff'
--               when abs(coalesce(inv_value, 0) - coalesce(erp_value, 0)) > 0.01 then 'value_diff'
--               else 'matched' end as status
--     from j;
-- =============================================================================
begin;

-- 1. v_inv_valuation: the open-reconciliation counts read this many rows per
--    balance through an index that LEADS with organisation_id. Under RLS the org
--    test is an OR (org = app_current_org() or super admin), so the planner could
--    only use (status, stock_id) as a non-leading scan: about 53 buffers per
--    balance, twice per balance, 444k buffers for one 1,000-row page.
create index if not exists inventory_cost_reconciliations_open_stock_idx
  on public.inventory_cost_reconciliations (stock_id) where status = 'open';

-- 2. Open job cards. 49 of 97,479 work orders are open; the list walks the
--    opened_at index through every closed card to find them. The predicate is the
--    client filter in src/lib/api/workOrders.js (CLOSED_STATUS_TOKENS, openOnly)
--    written exactly as PostgREST sends it, so the planner can prove the query
--    implies it. Change both together or the index stops being used.
create index if not exists work_orders_open_opened_idx
  on public.work_orders (opened_at desc, id)
  where (status is null or (status::text not ilike 'closed' and status::text not ilike 'completed' and status::text not ilike 'complete' and status::text not ilike 'done' and status::text not ilike 'finished' and status::text not ilike 'cancelled' and status::text not ilike 'canceled' and status::text not ilike 'void' and status::text not ilike 'voided'));

-- 3. v_inv_erp_reconciliation: same columns, same order, same types, same rows.
--    The FULL JOIN on COALESCEd keys is replaced by a GROUP BY over a UNION ALL of
--    the two sides (each side is already one row per key and organisation_id is
--    NOT NULL on every source table, so the result is identical; NULL country and
--    currency still pair up as IS NOT DISTINCT FROM did). Grouping columns let a
--    filter on country / site / month / item_code / currency reach the base scans.
create or replace view public.v_inv_erp_reconciliation with (security_invoker = on) as
with inv as (
  select m.organisation_id, m.country,
         upper(btrim(coalesce(m.site, ''))) as site,
         date_trunc('month', coalesce(ia.effective_at, m.effective_at))::date as month,
         upper(btrim(mm.item_code)) as item_code,
         upper(coalesce(m.currency, public.currency_for_country(m.country))) as currency,
         sum(- m.qty_change) as inv_qty,
         sum(- coalesce(m.value_change, 0)) as inv_value,
         sum(case when m.qty_change > 0 then - m.unvalued_qty else m.unvalued_qty end + m.pending_out_change) as inv_unvalued_qty,
         count(*) filter (where m.movement_type <> 'cost_allocation') as inv_movements
    from public.stock_movements m
    join public.material_master mm on mm.id = m.item_id
    left join public.stock_movements o on o.id = m.reverses_movement_id
    left join public.stock_movements ia on m.movement_type = 'cost_allocation' and m.source_doc_type = 'issue_allocation'
                                       and ia.id::text = m.source_doc_id
   where m.movement_type = any (array['issue','issue_return'])
      or (m.movement_type = 'reversal' and o.movement_type = any (array['issue','issue_return']))
      or (m.movement_type = 'cost_allocation' and ia.movement_type = 'issue')
   group by 1, 2, 3, 4, 5, 6
), pc as (
  select p.organisation_id, p.country,
         upper(btrim(coalesce(p.site, ''))) as site,
         date_trunc('month', p.event_date::timestamptz)::date as month,
         upper(btrim(p.item_code)) as item_code,
         upper(coalesce(p.currency, public.currency_for_country(p.country))) as currency,
         coalesce(p.qty_n, 0) as qty,
         p.line_cost as value                       -- (review A20) NULL = unvalued, never 0
    from public.parts_consumption p
   where p.event_date is not null and nullif(btrim(p.item_code), '') is not null
), mi as (
  select h.organisation_id, h.country,
         upper(btrim(coalesce(h.site, ''))) as site,
         date_trunc('month', h.issued_at)::date as month,
         upper(btrim(l.item_code)) as item_code,
         upper(public.currency_for_country(h.country)) as currency,
         coalesce(l.qty, 0) as qty,
         coalesce(l.line_cost, l.qty * l.unit_cost) as value     -- (review A20) NULL = unvalued, never 0
    from public.material_issues h
    join public.material_issue_lines l on l.issue_id = h.id
   where h.issued_at is not null and nullif(btrim(l.item_code), '') is not null
     and lower(coalesce(h.status, '')) <> all (array['cancelled','canceled','void','draft'])
     and not exists (select 1 from public.parts_consumption p
                      where p.organisation_id = h.organisation_id and p.issue_number = h.issue_number)
), erp as (
  select x.organisation_id, x.country, x.site, x.month, x.item_code, x.currency,
         sum(x.qty) as erp_qty, sum(x.value) as erp_value, count(*) as erp_lines,
         count(*) filter (where x.value is null) as erp_unvalued_lines
    from (select * from pc union all select * from mi) x
   group by 1, 2, 3, 4, 5, 6
), j as (
  -- One row per key. Replaces the FULL JOIN: each side is already one row per key
  -- and organisation_id is NOT NULL on every source, so grouping the union gives
  -- exactly the full-join result (country and currency still match NULL to NULL,
  -- as IS NOT DISTINCT FROM did). Unlike a FULL JOIN on COALESCEd keys, a filter
  -- on country / site / month / item_code / currency now reaches the base scans.
  select u.organisation_id, u.country, u.site, u.month, u.item_code, u.currency,
         sum(u.inv_qty) as inv_qty, sum(u.inv_value) as inv_value,
         sum(u.inv_unvalued_qty) as inv_unvalued_qty, sum(u.inv_movements) as inv_movements,
         sum(u.erp_qty) as erp_qty, sum(u.erp_value) as erp_value, sum(u.erp_lines) as erp_lines,
         sum(u.erp_unvalued_lines) as erp_unvalued_lines
    from (
      select i.organisation_id, i.country, i.site, i.month, i.item_code, i.currency,
             i.inv_qty, i.inv_value, i.inv_unvalued_qty, i.inv_movements,
             null::numeric as erp_qty, null::numeric as erp_value, null::bigint as erp_lines,
             null::bigint as erp_unvalued_lines
        from inv i
      union all
      select e.organisation_id, e.country, e.site, e.month, e.item_code, e.currency,
             null::numeric, null::numeric, null::numeric, null::bigint,
             e.erp_qty, e.erp_value, e.erp_lines, e.erp_unvalued_lines
        from erp e
    ) u
   group by 1, 2, 3, 4, 5, 6
)
select organisation_id, country, nullif(site, '') as site, month, item_code, currency,
       coalesce(inv_qty, 0) as inventory_qty,
       case when (select public.inv_can('view_value')) then round(coalesce(inv_value, 0), 2) else null::numeric end as inventory_value,
       coalesce(inv_unvalued_qty, 0) as inventory_unvalued_qty,
       coalesce(inv_movements, 0)::integer as inventory_movements,
       coalesce(erp_qty, 0) as erp_qty,
       -- (review A20) no ERP line = a true 0; ERP lines that are all unvalued = NULL (unknown), never 0
       case when erp_lines is null then 0::numeric else round(erp_value, 2) end as erp_value,
       coalesce(erp_lines, 0)::integer as erp_lines,
       coalesce(inv_qty, 0) - coalesce(erp_qty, 0) as qty_difference,
       case when (select public.inv_can('view_value')) and coalesce(erp_unvalued_lines, 0) = 0
            then round(coalesce(inv_value, 0) - coalesce(erp_value, 0), 2) else null::numeric end as value_difference,
       case
         when inv_movements is null then 'erp_only'
         when erp_lines is null then 'inventory_only'
         when coalesce(inv_unvalued_qty, 0) > 0 or coalesce(erp_unvalued_lines, 0) > 0 then 'unvalued'
         when abs(coalesce(inv_qty, 0) - coalesce(erp_qty, 0)) > 0.0001 then 'qty_diff'
         when abs(coalesce(inv_value, 0) - coalesce(erp_value, 0)) > 0.01 then 'value_diff'
         else 'matched'
       end as status,
       coalesce(erp_unvalued_lines, 0)::integer as erp_unvalued_lines   -- (review A20) appended: ERP lines with no cost
  from j;

-- 4. One page plus its total in ONE aggregation (the client sent two requests,
--    a count and a page, each aggregating every ERP line). SECURITY INVOKER: the
--    caller's RLS applies exactly as it does to the view. p_item_like is a LIKE
--    pattern the client has already escaped. Nullable filters: custom plans.
create or replace function public.inv_erp_reconciliation_page(
  p_country text default null, p_site text default null, p_status text default null,
  p_month date default null, p_month_from date default null, p_item_like text default null,
  p_offset integer default 0, p_limit integer default 25)
returns jsonb
language sql stable security invoker
set search_path = public
set plan_cache_mode = force_custom_plan
as $fn$
  with f as (
    select v.* from public.v_inv_erp_reconciliation v
     where (p_country is null or v.country = p_country or v.country is null)
       and (p_site is null or v.site = p_site)
       and (p_status is null
            or (p_status = 'differences' and v.status <> 'matched')
            or (p_status <> 'differences' and v.status = p_status))
       and (p_month is null or v.month = p_month)
       and (p_month_from is null or v.month >= p_month_from)
       and (p_item_like is null or v.item_code ilike p_item_like)
  ), p as (
    select f.*, count(*) over () as _total
      from f
     order by month desc, country, site, item_code, currency
    offset greatest(coalesce(p_offset, 0), 0)
     limit least(greatest(coalesce(p_limit, 25), 1), 5000)
  )
  select jsonb_build_object(
    'total', coalesce((select max(_total) from p), (select count(*) from f)),
    'rows', coalesce((select jsonb_agg(to_jsonb(p) - '_total' order by month desc, country, site, item_code, currency) from p), '[]'::jsonb));
$fn$;
revoke all on function public.inv_erp_reconciliation_page(text, text, text, date, date, text, integer, integer) from public, anon;
grant execute on function public.inv_erp_reconciliation_page(text, text, text, date, date, text, integer, integer) to authenticated, service_role;

commit;
