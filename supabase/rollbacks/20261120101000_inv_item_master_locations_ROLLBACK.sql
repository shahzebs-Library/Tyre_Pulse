-- ROLLBACK of 20261120101000_inv_item_master_locations.sql (run after the 102000 rollback).
-- Every material_master column it adds was checked absent on production (2026-11-20).
-- Refuses to discard opening-balance batches, master reviews, aliases or locations
-- unless `set local inv.rollback_discard = 'on'` (export them first). Locations are
-- detached from balances/movements first; the ledger rows themselves stay.
begin;
do $$ begin
  if coalesce(current_setting('inv.rollback_discard', true), '') <> 'on' and (
       exists (select 1 from public.opening_balance_batches) or exists (select 1 from public.material_master_reviews)
    or exists (select 1 from public.material_aliases) or exists (select 1 from public.inventory_locations)) then
    raise exception 'Locations, opening balances or master reviews exist; export them, then set inv.rollback_discard = on.';
  end if;
end $$;

drop function if exists public.inv_opening_batch_decide(uuid, text, text);
drop function if exists public.inv_opening_batch_submit(uuid);
drop function if exists public.inv_opening_line_map(uuid, jsonb);
drop function if exists public.inv_opening_batch_seed_legacy(uuid);
drop function if exists public.inv_opening_batch_add_line(uuid, jsonb);
drop function if exists public.inv_opening_batch_create(text, text, text, text);
drop function if exists public._inv_opening_batch_for_edit(uuid);
drop table if exists public.opening_balance_lines;
drop table if exists public.opening_balance_batches;

alter table public.stock_records drop constraint if exists stock_records_location_fk;
alter table public.stock_movements drop constraint if exists stock_movements_location_fk;
alter table public.stock_exceptions drop constraint if exists stock_exceptions_location_fk;
drop function if exists public.inv_location_upsert(jsonb);
drop table if exists public.inventory_locations;
drop function if exists public.inv_location_guard();

drop function if exists public.inv_master_review_decide(uuid, text, text);
drop function if exists public.inv_master_review_submit(jsonb);
drop function if exists public._inv_master_allowed_keys();
drop table if exists public.material_master_reviews;
drop table if exists public.material_aliases;

drop index if exists public.material_master_org_barcode_uq;
alter table public.material_master
  drop constraint if exists material_master_status_chk,
  drop constraint if exists material_master_criticality_chk,
  drop constraint if exists material_master_stock_levels_chk,
  drop column if exists stocked, drop column if exists base_uom, drop column if exists serial_tracked,
  drop column if exists lot_tracked, drop column if exists criticality, drop column if exists status,
  drop column if exists min_qty, drop column if exists max_qty, drop column if exists reorder_point,
  drop column if exists safety_stock, drop column if exists lead_time_days, drop column if exists barcode,
  drop column if exists manufacturer;
commit;
