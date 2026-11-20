-- ROLLBACK of 20261120107000_inv_api_contract.sql
-- Removes the p_payload wrappers, the idempotency store and the web-named views, and
-- renames the positional implementations back to their 100000..106000 names and grants.
-- Run BEFORE the 106000..100000 rollbacks. No business data lives in these objects
-- (inventory_rpc_requests only caches answers), so nothing is lost.
begin;

do $$ declare v text; begin
  foreach v in array array['v_inv_balances','v_inv_movements','v_inv_discrepancies','v_inv_adjustments',
    'v_inv_opening_batches','v_inv_opening_lines','v_inv_master_reviews','v_inv_tyre_items','v_inv_custody_conflicts',
    'v_inv_supplier_agreements','v_inv_po_lines','v_inv_grn_lines'] loop
    execute format('drop view if exists public.%I', v);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array['inv_post_movement','inv_reverse_movement','inv_exception_resolve','inv_location_upsert',
    'inv_master_review_submit','inv_master_review_decide','inv_opening_batch_create','inv_opening_line_map',
    'inv_opening_batch_submit','inv_opening_batch_decide','inv_opening_batch_approve','inv_audit_create',
    'inv_audit_schedule','inv_audit_start','inv_count_submit','inv_audit_complete_counting','inv_audit_reconcile',
    'inv_recount_assign','inv_discrepancy_update','inv_adjustment_approve','inv_audit_close','inv_audit_cancel',
    'inv_transfer_dispatch','inv_transfer_receive','inv_transfer_return_remaining','inv_reserve','inv_issue',
    'inv_receive_goods','inv_release','inv_po_add_line','inv_supplier_invoice_create','inv_supplier_invoice_match',
    'inv_supplier_agreement_upsert','inv_tyre_item_sync','inv_tyre_store_holding','inv_tyre_disposition_record',
    'inv_tyre_conflict_decide','inv_compat_propose','inv_compat_decide'] loop
    execute format('drop function if exists public.%I(jsonb)', f);
  end loop;
end $$;
drop function if exists public.inv_audit_counter_view(uuid);
drop function if exists public._inv_req_begin(text, jsonb, boolean);
drop function if exists public._inv_req_end(text, jsonb, jsonb);
drop table if exists public.inventory_rpc_requests;

do $$
declare r record;
begin
  for r in select * from (values
    ('_inv_post_movement(jsonb)'), ('_inv_reverse_movement(uuid,text,text)'), ('_inv_exception_resolve(uuid,text,text)'),
    ('_inv_master_review_submit(jsonb)'), ('_inv_master_review_decide(uuid,text,text)'), ('_inv_location_upsert(jsonb)'),
    ('_inv_opening_batch_create(text,text,text,text)'), ('_inv_opening_batch_add_line(uuid,jsonb)'),
    ('_inv_opening_batch_seed_legacy(uuid)'), ('_inv_opening_line_map(uuid,jsonb)'), ('_inv_opening_batch_submit(uuid)'),
    ('_inv_opening_batch_decide(uuid,text,text)'),
    ('_inv_audit_create(jsonb)'), ('_inv_audit_schedule(uuid,timestamptz,uuid)'), ('_inv_audit_start(uuid)'),
    ('_inv_count_submit(uuid,text,jsonb)'), ('_inv_audit_complete_counting(uuid)'), ('_inv_audit_reconcile(uuid)'),
    ('_inv_recount_assign(uuid,uuid,uuid[])'), ('_inv_discrepancy_update(uuid,jsonb)'), ('_inv_adjustment_approve(uuid,text,text)'),
    ('_inv_audit_close(uuid,text)'), ('_inv_audit_cancel(uuid,text)'),
    ('_inv_transfer_dispatch(jsonb)'), ('_inv_transfer_receive(jsonb)'), ('_inv_transfer_return_remaining(jsonb)'),
    ('_inv_reserve(jsonb)'), ('_inv_release(uuid,numeric,text)'), ('_inv_issue(jsonb)'), ('_inv_po_add_line(uuid,jsonb)'),
    ('_inv_receive_goods(jsonb)'), ('_inv_supplier_invoice_create(jsonb)'), ('_inv_supplier_invoice_match(uuid)'),
    ('_inv_supplier_agreement_upsert(jsonb)'),
    ('_inv_tyre_item_sync(text)'), ('_inv_tyre_store_holding(jsonb)'), ('_inv_tyre_disposition_record(text,text,text,text)'),
    ('_inv_tyre_conflict_decide(uuid,text,text)'),
    ('_inv_compat_propose(jsonb)'), ('_inv_compat_decide(text,uuid,text,text)'), ('_inv_counter_view_core(uuid)')
  ) v(sig) loop
    if to_regprocedure('public.' || r.sig) is not null then
      execute format('alter function public.%s rename to %s', r.sig,
        case when r.sig like '_inv_counter_view_core%' then 'inv_audit_counter_view' else substr(split_part(r.sig, '(', 1), 2) end);
      execute format('grant execute on function public.%s to authenticated',
        case when r.sig like '_inv_counter_view_core%' then 'inv_audit_counter_view(uuid)' else substr(r.sig, 2) end);
    end if;
  end loop;
end $$;

alter table public.opening_balance_lines
  drop column if exists serial_no, drop column if exists uom, drop column if exists item_code_raw,
  drop column if exists location_code_raw, drop column if exists issues;
alter table public.opening_balance_batches drop column if exists source_filename;
update public.opening_balance_batches set source = 'import' where source in ('excel','csv','erp');
alter table public.opening_balance_batches drop constraint if exists opening_balance_batches_source_check;
alter table public.opening_balance_batches add constraint opening_balance_batches_source_check
  check (source in ('legacy_stock_records','import','manual'));
alter table public.inventory_discrepancies drop column if exists proposed_action;

commit;
