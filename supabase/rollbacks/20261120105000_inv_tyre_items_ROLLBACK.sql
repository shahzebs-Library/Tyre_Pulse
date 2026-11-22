-- ROLLBACK of 20261120105000_inv_tyre_items.sql (run after the 106000 rollback).
-- tyre_records and tyre_status_marks are never written by this migration, so they need
-- no restore. Store holdings, dispositions and decided conflicts are human decisions:
-- the rollback refuses to discard them unless `set local inv.rollback_discard = 'on'`.
-- inv_canon_serial is left in place (also created by 20261120102000; its rollback drops it).
begin;
do $$ begin
  if coalesce(current_setting('inv.rollback_discard', true), '') <> 'on'
     and (exists (select 1 from public.tyre_store_holdings) or exists (select 1 from public.tyre_dispositions)
          or exists (select 1 from public.tyre_custody_conflicts where status <> 'open')) then
    raise exception 'Tyre holdings, dispositions or decided conflicts exist; export them, then set inv.rollback_discard = on.';
  end if;
end $$;
drop trigger if exists trg_zz_inv_tyre_scrap_flag on public.tyre_records;
drop function if exists public.inv_tyre_scrap_flag();
drop view if exists public.v_tyre_stock_valuation;
drop function if exists public.inv_tyre_conflict_decide(uuid, text, text);
drop function if exists public.inv_tyre_disposition_record(text, text, text, text);
drop function if exists public.inv_tyre_store_holding(jsonb);
drop function if exists public.inv_tyre_item_sync(text);
drop table if exists public.tyre_dispositions;
drop table if exists public.tyre_store_holdings;
drop table if exists public.tyre_custody_conflicts;
drop table if exists public.tyre_item_events;
drop table if exists public.tyre_items;
drop function if exists public.inv_append_only_guard();
commit;
