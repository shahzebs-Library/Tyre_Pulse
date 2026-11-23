-- =============================================================================
-- Accident delete cleanup: withdraw approvals that point at a deleted accident.
-- STATUS: AUTHORED, NOT APPLIED.
--
-- Problem (live test): deleting an accident left its approval request pending in
-- public.workflow_instances (entity_type 'accident', entity_id = accident id as
-- text). entity_id is free text with NO foreign key, so nothing cascaded and every
-- approver kept seeing an approval for a record that no longer exists.
--
-- What this does: an AFTER DELETE trigger on public.accidents removes, for the
-- deleted accident only:
--   1. approval_delegations.approval_workflow_id links to those instances
--      (FK to workflow_instances WITHOUT on delete -> would block the delete),
--      set to NULL so the delegation row itself is kept;
--   2. undelivered workflow_notifications (status pending/failed) for those
--      instances (instance_id has no FK; a queued push for a deleted record is
--      noise). Delivered rows are history and are kept;
--   3. the workflow_instances rows. workflow_step_events cascade via their
--      existing FK (ON DELETE CASCADE, MIGRATIONS_V97).
--
-- Guards that must be satisfied:
--   * approval_private.guard_workflow / guard_delegation refuse changes to a
--     governed (approval_matrix) instance unless approval_private.permits holds a
--     row for (txid_current(), entity_type, entity_id). The function writes that
--     permit for THIS transaction and THIS accident only, the same way the
--     versioned approval service does. Accident instances are not governed
--     today, so this is defensive.
--   * Audit tables are immutable (prevent_audit_mutation). Nothing here deletes
--     or updates an audit row; accident_audit_log keeps its history.
--
-- Security: SECURITY DEFINER (the deleting user cannot write workflow_instances
-- directly; all writes there go through definer RPCs), pinned search_path,
-- EXECUTE revoked from public/anon/authenticated (a trigger function needs none).
--
-- VERIFY (run in a transaction and roll back):
--   begin;
--   -- pick an accident that has a pending approval
--   select a.id, w.id as instance, w.status
--     from public.accidents a
--     join public.workflow_instances w
--       on w.entity_type like 'accident%' and w.entity_id = a.id::text
--    where w.status = 'pending' limit 1;
--   delete from public.accidents where id = '<accident id>';
--   select count(*) from public.workflow_instances
--    where entity_type like 'accident%' and entity_id = '<accident id>';   -- expect 0
--   select count(*) from public.workflow_step_events where instance_id = '<instance>'; -- expect 0
--   rollback;
--   -- orphan sweep after apply (expect 0):
--   select count(*) from public.workflow_instances w
--    where w.entity_type like 'accident%'
--      and not exists (select 1 from public.accidents a where a.id::text = w.entity_id);
--
-- ROLLBACK:
--   drop trigger if exists trg_accident_delete_cleanup on public.accidents;
--   drop function if exists public.accident_delete_cleanup();
--   (Deleted workflow rows are not restored; restore from backup if ever needed.)
-- =============================================================================

create or replace function public.accident_delete_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_types text[];
begin
  select array_agg(w.id), array_agg(distinct w.entity_type)
    into v_ids, v_types
    from public.workflow_instances w
   where w.entity_type like 'accident%'
     and w.entity_id = old.id::text;

  if v_ids is null then
    return old;
  end if;

  -- Permit for the approval guards, scoped to this transaction and accident.
  if to_regclass('approval_private.permits') is not null then
    insert into approval_private.permits (transaction_id, entity_type, entity_id)
    select txid_current(), t, old.id from unnest(v_types) as t
    on conflict do nothing;
  end if;

  if to_regclass('public.approval_delegations') is not null then
    update public.approval_delegations
       set approval_workflow_id = null
     where approval_workflow_id = any (v_ids);
  end if;

  if to_regclass('public.workflow_notifications') is not null then
    delete from public.workflow_notifications
     where instance_id = any (v_ids)
       and status in ('pending', 'failed');
  end if;

  -- workflow_step_events cascade (FK ON DELETE CASCADE).
  delete from public.workflow_instances where id = any (v_ids);

  return old;
end;
$$;

revoke all on function public.accident_delete_cleanup() from public, anon, authenticated;

drop trigger if exists trg_accident_delete_cleanup on public.accidents;
create trigger trg_accident_delete_cleanup
  after delete on public.accidents
  for each row execute function public.accident_delete_cleanup();

-- One-off sweep: approvals already orphaned by earlier deletes. Pending only, so
-- decided history stays. Runs under the migration role; permits are written per
-- orphan so the approval guards accept it.
do $sweep$
declare
  r record;
begin
  for r in
    select w.id, w.entity_type, w.entity_id
      from public.workflow_instances w
     where w.entity_type like 'accident%'
       and w.status = 'pending'
       and w.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and not exists (select 1 from public.accidents a where a.id::text = w.entity_id)
  loop
    if to_regclass('approval_private.permits') is not null then
      insert into approval_private.permits (transaction_id, entity_type, entity_id)
      values (txid_current(), r.entity_type, r.entity_id::uuid)
      on conflict do nothing;
    end if;
    if to_regclass('public.approval_delegations') is not null then
      update public.approval_delegations set approval_workflow_id = null
       where approval_workflow_id = r.id;
    end if;
    delete from public.workflow_notifications
     where instance_id = r.id and status in ('pending', 'failed');
    delete from public.workflow_instances where id = r.id;
  end loop;
end
$sweep$;
