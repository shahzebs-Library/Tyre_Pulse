-- =============================================================================
-- MIGRATIONS_V321_USER_DEVICES.sql
-- Multi-device push token registry (P1 Finding #15).
--
-- PROBLEM: the Expo push token was stored on profiles.push_token (one column),
-- so a user's SECOND phone OVERWROTE the first - they could only reliably
-- receive push on a single device. And a failed token write could look like a
-- success (fire-and-forget, no verified result).
--
-- FIX (additive - does NOT remove the profiles.push_token path):
--   1. public.user_devices - one row PER physical device per user. A device's
--      Expo push token is GLOBALLY UNIQUE, so we UNIQUE it and upsert on it:
--      re-registering the same device updates the row (and re-points it to the
--      current user, so a shared handset re-points cleanly on the next login).
--   2. register_user_device / revoke_user_device SECURITY DEFINER RPCs the
--      mobile app calls to persist / retire the current device's token.
--
-- BACKWARD COMPAT (IMPORTANT):
--   The existing server push consumers - consume_event_approval_push (V267),
--   consume_event_assignment_push (V297) - and the workflow-notify edge fn read
--   profiles.push_token to target devices. This migration KEEPS writing
--   profiles.push_token (the mobile client still updates it, and the RPC below
--   also stamps it) so those consumers keep delivering to at least the latest
--   device with NO change. user_devices is purely additive.
--
--   FOLLOW-UP (separate change, NOT in this migration): update the server push
--   consumers + workflow-notify to FAN OUT over user_devices (every row per
--   recipient WHERE revoked = false) instead of the single profiles.push_token,
--   so ALL of a user's devices receive the push. Until then, multi-device
--   delivery is stored but not yet fanned out server-side.
--
-- Blast radius: one new table + two RPCs. Depends on existing helpers
-- app_current_org(), is_super_admin(). Idempotent: CREATE TABLE / INDEX / POLICY
-- IF NOT EXISTS + CREATE OR REPLACE FUNCTION. Reversible: see the footer.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_devices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organisation_id  uuid DEFAULT public.app_current_org(),
  push_token       text NOT NULL,
  platform         text,
  device_id        text,
  app_version      text,
  last_seen_at     timestamptz DEFAULT now(),
  revoked          boolean DEFAULT false,
  created_at       timestamptz DEFAULT now()
);

-- Idempotent column adds (safe if an earlier partial version of the table exists).
ALTER TABLE public.user_devices
  ADD COLUMN IF NOT EXISTS organisation_id uuid DEFAULT public.app_current_org(),
  ADD COLUMN IF NOT EXISTS platform        text,
  ADD COLUMN IF NOT EXISTS device_id       text,
  ADD COLUMN IF NOT EXISTS app_version     text,
  ADD COLUMN IF NOT EXISTS last_seen_at    timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS revoked         boolean DEFAULT false;

-- A physical device's Expo push token is globally unique; UNIQUE it so the RPC
-- can ON CONFLICT (push_token) upsert - re-registering the same device updates
-- its row (and re-points it to the current user) instead of creating a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS user_devices_push_token_uidx
  ON public.user_devices (push_token);

-- Hot path: "all live devices for this user" (the server fan-out target).
CREATE INDEX IF NOT EXISTS user_devices_user_active_idx
  ON public.user_devices (user_id) WHERE revoked = false;

-- ---------------------------------------------------------------------------
-- 2. Row Level Security
--    RESTRICTIVE org isolation intersects with a PERMISSIVE own-rows policy so
--    a user manages only their OWN device rows within their own org.
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

-- Org isolation (outer wall): only a super-admin crosses the org boundary.
DROP POLICY IF EXISTS user_devices_org_isolation ON public.user_devices;
CREATE POLICY user_devices_org_isolation ON public.user_devices
  AS RESTRICTIVE FOR ALL
  USING ((organisation_id = (select public.app_current_org())) OR (select public.is_super_admin()))
  WITH CHECK ((organisation_id = (select public.app_current_org())) OR (select public.is_super_admin()));

