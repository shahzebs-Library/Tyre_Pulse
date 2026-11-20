-- =============================================================================
-- 20261120115000_inv_hardening.sql
-- STATUS: AUTHORED, NOT APPLIED. Requires 20261120100000..114000.
-- Rollback: 20261120115000_inv_hardening_ROLLBACK.sql
--
-- 1. Anonymous EXECUTE on the four pure inventory helpers (doc 90 section 5):
--      _inv_posting_on(), _inv_cap_for(text), inv_movement_kind(text), inv_canon_serial(text)
--    They are SECURITY INVOKER, read no table and are only called by SECURITY DEFINER
--    inventory functions (which run as the owner) or by the definer trigger
--    inv_tyre_scrap_flag. anon reads no inventory table and calls no inventory RPC, so
--    nothing anonymous needs them. Revoked from PUBLIC and anon; authenticated and
--    service_role keep EXECUTE explicitly (revoking PUBLIC alone would also have
--    removed authenticated, which reaches them through PUBLIC).
-- 2. Lifecycle guards (mutability by table, not by blanket rule):
--      * inventory_cost_reconciliations, inventory_approval_requests and
--        tyre_custody_conflicts are not writable by any API role (authenticated has no
--        INSERT / UPDATE / DELETE privilege since their creating files); they change only
--        through their lifecycle RPCs.
--      * Here: status transitions must follow the allowed graph, a terminal row is
--        immutable, and DELETE is refused - for every role, including the table owner.
--        (The ledgers stock_movements, tyre_item_events, inventory_approval_decisions
--        were already append-only for every role.)
-- =============================================================================
begin;

do $$
declare r record;
begin
  for r in select * from (values ('public._inv_posting_on()'), ('public._inv_cap_for(text)'),
                                 ('public.inv_movement_kind(text)'), ('public.inv_canon_serial(text)')) v(sig) loop
    if to_regprocedure(r.sig) is null then
      raise exception '115000: % is missing; apply 20261120100000..114000 first.', r.sig;
    end if;
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;

create or replace function public.inv_lifecycle_guard()
returns trigger language plpgsql set search_path = public as $fn$
declare ok boolean := true;
begin
  if tg_op = 'DELETE' then
    raise exception '% rows are never deleted; close them through their lifecycle.', tg_table_name using errcode = '42501';
  end if;
  if tg_table_name = 'inventory_cost_reconciliations' then
    if old.status <> 'open' then
      raise exception 'A % cost reconciliation is final.', old.status using errcode = '42501';
    end if;
    ok := new.status in ('open','resolved','written_off','cancelled');
  elsif tg_table_name = 'inventory_approval_requests' then
    if old.status in ('rejected','cancelled','consumed') then
      raise exception 'A % approval request is final.', old.status using errcode = '42501';
    end if;
    ok := (old.status = 'pending' and new.status in ('pending','approved','rejected','cancelled'))
       or (old.status = 'approved' and new.status in ('approved','consumed','cancelled'));
    if new.entity_type is distinct from old.entity_type or new.entity_id is distinct from old.entity_id
       or new.requested_by is distinct from old.requested_by or new.organisation_id is distinct from old.organisation_id
       or new.stages is distinct from old.stages or new.proposal is distinct from old.proposal then
      raise exception 'What an approval request is about cannot change; raise a new request.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'tyre_custody_conflicts' then
    if old.status <> 'open' then
      raise exception 'A % custody conflict is final.', old.status using errcode = '42501';
    end if;
    ok := new.status in ('open','resolved','dismissed')
      and (new.investigation_status = old.investigation_status
        or (old.investigation_status = 'open' and new.investigation_status = 'investigating')
        or (old.investigation_status = 'investigating' and new.investigation_status = 'proposed')
        or (old.investigation_status = 'proposed' and new.investigation_status in ('approved','rejected'))
        or (old.investigation_status = 'rejected' and new.investigation_status in ('investigating','proposed'))
        or (old.investigation_status = 'approved' and new.investigation_status = 'closed'));
    if new.serial is distinct from old.serial or new.conflict_type is distinct from old.conflict_type
       or new.organisation_id is distinct from old.organisation_id or new.evidence is distinct from old.evidence then
      raise exception 'The detected conflict itself cannot be edited.' using errcode = '42501';
    end if;
  end if;
  if not ok then
    raise exception 'Status change % -> % is not allowed on %.',
      coalesce(to_jsonb(old)->>'investigation_status', to_jsonb(old)->>'status'),
      coalesce(to_jsonb(new)->>'investigation_status', to_jsonb(new)->>'status'), tg_table_name using errcode = '42501';
  end if;
  return new;
end $fn$;
revoke all on function public.inv_lifecycle_guard() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['inventory_cost_reconciliations','inventory_approval_requests','tyre_custody_conflicts'] loop
    execute format('drop trigger if exists trg_inv_lifecycle_guard on public.%I', t);
    execute format('create trigger trg_inv_lifecycle_guard before update or delete on public.%I for each row execute function public.inv_lifecycle_guard()', t);
    -- belt and braces: no API role may write these tables directly
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated, anon', t);
  end loop;
end $$;

commit;
