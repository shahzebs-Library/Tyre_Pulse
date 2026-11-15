-- ROLLBACK for 20261115140500_wo_policies_and_guards.sql
--
-- STATUS: AUTHORED, NOT APPLIED. Rehearsed on a local copy of the staging database (tp_runbook):
--         apply, verify, this rollback, then a schema and data fingerprint equal to the one taken
--         before the apply. See docs/commercial-readiness/RELEASE_RUNBOOK_519_520.md, step 3.
-- ORDER:  run after 20261115142000 has been rolled back (if applied) and before
--         20261115140000's rollback.
-- EFFECT: the work_orders, wo_assignments, wo_tasks and tech_activity_events policies go back to
--         the expressions read on production on 2026-11-15; the three guard triggers and their
--         functions, the two helper functions and the policy wo_tasks_assignee_progress (created
--         by the apply, it did not exist before) are removed. No business row is touched.
--         Faster switch-off without removal (keeps objects, does not restore the fingerprint):
--           alter table public.work_orders disable trigger wo_write_guard; (and the two others)
--           plus the alter policy statements below.
-- CONTAINS the word "drop": the Supabase MCP tool waits for a human confirmation.

begin;

alter policy work_orders_cap_insert on public.work_orders
  with check (app_user_can('work_orders'::text, 'create'::text));
alter policy work_orders_cap_update on public.work_orders
  using (app_user_can('work_orders'::text, 'edit'::text))
  with check (app_user_can('work_orders'::text, 'edit'::text));
alter policy wo_assignments_elevated_write on public.wo_assignments
  using (app_is_elevated()) with check (app_is_elevated());
alter policy wo_tasks_elevated_write on public.wo_tasks
  using (app_is_elevated()) with check (app_is_elevated());
alter policy tech_activity_events_elevated_write on public.tech_activity_events
  using (app_is_elevated()) with check (app_is_elevated());
alter policy tech_activity_events_self_insert on public.tech_activity_events
  with check (app_is_active() and ((user_id = auth.uid()) or app_is_elevated()));
alter policy tech_activity_events_own_visibility on public.tech_activity_events
  using ((user_id = auth.uid()) or app_is_elevated());

drop policy if exists wo_tasks_assignee_progress on public.wo_tasks;

drop trigger if exists wo_write_guard on public.work_orders;
drop trigger if exists wo_delete_guard on public.work_orders;
drop trigger if exists wo_tasks_progress_guard on public.wo_tasks;
drop function if exists public.wo_write_guard();
drop function if exists public.wo_delete_guard();
drop function if exists public.wo_tasks_progress_guard();
drop function if exists public.work_order_can_any_write(uuid, text, text, boolean, uuid);
drop function if exists public.work_order_can_event(text, uuid, text, text, uuid);

commit;