-- Own rows: a user may read / register / update ONLY their own device rows.
DROP POLICY IF EXISTS user_devices_select_own ON public.user_devices;
CREATE POLICY user_devices_select_own ON public.user_devices
  FOR SELECT USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS user_devices_insert_own ON public.user_devices;
CREATE POLICY user_devices_insert_own ON public.user_devices
  FOR INSERT WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS user_devices_update_own ON public.user_devices;
CREATE POLICY user_devices_update_own ON public.user_devices
  FOR UPDATE USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- Deny anon; grant authenticated (the policies above + the DEFINER RPCs are the
-- real boundary). No DELETE grant/policy: retirement is a soft revoke, not a
-- hard delete, so a device's history is preserved.
REVOKE ALL ON public.user_devices FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.user_devices TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------

-- register_user_device: upsert the caller's device by its globally-unique push
-- token. Re-registering the same token updates the row, un-revokes it, refreshes
-- last_seen_at, and RE-POINTS it to the current caller (so a shared handset
-- re-points cleanly on the next login). Also clears the SAME token from any
-- OTHER user's row is implicit in the upsert (one row per token), but the
-- profiles.push_token of the PREVIOUS owner is left alone here - the fan-out
-- follow-up will read user_devices, which is now correct. Returns the row id.
CREATE OR REPLACE FUNCTION public.register_user_device(
  p_push_token text,
  p_platform   text DEFAULT NULL,
  p_device_id  text DEFAULT NULL,
  p_app_version text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_push_token IS NULL OR btrim(p_push_token) = '' THEN
    RAISE EXCEPTION 'push token required';
  END IF;

  -- One row per globally-unique device token. On conflict, re-point to the
  -- current user, un-revoke, and refresh metadata + last_seen_at. This same
  -- statement removes the token from any OTHER user (there is only one row per
  -- token, and we overwrite its user_id), so a shared device re-points cleanly.
  INSERT INTO public.user_devices AS d
    (user_id, organisation_id, push_token, platform, device_id, app_version,
     last_seen_at, revoked)
  VALUES
    (v_uid, public.app_current_org(), btrim(p_push_token), p_platform, p_device_id,
     p_app_version, now(), false)
  ON CONFLICT (push_token) DO UPDATE
    SET user_id         = v_uid,
        organisation_id = public.app_current_org(),
        platform        = COALESCE(EXCLUDED.platform, d.platform),
        device_id       = COALESCE(EXCLUDED.device_id, d.device_id),
        app_version     = COALESCE(EXCLUDED.app_version, d.app_version),
        last_seen_at    = now(),
        revoked         = false
  RETURNING d.id INTO v_id;

  -- Compatibility: keep profiles.push_token pointing at this (latest) device so
  -- the existing single-column server consumers still deliver until the fan-out
  -- follow-up lands.
  UPDATE public.profiles
     SET push_token = btrim(p_push_token),
         push_token_updated_at = now()
   WHERE id = v_uid;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_user_device(text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.register_user_device(text, text, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.register_user_device(text, text, text, text) TO authenticated;

-- revoke_user_device: soft-revoke the caller's own row for a given token (used
-- on logout so pushes are not delivered to a device the user has signed out of).
CREATE OR REPLACE FUNCTION public.revoke_user_device(p_push_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_push_token IS NULL OR btrim(p_push_token) = '' THEN
    RETURN;
  END IF;

  UPDATE public.user_devices
     SET revoked = true,
         last_seen_at = now()
   WHERE user_id = v_uid
     AND push_token = btrim(p_push_token);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_user_device(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_user_device(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.revoke_user_device(text) TO authenticated;

-- =============================================================================
-- Reversal (manual):
--   DROP FUNCTION IF EXISTS public.revoke_user_device(text);
--   DROP FUNCTION IF EXISTS public.register_user_device(text, text, text, text);
--   DROP TABLE IF EXISTS public.user_devices;
-- =============================================================================
