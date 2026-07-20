-- ============================================================================
-- MIGRATIONS_V316_WORKSPACE_ONBOARDING.sql
-- Roadmap — atomic self-serve workspace creation.
--
-- STATUS: NOT YET APPLIED. Apply after review (Supabase MCP apply_migration or
-- CLI). Read-only investigation confirmed every table/column referenced below.
--
-- GOAL
--   A NEW paying customer (individual OR company) becomes, in ONE transaction:
--     * a fresh public.organisations row (the workspace), and
--     * that signing-up user promoted to the workspace OWNER (profile.role =
--       'Admin', approved = true, org moved to the new org), and
--     * a durable owner membership row (public.organisation_memberships), and
--     * a trialing subscription (public.org_subscriptions, plan_code 'trial').
--   Either ALL of it lands or NONE of it does — never a half-created workspace.
--
--   Individuals and companies use the SAME model: an individual = a workspace
--   with exactly one user. The only difference is the stored `kind`.
--
-- WHAT THIS MIGRATION ADDS
--   * public.create_workspace_owner(p_org_name text, p_kind text default
--     'company') — SECURITY DEFINER RPC, GRANT EXECUTE authenticated. Returns
--     jsonb {ok, organisation_id, slug, plan_code, status, kind}.
--
-- SCHEMA FACTS THIS RELIES ON (verified live 2026-07-20)
--   organisations(id uuid pk default gen_random_uuid(), name text NOT NULL,
--     slug text NOT NULL UNIQUE, settings jsonb default '{}', plan text default
--     'starter', active bool default true, contact_email text, created_at,
--     updated_at ...) — there is NO `kind` column, so kind is stored in
--     settings->>'kind'. slug has NO default and is UNIQUE, so we generate one.
--   organisation_memberships(user_id uuid -> auth.users, organisation_id uuid ->
--     organisations, role text) UNIQUE(user_id, organisation_id). role is free
--     text (no CHECK) — we use 'owner'.
--   org_subscriptions(organisation_id uuid UNIQUE default app_current_org(),
--     plan_code text NOT NULL -> subscription_plans(code), status default
--     'trialing' CHECK in (trialing,active,past_due,canceled,expired),
--     billing_interval default 'monthly', seats default 1, trial_ends_at,
--     current_period_start default now(), current_period_end ...). Plan 'trial'
--     is seeded (V105) and confirmed present live.
--   profiles(id, role default 'Reporter', approved default false,
--     is_super_admin default false, locked default false, org_id, organisation_id
--     ...). handle_new_user (V237) stamps a new signup into Company A
--     (00000000-0000-0000-0000-000000000001) as role 'Reporter'.
--
-- TRIGGER INTERACTION — THE KEY CAVEAT (documented so the next session knows)
--   profiles carries BEFORE-UPDATE trigger `trg_guard_profile_privileged`
--   (guard_profile_privileged_cols). A SECURITY DEFINER function does NOT change
--   auth.uid() — the JWT claim is unchanged — so inside the trigger get_my_role()
--   / is_super_admin() still resolve to the CALLER. For our exact target user (a
--   brand-new signup: role 'Reporter', frequently approved=false) the guard runs:
--       privileged cols changed (role/approved/org) -> not the fast path
--       is_super_admin() -> false
--       get_my_role() -> NULL (pending) or 'Reporter'  =>  distinct from 'Admin'
--       => RAISE 'Not authorized to change role, approval, ... organisation.'
--   Even a caller who is ALREADY an Admin is blocked, because the guard forbids
--   changing org_id/organisation_id unless is_super_admin(). So the profile
--   promotion is IMPOSSIBLE through the normal path — the RPC MUST bypass this
--   ONE guard for its single self-UPDATE.
--
--   We follow the EXISTING project precedent (admin_set_user_country, V269):
--   ALTER TABLE ... DISABLE TRIGGER trg_guard_profile_privileged around the
--   UPDATE, then re-ENABLE. We disable ONLY that guard so the other profile
--   triggers stay active and still protect us:
--     * normalize_profiles_role  — keeps 'Admin' (valid role) intact.
--     * sync_profile_org_columns — we set org_id = organisation_id, so no-op.
--     * guard_last_admin (UPDATE) — we PROMOTE (Reporter->Admin), never demote,
--       so it passes; and our hijack guard rejects callers who are already Admin.
--     * profiles_updated_at / access-audit — unaffected.
--   DDL is transactional: if the RPC RAISEs after DISABLE, the whole transaction
--   (including the DISABLE) rolls back and the guard is restored automatically;
--   we also re-ENABLE explicitly before returning. The function is owned by
--   postgres (the table owner), so ALTER TABLE is permitted — same as the
--   admin_* RPCs already in production.
--   NOTE (concurrency): DISABLE/ENABLE TRIGGER takes a brief ACCESS EXCLUSIVE
--   lock on profiles for the txn duration; acceptable for a rare onboarding call
--   and consistent with the admin_* precedent. (An alternative, SET LOCAL
--   session_replication_role='replica', is transaction-local/lock-free but
--   disables ALL user triggers incl. the last-admin guard — we prefer the
--   targeted disable so every other protection stays live.)
--
-- HIJACK / IDEMPOTENCY GUARD
--   The RPC refuses (RAISE, clean message) when the caller:
--     * is a super admin (platform admins manage the platform, not self-serve
--       workspaces — this also stops the seed super-admin being moved), or
--     * already owns a workspace: an 'owner' organisation_memberships row exists
--       for them, OR their current profile is an approved, unlocked 'Admin'
--       (they already administer an org).
--   Because a successful call leaves the caller as Admin + 'owner' member, a
--   second call fails cleanly with 'already own a workspace' — the RPC is
--   naturally idempotent-guarded (it never creates a second workspace).
--
-- Idempotent DDL: CREATE OR REPLACE FUNCTION. Safe to re-run.
--
-- Rollback
--   DROP FUNCTION IF EXISTS public.create_workspace_owner(text, text);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_workspace_owner(
  p_org_name text,
  p_kind     text DEFAULT 'company'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_name      text := btrim(coalesce(p_org_name, ''));
  v_kind      text := lower(btrim(coalesce(p_kind, 'company')));
  v_role      text;
  v_super     boolean;
  v_approved  boolean;
  v_locked    boolean;
  v_owns      boolean;
  v_org_id    uuid;
  v_slug_base text;
  v_slug      text;
  v_email     text;
  v_now       timestamptz := now();
BEGIN
  -- 1. Authentication + input validation ------------------------------------
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to create a workspace.' USING errcode = '28000';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'A workspace name is required.' USING errcode = '22023';
  END IF;
  IF length(v_name) > 120 THEN
    v_name := left(v_name, 120);
  END IF;

  IF v_kind NOT IN ('individual', 'company') THEN
    v_kind := 'company';
  END IF;

  -- 2. Load the caller and enforce the hijack / idempotency guard ------------
  SELECT role, coalesce(is_super_admin, false), coalesce(approved, false),
         coalesce(locked, false), email
    INTO v_role, v_super, v_approved, v_locked, v_email
    FROM public.profiles
   WHERE id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your profile is not ready yet. Try again in a moment.'
      USING errcode = 'P0002';
  END IF;

  IF v_super THEN
    RAISE EXCEPTION 'Platform administrators cannot self-serve a workspace.'
      USING errcode = '42501';
  END IF;

  -- Already an approved, unlocked Admin => already administers a workspace.
  IF v_role = 'Admin' AND v_approved AND NOT v_locked THEN
    RAISE EXCEPTION 'You already own a workspace.' USING errcode = '42710';
  END IF;

  -- Durable ownership signal: an existing owner membership.
  SELECT EXISTS (
    SELECT 1 FROM public.organisation_memberships
     WHERE user_id = v_uid AND lower(coalesce(role, '')) = 'owner'
  ) INTO v_owns;
  IF v_owns THEN
    RAISE EXCEPTION 'You already own a workspace.' USING errcode = '42710';
  END IF;

  -- 3. Create the organisation (the workspace) ------------------------------
  --    kind lives in settings->>'kind' (no dedicated column). Generate a
  --    UNIQUE slug: normalise the name, then append a short random suffix,
  --    retrying on the UNIQUE(slug) collision (astronomically rare).
  v_slug_base := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_slug_base := btrim(v_slug_base, '-');
  IF v_slug_base = '' THEN
    v_slug_base := 'workspace';
  END IF;
  v_slug_base := left(v_slug_base, 40);

  LOOP
    v_slug := v_slug_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    BEGIN
      INSERT INTO public.organisations
        (name, slug, settings, plan, active, contact_email, primary_country, created_at, updated_at)
      VALUES
        (v_name,
         v_slug,
         jsonb_build_object('kind', v_kind, 'created_via', 'self_serve_onboarding'),
         'trial',
         true,
         v_email,
         NULL,
         v_now,
         v_now)
      RETURNING id INTO v_org_id;
      EXIT;  -- inserted cleanly
    EXCEPTION WHEN unique_violation THEN
      -- slug collided; loop and try a new suffix
      NULL;
    END;
  END LOOP;

  -- 4. Durable owner membership (queryable ownership record) -----------------
  INSERT INTO public.organisation_memberships (user_id, organisation_id, role)
  VALUES (v_uid, v_org_id, 'owner')
  ON CONFLICT (user_id, organisation_id) DO UPDATE SET role = 'owner';

  -- 5. Promote the caller to workspace OWNER --------------------------------
  --    Bypass ONLY the privileged-columns guard for this single self-UPDATE
  --    (see the trigger-interaction note in the header). All other profile
  --    triggers stay live. DDL is transactional, so a later RAISE restores the
  --    guard automatically; we also re-enable explicitly.
  ALTER TABLE public.profiles DISABLE TRIGGER trg_guard_profile_privileged;

  UPDATE public.profiles
     SET org_id          = v_org_id,
         organisation_id = v_org_id,
         role            = 'Admin',
         approved        = true,
         updated_at      = v_now
   WHERE id = v_uid;

  ALTER TABLE public.profiles ENABLE TRIGGER trg_guard_profile_privileged;

  -- 6. Trial subscription for the new org -----------------------------------
  INSERT INTO public.org_subscriptions
    (organisation_id, plan_code, status, billing_interval, seats,
     trial_ends_at, current_period_start, current_period_end)
  VALUES
    (v_org_id, 'trial', 'trialing', 'monthly', 1,
     v_now + interval '14 days', v_now, v_now + interval '14 days')
  ON CONFLICT (organisation_id) DO NOTHING;

  -- 7. (Optional onboarding tasks) ------------------------------------------
  --    An onboarding_tasks table exists (V199). Seeding a starter checklist is
  --    deliberately deferred (no default template is agreed yet). When one is,
  --    INSERT the default rows for v_org_id HERE, inside this same transaction,
  --    so the workspace + its checklist stay atomic.

  RETURN jsonb_build_object(
    'ok', true,
    'organisation_id', v_org_id,
    'slug', v_slug,
    'kind', v_kind,
    'plan_code', 'trial',
    'status', 'trialing'
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.create_workspace_owner(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_workspace_owner(text, text) TO authenticated;

COMMENT ON FUNCTION public.create_workspace_owner(text, text) IS
  'Atomic self-serve workspace creation: new organisations row + owner membership + caller promoted to org Admin (approved, org moved) + trialing org_subscriptions, in one transaction. Guarded against hijack/double-create. Bypasses only trg_guard_profile_privileged for its single self-UPDATE (see MIGRATIONS_V316 header).';
