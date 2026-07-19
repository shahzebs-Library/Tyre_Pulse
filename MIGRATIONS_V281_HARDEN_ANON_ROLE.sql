-- V281: Harden the anon (unauthenticated) role — anon reaches NO base table directly.
--
-- AUDIT FINDING (2026-07-19 backend security audit):
--   The anon role held SELECT + INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on 100
--   public tables (the Supabase default GRANT-to-anon behaviour), with RLS as the ONLY
--   backstop. Verification with impersonated anon (SET LOCAL ROLE anon, no JWT):
--     * WRITES were all RLS-denied (standalone null-check INSERT policies default to deny),
--       so no active write vuln existed.
--     * but `module_permissions` LEAKED 559 rows to anonymous callers via the public
--       SELECT policy `users_read_own_org_permissions` (org_id IS NULL branch), exposing
--       the entire role -> module capability matrix to the internet.
--     * every other data table was protected only because anon happened to lack EXECUTE
--       on app_can_see_country()/is_elevated_user() (the RESTRICTIVE policy threw) — a
--       fragile, accidental defense.
--
-- FIX: anon should reach nothing directly. Everything anon legitimately needs runs through
--   SECURITY DEFINER RPCs that execute as their owner and are unaffected by table grants:
--     * get_email_by_identifier  (login: username -> synthetic email)
--     * get_report_snapshot      (public /report/:token share links)
--     * get_display_snapshot     (public /display/:token TV links)
--   Pre-auth pages (login/register/data-deletion) issue no direct table reads; SettingsContext
--   reads settings/system_config only behind `if (user)` gates. Verified: after this migration
--   anon is blocked on every base table while all three anon RPCs still return normally, and an
--   authenticated super-admin still reads vehicle_fleet (684 rows) unchanged.
--
-- Authenticated grants are untouched, so the application is unaffected.

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;

-- Stop future tables (created by the migration/service roles) from auto-granting to anon.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- Down (manual, if ever needed): re-GRANT the specific privilege on the specific table to
-- anon. Do NOT restore the blanket GRANT ALL — that was the exposure this migration removes.
