-- ROLLBACK of 20261120100000_inv_p0_ledger_integrity.sql (run LAST, after 101000).
--
-- Restores, from _bak.inv_p0_snapshot (copied from the catalog at apply time, never
-- hand-typed): the six legacy stock writers, every policy on the eight touched tables,
-- the client table grants, the replaced constraints (incl. stock_movements FK ON
-- DELETE CASCADE and the global po_number key), v_stock_balance_reconcile, and the
-- nullability of stock_movements.organisation_id.
--
-- Data: stock_records and stock_movements ROWS are kept. Columns added by P0 are
-- dropped, which discards valuation (WAC buckets), item/location links and the
-- idempotency keys of anything posted through the new ledger. The rollback therefore
-- refuses when the new ledger was used, unless `set local inv.rollback_discard = 'on'`.
-- Kept on purpose:
--   * stock_movements qty_before/qty_change/qty_after stay NUMERIC (narrowing back to
--     integer could fail on a fractional count; numeric is a superset for readers).
--   * Constraints that legacy rows may no longer satisfy (a new movement type, a
--     po_number repeated across companies) are re-added NOT VALID with a notice.
begin;

do $$ begin
  if to_regclass('_bak.inv_p0_snapshot') is null then
    raise exception 'No _bak.inv_p0_snapshot: cannot restore the live definitions.';
  end if;
  if coalesce(current_setting('inv.rollback_discard', true), '') <> 'on' and (
       exists (select 1 from public.stock_movements where idempotency_key not like 'legacy:%')
    or exists (select 1 from public.stock_exceptions)
    or exists (select 1 from public.stock_records where item_id is not null)) then
    raise exception 'The new ledger has been used; export it, then set inv.rollback_discard = on to roll back.';
  end if;
end $$;

-- 1. triggers + new functions
drop trigger if exists trg_zz_inv_balance_guard on public.stock_records;
drop trigger if exists trg_inv_ledger_append_only on public.stock_movements;
drop trigger if exists trg_inv_ledger_no_truncate on public.stock_movements;
drop function if exists public.inv_post_movement(jsonb);
drop function if exists public.inv_reverse_movement(uuid, text, text);
drop function if exists public.inv_exception_resolve(uuid, text, text);

-- 2. policies on the touched tables: drop all, recreate the captured set
do $$ declare r record; begin
  for r in select tablename, policyname from pg_policies where schemaname = 'public'
             and tablename in ('stock_records','stock_movements','stock','goods_receipts','requisitions','suppliers',
                               'purchase_orders','materials') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
  for r in select definition from _bak.inv_p0_snapshot where kind = 'policy' loop execute r.definition; end loop;
end $$;

-- 3. legacy writers: restore captured bodies; drop ones that did not exist before
do $$ declare r record; begin
  for r in select x.sig from (values ('public.post_stock_movement(uuid,text,numeric,text,text)'),
      ('public.set_stock_count(uuid,numeric,text)'),
      ('public.save_stock_entry(uuid,text,text,text,text,text,jsonb)'),
      ('public.transfer_stock_entry(uuid,uuid,uuid,integer,integer,integer,text)'),
      ('private.reserve_work_order_stock_internal(uuid,jsonb,text)'),
      ('private.release_work_order_stock_internal(uuid,text)')) x(sig)
    where not exists (select 1 from _bak.inv_p0_snapshot s where s.kind = 'function'
                       and to_regprocedure(s.name) = to_regprocedure(x.sig)) loop
    execute format('drop function if exists %s', r.sig);
  end loop;
  for r in select definition from _bak.inv_p0_snapshot where kind = 'function' loop execute r.definition; end loop;
  for r in select definition from _bak.inv_p0_snapshot where kind = 'function_acl' loop execute r.definition; end loop;
end $$;

drop view if exists public.v_stock_balance_reconcile;
drop table if exists public.stock_exceptions;
drop function if exists public._inv_post(jsonb, boolean);
drop function if exists public._inv_cost_rec_track(public.stock_movements, jsonb);
drop function if exists public._inv_movement_json(public.stock_movements);
drop function if exists public.inv_ledger_guard();
drop function if exists public.inv_balance_guard();
drop function if exists public._inv_secure_table(text, boolean, boolean);
drop function if exists public._inv_cap_for(text);
drop function if exists public.inv_movement_kind(text);
drop function if exists public.inv_blind_hides_balance(uuid, text, uuid, uuid);
drop function if exists public._inv_posting_on();
drop function if exists public._inv_scope_ok(text, text);
drop function if exists public.inv_can(text);

