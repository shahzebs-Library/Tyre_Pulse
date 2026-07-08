-- ============================================================================
-- MIGRATIONS_V107 — Integration / data roles for the ERP Sync Hub
-- ============================================================================
-- Adds three dedicated, least-privilege roles focused on data ingestion and
-- ERP automation, alongside the existing operational roles:
--
--   * Integration Admin — owns the ERP connection + data-integration surface.
--   * Data Engineer      — data intake / cleaning / import specialist.
--   * Automation         — runs scheduled ERP syncs & pipelines (operator).
--
-- Rationale: the ERP Sync Hub (module `erp_sync`) was Admin-only. Fleets that
-- separate "who administers users" from "who runs the data pipeline" need a
-- role that can operate ERP sync WITHOUT full tenant administration. These
-- roles never receive user-management, so they cannot escalate privilege.
--
-- Two changes, both idempotent and safe to re-run:
--   1. Widen the profiles.role CHECK constraint to the full role vocabulary
--      (kept in exact sync with the frontend role registry).
--   2. Scope app_settings writes: Admin keeps full write; Integration Admin and
--      Automation may write ONLY the `erp_connection` key (never
--      `permission_overrides`, alert thresholds, etc.) — so the integration
--      roles can run the connector but cannot alter access control or other
--      tenant settings. Data Engineer stays read-only on connection config.
-- ============================================================================

-- ── 1. Role vocabulary ──────────────────────────────────────────────────────
-- Drop whatever CHECK currently guards profiles.role (name has drifted across
-- historical migrations) and re-create it with the complete, current set.
DO $$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'profiles'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', v_conname);
  END LOOP;
END $$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN (
    'Admin',
    'Manager',
    'Director',
    'Reporter',
    'Inspector',
    'Tyre Man',
    'Driver',
    'Integration Admin',
    'Data Engineer',
    'Automation'
  ));

-- ── 2. Scoped app_settings writes for the integration roles ─────────────────
-- INSERT + UPDATE of the ERP connection config only; all other keys stay
-- Admin-only. get_my_role() is the existing SECURITY DEFINER helper.
DROP POLICY IF EXISTS "app_settings_insert" ON public.app_settings;
CREATE POLICY "app_settings_insert"
  ON public.app_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_my_role() = 'Admin'
    OR (
      public.get_my_role() IN ('Integration Admin', 'Automation')
      AND key = 'erp_connection'
    )
  );

DROP POLICY IF EXISTS "app_settings_update" ON public.app_settings;
CREATE POLICY "app_settings_update"
  ON public.app_settings
  FOR UPDATE
  TO authenticated
  USING (
    public.get_my_role() = 'Admin'
    OR (
      public.get_my_role() IN ('Integration Admin', 'Automation')
      AND key = 'erp_connection'
    )
  )
  WITH CHECK (
    public.get_my_role() = 'Admin'
    OR (
      public.get_my_role() IN ('Integration Admin', 'Automation')
      AND key = 'erp_connection'
    )
  );

-- DELETE stays Admin-only (unchanged from V12) — integration roles never
-- remove settings rows.
