-- ROLLBACK of 20261120114000_inv_tyre_conflict_investigation.sql.
-- Refuses while any tyre case has left 'open' (an investigation record would be lost)
-- unless `set local inv.rollback_discard = 'on'` is set after exporting
-- v_inv_tyre_conflict_cases. Restores the three patched functions verbatim from
-- _bak.inv_114000_snapshot, drops the workflow functions, the view, the columns and
-- the widened entity types. No tyre_records / tyre_status_marks row is touched.
begin;

do $$ begin
  if exists (select 1 from public.tyre_custody_conflicts where investigation_status <> 'open')
     and coalesce(current_setting('inv.rollback_discard', true), '') <> 'on' then
    raise exception '114000 rollback refused: tyre investigations exist. Export them, then set inv.rollback_discard = on.';
  end if;
end $$;

drop trigger if exists trg_inv_tyre_case_follow_approval on public.inventory_approval_requests;
drop function if exists public.inv_tyre_case_follow_approval();
drop view if exists public.v_inv_tyre_conflict_cases;
drop function if exists public.inv_tyre_conflict_close(jsonb);
drop function if exists public.inv_tyre_conflict_propose(jsonb);
drop function if exists public.inv_tyre_conflict_investigate(jsonb);
drop function if exists public.inv_tyre_conflict_assign(jsonb);
drop function if exists public._inv_tyre_case_event(public.tyre_custody_conflicts, text, jsonb);
drop function if exists public._inv_tyre_case(uuid);
drop function if exists public.inv_tyre_investigator_roles();

do $$
declare r record;
begin
  if to_regclass('_bak.inv_114000_snapshot') is null then return; end if;
  for r in select obj, def from _bak.inv_114000_snapshot order by obj loop
    if to_regprocedure(r.obj) is not null then execute r.def; end if;
  end loop;
end $$;
drop table if exists _bak.inv_114000_snapshot;

-- requests of the removed type cannot stay under the narrower CHECK
do $$ begin
  if exists (select 1 from public.inventory_approval_requests where entity_type = 'tyre_conflict_correction') then
    if coalesce(current_setting('inv.rollback_discard', true), '') <> 'on' then
      raise exception '114000 rollback refused: tyre correction approval requests exist.';
    end if;
    alter table public.inventory_approval_decisions disable trigger trg_inv_approval_decisions_append_only;
    delete from public.inventory_approval_decisions d using public.inventory_approval_requests r
     where d.request_id = r.id and r.entity_type = 'tyre_conflict_correction';
    alter table public.inventory_approval_decisions enable trigger trg_inv_approval_decisions_append_only;
    delete from public.inventory_approval_requests where entity_type = 'tyre_conflict_correction';
  end if;
end $$;
alter table public.inventory_approval_requests drop constraint if exists inventory_approval_requests_entity_type_check;
alter table public.inventory_approval_requests add constraint inventory_approval_requests_entity_type_check
  check (entity_type in ('stock_adjustment','recount_assignment','opening_balance_batch','cost_reconciliation'));

do $$ begin
  if to_regclass('public.approval_policies') is not null then
    delete from public.approval_policies where entity_type = 'inventory_tyre_conflict_correction';
    alter table public.approval_policies drop constraint if exists approval_policies_entity_type_check;
    alter table public.approval_policies add constraint approval_policies_entity_type_check check (entity_type = any (array[
      'inspection','checklist','work_order','tyre_change',
      'inventory_stock_adjustment','inventory_recount_assignment','inventory_opening_balance_batch',
      'inventory_cost_reconciliation']));
  end if;
end $$;

alter table public.tyre_custody_conflicts drop constraint if exists tyre_custody_conflicts_case_status_chk;
alter table public.tyre_custody_conflicts drop constraint if exists tyre_custody_conflicts_investigation_status_check;
alter table public.tyre_custody_conflicts
  drop column if exists closed_at, drop column if exists closed_by, drop column if exists decided_correction,
  drop column if exists approval_request_id, drop column if exists proposed_at, drop column if exists proposed_by,
  drop column if exists proposed_correction, drop column if exists investigation_notes, drop column if exists assigned_at,
  drop column if exists assigned_by, drop column if exists investigator_id, drop column if exists investigation_status;

commit;
