-- ============================================================================
-- MIGRATIONS_V204 — Notification Preferences (per-user)
-- ============================================================================
-- SAFE, additive slice of the §11 Notification engine. Adds ONLY a per-user
-- PREFERENCES store — one row per user — that records which channels a user
-- wants to receive notifications on, their quiet-hours window, digest cadence
-- and minimum priority. It does NOT introduce a parallel notification queue:
-- the existing `notifications` (V19), `workflow_notifications` delivery queue
-- (V119), `alert_thresholds` and `useRealtimeAlerts` remain the transport.
-- A future deliverer reads these preferences before fanning out.
--
-- One row per user (user_id primary key). Each user manages ONLY their own row;
-- Admin/Manager/Director may SELECT other rows for support. Org isolation is the
-- hard RESTRICTIVE boundary. Depends on V42 helpers: app_current_org(),
-- set_updated_at(), and the RBAC helper get_my_role(). Idempotent + reversible.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id           uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  organisation_id   uuid DEFAULT public.app_current_org(),
  channel_in_app    boolean NOT NULL DEFAULT true,
  channel_email     boolean NOT NULL DEFAULT true,
  channel_push      boolean NOT NULL DEFAULT false,
  channel_whatsapp  boolean NOT NULL DEFAULT false,
  channel_sms       boolean NOT NULL DEFAULT false,
  channel_slack     boolean NOT NULL DEFAULT false,
  channel_teams     boolean NOT NULL DEFAULT false,
  quiet_start       time,
  quiet_end         time,
  timezone          text,
  digest_frequency  text NOT NULL DEFAULT 'none'
                      CHECK (digest_frequency IN ('none','daily','weekly')),
  min_priority      text NOT NULL DEFAULT 'low'
                      CHECK (min_priority IN ('low','normal','high','critical')),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_org
  ON public.notification_preferences (organisation_id);

DROP TRIGGER IF EXISTS set_updated_at_notification_preferences ON public.notification_preferences;
CREATE TRIGGER set_updated_at_notification_preferences BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). On top of that, a user may
-- only read/write their OWN row (user_id = auth.uid()); Admin/Manager/Director
-- may additionally SELECT any row in the org for support/troubleshooting.
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_preferences_org_isolation ON public.notification_preferences;
CREATE POLICY notification_preferences_org_isolation ON public.notification_preferences
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS notification_preferences_select ON public.notification_preferences;
CREATE POLICY notification_preferences_select ON public.notification_preferences FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.get_my_role() IN ('Admin','Manager','Director')
  );

DROP POLICY IF EXISTS notification_preferences_insert ON public.notification_preferences;
CREATE POLICY notification_preferences_insert ON public.notification_preferences FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notification_preferences_update ON public.notification_preferences;
CREATE POLICY notification_preferences_update ON public.notification_preferences FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notification_preferences_delete ON public.notification_preferences;
CREATE POLICY notification_preferences_delete ON public.notification_preferences FOR DELETE
  USING (user_id = auth.uid());

REVOKE ALL ON public.notification_preferences FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;

-- Reversible:
--   DROP TABLE IF EXISTS public.notification_preferences;
