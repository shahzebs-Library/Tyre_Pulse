-- =============================================================================
-- MIGRATIONS_V275_CONSOLE_AUDIT.sql
-- Server-stamped console audit (finding A3) + module-status read policy (B1).
--
--   A3. Console login / logout / 2FA / action events were INSERTed directly from
--       the browser into console_sessions, and the INSERT policy was open, so the
--       admin_id and the very existence of a row were client-controlled (forgeable
--       and skippable). Replace that with a SECURITY DEFINER function
--       log_console_event(...) that stamps admin_id = auth.uid() server-side and
--       self-gates to super-admins. Then drop the open client INSERT policy so a
--       browser can no longer write console_sessions directly (the definer fn
--       bypasses RLS, so no client INSERT policy is needed). The existing SELECT
--       policy is left untouched.
--
--   B1. modules.status is now honored app-wide (Module Control enforcement). Make
--       sure any authenticated user can READ the modules table (status flags are
--       not sensitive; writes stay Admin / super-admin per V258). Idempotent.
--
-- Idempotent. Reversible: see the footer. Additive / hardening only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A3. Server-stamped console audit writer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_console_event(
  p_action      text,
  p_target_id   text  DEFAULT NULL,
  p_target_type text  DEFAULT NULL,
  p_details     jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Self-gate: only a super-admin may write a console audit row. The admin_id is
  -- stamped from auth.uid() here, never accepted from the caller.
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super admin required';
  END IF;

  INSERT INTO public.console_sessions (admin_id, action, target_id, target_type, details)
  VALUES (auth.uid(), p_action, p_target_id, p_target_type, COALESCE(p_details, '{}'::jsonb));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.log_console_event(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.log_console_event(text, text, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- A3. Tighten console_sessions INSERT: drop any open/client INSERT policy so
--     direct browser inserts are blocked. The definer fn above bypasses RLS, so
--     no client INSERT policy is required. SELECT policy is left intact.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'console_sessions'
      AND cmd = 'INSERT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.console_sessions', r.policyname);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- B1. modules: authenticated SELECT (status is not sensitive; writes stay gated)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'modules'
  ) THEN
    EXECUTE 'ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY';
    DROP POLICY IF EXISTS modules_authenticated_read ON public.modules;
    CREATE POLICY modules_authenticated_read ON public.modules
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- =============================================================================
-- Reversal (manual):
--   A3: DROP FUNCTION public.log_console_event(text,text,text,jsonb);
--       and (only if a client must write directly, not recommended) recreate an
--       INSERT policy on public.console_sessions.
--   B1: DROP POLICY IF EXISTS modules_authenticated_read ON public.modules;
-- =============================================================================
