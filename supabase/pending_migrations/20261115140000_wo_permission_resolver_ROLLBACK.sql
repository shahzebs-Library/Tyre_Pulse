-- ROLLBACK for 20261115140000_wo_permission_resolver.sql
--
-- STATUS: AUTHORED, NOT APPLIED. Rehearsed on a local copy of the staging database (tp_runbook):
--         apply, verify, this rollback, then a schema and data fingerprint equal to the one taken
--         before the apply. See docs/commercial-readiness/RELEASE_RUNBOOK_519_520.md, step 2.
-- ORDER:  run only after 20261115141000, 20261115140500 and 20261115142000 have been rolled back
--         (they read work_order_role_rules or call these functions). The guard below refuses
--         otherwise.
-- EFFECT: removes the rule table (31 built-in rows plus any per-company rows an Admin added) and
--         the seven helper functions. No business row is touched.
-- CONTAINS the word "drop": the Supabase MCP tool waits for a human confirmation.

begin;

do $do$
begin
  if exists (select 1 from pg_proc where proname in ('work_order_can_any_write', 'wo_write_guard', 'work_order_cost_add')
               and pronamespace = 'public'::regnamespace) then
    raise exception 'Rollback aborted: roll back 20261115142000 and 20261115140500 first.';
  end if;
end
$do$;

drop function if exists public.work_order_my_access();
drop function if exists public.work_order_can_job(text, uuid);
drop function if exists public.work_order_can(text, uuid, text, text, boolean, uuid);
drop function if exists public.work_order_scope(text);
drop function if exists public.work_order_is_assigned(uuid);
drop function if exists public.work_order_is_closed(text);
drop function if exists public.work_order_is_tyre(text, text, text);
drop table if exists public.work_order_role_rules;

commit;
