-- V480 - remove anonymous EXECUTE from the two RPCs added this session.
-- STATUS: APPLIED LIVE on project jhssdmeruxtrlqnwfksc (2026-08-04) and verified.
--
-- FOUND BY the pre-release security audit, not by an advisor.
--
-- Supabase's default privileges grant EXECUTE on new public functions to anon,
-- authenticated and service_role at CREATE time, and a bare grant to PUBLIC
-- also reaches anon. Neither is removed by `REVOKE ... FROM PUBLIC` alone in
-- every case, so both new functions were still anon-executable:
--
--   get_mobile_analytics  - carried a leftover explicit anon grant
--   resolve_approvers     - carried a bare `=X/postgres` PUBLIC grant
--
-- NO DATA WAS REACHABLE through either. Both are SECURITY INVOKER, and V281
-- revoked every anon table grant in schema public, so an anonymous call fails
-- on the underlying table rather than returning rows. This closes the surface
-- regardless: an unauthenticated caller has no business reaching either one,
-- and the repo's standing rule is to revoke from the ROLE explicitly, not to
-- rely on a PUBLIC revoke.
--
-- VERIFIED after applying, by impersonating a real approved non-admin
-- (role 'Tyre Data Collector'): get_mobile_analytics still returns
-- 8,046 tyres / 1,019 vehicles / SAR 6,132,319.38 / 29 sites, and
-- resolve_approvers still executes. anon EXECUTE is false on both.
--
-- ROLLBACK (not recommended):
--   grant execute on function public.get_mobile_analytics(text, date, date, text) to anon;
--   grant execute on function public.resolve_approvers(text, text, text, text, uuid) to anon;

-- Explicit per-role grant left behind by Supabase default privileges.
revoke execute on function public.get_mobile_analytics(text, date, date, text) from anon;

-- Bare PUBLIC grant: an anon-scoped revoke is a no-op against this, the grant
-- has to come off PUBLIC itself. authenticated and service_role keep their own
-- explicit grants, so the Approval Matrix page is unaffected.
revoke execute on function public.resolve_approvers(text, text, text, text, uuid) from anon;
revoke execute on function public.resolve_approvers(text, text, text, text, uuid) from public;
grant  execute on function public.resolve_approvers(text, text, text, text, uuid) to authenticated;
