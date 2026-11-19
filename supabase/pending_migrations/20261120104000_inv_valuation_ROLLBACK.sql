-- ROLLBACK of 20261120104000_inv_valuation.sql. Read-only objects only; nothing to keep.
-- The column comments it set are harmless and left in place.
begin;
drop function if exists public.inv_valuation_summary(text);
drop view if exists public.v_inventory_valuation;
commit;
