-- V265: pin search_path on 5 functions flagged by the security advisor
-- (function_search_path_mutable). Config-only ALTER FUNCTION - does NOT recreate
-- the function bodies, so it is zero-risk to app behavior while closing the
-- mutable-search-path hardening gap. Applied live via Supabase MCP
-- (project jhssdmeruxtrlqnwfksc). Next free migration V266.
ALTER FUNCTION public._admin_db_safelist() SET search_path = 'public';
ALTER FUNCTION public.normalize_country(raw text) SET search_path = 'public';
ALTER FUNCTION public.normalize_profiles_role() SET search_path = 'public';
ALTER FUNCTION public.normalize_report_schedules_type() SET search_path = 'public';
ALTER FUNCTION public.tyre_records_master_process() SET search_path = 'public';
