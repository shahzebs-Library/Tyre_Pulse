-- ROLLBACK of 20261120104000_inv_valuation.sql.
-- Refuses while cost reconciliations carry decisions or non-legacy records (they are
-- the only record of unknown cost) unless `set local inv.rollback_discard = 'on'`
-- after exporting them. Restores the no-op _inv_cost_rec_track hook of
-- 20261120100000. The two column comments it set are harmless and stay.
begin;
do $$ begin
  if coalesce(current_setting('inv.rollback_discard', true), '') <> 'on'
     and exists (select 1 from public.inventory_cost_reconciliations where kind <> 'legacy' or status <> 'open') then
    raise exception 'Cost reconciliations exist; export them, then set inv.rollback_discard = on to roll back.';
  end if;
end $$;
drop function if exists public.inv_valuation_summary(text);
drop view if exists public.v_inventory_valuation;
drop view if exists public.v_inv_valuation;
drop view if exists public.v_inv_cost_reconciliations;
create or replace function public._inv_cost_rec_track(p_mov public.stock_movements, p jsonb)
returns void language plpgsql security definer set search_path = public as $fn$ begin return; end $fn$;
revoke all on function public._inv_cost_rec_track(public.stock_movements, jsonb) from public, anon, authenticated;
drop function if exists public._inv_rec_take(uuid, numeric, text, public.stock_movements, uuid);
drop table if exists public.inventory_cost_reconciliations;
commit;
