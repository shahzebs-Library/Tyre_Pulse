-- V64: Admin-gated bulk writer for the role x module access matrix (Access Control
-- tab in User Management). Writes GLOBAL rows (org_id IS NULL); update-or-insert
-- because the unique index treats NULL org_id as distinct. Admin role stays full.
CREATE OR REPLACE FUNCTION public.set_module_permissions(p_changes jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_role text; v_super boolean; rec jsonb;
  v_n integer := 0; v_mod text; v_r text; v_en boolean;
BEGIN
  SELECT role, coalesce(is_super_admin,false) INTO v_role, v_super FROM profiles WHERE id = v_uid;
  IF v_role IS DISTINCT FROM 'Admin' AND v_super IS NOT TRUE THEN
    RAISE EXCEPTION 'Only an Admin can change module access.' USING errcode = '42501';
  END IF;
  IF jsonb_typeof(p_changes) <> 'array' THEN
    RAISE EXCEPTION 'p_changes must be a JSON array of {role, module_key, enabled}.'; END IF;
  FOR rec IN SELECT * FROM jsonb_array_elements(p_changes) LOOP
    v_r := rec->>'role'; v_mod := rec->>'module_key'; v_en := (rec->>'enabled')::boolean;
    IF v_r IS NULL OR v_mod IS NULL OR v_en IS NULL THEN CONTINUE; END IF;
    IF v_r = 'Admin' THEN v_en := true; END IF;
    UPDATE module_permissions SET enabled = v_en, updated_by = v_uid, updated_at = now()
      WHERE org_id IS NULL AND role = v_r AND module_key = v_mod;
    IF NOT FOUND THEN
      INSERT INTO module_permissions (module_key, role, org_id, enabled, updated_by, updated_at)
      VALUES (v_mod, v_r, NULL, v_en, v_uid, now());
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $function$;
REVOKE ALL ON FUNCTION public.set_module_permissions(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_module_permissions(jsonb) TO authenticated;