-- 4. constraints
alter table public.stock_movements drop constraint if exists stock_movements_stock_id_fkey,
  drop constraint if exists stock_movements_movement_type_check,
  drop constraint if exists stock_movements_qty_after_nonneg,
  drop constraint if exists stock_movements_ownership_chk;
alter table public.work_order_stock_reservation_lines drop constraint if exists work_order_stock_reservation_lines_stock_id_fkey;
alter table public.purchase_orders drop constraint if exists purchase_orders_org_po_number_key;
drop index if exists public.suppliers_org_code_uq;
do $$ declare r record; begin
  for r in select name, definition from _bak.inv_p0_snapshot where kind = 'constraint' loop
    begin
      execute r.definition;
    exception when others then
      if r.definition ~* 'unique' then
        raise notice 'could not restore % (%); left off - resolve the duplicates by hand', r.name, sqlerrm;
      else
        execute r.definition || ' not valid';
        raise notice 'restored % as NOT VALID (%)', r.name, sqlerrm;
      end if;
    end;
  end loop;
end $$;

-- 5. stock_movements columns
alter table public.stock_movements alter column movement_seq drop default;
drop index if exists public.stock_movements_movement_seq_uq;
drop index if exists public.stock_movements_org_idempotency_uq;
drop index if exists public.stock_movements_one_reversal_uq;
drop index if exists public.stock_movements_item_idx;
drop index if exists public.stock_movements_org_seq_idx;
alter table public.stock_movements
  drop column if exists country, drop column if exists item_id, drop column if exists location_id,
  drop column if exists movement_seq, drop column if exists posted_at, drop column if exists effective_at,
  drop column if exists unit_cost, drop column if exists value_change, drop column if exists unvalued_qty_change,
  drop column if exists valuation_status, drop column if exists variance_kind, drop column if exists variance_amount,
  drop column if exists currency, drop column if exists ownership, drop column if exists source_doc_type,
  drop column if exists source_doc_id, drop column if exists idempotency_key, drop column if exists payload_hash,
  drop column if exists reverses_movement_id, drop column if exists actor_id, drop column if exists approval_ref,
  drop column if exists reserved_change, drop column if exists valued_qty, drop column if exists unvalued_qty,
  drop column if exists pending_out_change, drop column if exists pending_in_change,
  drop column if exists source_receipt_movement_id;
drop sequence if exists public.stock_movements_movement_seq_seq;
do $$ declare r record; begin
  for r in select definition from _bak.inv_p0_snapshot where kind = 'nullable' loop execute r.definition; end loop;
end $$;

-- 6. stock_records columns
drop index if exists public.stock_records_item_balance_uq;
drop index if exists public.stock_records_item_idx;
drop index if exists public.stock_records_location_idx;
alter table public.stock_records
  drop constraint if exists stock_records_condition_chk, drop constraint if exists stock_records_ownership_chk,
  drop constraint if exists stock_records_owner_supplier_chk, drop constraint if exists stock_records_qty_on_hand_nonneg,
  drop constraint if exists stock_records_qty_reserved_bounds, drop constraint if exists stock_records_avg_cost_nonneg,
  drop constraint if exists stock_records_value_buckets_chk;
alter table public.stock_records
  drop column if exists item_id, drop column if exists location_id, drop column if exists condition,
  drop column if exists ownership, drop column if exists owner_supplier_id, drop column if exists qty_on_hand,
  drop column if exists qty_reserved, drop column if exists avg_unit_cost, drop column if exists valued_qty,
  drop column if exists valued_value, drop column if exists unvalued_qty, drop column if exists last_receipt_at,
  drop column if exists pending_allocation_out_qty, drop column if exists pending_allocation_in_qty,
  drop column if exists last_issue_at, drop column if exists uom, drop column if exists version;

-- 7. grants + view
revoke update (min_level, critical_level, reorder_qty, management_action) on public.stock_records from authenticated;
do $$ declare r record; begin
  for r in select definition from _bak.inv_p0_snapshot where kind in ('grant','view') order by kind desc loop
    execute r.definition;
  end loop;
  if to_regclass('public.v_stock_balance_reconcile') is not null then
    grant select on public.v_stock_balance_reconcile to authenticated;
  end if;
end $$;
comment on table public.stock is null;
comment on table public.materials is null;

commit;
