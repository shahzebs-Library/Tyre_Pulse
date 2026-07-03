-- ============================================================================
-- MIGRATIONS_V69_LOGIN_IDENTIFIER
-- Sign in with email, username, OR employee code (case-insensitive).
--
-- Supabase Auth authenticates on email+password; the client resolves a typed
-- username / employee code to the account email via get_email_by_identifier
-- (SECURITY DEFINER, anon-executable — runs before authentication) and then
-- signs in. This migration makes that resolution case-insensitive and enforces
-- uniqueness so an identifier maps to exactly one account.
--
-- Additive & backward-compatible. Verified with a rolled-back self-asserting
-- test (case-insensitive username + emp-code resolution, unknown → NULL,
-- duplicate emp code blocked).
-- ============================================================================

-- Case-insensitive uniqueness (partial: only non-blank values participate).
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_uidx
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL AND btrim(username) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS profiles_employee_id_lower_uidx
  ON public.profiles (lower(employee_id))
  WHERE employee_id IS NOT NULL AND btrim(employee_id) <> '';

-- Resolve email/username/employee-code → account email, case-insensitively.
-- Username matches take priority over employee code.
CREATE OR REPLACE FUNCTION public.get_email_by_identifier(identifier text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_id    text := btrim(identifier);
  v_email text;
BEGIN
  IF v_id IS NULL OR v_id = '' THEN
    RETURN NULL;
  END IF;

  SELECT au.email INTO v_email
  FROM auth.users au
  JOIN public.profiles p ON p.id = au.id
  WHERE lower(p.username) = lower(v_id)
  LIMIT 1;

  IF v_email IS NULL THEN
    SELECT au.email INTO v_email
    FROM auth.users au
    JOIN public.profiles p ON p.id = au.id
    WHERE lower(p.employee_id) = lower(v_id)
    LIMIT 1;
  END IF;

  RETURN v_email;
END;
$function$;
