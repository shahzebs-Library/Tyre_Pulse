-- ============================================================================
-- MIGRATIONS_V106_AUDIT_LOG_V2_PROFILES_FK.sql  (APPLIED LIVE 2026-07-08)
-- ----------------------------------------------------------------------------
-- Fix: AuditTrail.jsx and SecurityCenter (src/lib/securityCenter.js) embed the
-- actor's name via PostgREST:
--     audit_log_v2?select=*,profiles(full_name, username)
-- This failed at runtime with:
--     "Could not find a relationship between 'audit_log_v2' and 'profiles' in
--      the schema cache"  (PGRST200)
--
-- Cause: audit_log_v2.user_id already had a FK, but it referenced auth.users
-- (not exposed through PostgREST), so there was no audit_log_v2 → public.profiles
-- relationship for the embed to resolve.
--
-- Fix: add an explicit FK from audit_log_v2.user_id → public.profiles(id)
-- (profiles.id IS the auth uid, so this is consistent with the existing
-- auth.users FK). Verified 0 orphan user_ids before applying, so it validates
-- cleanly. ON DELETE SET NULL keeps audit history when a profile is removed.
--
-- Idempotent + non-destructive. Rollback:
--   ALTER TABLE public.audit_log_v2 DROP CONSTRAINT audit_log_v2_user_id_profiles_fkey;
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.audit_log_v2'::regclass
      AND conname  = 'audit_log_v2_user_id_profiles_fkey'
  ) THEN
    ALTER TABLE public.audit_log_v2
      ADD CONSTRAINT audit_log_v2_user_id_profiles_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Refresh PostgREST's schema cache so the new relationship is available now.
NOTIFY pgrst, 'reload schema';
