-- ============================================================================
-- MIGRATIONS V228 - Access Audit (immutable trail of RBAC / access changes)
-- ============================================================================
-- A single, append only audit trail of every change that alters WHO can do
-- WHAT in the platform: per user access grants, the role x module permission
-- matrix, custom role roster, and the security relevant columns of a profile
-- (role, country, locked, approved, is_super_admin).
--
-- Design rules honoured:
--   * SECURITY DEFINER AFTER triggers only; NEVER write back to an audited
--     table (access_audit is itself unaudited, so no recursion).
--   * No direct client writes. RLS is ON; the only SELECT policy is
--     is_super_admin(). INSERTs happen exclusively from the trigger functions
--     (which run as definer and bypass RLS).
--   * profiles is audited field by field: one access_audit row per changed
--     security column, so the entity precisely names what moved.
--   * Idempotent and safe to re-run.
--
-- Depends on existing helpers: public.is_super_admin() (V35), auth.uid(),
-- auth.jwt() (Supabase). No new location RLS is introduced.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.access_audit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor        uuid DEFAULT auth.uid(),
  actor_email  text,
  action       text,               -- INSERT | UPDATE | DELETE
  target_user  uuid,               -- the user whose access changed (when known)
  entity       text,               -- grant|module_perm|custom_role|role|country|lock|approve|super_admin
  before       jsonb,
  after        jsonb,
  at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_audit_at          ON public.access_audit (at DESC);
CREATE INDEX IF NOT EXISTS idx_access_audit_target_user ON public.access_audit (target_user);
CREATE INDEX IF NOT EXISTS idx_access_audit_entity      ON public.access_audit (entity);

ALTER TABLE public.access_audit ENABLE ROW LEVEL SECURITY;

-- Super admins may read the trail. No INSERT/UPDATE/DELETE policy exists, so no
-- authenticated client can mutate it directly; only the SECURITY DEFINER
-- triggers below (which bypass RLS) write rows.
DROP POLICY IF EXISTS access_audit_select ON public.access_audit;
CREATE POLICY access_audit_select ON public.access_audit
  FOR SELECT TO authenticated
  USING (public.is_super_admin());

REVOKE ALL   ON public.access_audit FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.access_audit FROM authenticated;
GRANT  SELECT ON public.access_audit TO authenticated;

-- ── Actor email helper (JWT claim; never touches profiles => no recursion) ──
CREATE OR REPLACE FUNCTION public.access_audit_actor_email()
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT nullif(coalesce(auth.jwt() ->> 'email', ''), '');
$$;

-- ── Generic trigger for the three simple audited tables ─────────────────────
-- Emits one row carrying the full before/after image. entity + target_user are
-- derived from the table being audited.
CREATE OR REPLACE FUNCTION public.log_access_audit_generic()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_entity text;
  v_target uuid;
  v_before jsonb;
  v_after  jsonb;
BEGIN
  IF TG_TABLE_NAME = 'user_access_grants' THEN
    v_entity := 'grant';
    v_target := COALESCE(NEW.user_id, OLD.user_id);
  ELSIF TG_TABLE_NAME = 'module_permissions' THEN
    v_entity := 'module_perm';
    v_target := NULL;
  ELSIF TG_TABLE_NAME = 'custom_roles' THEN
    v_entity := 'custom_role';
    v_target := NULL;
  ELSE
    v_entity := TG_TABLE_NAME;
    v_target := NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_before := to_jsonb(OLD); v_after := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_before := NULL; v_after := to_jsonb(NEW);
  ELSE
    v_before := to_jsonb(OLD); v_after := to_jsonb(NEW);
  END IF;

  INSERT INTO public.access_audit (actor, actor_email, action, target_user, entity, before, after)
  VALUES (auth.uid(), public.access_audit_actor_email(), TG_OP, v_target, v_entity, v_before, v_after);

  RETURN NULL; -- AFTER trigger: return value ignored
END $$;

