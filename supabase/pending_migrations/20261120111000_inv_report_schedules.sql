-- =============================================================================
-- 20261120111000_inv_report_schedules.sql
-- STATUS: AUTHORED, NOT APPLIED. Scheduled inventory digest. Requires 20261120100000..110000.
--         Rollback: 20261120111000_inv_report_schedules_ROLLBACK.sql
--
--   * report_schedules.report_type gains 'inventory' (the live list, copied from
--     production 2026-11-20, plus 'inventory'; builder:% stays allowed).
--   * v_inv_report_snapshot (security_invoker, read-only): the digest rows per
--     organisation / country / site / currency - balances, quantities, valued part
--     and unvalued part (never summed together, money NULL without stock:view_value),
--     valuation_complete, low/critical lines, open shortages, open discrepancies,
--     open cost reconciliations and pending inventory approvals. One currency per
--     row: nothing is ever added across currencies.
-- NOT included here: the send-scheduled-reports edge function branch for
-- 'inventory' (an edge-function deploy is a separate, owner-approved step; until
-- then an 'inventory' schedule emails the generic fallback).
-- =============================================================================
begin;

alter table public.report_schedules drop constraint if exists report_schedules_report_type_check;
alter table public.report_schedules add constraint report_schedules_report_type_check check ((report_type = any (array[
  'executive'::text, 'kpi'::text, 'fleet'::text, 'inspection'::text, 'cost'::text, 'accidents'::text, 'claims'::text,
  'stock'::text, 'vendor'::text, 'pm'::text, 'workshop'::text, 'workshop_status'::text, 'tyre_stock_alert'::text,
  'inventory'::text])) or (report_type ~~ 'builder:%'::text));

create or replace view public.v_inv_report_snapshot with (security_invoker = on) as
with b as (
  select s.organisation_id, s.country, s.site, upper(coalesce(s.currency, public.currency_for_country(s.country))) as currency,
         count(*) filter (where s.qty_on_hand > 0) as balances,
         sum(s.qty_on_hand) as qty_on_hand, sum(s.qty_reserved) as qty_reserved,
         sum(s.valued_qty) filter (where s.ownership = 'owned') as owned_valued_qty,
         sum(s.unvalued_qty) filter (where s.ownership = 'owned') as owned_unvalued_qty,
         sum(s.pending_allocation_out_qty + s.pending_allocation_in_qty) filter (where s.ownership = 'owned') as owned_pending_qty,
         sum(s.valued_value) filter (where s.ownership = 'owned') as owned_valued_value,
         count(*) filter (where s.stock_status = 'Critical') as critical_lines,
         count(*) filter (where s.stock_status = 'Low') as low_lines
    from public.stock_records s
   where s.item_id is not null or s.qty_on_hand > 0
   group by 1, 2, 3, 4
)
select b.organisation_id, b.country, b.site, b.currency, b.balances, b.qty_on_hand, b.qty_reserved,
       coalesce(b.owned_valued_qty, 0) as owned_valued_qty, coalesce(b.owned_unvalued_qty, 0) as owned_unvalued_qty,
       case when (select public.inv_can('view_value')) then round(coalesce(b.owned_valued_value, 0), 2) end as owned_valued_amount,
       coalesce(b.owned_unvalued_qty, 0) = 0 and coalesce(b.owned_pending_qty, 0) = 0 as valuation_complete,
       coalesce(b.owned_pending_qty, 0) as owned_pending_allocation_qty,
       b.critical_lines, b.low_lines,
       (select count(*) from public.stock_exceptions x where x.organisation_id = b.organisation_id and x.status = 'open'
          and x.country is not distinct from b.country and x.site is not distinct from b.site)::int as open_exceptions,
       (select count(*) from public.inventory_discrepancies d where d.organisation_id = b.organisation_id
          and d.status in ('open','investigating','recount_requested','proposed')
          and d.country is not distinct from b.country and d.site is not distinct from b.site)::int as open_discrepancies,
       (select count(*) from public.inventory_cost_reconciliations r where r.organisation_id = b.organisation_id
          and r.status = 'open' and r.country is not distinct from b.country and r.site is not distinct from b.site
          and upper(coalesce(r.currency, b.currency)) = b.currency)::int as open_cost_reconciliations,
       (select count(*) from public.inventory_approval_requests a where a.organisation_id = b.organisation_id
          and a.status = 'pending' and a.country is not distinct from b.country and a.site is not distinct from b.site)::int
         as pending_approvals,
       now() as generated_at
  from b;
revoke all on public.v_inv_report_snapshot from anon;
grant select on public.v_inv_report_snapshot to authenticated;

commit;
