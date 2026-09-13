INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('driver-fine-evidence','driver-fine-evidence',false,5242880,ARRAY['image/jpeg','image/png','application/pdf']);

CREATE FUNCTION private.driver_fine_storage_access(p_path text,p_write boolean)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE parts text[]; f public.driver_fines%ROWTYPE; mode text;
BEGIN
  IF p_path !~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(png|jpg|pdf)$' THEN RETURN false; END IF;
  parts:=string_to_array(p_path,'/');
  SELECT * INTO f FROM public.driver_fines WHERE id::text=parts[3] AND organisation_id::text=parts[1] AND driver_id::text=parts[2];
  IF NOT FOUND THEN RETURN false; END IF;
  mode:=private.driver_workspace_access(f.driver_id);
  RETURN mode<>'none' AND (NOT p_write OR (mode IN ('driver','supervisor','manager') AND f.status='open'));
END $$;
REVOKE ALL ON FUNCTION private.driver_fine_storage_access(text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.driver_fine_storage_access(text,boolean) TO authenticated;
CREATE POLICY driver_fine_evidence_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='driver-fine-evidence' AND private.driver_fine_storage_access(name,true));
CREATE POLICY driver_fine_evidence_read ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='driver-fine-evidence' AND private.driver_fine_storage_access(name,false));
-- No overwrite/delete policies: signed supporting material remains immutable.
