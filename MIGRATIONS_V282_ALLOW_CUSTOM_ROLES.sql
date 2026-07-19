-- V282: Let custom roles actually be assigned to users.
--
-- ROOT CAUSE (backend audit 2026-07-19): assigning a user to a newly-created custom
-- role silently did nothing ("I add new roles, assign to them, it's still same even
-- when I change it"). TWO hardcoded allowlists of the 10 built-in roles rejected every
-- custom role name:
--   1. BEFORE trigger normalize_profiles_role() coerced any non-builtin role back to
--      'Reporter' -> the UPDATE reported success (1 row) but the stored role never
--      changed. Verified live: UPDATE profiles SET role='Fleet Supervisor' left the
--      stored value as the user's OLD role.
--   2. CHECK constraint profiles_role_check allowed only those same 10 names.
--
-- FIX: the normalize trigger now accepts a built-in role OR any role that exists in
-- public.custom_roles; only a genuinely unknown role falls back to 'Reporter'. The
-- static CHECK is dropped (a CHECK cannot reference custom_roles and would now reject
-- valid custom roles) - the trigger is the single dynamic validator and guarantees
-- profiles.role is always a real role.
--
-- Verified live (rolled back), authenticated as a super-admin:
--   assign 'Fleet Supervisor' -> stored 'Fleet Supervisor'
--   assign 'Insurance Officer' -> stored 'Insurance Officer'
--   assign garbage             -> stored 'Reporter' (safe fallback preserved)
--   assign 'Manager'           -> stored 'Manager'  (built-ins unaffected)

CREATE OR REPLACE FUNCTION public.normalize_profiles_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role IS NULL THEN
    NEW.role := 'Reporter';
    RETURN NEW;
  END IF;

  -- legacy typo fixes (unchanged)
  CASE lower(trim(NEW.role))
    WHEN 'schedule'        THEN NEW.role := 'Reporter';
    WHEN 'schedules'       THEN NEW.role := 'Reporter';
    WHEN 'schedule_report' THEN NEW.role := 'Reporter';
    WHEN 'schaule'         THEN NEW.role := 'Reporter';
    WHEN 'schdule'         THEN NEW.role := 'Reporter';
    ELSE NULL;
  END CASE;

  -- Accept a built-in role OR any defined custom role; else fall back to Reporter.
  IF NEW.role <> ALL (ARRAY['Admin','Manager','Director','Reporter','Inspector',
                            'Tyre Man','Driver','Integration Admin','Data Engineer','Automation']::text[])
     AND NOT EXISTS (SELECT 1 FROM public.custom_roles c WHERE c.name = NEW.role) THEN
    NEW.role := 'Reporter';
  END IF;

  RETURN NEW;
END;
$function$;

-- The static allowlist CHECK cannot know about custom_roles; the trigger now validates.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- Down (manual): re-add the CHECK with only built-ins and restore the old trigger body.
