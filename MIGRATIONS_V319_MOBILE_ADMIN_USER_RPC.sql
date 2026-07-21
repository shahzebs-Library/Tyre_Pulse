-- =============================================================================
-- MIGRATIONS_V319_MOBILE_ADMIN_USER_RPC.sql
-- Mobile admin user-management hardening (audit findings #6 P0 + #12 P1).
--
-- Context / problem
--   The mobile "Admin > Users" screen managed accounts via DIRECT client writes
--   to public.profiles:
--     * REMOVAL deleted only the profiles row (.delete()), orphaning the
--       Supabase Auth identity (auth.users) which stayed active  ............ (#6)
--     * ROLE / APPROVAL / LOCK changes were direct .update() calls with no
--       second control, no last-admin protection surfaced, no reason, and no
--       explicit reason-bearing audit  ....................................... (#12)
--   The privileged-column guard (V307), the last-admin guard (V308) and the
--   access_audit AFTER-trigger (V228) already backstop those writes server-side,
--   but nothing captured the ACTOR INTENT (a reason) and the client could still
--   pretend to "delete" a user (removing the profile, not the auth identity).
--
-- What this migration adds
--   ONE SECURITY DEFINER RPC, admin_mobile_user_action(...), that the mobile
--   screen calls for approve / lock / unlock / deactivate / set_role. It:
--     1. Self-gates: caller must be a super-admin, OR an approved, non-locked
--        Admin in the SAME organisation as the target (org boundary).
--     2. Requires SUPER-ADMIN for any privileged transition — acting on an
--        Admin/super target, or a role change to/from 'Admin' (closes the
--        lateral Admin-to-Admin promotion hole). Mirrors the web rule
--        (admin_update_profile, V272 A7).
--     3. Blocks self-lock / self-deactivate / self-demotion.
--     4. Pre-checks the last active super-admin and the last active org-Admin so
--        the user sees a friendly message; the V308 guard_last_admin trigger is
--        the authoritative backstop on the UPDATE regardless.
--     5. Requires a REASON for role changes and for deactivation, and writes ONE
--        explicit, immutable access_audit row carrying actor + target + action +
--        reason (in addition to the automatic field-level V228 audit rows).
--   DEACTIVATION is a SOFT disable (approved=false + locked=true) done in one
--   UPDATE. True auth-identity deletion (auth.users) needs the service role and
--   is an Admin-WEB action, OUT OF SCOPE for the mobile client — see the note in
--   the deactivate branch. The client can never hard-delete an auth account.
--
--   The RPC performs a normal UPDATE on public.profiles so the existing guards
--   (V307 trg_guard_profile_privileged, V308 trg_guard_last_admin) and the V228
--   audit triggers all still fire — this RPC ADDS intent + reason, it does not
--   replace the defense-in-depth already in the database.
--
-- Idempotent (CREATE OR REPLACE + ADD COLUMN IF NOT EXISTS + guarded GRANT).
-- Reversible: see the footer. Additive/hardening only.
-- Depends on: profiles (role, approved, locked, is_super_admin, org_id,
--   organisation_id, updated_at), access_audit (V228),
--   is_super_admin()/get_my_role()/app_current_org() helpers,
--   access_audit_actor_email() (V228).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- access_audit: carry the actor's stated reason (nullable, additive)
-- ---------------------------------------------------------------------------
ALTER TABLE public.access_audit ADD COLUMN IF NOT EXISTS reason text;

-- ---------------------------------------------------------------------------
-- The single mobile admin user-action RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_mobile_user_action(
  p_user_id uuid,
  p_action  text,                    -- approve | lock | unlock | deactivate | set_role
  p_reason  text DEFAULT NULL,
  p_role    text DEFAULT NULL         -- required (built-in/custom role name) when p_action = 'set_role'
)
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
  -- ---- caller identity ----------------------------------------------------
  SELECT COALESCE(is_super_admin, false), role, org_id,
         COALESCE(locked, false), COALESCE(approved, true)
    INTO v_is_super, v_caller_role, v_caller_org, v_caller_lock, v_caller_appr
    FROM public.profiles WHERE id = v_caller;

  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING errcode = '42501';
  END IF;

  -- Only a super-admin, or an approved non-locked Admin, may manage users.
  IF NOT (v_is_super OR (v_caller_role = 'Admin' AND NOT v_caller_lock AND v_caller_appr)) THEN
    RAISE EXCEPTION 'You do not have permission to manage users.' USING errcode = '42501';
  END IF;

  IF v_action NOT IN ('approve','lock','unlock','deactivate','set_role') THEN
    RAISE EXCEPTION 'Unknown action.' USING errcode = '22023';
  END IF;

  -- ---- target identity ----------------------------------------------------
  SELECT role, COALESCE(is_super_admin, false), org_id,
         COALESCE(approved, false), COALESCE(locked, false)
    INTO v_t_role, v_t_super, v_t_org, v_t_appr, v_t_lock
    FROM public.profiles WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That user could not be found.' USING errcode = 'P0002';
  END IF;

  -- ---- self-action guards -------------------------------------------------
  IF p_user_id = v_caller THEN
    IF v_action IN ('lock','deactivate') THEN
      RAISE EXCEPTION 'You cannot lock or deactivate your own account.' USING errcode = '42501';
    END IF;
    IF v_action = 'set_role' THEN
      RAISE EXCEPTION 'You cannot change your own role.' USING errcode = '42501';
    END IF;
  END IF;

  -- ---- organisation boundary (non-super confined to own org) --------------
  IF NOT v_is_super AND v_t_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'That user belongs to another organisation.' USING errcode = '42501';
  END IF;

  -- ---- privileged-transition gate: super-admin required -------------------
  --   * acting on a super-admin at all, or
  --   * lock / deactivate / role-change on an Admin target, or
  --   * a role change to/from 'Admin'.
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

  -- ---- last active admin / super pre-check (guard_last_admin is the backstop)
  IF v_action IN ('lock','deactivate','set_role') THEN
    -- last active super-admin
    IF v_t_super THEN
      SELECT count(*) INTO v_others FROM public.profiles
        WHERE id <> p_user_id AND COALESCE(is_super_admin, false) AND COALESCE(locked, false) = false;
      IF v_others = 0 THEN
        RAISE EXCEPTION 'You cannot lock, deactivate or demote the last super admin.' USING errcode = '42501';
      END IF;
    END IF;
    -- last active Admin of the target's org (only when this action removes their admin standing)
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

  -- ---- reason requirements ------------------------------------------------
  IF v_action IN ('set_role','deactivate') AND v_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required for this action.' USING errcode = '22023';
  END IF;
  IF v_action = 'set_role' AND v_new_role = '' THEN
    RAISE EXCEPTION 'A role is required.' USING errcode = '22023';
  END IF;

  -- ---- perform the change (V307 + V308 + V228 triggers all fire) ----------
  IF v_action = 'approve' THEN
    UPDATE public.profiles SET approved = true, updated_at = now() WHERE id = p_user_id;

  ELSIF v_action = 'lock' THEN
    UPDATE public.profiles SET locked = true, updated_at = now() WHERE id = p_user_id;

  ELSIF v_action = 'unlock' THEN
    UPDATE public.profiles SET locked = false, updated_at = now() WHERE id = p_user_id;

  ELSIF v_action = 'deactivate' THEN
    -- SOFT disable only. The Supabase Auth identity (auth.users) is deliberately
    -- NOT touched here: deleting an auth identity requires the service role and
    -- is an Admin-WEB + backend operation, out of scope for the mobile client.
    -- This revokes all app access (approved=false AND locked=true) atomically.
    UPDATE public.profiles SET approved = false, locked = true, updated_at = now() WHERE id = p_user_id;

  ELSIF v_action = 'set_role' THEN
    -- is_super_admin is NEVER set here; a role string can never escalate to super.
    UPDATE public.profiles SET role = v_new_role, updated_at = now() WHERE id = p_user_id;
  END IF;

  -- ---- explicit, immutable, reason-bearing audit row ----------------------
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

REVOKE EXECUTE ON FUNCTION public.admin_mobile_user_action(uuid, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_mobile_user_action(uuid, text, text, text) TO authenticated;

-- =============================================================================
-- Reversal (manual):
--   DROP FUNCTION IF EXISTS public.admin_mobile_user_action(uuid, text, text, text);
--   ALTER TABLE public.access_audit DROP COLUMN IF EXISTS reason;   -- (drops captured reasons)
-- =============================================================================
