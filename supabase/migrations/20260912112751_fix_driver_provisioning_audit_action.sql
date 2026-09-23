-- audit_log accepts INSERT/UPDATE/DELETE; retain the domain event in details.
DO $migration$
DECLARE definition text;
BEGIN
  definition:=pg_get_functiondef('public.provision_approved_driver_account(uuid,uuid,uuid,text,text,text,text,text,text,boolean)'::regprocedure);
  definition:=replace(definition,
    'jsonb_build_object(''batch_id'',p_batch_id',
    'jsonb_build_object(''event'',''driver_account_provisioned'',''batch_id'',p_batch_id');
  definition:=replace(definition,'action=''driver_account_provisioned''','action=''INSERT''');
  definition:=replace(definition,'''driver_account_provisioned'',p_actor_id','''INSERT'',p_actor_id');
  EXECUTE definition;
END $migration$;
