-- ROLLBACK of 20261120108000_inv_approvals.sql (run before 107000's rollback).
-- Refuses while approval requests exist (they are the audit trail of who approved
-- what) or while an inventory approval policy is stored, unless
-- `set local inv.rollback_discard = 'on'` after exporting them. Restores the live
-- approval_policies entity_type CHECK (copied from production 2026-11-20).
begin;
do $$ begin
  if coalesce(current_setting('inv.rollback_discard', true), '') <> 'on' and (
       exists (select 1 from public.inventory_approval_requests)
    or (to_regclass('public.approval_policies') is not null
        and exists (select 1 from public.approval_policies where entity_type like 'inventory\_%'))) then
    raise exception 'Inventory approvals or inventory approval policies exist; export them, then set inv.rollback_discard = on to roll back.';
  end if;
end $$;
drop view if exists public.v_inv_pending_approvals;
drop trigger if exists trg_inv_gate_adjustment_post on public.inventory_adjustments;
drop trigger if exists trg_inv_gate_opening_approve on public.opening_balance_batches;
drop trigger if exists trg_inv_gate_recount_assign on public.inventory_audits;
alter table public.opening_balance_batches drop constraint if exists opening_balance_batches_sod_chk;
alter table public.inventory_audits drop constraint if exists inventory_audits_recount_sod_chk;
drop function if exists public.inv_cost_reconcile(jsonb);
drop function if exists public.inv_approval_decide(jsonb);
drop function if exists public.inv_request_approval(jsonb);
drop function if exists public._inv_approval_consume(text, uuid, jsonb);
drop function if exists public._inv_approval_block_reason(uuid);
drop function if exists public._inv_approval_cap(text);
drop function if exists public._inv_approval_entity(text, uuid);
drop function if exists public.inv_gate_adjustment_post();
drop function if exists public.inv_gate_opening_approve();
drop function if exists public.inv_gate_recount_assign();
drop table if exists public.inventory_approval_decisions;
drop function if exists public.inv_approval_append_only();
drop table if exists public.inventory_approval_requests;
do $$ begin
  if to_regclass('public.approval_policies') is not null then
    delete from public.approval_policies where entity_type like 'inventory\_%';
    alter table public.approval_policies drop constraint if exists approval_policies_entity_type_check;
    alter table public.approval_policies add constraint approval_policies_entity_type_check
      check (entity_type = any (array['inspection'::text, 'checklist'::text, 'work_order'::text, 'tyre_change'::text]));
  end if;
end $$;
commit;
