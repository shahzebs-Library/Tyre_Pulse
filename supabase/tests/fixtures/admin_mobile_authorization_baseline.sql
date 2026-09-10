-- Captured deployed function definitions 2026-09-10; no customer data.
CREATE OR REPLACE FUNCTION public.admin_mobile_user_action(p_user_id uuid, p_action text, p_reason text DEFAULT NULL::text, p_role text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_is_super     boolean;
  v_caller_role  text;
  v_caller_org   uuid;
  v_caller_lock  boolean;
  v_caller_appr  boolean;
  v_t_role       text;
  v_t_super      boolean;
  v_t_org        uuid;
  v_t_appr       boolean;
  v_t_lock       boolean;
  v_action       text := lower(btrim(coalesce(p_action, '')));
  v_reason       text := nullif(btrim(coalesce(p_reason, '')), '');
  v_new_role     text := btrim(coalesce(p_role, ''));
  v_target_priv  boolean;
  v_new_priv     boolean;
  v_others       integer;
BEGIN
  SELECT COALESCE(is_super_admin, false), role, org_id,
         COALESCE(locked, false), COALESCE(approved, true)
    INTO v_is_super, v_caller_role, v_caller_org, v_caller_lock, v_caller_appr
    FROM public.profiles WHERE id = v_caller;

  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING errcode = '42501';
  END IF;

  IF NOT (v_is_super OR (v_caller_role = 'Admin' AND NOT v_caller_lock AND v_caller_appr)) THEN
    RAISE EXCEPTION 'You do not have permission to manage users.' USING errcode = '42501';
  END IF;

  IF v_action NOT IN ('approve','lock','unlock','deactivate','set_role') THEN
    RAISE EXCEPTION 'Unknown action.' USING errcode = '22023';
  END IF;

  SELECT role, COALESCE(is_super_admin, false), org_id,
         COALESCE(approved, false), COALESCE(locked, false)
    INTO v_t_role, v_t_super, v_t_org, v_t_appr, v_t_lock
    FROM public.profiles WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That user could not be found.' USING errcode = 'P0002';
  END IF;

  IF p_user_id = v_caller THEN
    IF v_action IN ('lock','deactivate') THEN
      RAISE EXCEPTION 'You cannot lock or deactivate your own account.' USING errcode = '42501';
    END IF;
    IF v_action = 'set_role' THEN
      RAISE EXCEPTION 'You cannot change your own role.' USING errcode = '42501';
    END IF;
  END IF;

  IF NOT v_is_super AND v_t_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'That user belongs to another organisation.' USING errcode = '42501';
  END IF;

  v_target_priv := v_t_super OR (lower(coalesce(v_t_role, '')) = 'admin');
  v_new_priv    := (v_action = 'set_role' AND lower(v_new_role) = 'admin');

  IF NOT v_is_super THEN
    IF v_t_super THEN
      RAISE EXCEPTION 'Only a super admin can manage a super admin.' USING errcode = '42501';
    END IF;
    IF v_target_priv AND v_action IN ('lock','deactivate','set_role') THEN
      RAISE EXCEPTION 'Only a super admin can change an administrator.' USING errcode = '42501';
    END IF;
    IF v_new_priv THEN
      RAISE EXCEPTION 'Only a super admin can grant the Admin role.' USING errcode = '42501';
    END IF;
  END IF;

  IF v_action IN ('lock','deactivate','set_role') THEN
    IF v_t_super THEN
      SELECT count(*) INTO v_others FROM public.profiles
        WHERE id <> p_user_id AND COALESCE(is_super_admin, false) AND COALESCE(locked, false) = false;
      IF v_others = 0 THEN
        RAISE EXCEPTION 'You cannot lock, deactivate or demote the last super admin.' USING errcode = '42501';
      END IF;
    END IF;
    IF lower(coalesce(v_t_role, '')) = 'admin'
       AND NOT v_t_lock AND v_t_appr
       AND (v_action IN ('lock','deactivate') OR (v_action = 'set_role' AND lower(v_new_role) <> 'admin')) THEN
      SELECT count(*) INTO v_others FROM public.profiles
        WHERE id <> p_user_id AND role = 'Admin'
          AND org_id IS NOT DISTINCT FROM v_t_org
          AND COALESCE(locked, false) = false AND COALESCE(approved, true);
      IF v_others = 0 THEN
        RAISE EXCEPTION 'You cannot remove the last administrator of this organisation.' USING errcode = '42501';
      END IF;
    END IF;
  END IF;

  IF v_action IN ('set_role','deactivate') AND v_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required for this action.' USING errcode = '22023';
  END IF;
  IF v_action = 'set_role' AND v_new_role = '' THEN
    RAISE EXCEPTION 'A role is required.' USING errcode = '22023';
  END IF;

  IF v_action = 'approve' THEN
    UPDATE public.profiles SET approved = true, updated_at = now() WHERE id = p_user_id;
  ELSIF v_action = 'lock' THEN
    UPDATE public.profiles SET locked = true, updated_at = now() WHERE id = p_user_id;
  ELSIF v_action = 'unlock' THEN
    UPDATE public.profiles SET locked = false, updated_at = now() WHERE id = p_user_id;
  ELSIF v_action = 'deactivate' THEN
    UPDATE public.profiles SET approved = false, locked = true, updated_at = now() WHERE id = p_user_id;
  ELSIF v_action = 'set_role' THEN
    UPDATE public.profiles SET role = v_new_role, updated_at = now() WHERE id = p_user_id;
  END IF;

  INSERT INTO public.access_audit
    (actor, actor_email, action, target_user, entity, before, after, reason)
  VALUES (
    v_caller,
    public.access_audit_actor_email(),
    'UPDATE',
    p_user_id,
    'mobile_' || v_action,
    jsonb_build_object('role', v_t_role, 'approved', v_t_appr, 'locked', v_t_lock, 'is_super_admin', v_t_super),
    jsonb_build_object('action', v_action, 'role', CASE WHEN v_action = 'set_role' THEN v_new_role ELSE v_t_role END),
    v_reason
  );

  RETURN jsonb_build_object('success', true, 'action', v_action);
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_user_access_grant(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only a Super Admin can change access grants.' USING errcode = '42501';
  END IF;
  DELETE FROM public.user_access_grants WHERE id = p_id;
END $function$;

CREATE OR REPLACE FUNCTION public.set_user_access_grant(p_user_id uuid, p_module_key text, p_capability text DEFAULT 'view'::text, p_effect text DEFAULT 'grant'::text, p_note text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_org uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only a Super Admin can change access grants.' USING errcode = '42501';
  END IF;
  IF p_effect NOT IN ('grant','revoke') THEN
    RAISE EXCEPTION 'effect must be grant or revoke.'; END IF;
  SELECT org_id INTO v_org FROM public.profiles WHERE id = p_user_id;
  INSERT INTO public.user_access_grants (org_id,user_id,module_key,capability,effect,granted_by,note,expires_at)
  VALUES (v_org,p_user_id,p_module_key,COALESCE(p_capability,'view'),p_effect,auth.uid(),p_note,p_expires_at)
  ON CONFLICT (user_id,module_key,capability,effect)
    DO UPDATE SET note = EXCLUDED.note, expires_at = EXCLUDED.expires_at,
                  granted_by = auth.uid(), created_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;