-- ── profiles: audit only security relevant column changes, one row per field ─
CREATE OR REPLACE FUNCTION public.log_access_audit_profiles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text := public.access_audit_actor_email();
  v_actor uuid := auth.uid();
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    INSERT INTO public.access_audit (actor, actor_email, action, target_user, entity, before, after)
    VALUES (v_actor, v_email, TG_OP, NEW.id, 'role',
            jsonb_build_object('role', OLD.role), jsonb_build_object('role', NEW.role));
  END IF;

  IF OLD.country IS DISTINCT FROM NEW.country THEN
    INSERT INTO public.access_audit (actor, actor_email, action, target_user, entity, before, after)
    VALUES (v_actor, v_email, TG_OP, NEW.id, 'country',
            jsonb_build_object('country', to_jsonb(OLD.country)),
            jsonb_build_object('country', to_jsonb(NEW.country)));
  END IF;

  IF OLD.locked IS DISTINCT FROM NEW.locked THEN
    INSERT INTO public.access_audit (actor, actor_email, action, target_user, entity, before, after)
    VALUES (v_actor, v_email, TG_OP, NEW.id, 'lock',
            jsonb_build_object('locked', OLD.locked), jsonb_build_object('locked', NEW.locked));
  END IF;

  IF OLD.approved IS DISTINCT FROM NEW.approved THEN
    INSERT INTO public.access_audit (actor, actor_email, action, target_user, entity, before, after)
    VALUES (v_actor, v_email, TG_OP, NEW.id, 'approve',
            jsonb_build_object('approved', OLD.approved), jsonb_build_object('approved', NEW.approved));
  END IF;

  IF OLD.is_super_admin IS DISTINCT FROM NEW.is_super_admin THEN
    INSERT INTO public.access_audit (actor, actor_email, action, target_user, entity, before, after)
    VALUES (v_actor, v_email, TG_OP, NEW.id, 'super_admin',
            jsonb_build_object('is_super_admin', OLD.is_super_admin),
            jsonb_build_object('is_super_admin', NEW.is_super_admin));
  END IF;

  RETURN NULL;
END $$;

-- ── Wire triggers (idempotent) ──────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_access_audit_grants ON public.user_access_grants;
CREATE TRIGGER trg_access_audit_grants
  AFTER INSERT OR UPDATE OR DELETE ON public.user_access_grants
  FOR EACH ROW EXECUTE FUNCTION public.log_access_audit_generic();

DROP TRIGGER IF EXISTS trg_access_audit_module_perms ON public.module_permissions;
CREATE TRIGGER trg_access_audit_module_perms
  AFTER INSERT OR UPDATE OR DELETE ON public.module_permissions
  FOR EACH ROW EXECUTE FUNCTION public.log_access_audit_generic();

DROP TRIGGER IF EXISTS trg_access_audit_custom_roles ON public.custom_roles;
CREATE TRIGGER trg_access_audit_custom_roles
  AFTER INSERT OR UPDATE OR DELETE ON public.custom_roles
  FOR EACH ROW EXECUTE FUNCTION public.log_access_audit_generic();

-- profiles: only on UPDATE (security columns move via edits, not row creation).
DROP TRIGGER IF EXISTS trg_access_audit_profiles ON public.profiles;
CREATE TRIGGER trg_access_audit_profiles
  AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.log_access_audit_profiles();

REVOKE ALL ON FUNCTION public.access_audit_actor_email()   FROM anon;
REVOKE ALL ON FUNCTION public.log_access_audit_generic()   FROM anon;
REVOKE ALL ON FUNCTION public.log_access_audit_profiles()  FROM anon;

-- Reversible:
--   DROP TRIGGER IF EXISTS trg_access_audit_grants        ON public.user_access_grants;
--   DROP TRIGGER IF EXISTS trg_access_audit_module_perms  ON public.module_permissions;
--   DROP TRIGGER IF EXISTS trg_access_audit_custom_roles  ON public.custom_roles;
--   DROP TRIGGER IF EXISTS trg_access_audit_profiles      ON public.profiles;
--   DROP FUNCTION IF EXISTS public.log_access_audit_generic();
--   DROP FUNCTION IF EXISTS public.log_access_audit_profiles();
--   DROP FUNCTION IF EXISTS public.access_audit_actor_email();
--   DROP TABLE    IF EXISTS public.access_audit;
