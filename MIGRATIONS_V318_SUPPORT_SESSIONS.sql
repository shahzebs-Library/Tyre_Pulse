-- =============================================================================
-- MIGRATIONS_V318_SUPPORT_SESSIONS.sql
--
-- Platform-owner SUPPORT SESSIONS: a time-boxed, reason-required, read-only-by-
-- default, fully-audited record authorizing a super-admin to inspect ONE
-- customer organisation's data during a support engagement. This replaces the
-- current posture of silent, unrestricted cross-org super-admin access with an
-- explicit, expiring, logged grant.
--
-- STATUS: **NOT YET APPLIED.** Apply only after review. Additive / non-
-- destructive. Reversal footer at the bottom.
--
-- SCOPE OF THIS MIGRATION (deliberately narrow):
--   This migration only RECORDS and AUTHORIZES support sessions and AUDITS the
--   start/end events. It does NOT change data visibility. Making the actual
--   reads honor an active session (i.e. having app_current_org() or any RLS
--   policy resolve to the session's target_org while a session is active) is a
--   SEPARATE, careful follow-up and is INTENTIONALLY NOT included here.
--   This migration does NOT modify app_current_org() or any existing policy.
--
-- AUDIT: start_support_session / end_support_session reuse the EXISTING console
--   audit writer public.log_console_event(...) (V275) - the same server-stamped,
--   super-admin-gated sink used by the rest of the console. No parallel audit
--   table is introduced.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table: public.support_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_id  uuid        NOT NULL DEFAULT auth.uid()
                              REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_org_id   uuid        NOT NULL
                              REFERENCES public.organisations(id) ON DELETE CASCADE,
  reason          text        NOT NULL,
  mode            text        NOT NULL DEFAULT 'read_only'
                              CHECK (mode IN ('read_only', 'edit')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  ended_at        timestamptz,
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- A session is "live" when active AND not manually ended AND not past expiry.
-- Index the common lookup (my live session).
CREATE INDEX IF NOT EXISTS support_sessions_admin_live_idx
  ON public.support_sessions (super_admin_id, active, expires_at);
CREATE INDEX IF NOT EXISTS support_sessions_target_org_idx
  ON public.support_sessions (target_org_id);

COMMENT ON TABLE public.support_sessions IS
  'Time-boxed, reason-required, read-only-by-default authorizations for a super-admin to inspect one customer org during support. Records/authorizes only; does not itself change data visibility (see V318 header).';

-- ---------------------------------------------------------------------------
-- 2. RLS: super-admin only, for every operation. Never readable by normal users.
-- ---------------------------------------------------------------------------
ALTER TABLE public.support_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_sessions_superadmin_all ON public.support_sessions;
CREATE POLICY support_sessions_superadmin_all
  ON public.support_sessions
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Base table is not reachable by anon / public.
REVOKE ALL ON public.support_sessions FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_sessions TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. RPC: start_support_session
--    Opens a session for a target org, with a mandatory reason, a time box
--    (minutes, default 30), and a mode (read_only default). Super-admin gated.
--    Audited via log_console_event. Returns the new session row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_support_session(
  p_target_org uuid,
  p_reason     text,
  p_minutes    integer DEFAULT 30,
  p_mode       text    DEFAULT 'read_only'
)
RETURNS public.support_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row     public.support_sessions;
  v_minutes integer;
  v_mode    text;
BEGIN
  -- Self-gate: super-admin only.
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super admin required';
  END IF;

  -- Validate inputs (fail loudly rather than opening a malformed session).
  IF p_target_org IS NULL THEN
    RAISE EXCEPTION 'A target organisation is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organisations WHERE id = p_target_org) THEN
    RAISE EXCEPTION 'Unknown target organisation';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to open a support session';
  END IF;

  v_mode := lower(coalesce(nullif(btrim(p_mode), ''), 'read_only'));
  IF v_mode NOT IN ('read_only', 'edit') THEN
    RAISE EXCEPTION 'Invalid mode: %', p_mode;
  END IF;

  -- Clamp the time box to a sane window: 1 minute .. 8 hours.
  v_minutes := coalesce(p_minutes, 30);
  IF v_minutes < 1   THEN v_minutes := 1;   END IF;
  IF v_minutes > 480 THEN v_minutes := 480; END IF;

  -- Close any other live session this admin holds (one live session at a time).
  UPDATE public.support_sessions
     SET active = false, ended_at = now()
   WHERE super_admin_id = auth.uid()
     AND active = true
     AND ended_at IS NULL;

  INSERT INTO public.support_sessions
    (super_admin_id, target_org_id, reason, mode, started_at, expires_at, active)
  VALUES
    (auth.uid(), p_target_org, btrim(p_reason), v_mode,
     now(), now() + make_interval(mins => v_minutes), true)
  RETURNING * INTO v_row;

  -- Audit into the EXISTING console_sessions sink directly. (log_console_event
  -- declares p_target_id text but console_sessions.target_id is uuid, so it cannot
  -- carry our uuid session id; this DEFINER RPC inserts the audit row itself with
  -- correct typing. Same table, same server-stamped admin_id = auth.uid().)
  INSERT INTO public.console_sessions (admin_id, action, target_id, target_type, details)
  VALUES (auth.uid(), 'support_session_start', v_row.id, 'support_session',
    jsonb_build_object(
      'target_org_id', v_row.target_org_id,
      'mode',          v_row.mode,
      'reason',        v_row.reason,
      'expires_at',    v_row.expires_at,
      'minutes',       v_minutes
    ));

  RETURN v_row;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.start_support_session(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.start_support_session(uuid, text, integer, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPC: end_support_session
--    Closes a session the caller owns. Super-admin gated. Audited. Idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.end_support_session(
  p_id uuid
)
RETURNS public.support_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.support_sessions;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super admin required';
  END IF;

  UPDATE public.support_sessions
     SET active = false,
         ended_at = COALESCE(ended_at, now())
   WHERE id = p_id
     AND super_admin_id = auth.uid()
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Support session not found';
  END IF;

  INSERT INTO public.console_sessions (admin_id, action, target_id, target_type, details)
  VALUES (auth.uid(), 'support_session_end', v_row.id, 'support_session',
    jsonb_build_object(
      'target_org_id', v_row.target_org_id,
      'ended_at',      v_row.ended_at
    ));

  RETURN v_row;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.end_support_session(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.end_support_session(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. RPC: current_support_session
--    Returns the caller's active, non-expired session (target org + mode) or
--    NULL. Read-only helper - NOT audited (no side effect). Super-admin gated.
--    This is the seam a future RLS follow-up would consult; it does NOT change
--    any policy today.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_support_session()
RETURNS public.support_sessions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT s.*
  FROM public.support_sessions s
  WHERE s.super_admin_id = auth.uid()
    AND public.is_super_admin()
    AND s.active = true
    AND s.ended_at IS NULL
    AND (s.expires_at IS NULL OR s.expires_at > now())
  ORDER BY s.started_at DESC
  LIMIT 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.current_support_session() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.current_support_session() TO authenticated;

-- =============================================================================
-- Reversal (manual):
--   DROP FUNCTION IF EXISTS public.current_support_session();
--   DROP FUNCTION IF EXISTS public.end_support_session(uuid);
--   DROP FUNCTION IF EXISTS public.start_support_session(uuid, text, integer, text);
--   DROP TABLE IF EXISTS public.support_sessions;
-- =============================================================================
