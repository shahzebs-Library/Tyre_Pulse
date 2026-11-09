-- The workforce trigger functions inherited Supabase's default EXECUTE grant to PUBLIC/anon at CREATE
-- time, so the security advisor lists them as anon-executable SECURITY DEFINER functions. A trigger
-- function needs no EXECUTE grant to fire, so revoking changes no behaviour; it only removes the
-- callable surface. Revoke from PUBLIC first (a revoke from anon alone is a no-op against PUBLIC).
-- STATUS: APPLIED LIVE 2026-11-09 (migration workforce_trigger_fn_revoke).
-- ROLLBACK: grant execute on function ... to public;  (not recommended)
REVOKE ALL ON FUNCTION public.workforce_assignment_qualify() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workforce_employee_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workforce_employee_log() FROM PUBLIC, anon, authenticated;
