-- ROLLBACK of 20261120103000_inv_transfers_procurement.sql (run after the 104000 rollback).
-- Every column this migration adds to purchase_orders / goods_receipts was checked
-- absent on production (2026-11-20), so dropping them removes nothing that existed.
-- Refuses to discard transfers, reservations, PO/GRN lines, invoices, agreements or
-- consignment records unless `set local inv.rollback_discard = 'on'` (export first).
begin;
do $$ begin
  if coalesce(current_setting('inv.rollback_discard', true), '') <> 'on' and (
       exists (select 1 from public.stock_transfers) or exists (select 1 from public.stock_reservations)
    or exists (select 1 from public.purchase_order_lines) or exists (select 1 from public.goods_receipt_lines)
    or exists (select 1 from public.supplier_invoices) or exists (select 1 from public.supplier_agreements)
    or exists (select 1 from public.consignment_consumptions)) then
    raise exception 'Transfer / procurement records exist; export them, then set inv.rollback_discard = on.';
  end if;
end $$;
drop function if exists public.inv_supplier_agreement_upsert(jsonb);
drop function if exists public.inv_supplier_invoice_match(uuid);
drop function if exists public.inv_supplier_invoice_create(jsonb);
drop function if exists public.inv_receive_goods(jsonb);
drop function if exists public.inv_po_add_line(uuid, jsonb);
drop function if exists public.inv_issue(jsonb);
drop function if exists public.inv_release(uuid, numeric, text);
drop function if exists public.inv_reserve(jsonb);
drop function if exists public.inv_transfer_return_remaining(jsonb);
drop function if exists public.inv_transfer_receive(jsonb);
drop function if exists public._inv_transfer_move(jsonb, text);
drop function if exists public.inv_transfer_dispatch(jsonb);
drop function if exists public._inv_transit_location(uuid, text, text);
drop table if exists public.supplier_invoice_lines;
drop table if exists public.supplier_invoices;
drop table if exists public.goods_receipt_lines;
drop table if exists public.purchase_order_lines;
drop table if exists public.consignment_consumptions;
drop table if exists public.supplier_agreements;
drop table if exists public.stock_reservations;
drop table if exists public.stock_transfer_lines;
drop table if exists public.stock_transfers;
drop index if exists public.goods_receipts_org_idempotency_uq;
alter table public.goods_receipts drop column if exists supplier_id, drop column if exists po_id,
  drop column if exists idempotency_key, drop column if exists received_by_id;
alter table public.purchase_orders drop column if exists supplier_id, drop column if exists currency;
-- IN-TRANSIT locations created by dispatch are removed with the 101000 rollback.
commit;
