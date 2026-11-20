-- =============================================================================
-- 20261120109000_inv_erp_reconciliation.sql
-- STATUS: AUTHORED, NOT APPLIED. Read-only inventory vs ERP reconciliation.
--         Requires 20261120100000..108000. Rollback: 20261120109000_inv_erp_reconciliation_ROLLBACK.sql
--
-- v_inv_erp_reconciliation (security_invoker): one row per
--   organisation / country / site / month / item_code / currency
-- comparing
--   * INVENTORY issues: stock_movements issue minus issue_return (and reversals of
--     either), quantity, valued value (the valued part only) and unvalued quantity;
--   * ERP material: parts_consumption (qty_n, line_cost by event_date) plus
--     material_issues lines whose issue_number is NOT already in parts_consumption
--     for that company (so an ERP issue is never counted twice).
-- status: matched | qty_diff | value_diff | inventory_only | erp_only | unvalued.
--
-- It POSTS NOTHING, writes nothing and changes no expense figure: it only reads.
-- Currencies are part of the key and are never summed together. Org, country and
-- site scoping (and blind-count hiding of stock movements) come from the base tables'
-- RLS because the view runs as the caller. Inventory money is NULL without
-- stock:view_value. Matching is by item_code text (upper, trimmed): items whose
-- codes differ between the item master and the ERP show as inventory_only /
-- erp_only, which is the honest answer until the master is aligned.
-- =============================================================================
begin;

create or replace view public.v_inv_erp_reconciliation with (security_invoker = on) as
with inv as (
  select m.organisation_id, m.country, upper(btrim(coalesce(m.site, ''))) as site,
         date_trunc('month', m.effective_at)::date as month,
         upper(btrim(mm.item_code)) as item_code, upper(coalesce(m.currency, public.currency_for_country(m.country))) as currency,
         sum(-m.qty_change) as inv_qty,
         sum(-coalesce(m.value_change, 0)) as inv_value,
         sum(case when m.qty_change < 0 then m.unvalued_qty else -m.unvalued_qty end) as inv_unvalued_qty,
         count(*) as inv_movements
    from public.stock_movements m
    join public.material_master mm on mm.id = m.item_id
    left join public.stock_movements o on o.id = m.reverses_movement_id
   where m.movement_type in ('issue', 'issue_return')
      or (m.movement_type = 'reversal' and o.movement_type in ('issue', 'issue_return'))
   group by 1, 2, 3, 4, 5, 6
), pc as (
  select p.organisation_id, p.country, upper(btrim(coalesce(p.site, ''))) as site,
         date_trunc('month', p.event_date)::date as month, upper(btrim(p.item_code)) as item_code,
         upper(coalesce(p.currency, public.currency_for_country(p.country))) as currency,
         coalesce(p.qty_n, 0) as qty, coalesce(p.line_cost, 0) as value
    from public.parts_consumption p
   where p.event_date is not null and nullif(btrim(p.item_code), '') is not null
), mi as (
  select h.organisation_id, h.country, upper(btrim(coalesce(h.site, ''))) as site,
         date_trunc('month', h.issued_at)::date as month, upper(btrim(l.item_code)) as item_code,
         upper(public.currency_for_country(h.country)) as currency,
         coalesce(l.qty, 0) as qty, coalesce(l.line_cost, coalesce(l.qty, 0) * l.unit_cost, 0) as value
    from public.material_issues h
    join public.material_issue_lines l on l.issue_id = h.id
   where h.issued_at is not null and nullif(btrim(l.item_code), '') is not null
     and lower(coalesce(h.status, '')) not in ('cancelled', 'canceled', 'void', 'draft')
     and not exists (select 1 from public.parts_consumption p
                      where p.organisation_id = h.organisation_id and p.issue_number = h.issue_number)
), erp as (
  select organisation_id, country, site, month, item_code, currency,
         sum(qty) as erp_qty, sum(value) as erp_value, count(*) as erp_lines
    from (select * from pc union all select * from mi) x
   group by 1, 2, 3, 4, 5, 6
), j as (
  select coalesce(i.organisation_id, e.organisation_id) as organisation_id,
         coalesce(i.country, e.country) as country, coalesce(i.site, e.site) as site,
         coalesce(i.month, e.month) as month, coalesce(i.item_code, e.item_code) as item_code,
         coalesce(i.currency, e.currency) as currency,
         i.inv_qty, i.inv_value, i.inv_unvalued_qty, i.inv_movements, e.erp_qty, e.erp_value, e.erp_lines
    from inv i
    full join erp e on e.organisation_id = i.organisation_id and e.country is not distinct from i.country
     and e.site = i.site and e.month = i.month and e.item_code = i.item_code and e.currency is not distinct from i.currency
)
select organisation_id, country, nullif(site, '') as site, month, item_code, currency,
       coalesce(inv_qty, 0) as inventory_qty,
       case when (select public.inv_can('view_value')) then round(coalesce(inv_value, 0), 2) end as inventory_value,
       coalesce(inv_unvalued_qty, 0) as inventory_unvalued_qty,
       coalesce(inv_movements, 0)::int as inventory_movements,
       coalesce(erp_qty, 0) as erp_qty, round(coalesce(erp_value, 0), 2) as erp_value,
       coalesce(erp_lines, 0)::int as erp_lines,
       coalesce(inv_qty, 0) - coalesce(erp_qty, 0) as qty_difference,
       case when (select public.inv_can('view_value')) then round(coalesce(inv_value, 0) - coalesce(erp_value, 0), 2) end
         as value_difference,
       case when inv_movements is null then 'erp_only'
            when erp_lines is null then 'inventory_only'
            when coalesce(inv_unvalued_qty, 0) > 0 then 'unvalued'
            when abs(coalesce(inv_qty, 0) - coalesce(erp_qty, 0)) > 0.0001 then 'qty_diff'
            when abs(coalesce(inv_value, 0) - coalesce(erp_value, 0)) > 0.01 then 'value_diff'
            else 'matched' end as status
  from j;
revoke all on public.v_inv_erp_reconciliation from anon;
grant select on public.v_inv_erp_reconciliation to authenticated;
comment on view public.v_inv_erp_reconciliation is
  'Read-only inventory issues vs ERP material (parts_consumption + material_issues not already in it) per org/country/site/month/item/currency. Posts nothing; never sums currencies.';

commit;
