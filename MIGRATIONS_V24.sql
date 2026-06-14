-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V24.sql — Restrict anonymous system_config exposure
--
-- Idempotent. The only table readable by the `anon` role (via an "always true"
-- policy) was public.system_config, which exposed internal operational config
-- (AI budget, user limits, retention days …) to unauthenticated callers.
--
-- Fix: anon may read ONLY the handful of non-sensitive flags the login/register
-- screen needs pre-auth; authenticated users keep full read. Writes remain
-- super-admin only (unchanged).
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "users_read_system_config" ON public.system_config;

CREATE POLICY "system_config_read" ON public.system_config
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    OR key IN (
      'maintenance_mode',
      'maintenance_message',
      'allow_signups',
      'registration_open',
      'require_approval',
      'app_version',
      'default_currency',
      'password_min_length',
      'two_factor_required',
      'session_timeout_hours'
    )
  );
