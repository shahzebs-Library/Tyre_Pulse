-- ROLLBACK of 20261120102000_inv_physical_audits.sql (run after the 103000 rollback).
-- Removes the blind-count policies and the audit tables and puts back the P0 stub of
-- inv_blind_hides_balance. Adjustments already approved are LEDGER movements and stay
-- (the 100000 rollback decides about the ledger). Refuses to discard audit records
-- unless `set local inv.rollback_discard = 'on'` (export them first).
begin;
do $$ begin
  if coalesce(current_setting('inv.rollback_discard', true), '') <> 'on'
     and exists (select 1 from public.inventory_audits) then
    raise exception 'Physical audit records exist; export them, then set inv.rollback_discard = on.';
  end if;
end $$;
drop policy if exists stock_records_blind_count on public.stock_records;
drop policy if exists stock_movements_blind_count on public.stock_movements;
drop policy if exists stock_exceptions_blind_count on public.stock_exceptions;
drop policy if exists opening_balance_lines_blind_count on public.opening_balance_lines;

drop function if exists public.inv_audit_cancel(uuid, text);
drop function if exists public.inv_audit_close(uuid, text);
drop function if exists public.inv_adjustment_approve(uuid, text, text);
drop function if exists public.inv_discrepancy_update(uuid, jsonb);
drop function if exists public.inv_recount_assign(uuid, uuid, uuid[]);
drop function if exists public.inv_audit_reconcile(uuid);
drop function if exists public.inv_audit_complete_counting(uuid);
drop function if exists public.inv_count_submit(uuid, text, jsonb);
drop function if exists public.inv_audit_counter_view(uuid);
drop function if exists public.inv_audit_start(uuid);
drop function if exists public.inv_audit_schedule(uuid, timestamptz, uuid);
drop function if exists public.inv_audit_create(jsonb);
drop function if exists public._inv_audit_lock(uuid);

drop table if exists public.inventory_adjustments;
drop table if exists public.inventory_discrepancies;
drop table if exists public.inventory_count_lines;
drop table if exists public.inventory_audit_snapshot_lines;
drop table if exists public.inventory_audits;

drop function if exists public._inv_audit_can_see_expected(uuid);
drop function if exists public._inv_audit_open_for_counter(text);
drop function if exists public.inv_canon_serial(text);

-- back to the P0 stub (no blind audits exist any more)
create or replace function public.inv_blind_hides_balance(p_org uuid, p_site text, p_location uuid, p_item uuid)
returns boolean language sql stable security definer set search_path = public as $$ select false $$;
revoke all on function public.inv_blind_hides_balance(uuid, text, uuid, uuid) from public, anon, authenticated;
commit;
