-- =============================================================================
-- 20261120104000_inv_valuation.sql
-- STATUS: AUTHORED, NOT APPLIED. Inventory WP4 valuation. Requires 20261120100000..103000.
--         Rollback: 20261120104000_inv_valuation_ROLLBACK.sql
--
-- Perpetual weighted average per balance row (org, country, location, item,
-- condition, ownership, owner supplier) in that row's own currency is computed by
-- the single writer _inv_post (20261120100000), mirroring
-- src/lib/inventory/valuation.js (docs/inventory/20_VALUATION_RULES.md):
-- valued_qty/valued_value carry the average, unvalued_qty is never priced at 0,
-- outbound takes unvalued units first, currencies are never mixed.
--
-- This file adds READ surfaces only:
--   * v_inventory_valuation (security_invoker): one row per balance. Money
--     columns are NULL unless the caller holds stock:view_value.
--   * inv_valuation_summary(country): per currency - owned value (NULL while any
--     owned unit is unvalued, reason unvalued_stock_present, with valued_value and
--     priced_pct beside it), consignment at the agreed price (excluded from owned
--     value), supplier custody quantity.
-- Separation: nothing here reads or writes parts_consumption, and no cost reader
-- may read stock_movements.value_change (comment below; CI scan in the web lane).
-- =============================================================================
begin;

comment on column public.stock_movements.value_change is
  'Inventory (balance sheet) value only. NEVER summed into maintenance cost, CPK or cost per m3; parts_consumption stays the cost source.';
comment on column public.stock_records.valued_value is
  'Weighted-average value of valued units only. Unvalued units (unvalued_qty) are never priced at 0.';

create or replace view public.v_inventory_valuation with (security_invoker = on) as
select s.id as stock_id, s.organisation_id, s.country, s.site, s.location_id, s.item_id, s.description,
       s.condition, s.ownership, s.owner_supplier_id, s.currency,
       s.qty_on_hand, s.qty_reserved, s.qty_on_hand - s.qty_reserved as qty_available,
       s.valued_qty, s.unvalued_qty,
       case when (select public.inv_can('view_value')) then s.valued_value end as valued_value,
       case when (select public.inv_can('view_value')) then s.avg_unit_cost end as avg_unit_cost,
       case when s.qty_on_hand = 0 then 'empty'
            when s.unvalued_qty = 0 then 'valued'
            when s.valued_qty = 0 then 'unvalued'
            else 'partially_valued' end as valuation_status,
       s.last_receipt_at, s.last_issue_at
  from public.stock_records s;
revoke all on public.v_inventory_valuation from anon;
grant select on public.v_inventory_valuation to authenticated;

create or replace function public.inv_valuation_summary(p_country text default null)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $fn$
declare v jsonb;
begin
  if not public.inv_can('view_value') then
    raise exception 'Stock permission "view_value" is required.' using errcode = '42501';
  end if;
  with b as (
    select s.*, upper(s.currency) as cur from public.stock_records s
     where s.qty_on_hand > 0 and (p_country is null or lower(s.country) = lower(p_country))
  ), agreed as (
    select b.id, (select (a.agreed_prices ->> b.item_id::text)::numeric from public.supplier_agreements a
                   where a.organisation_id = b.organisation_id and a.supplier_id = b.owner_supplier_id
                     and a.agreement_type = 'consignment' and a.status = 'active'
                   order by a.starts_on desc nulls last limit 1) as price
      from b where b.ownership = 'consignment'
  ), per as (
    select coalesce(b.cur, 'UNKNOWN') as currency,
      sum(b.valued_value) filter (where b.ownership = 'owned') as owned_valued_value,
      sum(b.valued_qty) filter (where b.ownership = 'owned') as owned_valued_qty,
      sum(b.unvalued_qty) filter (where b.ownership = 'owned') as owned_unvalued_qty,
      count(*) filter (where b.ownership = 'owned' and b.unvalued_qty > 0 and b.valued_qty > 0) as partial_lines,
      count(*) filter (where b.ownership = 'owned' and b.unvalued_qty > 0 and b.valued_qty = 0) as unvalued_lines,
      sum(b.qty_on_hand) filter (where b.ownership = 'consignment') as consignment_qty,
      sum(b.qty_on_hand * a.price) filter (where b.ownership = 'consignment') as consignment_agreed_value,
      count(*) filter (where b.ownership = 'consignment' and a.price is null) as consignment_without_price,
      sum(b.qty_on_hand) filter (where b.ownership = 'supplier') as supplier_custody_qty
    from b left join agreed a on a.id = b.id group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'currency', currency,
      'owned_value', case when coalesce(owned_unvalued_qty, 0) = 0 then round(coalesce(owned_valued_value, 0), 2) end,
      'owned_value_reason', case when coalesce(owned_unvalued_qty, 0) > 0 then 'unvalued_stock_present' end,
      'owned_valued_value', round(coalesce(owned_valued_value, 0), 2),
      'owned_unvalued_qty', coalesce(owned_unvalued_qty, 0),
      'priced_pct', case when coalesce(owned_valued_qty, 0) + coalesce(owned_unvalued_qty, 0) > 0
        then round(100 * coalesce(owned_valued_qty, 0) / (coalesce(owned_valued_qty, 0) + coalesce(owned_unvalued_qty, 0)), 1) end,
      'partial_lines', partial_lines, 'unvalued_lines', unvalued_lines,
      'consignment_qty', coalesce(consignment_qty, 0),
      'consignment_agreed_value', round(consignment_agreed_value, 2),
      'consignment_without_price', consignment_without_price,
      'supplier_custody_qty', coalesce(supplier_custody_qty, 0)) order by currency), '[]'::jsonb)
    into v from per;
  return jsonb_build_object('by_currency', v, 'mixed_currency', jsonb_array_length(v) > 1,
    'note', 'Per currency; never summed across currencies. Inventory value is not maintenance cost.');
end $fn$;
revoke all on function public.inv_valuation_summary(text) from public, anon;
grant execute on function public.inv_valuation_summary(text) to authenticated;

commit;
