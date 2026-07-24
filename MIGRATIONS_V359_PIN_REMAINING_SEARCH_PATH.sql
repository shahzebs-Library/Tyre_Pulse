-- V359 — Pin search_path on the remaining 8 advisor-flagged functions.
-- Clears the last function_search_path_mutable security lints (8 -> 0). Config-only
-- ALTERs; no behavior change. Applied live via Supabase MCP.

ALTER FUNCTION public._data_cleanup_spec(text)             SET search_path TO 'public';
ALTER FUNCTION public._login_lock_minutes()                SET search_path TO 'public';
ALTER FUNCTION public._login_window_minutes()              SET search_path TO 'public';
ALTER FUNCTION public.accident_pending_action(text)        SET search_path TO 'public';
ALTER FUNCTION public.accident_severity_label(text)        SET search_path TO 'public';
ALTER FUNCTION public.accident_stage_from_status(text)     SET search_path TO 'public';
ALTER FUNCTION public.accident_stage_label(text)           SET search_path TO 'public';
ALTER FUNCTION public.accident_status_from_stage(text)     SET search_path TO 'public';

-- Reversible (removes the pin):
--   ALTER FUNCTION public._data_cleanup_spec(text) RESET search_path;  -- (repeat per function)
