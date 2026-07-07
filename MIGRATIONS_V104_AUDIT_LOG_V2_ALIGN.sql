-- ============================================================================
-- MIGRATIONS_V104_AUDIT_LOG_V2_ALIGN.sql
-- Drift reconciliation caught during the live V96–V103 apply (2026-07-07).
--
-- The live `audit_log_v2` had drifted to the "SAFE" variant — it stored diffs
-- in `old_data`/`new_data` (+ `site`/`country`) and was MISSING the columns the
-- application code contract expects:
--   * V102's server-side audit triggers (public.trg_audit_row_change)
--   * src/lib/auditLogger.js  (client audit writes)
--   * src/lib/audit.js        (field-level audit service)
--   * src/pages/AuditTrail.jsx (reads old_values/new_values)
-- all write/read `user_role`, `org_id`, `old_values`, `new_values`. On the
-- drifted table those inserts silently failed (client) and would have failed
-- V102's CREATE FUNCTION (Postgres validates function bodies at creation).
--
-- Fix: additively bring audit_log_v2 up to the code contract. Non-destructive —
-- the legacy `old_data`/`new_data` columns are left in place for any historical
-- reader. Idempotent (ADD COLUMN IF NOT EXISTS): a no-op on a fresh database
-- provisioned from MASTER_MIGRATION (V15), which already defines these columns.
--
-- MUST run BEFORE V102 on any database whose audit_log_v2 is the SAFE variant.
-- Applied live as migration `v102a_audit_log_v2_align_columns`.
--
-- Rollback (only if audit_log_v2 originated as the SAFE variant):
--   ALTER TABLE public.audit_log_v2
--     DROP COLUMN IF EXISTS user_role,
--     DROP COLUMN IF EXISTS org_id,
--     DROP COLUMN IF EXISTS old_values,
--     DROP COLUMN IF EXISTS new_values;
-- ============================================================================

ALTER TABLE public.audit_log_v2
  ADD COLUMN IF NOT EXISTS user_role  text,
  ADD COLUMN IF NOT EXISTS org_id     uuid,
  ADD COLUMN IF NOT EXISTS old_values jsonb,
  ADD COLUMN IF NOT EXISTS new_values jsonb;
