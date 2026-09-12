-- The Data API service role cannot SELECT auth.users. Expose only this narrow
-- server-only predicate; never grant access to Auth identities or password data.
CREATE SCHEMA IF NOT EXISTS private;
CREATE FUNCTION private.driver_import_matches_batch(p_user_id uuid,p_batch_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce((SELECT raw_app_meta_data->>'driver_import_batch'=p_batch_id
    FROM auth.users WHERE id=p_user_id),false);
$$;
REVOKE ALL ON FUNCTION private.driver_import_matches_batch(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.driver_import_matches_batch(uuid,text) TO service_role;
DO $migration$
DECLARE definition text;
BEGIN
  definition:=pg_get_functiondef('public.provision_approved_driver_account(uuid,uuid,uuid,text,text,text,text,text,text,boolean)'::regprocedure);
  definition:=replace(definition,
    'SELECT raw_app_meta_data->>''driver_import_batch'' INTO marker FROM auth.users WHERE id=p_user_id;',
    'marker:=CASE WHEN private.driver_import_matches_batch(p_user_id,p_batch_id) THEN p_batch_id ELSE NULL END;');
  EXECUTE definition;
END $migration$;
