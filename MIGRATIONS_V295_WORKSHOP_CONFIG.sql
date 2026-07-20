-- =============================================================================
-- MIGRATIONS_V295_WORKSHOP_CONFIG.sql   (applied live via Supabase MCP)
-- Admin configuration surface for Workshop Live Control.
--
-- What this does:
--   CREATE public.workshop_config - one row per (organisation_id, key) holding a
--   jsonb value. Lets an Admin/Manager/Director tune the Workshop Live Control
--   alert thresholds, productivity target, labour rate and shift defaults instead
--   of them being hardcoded in src/lib/workshopLive.js.
--
-- Keys (each a jsonb value; absence of a row = the engine's built-in default):
--   thresholds        -> { unassignedMin, noActivityMin, overSafeOvertimeMin,
--                          vorSlaHours, blockedPendingMin }  (mirrors DEFAULT_THRESHOLDS)
--   target_utilization -> number 0..1
--   labour_rate        -> number (currency per hour; feeds delayBreakdown cost)
--   shift_default      -> { start, end }  ("HH:MM")
--   overtime_safe_min  -> number (minutes)
--
-- We deliberately DO NOT seed rows: the service (src/lib/api/workshopConfig.js)
-- merges DB rows over WORKSHOP_CONFIG_DEFAULTS, so an empty table = engine defaults.
--
-- Blast radius: purely additive (a new table). Depends on existing helpers
-- app_current_org(), app_is_active(), app_is_elevated(), set_updated_at().
-- Idempotent: CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.workshop_config (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL DEFAULT public.app_current_org(),
  key              text NOT NULL,
  value            jsonb NOT NULL,
  updated_by       uuid DEFAULT auth.uid(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, key)
);

CREATE INDEX IF NOT EXISTS idx_workshop_config_org ON public.workshop_config (organisation_id);

DROP TRIGGER IF EXISTS set_updated_at_workshop_config ON public.workshop_config;
CREATE TRIGGER set_updated_at_workshop_config BEFORE UPDATE ON public.workshop_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--   RESTRICTIVE org isolation (outer wall) intersected with a PERMISSIVE
--   SELECT for any active member and PERMISSIVE writes for elevated roles.
-- ---------------------------------------------------------------------------
ALTER TABLE public.workshop_config ENABLE ROW LEVEL SECURITY;

-- Org isolation (RESTRICTIVE, ALL): a row is only ever visible/writable in-org.
DROP POLICY IF EXISTS workshop_config_org_isolation ON public.workshop_config;
CREATE POLICY workshop_config_org_isolation ON public.workshop_config
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

-- Read: any active member (scoped by the RESTRICTIVE org policy above).
DROP POLICY IF EXISTS workshop_config_select ON public.workshop_config;
CREATE POLICY workshop_config_select ON public.workshop_config
  FOR SELECT USING (public.app_is_active());

-- Write: elevated roles only (Admin / Manager / Director).
DROP POLICY IF EXISTS workshop_config_write ON public.workshop_config;
CREATE POLICY workshop_config_write ON public.workshop_config
  FOR ALL
  USING (public.app_is_elevated())
  WITH CHECK (public.app_is_elevated());

-- Deny anon; grant authenticated (the policies above are the real boundary).
REVOKE ALL ON public.workshop_config FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workshop_config TO authenticated;

-- =============================================================================
-- Reversal (manual):
--   DROP TABLE IF EXISTS public.workshop_config;
-- =============================================================================
