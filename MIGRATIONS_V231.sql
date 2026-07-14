-- V231: revoke default PUBLIC EXECUTE on the access-control SECURITY DEFINER functions.
-- Applied live 2026-07-14. CREATE FUNCTION grants EXECUTE to PUBLIC by default; the
-- self-gates (is_super_admin()/auth.uid()) already block non-super-admins, so this only
-- removes redundant anon reachability the advisor flags. authenticated keeps EXECUTE.
REVOKE EXECUTE ON FUNCTION public.admin_get_effective_access(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_country(uuid, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_bulk_set_grant(uuid[], text, text, text, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_bulk_set_role(uuid[], text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_clone_role(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_access_audit(int, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_user_can(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_capabilities() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_has_capability(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_access_audit_generic() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_access_audit_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_effective_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_country(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bulk_set_grant(uuid[], text, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bulk_set_role(uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clone_role(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_access_audit(int, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_user_can(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_capabilities() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_capability(uuid, text, text) TO authenticated;
