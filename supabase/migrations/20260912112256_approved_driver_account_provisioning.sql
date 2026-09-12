-- Passwords and employee import files never belong in migrations. Auth users are
-- created through the Admin API; this service-only transaction finalizes the
-- approved profile, driver identity and audit record without changing old users.
CREATE OR REPLACE FUNCTION public.provision_approved_driver_account(
  p_user_id uuid, p_actor_id uuid, p_organisation_id uuid, p_employee_id text,
  p_full_name text, p_country text, p_position text, p_iqama text,
  p_batch_id text, p_preserve_profile boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  actor public.profiles%ROWTYPE; account public.profiles%ROWTYPE;
  driver public.drivers%ROWTYPE; marker text; linked boolean := false;
  found_link uuid; old_claims text; old_sub text; import_details jsonb;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id=p_actor_id;
  IF NOT FOUND OR actor.role<>'Admin' OR NOT coalesce(actor.approved,false)
     OR coalesce(actor.locked,false) OR actor.org_id IS DISTINCT FROM p_organisation_id THEN
    RAISE EXCEPTION 'Active administrator in the target organisation required' USING ERRCODE='42501';
  END IF;
  IF p_employee_id IS NULL OR p_employee_id !~ '^[0-9]{3,30}$'
     OR nullif(btrim(p_full_name),'') IS NULL OR nullif(btrim(p_position),'') IS NULL
     OR p_country IS DISTINCT FROM 'KSA' OR nullif(btrim(p_batch_id),'') IS NULL THEN
    RAISE EXCEPTION 'Verified employee ID, name, position, KSA and import batch required' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':'||p_employee_id,0));
  SELECT * INTO account FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND OR account.org_id IS DISTINCT FROM p_organisation_id
     OR account.organisation_id IS DISTINCT FROM p_organisation_id
     OR btrim(account.employee_id) IS DISTINCT FROM p_employee_id THEN
    RAISE EXCEPTION 'Account identity or organisation mismatch' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM public.profiles WHERE btrim(employee_id)=p_employee_id AND id<>p_user_id) THEN
    RAISE EXCEPTION 'Employee ID matches more than one account' USING ERRCODE='23505';
  END IF;
  IF NOT p_preserve_profile THEN
    SELECT raw_app_meta_data->>'driver_import_batch' INTO marker FROM auth.users WHERE id=p_user_id;
    IF marker IS DISTINCT FROM p_batch_id OR account.username IS DISTINCT FROM p_employee_id THEN
      RAISE EXCEPTION 'Only accounts created by this import may be updated' USING ERRCODE='42501';
    END IF;
    old_claims:=current_setting('request.jwt.claims',true);
    old_sub:=current_setting('request.jwt.claim.sub',true);
    PERFORM set_config('request.jwt.claim.sub',p_actor_id::text,true);
    PERFORM set_config('request.jwt.claims',
      (coalesce(nullif(old_claims,''),'{}')::jsonb||jsonb_build_object('sub',p_actor_id::text))::text,true);
    UPDATE public.profiles SET role='Driver',approved=true,locked=false,
      country=ARRAY['KSA'],countries=ARRAY['KSA'],region='KSA',
      site=NULL,sites=ARRAY[]::text[],full_name=btrim(p_full_name)
      WHERE id=p_user_id;
    PERFORM set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
    PERFORM set_config('request.jwt.claims',coalesce(old_claims,''),true);
  END IF;
  IF (SELECT count(*) FROM public.drivers WHERE organisation_id=p_organisation_id AND btrim(driver_id)=p_employee_id)>1 THEN
    RAISE EXCEPTION 'Employee ID matches more than one driver record' USING ERRCODE='23505';
  END IF;
  SELECT * INTO driver FROM public.drivers WHERE organisation_id=p_organisation_id AND btrim(driver_id)=p_employee_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.drivers(driver_id,driver_name,country,organisation_id,created_by,custom_data)
    VALUES(p_employee_id,btrim(p_full_name),p_country,p_organisation_id,p_actor_id,
      jsonb_build_object('position',btrim(p_position),'employee_iqama',nullif(btrim(p_iqama),''),'import_batch',p_batch_id))
    RETURNING * INTO driver;
  ELSIF driver.country IS DISTINCT FROM p_country THEN
    RAISE EXCEPTION 'Existing driver country mismatch' USING ERRCODE='42501';
  END IF;
  -- The independently deployed fines workspace owns this table. Provisioning
  -- remains resumable before that rollout and never fabricates its schema.
  IF to_regclass('public.driver_account_links') IS NOT NULL THEN
    EXECUTE 'SELECT user_id FROM public.driver_account_links WHERE driver_id=$1' INTO found_link USING driver.id;
    IF found_link IS NOT NULL AND found_link<>p_user_id THEN
      RAISE EXCEPTION 'Driver already linked to another account' USING ERRCODE='23505';
    END IF;
    EXECUTE 'INSERT INTO public.driver_account_links(driver_id,user_id,organisation_id,linked_by)
      VALUES($1,$2,$3,$4) ON CONFLICT(driver_id) DO NOTHING'
      USING driver.id,p_user_id,p_organisation_id,p_actor_id;
    linked:=true;
  END IF;
  import_details:=jsonb_build_object('batch_id',p_batch_id,'user_id',p_user_id,'driver_id',driver.id,
    'profile_preserved',p_preserve_profile,'workspace_linked',linked,'country',p_country);
  IF NOT EXISTS(SELECT 1 FROM public.audit_log WHERE table_name='drivers' AND record_id=driver.id
      AND action='driver_account_provisioned' AND audit_log.details @> import_details) THEN
    INSERT INTO public.audit_log(table_name,record_id,action,changed_by,user_id,organisation_id,details)
      VALUES('drivers',driver.id,'driver_account_provisioned',p_actor_id,p_actor_id,p_organisation_id,import_details);
  END IF;
  RETURN import_details;
END $$;
REVOKE ALL ON FUNCTION public.provision_approved_driver_account(uuid,uuid,uuid,text,text,text,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.provision_approved_driver_account(uuid,uuid,uuid,text,text,text,text,text,text,boolean) TO service_role;
