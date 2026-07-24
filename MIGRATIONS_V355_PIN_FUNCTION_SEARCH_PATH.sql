-- V355 — Pin search_path on our expense/tyre-cost helper functions
-- ------------------------------------------------------------------
-- Security-advisor hygiene (function_search_path_mutable).
--
-- All recon_* and get_* RPCs added in V346-V354
-- (get_tyre_cost_by_asset, get_parts_expense_snapshot, get_expense_by_country,
--  recon_jobcard_mismatches, recon_jobcard_mismatch_summary,
--  recon_duplicate_key_tyres, recon_serial_multi_asset,
--  recon_data_quality_summary, ...) ALREADY ship with a pinned
--  `SET search_path` — they are clean and are NOT touched here.
--
-- This migration only pins the remaining flagged leaf helper functions that
-- back the tyre-cost / expense-classifier grid work those RPCs read
-- (parts_consumption classifier + tyre-status). They are pure IMMUTABLE
-- SECURITY INVOKER string functions (no table access), so pinning is
-- behaviour-neutral and simply clears the advisor, matching the standing
-- project practice (V265/V281) of pinning search_path on all our functions.
--
-- Idempotent: ALTER FUNCTION ... SET search_path is safe to re-run.

ALTER FUNCTION public._to_num(text)                SET search_path TO 'public';
ALTER FUNCTION public.parts_brand(text)            SET search_path TO 'public';
ALTER FUNCTION public.parts_is_oil(text)           SET search_path TO 'public';
ALTER FUNCTION public.parts_is_tyre(text)          SET search_path TO 'public';
ALTER FUNCTION public.tyre_status_is_active(text)  SET search_path TO 'public';

-- ------------------------------------------------------------------
-- Reversible footer (to revert, reset each function's search_path):
--   ALTER FUNCTION public._to_num(text)               RESET search_path;
--   ALTER FUNCTION public.parts_brand(text)           RESET search_path;
--   ALTER FUNCTION public.parts_is_oil(text)          RESET search_path;
--   ALTER FUNCTION public.parts_is_tyre(text)         RESET search_path;
--   ALTER FUNCTION public.tyre_status_is_active(text) RESET search_path;
-- ------------------------------------------------------------------
