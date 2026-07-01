-- ============================================================
-- TYREPULSE V43 PUSH NOTIFICATION TOKENS
-- Adds push_token column to profiles so the server can send
-- targeted Expo push notifications to individual inspectors.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS push_token             text,
  ADD COLUMN IF NOT EXISTS push_token_updated_at  timestamptz;

-- Fast lookup when the server fans out push notifications by site/role.
CREATE INDEX IF NOT EXISTS idx_profiles_push_token
  ON public.profiles (push_token)
  WHERE push_token IS NOT NULL;

-- Allow the mobile app (authenticated) to update its own push token
-- without a separate RBAC bypass — covered by the existing profiles_update_own policy.
-- (No additional policy needed — profiles_update_own already allows self-updates.)
