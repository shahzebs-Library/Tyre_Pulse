BEGIN;
-- Row edits and an approval decision take the same batch lock. This closes
-- the race where data is changed after the reviewer has approved its contents.
CREATE OR REPLACE FUNCTION public.guard_import_reviewed_contents()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE b public.import_batches%ROWTYPE; batch_id uuid;
BEGIN
  IF TG_OP='UPDATE' AND NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN
    RAISE EXCEPTION 'A staged row cannot move between batches.' USING ERRCODE='42501';
  END IF;
  batch_id := CASE WHEN TG_OP='DELETE' THEN OLD.batch_id ELSE NEW.batch_id END;
  SELECT * INTO b FROM public.import_batches WHERE id=batch_id FOR UPDATE;
  IF NOT FOUND OR b.organisation_id IS DISTINCT FROM public.app_current_org()
     OR NOT coalesce(public.app_is_active(),false) THEN
    RAISE EXCEPTION 'Import batch is unavailable in your organisation.' USING ERRCODE='42501';
  END IF;
  IF NOT coalesce(b.approval_status IN ('draft','pending_approval'),false) OR b.import_status IN ('committing','committed','reversed')
     OR NOT coalesce(public.import_user_can_commit_country(b.country),false) THEN
    -- Definer commit/enrichment functions may record outcomes, but even they
    -- cannot rewrite the reviewed source values or add/delete reviewed rows.
    IF TG_OP='UPDATE' AND current_user <> 'authenticated'
       AND b.approval_status='approved'
       AND coalesce(public.import_user_can_commit_country(b.country),false)
       AND (to_jsonb(NEW)-ARRAY['processed_at','target_record_id','target_module','dup_status','validation_status'])
           IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['processed_at','target_record_id','target_module','dup_status','validation_status']) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Approved import contents are immutable. Create a corrected batch for review.' USING ERRCODE='42501';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION public.guard_import_reviewed_contents() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER administration_reviewed_contents BEFORE INSERT OR UPDATE OR DELETE ON public.import_rows
FOR EACH ROW EXECUTE FUNCTION public.guard_import_reviewed_contents();

CREATE OR REPLACE FUNCTION public.guard_import_reviewed_context()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF (OLD.approval_status='approved' OR OLD.import_status IN ('committing','committed','reversed')) AND EXISTS(
    SELECT 1 FROM unnest(ARRAY['module','country','site','project','company_id','file_id','mapping_profile_id','mapping_profile_version','date_format','timezone','source_currency','unit_system']) k
    WHERE to_jsonb(OLD)->k IS DISTINCT FROM to_jsonb(NEW)->k
  ) THEN
    RAISE EXCEPTION 'Approved import context is immutable. Create a corrected batch for review.' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_import_reviewed_context() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER administration_reviewed_context BEFORE UPDATE ON public.import_batches
FOR EACH ROW EXECUTE FUNCTION public.guard_import_reviewed_context();

-- Small guarded changes preserve deployed user-role rules and audit format.
DO $user_guards$
DECLARE original text; revised text;
BEGIN
  original := pg_get_functiondef('public.admin_mobile_user_action(uuid,text,text,text)'::regprocedure);
  revised := replace(original,'BEGIN'||chr(10)||'  SELECT COALESCE',
    'BEGIN'||chr(10)||'  PERFORM pg_advisory_xact_lock(821746013);'||chr(10)||'  SELECT COALESCE');
  IF revised=original THEN RAISE EXCEPTION 'Unexpected mobile user function entry; review deployed definition.'; END IF;
  original := revised;
  revised := replace(original,
    'IF NOT (v_is_super OR (v_caller_role = ''Admin'' AND NOT v_caller_lock AND v_caller_appr)) THEN',
    'IF NOT coalesce(public.app_is_active(),false) OR NOT coalesce(v_is_super OR v_caller_role = ''Admin'',false) THEN');
  IF revised=original THEN RAISE EXCEPTION 'Unexpected mobile user authorization; review deployed definition.'; END IF;
  revised := replace(revised,'FROM public.profiles WHERE id = v_caller;','FROM public.profiles WHERE id = v_caller FOR SHARE;');
  revised := replace(revised,'FROM public.profiles WHERE id = p_user_id;','FROM public.profiles WHERE id = p_user_id FOR UPDATE;');
  revised := replace(revised,'AND COALESCE(locked, false) = false;','AND COALESCE(locked, false) = false AND COALESCE(approved, false);');
  EXECUTE revised;
END $user_guards$;

CREATE OR REPLACE FUNCTION public.set_user_access_grant(p_user_id uuid,p_module_key text,p_capability text DEFAULT 'view',p_effect text DEFAULT 'grant',p_note text DEFAULT NULL,p_expires_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid; v_org uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.app_is_active(),false) OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only an active Super Admin can change access grants.' USING ERRCODE='42501';
  END IF;
  IF p_effect IS NULL OR p_effect NOT IN ('grant','revoke') OR nullif(btrim(p_module_key),'') IS NULL THEN
    RAISE EXCEPTION 'A module and grant/revoke effect are required.' USING ERRCODE='22023';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at<=now() THEN RAISE EXCEPTION 'Grant expiry must be in the future.' USING ERRCODE='22023'; END IF;
  SELECT org_id INTO v_org FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND OR v_org IS NULL THEN RAISE EXCEPTION 'Target user requires an organisation.' USING ERRCODE='42501'; END IF;
  IF left(p_module_key,7)='mobile:' THEN
    -- A fresh ID prevents an installed client's cleanup of old grant IDs from
    -- deleting a newer concurrent override. Other clients retain existing semantics.
    DELETE FROM public.user_access_grants WHERE user_id=p_user_id AND module_key=p_module_key AND capability=coalesce(p_capability,'view');
  END IF;
  INSERT INTO public.user_access_grants(org_id,user_id,module_key,capability,effect,granted_by,note,expires_at)
    VALUES(v_org,p_user_id,p_module_key,coalesce(p_capability,'view'),p_effect,auth.uid(),p_note,p_expires_at)
  ON CONFLICT(user_id,module_key,capability,effect) DO UPDATE
    SET note=EXCLUDED.note,expires_at=EXCLUDED.expires_at,granted_by=auth.uid(),created_at=now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION public.revoke_user_access_grant(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.app_is_active(),false) OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only an active Super Admin can change access grants.' USING ERRCODE='42501';
  END IF;
  SELECT user_id INTO target FROM public.user_access_grants WHERE id=p_id;
  IF target IS NULL THEN RETURN; END IF;
  PERFORM 1 FROM public.profiles WHERE id=target FOR UPDATE;
  DELETE FROM public.user_access_grants WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.set_user_access_grant(uuid,text,text,text,text,timestamptz),public.revoke_user_access_grant(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_user_access_grant(uuid,text,text,text,text,timestamptz),public.revoke_user_access_grant(uuid) TO authenticated;
COMMIT;
