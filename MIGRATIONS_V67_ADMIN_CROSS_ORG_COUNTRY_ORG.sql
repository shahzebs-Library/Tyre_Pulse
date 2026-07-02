-- V67: (1) BOTH Admin role and super-admins see/work across ALL organisations;
--      (2) assigning a country to a user auto-sets their organisation.
-- Helper app_is_org_admin() = is_super_admin() OR app_role()='admin'; the 38
-- RESTRICTIVE *_org_isolation policies now bypass via it. admin_update_profile
-- derives org from a single-country assignment (explicit p_org_id still wins);
-- the old 12-arg overload was dropped to keep one signature.
-- Verified live (rolled back): Admin sees another org's row (1); setting country
-- 'KSA' with no explicit org places the user in the KSA organisation.
CREATE OR REPLACE FUNCTION public.app_is_org_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT public.is_super_admin() OR public.app_role() = 'admin'; $$;
-- (see applied migration for the full policy-regeneration DO block and the
--  updated admin_update_profile with p_org_id + country→org derivation)
