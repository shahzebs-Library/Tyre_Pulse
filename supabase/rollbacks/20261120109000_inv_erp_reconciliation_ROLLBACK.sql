-- ROLLBACK of 20261120109000_inv_erp_reconciliation.sql. A read-only view; nothing to keep.
begin;
drop view if exists public.v_inv_erp_reconciliation;
commit;
