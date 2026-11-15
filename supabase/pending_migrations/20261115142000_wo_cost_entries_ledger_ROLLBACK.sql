-- ROLLBACK for 20261115142000_wo_cost_entries_ledger.sql
--
-- STATUS: AUTHORED, NOT APPLIED. Rehearsed on a local copy of the staging database (tp_runbook):
--         apply, verify, this rollback, then a schema and data fingerprint equal to the one taken
--         before the apply. See docs/commercial-readiness/RELEASE_RUNBOOK_519_520.md, step 6.
-- STOP FIRST: if any cost entry was recorded, this rollback removes it with its history. Count and
--         export first:
--           select status, count(*), sum(amount) from public.work_order_cost_entries group by 1;
--         If the count is not 0, prefer the switch-off without removal (keeps every entry):
--           revoke execute on function public.work_order_cost_add(uuid,text,text,text,text,numeric,numeric,numeric,text,text,text,uuid,uuid),
--             public.work_order_cost_submit(uuid), public.work_order_cost_decide(uuid,text,text),
--             public.work_order_cost_withdraw(uuid,text), public.work_order_cost_reverse(uuid,text),
--             public.work_order_cost_reconcile(uuid,text) from authenticated;
--         The web form then says adding costs is not available.
--         work_orders.parts_cost and total_cost are never written by the ledger, so neither path
--         changes an imported cost.
-- CONTAINS the word "drop": the Supabase MCP tool waits for a human confirmation.

begin;

drop view if exists public.v_work_order_cost_totals;
drop function if exists public.work_order_cost_reverse(uuid, text);
drop function if exists public.work_order_cost_withdraw(uuid, text);
drop function if exists public.work_order_cost_decide(uuid, text, text);
drop function if exists public.work_order_cost_submit(uuid);
drop function if exists public.work_order_cost_add(uuid, text, text, text, text, numeric, numeric, numeric, text, text, text, uuid, uuid);
drop function if exists public.wo_cost_log(uuid, uuid, text, text, text, text);
drop function if exists public.work_order_cost_reconcile(uuid, text);
drop table if exists public.work_order_cost_entry_events;
drop table if exists public.work_order_cost_entries;
drop function if exists public.wo_cost_entry_immutable();

commit;
