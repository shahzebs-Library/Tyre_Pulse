-- Close the anon EXECUTE surface on the planning RPCs.
--
-- Supabase grants EXECUTE to anon at CREATE time as an EXPLICIT grant, so the
-- `revoke all ... from public` in 20260921074351 removed the PUBLIC entry and
-- left `anon=X/postgres` behind. Revoking from PUBLIC does not clear an
-- explicit anon grant, and revoking from anon does not clear a PUBLIC one -
-- both have to be named, in that order, after the authenticated grant is in
-- place (revoking PUBLIC first would otherwise strip authenticated too).
--
-- This was a LATENT surface, not a live leak, and it was measured before being
-- closed: the functions are SECURITY INVOKER and anon holds no table grants, so
-- an anon call already failed with "permission denied for table profiles".
-- Closed anyway so the catalog states the boundary rather than depending on a
-- table grant elsewhere staying revoked.
--
-- VERIFIED after applying, as the real Tyre Data Collector who uses this
-- screen: coverage still returns 23 sites and the pick list still returns rows,
-- so the revoke did not take access away from a legitimate caller.

revoke execute on function public.get_schedule_adherence(text, date, date) from anon;
revoke execute on function public.get_plan_coverage(text, integer) from anon;
revoke execute on function public.get_unplanned_assets(text, integer, text, integer) from anon;

revoke execute on function public.inspection_plan_state(date, integer, text, text, date) from public;
revoke execute on function public.inspection_plan_state(date, integer, text, text, date) from anon;
grant execute on function public.inspection_plan_state(date, integer, text, text, date) to authenticated, service_role;

-- Rollback:
--   grant execute on function public.get_schedule_adherence(text, date, date) to anon;
--   grant execute on function public.get_plan_coverage(text, integer) to anon;
--   grant execute on function public.get_unplanned_assets(text, integer, text, integer) to anon;
--   grant execute on function public.inspection_plan_state(date, integer, text, text, date) to public;
