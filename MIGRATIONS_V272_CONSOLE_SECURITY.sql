-- =============================================================================
-- MIGRATIONS_V272_CONSOLE_SECURITY.sql
-- Super-admin console security hardening (audit findings A1, A2, A6, A7).
--
--   A1. Remove the always-true (WITH CHECK true) INSERT policies that let any
--       authenticated user forge audit rows. audit_log_v2 keeps its scoped
--       policy; inspection_audit_log's forgeable policy is replaced with a
--       self-attribution one. Definer audit TRIGGERS bypass RLS and are
--       unaffected.
--   A2. REVOKE EXECUTE ... FROM PUBLIC, anon on the privileged admin / access /
--       backup / import / holding write RPCs (defense in depth; they already
--       self-gate in-body). authenticated keeps EXECUTE. Deliberately-public
--       token/login RPCs (get_report_snapshot, get_display_snapshot,
--       get_email_by_identifier, ...) and RLS helper functions are left alone.
--   A6. Pin search_path on the SECURITY DEFINER helper backups._core_tables.
--   A7. admin_update_profile: require super-admin for privileged transitions
--       (role / approval / lock / organisation) and confine a non-super Admin
--       to descriptive edits of users in their OWN org. Closes the lateral
--       Admin-to-Admin escalation path.
--
-- Idempotent. Reversible: see the footer. Additive/hardening only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A1. Forgeable audit-insert policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS audit_log_v2_insert ON public.audit_log_v2;      -- WITH CHECK true (redundant; scoped audit_v2_insert remains)

DROP POLICY IF EXISTS insp_audit_insert ON public.inspection_audit_log;
CREATE POLICY insp_audit_insert ON public.inspection_audit_log
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND changed_by = auth.uid());

-- ---------------------------------------------------------------------------
-- A2. Revoke anon/PUBLIC execute on privileged write RPCs (keep authenticated)
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(ARRAY[
      'admin_db_columns','admin_db_query','admin_db_tables',
      'admin_set_admin_user','admin_update_profile',
      'backup_restore_missing','backup_restore_preview','create_backup_snapshot',
      'cron_run_backup','list_backup_snapshots',
      'create_report_share','revoke_report_share',
      'set_module_permissions','set_user_access_grant','revoke_user_access_grant',
      'import_existing_keys','import_reprocess_row','import_reverse_batch',
      'holding_link_subsidiary','holding_unlink_subsidiary',
      'resolve_system_logs'
    ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- A6. Pin search_path on backups._core_tables
-- ---------------------------------------------------------------------------
ALTER FUNCTION backups._core_tables() SET search_path = 'backups', 'public';

-- ---------------------------------------------------------------------------
-- A7. admin_update_profile: super-admin required for privileged transitions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_profile(
  p_user_id uuid, p_full_name text DEFAULT NULL, p_username text DEFAULT NULL,
  p_employee_id text DEFAULT NULL, p_role text DEFAULT NULL, p_country text[] DEFAULT NULL,
  p_region text DEFAULT NULL, p_site text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_notes text DEFAULT NULL, p_approved boolean DEFAULT NULL, p_locked boolean DEFAULT NULL,
  p_org_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role text;
  v_is_super    boolean;
  v_caller_org  uuid;
  v_target_org  uuid;
  v_org uuid := p_org_id;
  v_priv boolean;
BEGIN
  SELECT role, COALESCE(is_super_admin, false), org_id
    INTO v_caller_role, v_is_super, v_caller_org
    FROM public.profiles WHERE id = auth.uid() LIMIT 1;

  IF v_caller_role IS DISTINCT FROM 'Admin' AND NOT v_is_super THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Admin role required');
  END IF;

  IF p_user_id = auth.uid() AND p_locked = true THEN
    RETURN jsonb_build_object('success', false, 'error', 'You cannot lock your own account');
  END IF;

  -- derive org from country when no explicit org and a single country is given
  IF v_org IS NULL AND p_country IS NOT NULL AND array_length(p_country, 1) = 1 THEN
    SELECT id INTO v_org FROM public.organisations WHERE country = p_country[1] LIMIT 1;
  END IF;
  IF v_org IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organisations WHERE id = v_org) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown organisation');
  END IF;

  -- Privileged transitions (role / approval / lock / org) require super-admin.
  -- A non-super Admin may only edit descriptive fields of a user in their OWN org.
  v_priv := (p_role IS NOT NULL) OR (p_approved IS NOT NULL) OR (p_locked IS NOT NULL) OR (v_org IS NOT NULL);
  IF NOT v_is_super THEN
    IF v_priv THEN
      RETURN jsonb_build_object('success', false,
        'error', 'Permission denied: super admin required for role, approval, lock or organisation changes');
    END IF;
    SELECT org_id INTO v_target_org FROM public.profiles WHERE id = p_user_id;
    IF v_target_org IS DISTINCT FROM v_caller_org THEN
      RETURN jsonb_build_object('success', false,
        'error', 'Permission denied: target user is in another organisation');
    END IF;
  END IF;

  UPDATE public.profiles SET
    full_name   = COALESCE(p_full_name,   full_name),
    username    = COALESCE(p_username,    username),
    employee_id = COALESCE(p_employee_id, employee_id),
    role        = COALESCE(p_role,        role),
    country     = CASE WHEN p_country IS NOT NULL THEN p_country ELSE country END,
    region      = COALESCE(p_region,      region),
    site        = COALESCE(p_site,        site),
    phone       = COALESCE(p_phone,       phone),
    notes       = COALESCE(p_notes,       notes),
    approved    = COALESCE(p_approved,    approved),
    locked      = COALESCE(p_locked,      locked),
    org_id          = COALESCE(v_org, org_id),
    organisation_id = COALESCE(v_org, organisation_id),
    updated_at  = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object('success', true, 'org_id', v_org);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_update_profile(uuid,text,text,text,text,text[],text,text,text,text,boolean,boolean,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_update_profile(uuid,text,text,text,text,text[],text,text,text,text,boolean,boolean,uuid) TO authenticated;

-- =============================================================================
-- Reversal (manual):
--   A1: recreate the WITH CHECK true policies (not recommended).
--   A2: GRANT EXECUTE ... TO anon on the listed functions (not recommended).
--   A6: ALTER FUNCTION backups._core_tables() RESET search_path;
--   A7: restore the prior admin_update_profile body (Admin-only, no super gate).
-- =============================================================================
