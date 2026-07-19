-- V285: make normalize_profiles_role() SECURITY DEFINER.
--
-- Review finding: the V282 trigger validates NEW.role against public.custom_roles,
-- but that table has a RESTRICTIVE org-isolation policy, so under SECURITY INVOKER
-- the EXISTS() check only sees custom roles in the caller's org and only when
-- auth.uid() is set. A role assignment from a context without a matching org/uid
-- (e.g. a service-role batch) could then silently coerce a VALID custom role back
-- to 'Reporter' -- the same failure class V282 fixed. Running as owner makes the
-- existence check context-independent (sees every defined custom role) while still
-- coercing genuinely unknown roles to 'Reporter'. search_path stays pinned.
--
-- Verified live (rolled back): custom role 'Fleet Supervisor' persists; garbage -> Reporter.

CREATE OR REPLACE FUNCTION public.normalize_profiles_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role IS NULL THEN
    NEW.role := 'Reporter';
    RETURN NEW;
  END IF;

  CASE lower(trim(NEW.role))
    WHEN 'schedule'        THEN NEW.role := 'Reporter';
    WHEN 'schedules'       THEN NEW.role := 'Reporter';
    WHEN 'schedule_report' THEN NEW.role := 'Reporter';
    WHEN 'schaule'         THEN NEW.role := 'Reporter';
    WHEN 'schdule'         THEN NEW.role := 'Reporter';
    ELSE NULL;
  END CASE;

  IF NEW.role <> ALL (ARRAY['Admin','Manager','Director','Reporter','Inspector',
                            'Tyre Man','Driver','Integration Admin','Data Engineer','Automation']::text[])
     AND NOT EXISTS (SELECT 1 FROM public.custom_roles c WHERE c.name = NEW.role) THEN
    NEW.role := 'Reporter';
  END IF;

  RETURN NEW;
END;
$function$;
