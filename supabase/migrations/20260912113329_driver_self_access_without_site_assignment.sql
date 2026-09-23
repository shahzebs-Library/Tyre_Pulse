-- Self-service follows the verified account link, including drivers awaiting a
-- site assignment. Staff access continues to use the existing full site scope.
-- The workspace can be deployed independently of the account importer.
DO $migration$
BEGIN
  IF to_regprocedure('private.driver_workspace_access(uuid)') IS NULL THEN RETURN; END IF;
  EXECUTE $definition$
CREATE OR REPLACE FUNCTION private.driver_workspace_access(p_driver_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE d public.drivers%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.drivers WHERE id=p_driver_id;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT coalesce(public.app_is_active(),false)
     OR d.organisation_id IS DISTINCT FROM public.app_current_org() THEN RETURN 'none'; END IF;
  IF (public.is_super_admin() OR public.app_sees_all_countries()
      OR lower(btrim(d.country))=ANY(public.app_country_scope()))
     AND EXISTS(SELECT 1 FROM public.driver_account_links l WHERE l.driver_id=d.id
       AND l.user_id=auth.uid() AND l.organisation_id=d.organisation_id) THEN
    RETURN 'driver';
  END IF;
  IF NOT private.driver_workspace_scope(d.organisation_id,d.country,d.site) THEN RETURN 'none'; END IF;
  IF public.app_user_can('fleet_master','edit') THEN RETURN 'manager'; END IF;
  IF EXISTS(SELECT 1 FROM public.driver_team_assignments a WHERE a.driver_id=d.id AND a.organisation_id=d.organisation_id
    AND a.starts_at<=now() AND (a.ends_at IS NULL OR a.ends_at>now()) AND auth.uid() IN (a.supervisor_id,a.manager_id)) THEN RETURN 'supervisor'; END IF;
  IF public.app_user_can('driver_workspace','view') THEN RETURN 'viewer'; END IF;
  RETURN 'none';
END $function$;
  $definition$;
END $migration$;
