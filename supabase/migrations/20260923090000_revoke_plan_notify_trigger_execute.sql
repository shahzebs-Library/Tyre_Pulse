-- Close the EXECUTE surface on the two inspection-plan notification triggers.
--
-- 20260921160000_notify_inspection_plan_assignment.sql created
-- public.notify_inspection_plan_assignment() and
-- public.notify_inspection_plan_reassignment() as SECURITY DEFINER and never
-- revoked the default PUBLIC EXECUTE grant, so `anon` could execute them.
-- They are the only anon-executable definer functions outside the V500
-- allowlist (measured 2026-09-23).
--
-- A trigger function needs NO EXECUTE grant to fire (proven for V607), and
-- PostgREST cannot call a function returning `trigger`, so this removes
-- surface without changing behaviour. Both fire from inspection_schedules
-- (trg_notify_plan_assigned_insert / trg_notify_plan_assigned_update).
--
-- Order is load-bearing (V500): revoking from anon alone is a no-op against a
-- PUBLIC grant, so PUBLIC is revoked first.

revoke all on function public.notify_inspection_plan_assignment() from public;
revoke all on function public.notify_inspection_plan_assignment() from anon, authenticated;
revoke all on function public.notify_inspection_plan_reassignment() from public;
revoke all on function public.notify_inspection_plan_reassignment() from anon, authenticated;

-- Verify (expect f,f,f,f):
--   select has_function_privilege('anon','public.notify_inspection_plan_assignment()','EXECUTE'),
--          has_function_privilege('authenticated','public.notify_inspection_plan_assignment()','EXECUTE'),
--          has_function_privilege('anon','public.notify_inspection_plan_reassignment()','EXECUTE'),
--          has_function_privilege('authenticated','public.notify_inspection_plan_reassignment()','EXECUTE');
--
-- Rollback:
--   grant execute on function public.notify_inspection_plan_assignment() to public;
--   grant execute on function public.notify_inspection_plan_reassignment() to public;
