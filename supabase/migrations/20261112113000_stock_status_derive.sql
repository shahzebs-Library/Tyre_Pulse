-- F-F-04 - stock_status is derived on EVERY write to stock_records, not only when
--          it goes through the stock-movement / stock-count RPCs.
--
-- STATUS: APPLIED 2026-11-11. Verified live, rolled back: backfill corrected all 3 of 36
--   disagreeing rows (0 wrong after); a direct insert of a below-critical qty with 'OK' sent
--   is corrected to 'Critical'; a direct update re-derives 'OK'. Confirmed the trigger rule is
--   byte-identical to post_stock_movement / set_stock_count (CASE WHEN v_after <=
--   COALESCE(critical_level,0) ... ), so RPC-path writes are unchanged and only direct writes
--   gain the derivation. Applied as CREATE OR REPLACE function + guarded CREATE trigger +
--   backfill (already DROP-free; the drops are rollback-only).
--
-- WHY. post_stock_movement() and set_stock_count() (V52 / V214) recompute stock_status with
--   one rule - qty <= critical_level -> Critical, qty <= min_level -> Low, else OK - but a
--   DIRECT insert or edit of a stock_records row (dashboard CSV import, admin edit, any
--   PostgREST write) can store an arbitrary or stale stock_status. A row then shows 'OK'
--   while its quantity is below critical, so the Low/Critical alerts and dashboards read
--   the wrong state.
--
-- FIX. A BEFORE INSERT OR UPDATE trigger that derives stock_status from the SAME rule the
--   RPCs use, so every write path agrees. The RPCs set stock_status explicitly too; the
--   trigger simply recomputes the identical value, so they never disagree.
--
-- NOT A NEW TABLE. This only adds a function + trigger to an existing table, so it does
--   NOT call anum_integration.apply_reader_policies() (that is only for a CREATE TABLE).
--   The function is a plain (non-DEFINER) trigger that mutates NEW and touches no table, so
--   it needs no SECURITY DEFINER and no table grants; search_path is pinned.

create or replace function public.stock_status_derive()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Same rule as post_stock_movement / set_stock_count (COALESCE levels to 0, so an
  -- unset threshold never makes a positive quantity read Low/Critical).
  new.stock_status := case
    when coalesce(new.stock_qty, 0) <= coalesce(new.critical_level, 0) then 'Critical'
    when coalesce(new.stock_qty, 0) <= coalesce(new.min_level, 0)      then 'Low'
    else 'OK'
  end;
  return new;
end;
$$;

revoke all on function public.stock_status_derive() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'stock_records'
       and t.tgname = 'trg_stock_status_derive'
  ) then
    create trigger trg_stock_status_derive
      before insert or update on public.stock_records
      for each row execute function public.stock_status_derive();
  end if;
end $$;

-- BACKFILL (the 3 live rows): re-derive stock_status for any existing row where the stored
--   value disagrees with the rule. Safe + idempotent; the BEFORE UPDATE trigger recomputes
--   the identical value, so applying this twice is a no-op.
update public.stock_records sr
   set stock_status = d.status
  from (
    select id, case
      when coalesce(stock_qty, 0) <= coalesce(critical_level, 0) then 'Critical'
      when coalesce(stock_qty, 0) <= coalesce(min_level, 0)      then 'Low'
      else 'OK'
    end as status
    from public.stock_records
  ) d
 where sr.id = d.id
   and sr.stock_status is distinct from d.status;

-- VERIFY (one rolled-back call):
--   begin;
--     -- 1. a direct insert gets a correct status without going through an RPC:
--     insert into public.stock_records (description, stock_qty, min_level, critical_level, stock_status)
--     values ('zz-verify', 2, 10, 5, 'OK') returning stock_status;        -- 'Critical' (2 <= 5)
--     -- 2. a direct UPDATE re-derives it:
--     update public.stock_records set stock_qty = 100 where description='zz-verify'
--       returning stock_status;                                           -- 'OK' (100 > 10)
--     -- 3. every live row now agrees with the rule:
--     select count(*) as wrong from public.stock_records
--      where stock_status is distinct from case
--        when coalesce(stock_qty,0) <= coalesce(critical_level,0) then 'Critical'
--        when coalesce(stock_qty,0) <= coalesce(min_level,0)      then 'Low'
--        else 'OK' end;                                                   -- 0
--   rollback;
--
-- ROLLBACK (manual lead action - the DROP-free rule is for the applied body, not this note):
--   drop trigger if exists trg_stock_status_derive on public.stock_records;
--   drop function if exists public.stock_status_derive();
--   -- stock_status values are not reverted (they are now correct per the shared rule).
--   -- To disable in place instead of dropping:
--   --   alter table public.stock_records disable trigger trg_stock_status_derive;
