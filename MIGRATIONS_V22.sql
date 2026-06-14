-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V22.sql — Locking enforcement + notifications + schema fixes
--
-- Builds on V21. Additive + idempotent, safe to re-run.
-- APPLIED: 2026-06-14 via Supabase MCP (migration: v22_locking_notifications_schema_fixes)
--
--   1. get_my_role() hardened — returns exact title-case role, NULL when
--      locked=true OR approved=false (instant DB-level access revocation)
--   2. Old RLS policies that used lowercase 'admin' normalised to 'Admin'
--   3. admin_update_profile RPC — old overload (with p_countries) dropped,
--      clean new signature with p_locked, p_site, p_phone, p_notes
--   4. accidents.country column added (was missing → all country-filtered
--      accident queries returned 400)
--   5. inspections.pressure_reading column added (was missing → 400 on
--      AI Command Center and inspection list queries)
--   6. tyre_records.fitment_date generated column (app uses this name;
--      DB stores as issue_date — generated column bridges the gap)
--   7. Accident notification trigger — new accident creation, claim_status
--      change, closure_status change, Insurance Claim status change all
--      fan-out notifications to Admin / Manager / Director profiles
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. FIX get_my_role() ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role
    FROM public.profiles
   WHERE id     = auth.uid()
     AND locked = false
     AND (approved IS NULL OR approved = true)
   LIMIT 1;
$$;

-- ── 2. FIX OLD POLICIES THAT USED LOWERCASE 'admin' ──────────────────────
DROP POLICY IF EXISTS "accidents_delete"         ON public.accidents;
CREATE POLICY "accidents_delete"
  ON public.accidents FOR DELETE
  USING (public.get_my_role() IN ('Admin', 'Manager'));

DROP POLICY IF EXISTS "inspections_delete"       ON public.inspections;
CREATE POLICY "inspections_delete"
  ON public.inspections FOR DELETE
  USING (public.get_my_role() IN ('Admin', 'Manager'));

DROP POLICY IF EXISTS "profiles_admin_delete"    ON public.profiles;
CREATE POLICY "profiles_admin_delete"
  ON public.profiles FOR DELETE
  USING (public.get_my_role() = 'Admin');

DROP POLICY IF EXISTS "profiles_admin_update"    ON public.profiles;
CREATE POLICY "profiles_admin_update"
  ON public.profiles FOR UPDATE
  USING  (public.get_my_role() = 'Admin')
  WITH CHECK (public.get_my_role() = 'Admin');

DROP POLICY IF EXISTS "profiles_insert_new_user" ON public.profiles;
CREATE POLICY "profiles_insert_new_user"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id OR public.get_my_role() = 'Admin');

-- ── 3. REPLACE admin_update_profile ───────────────────────────────────────
-- Drop all known old overloads before creating the clean new version.
DROP FUNCTION IF EXISTS public.admin_update_profile(uuid, text, text, text, text, text[], text[], text, text, text, text, boolean, boolean);
DROP FUNCTION IF EXISTS public.admin_update_profile(uuid, text, text, text, text, text[], text, text, text, text, text, boolean, boolean);
DROP FUNCTION IF EXISTS public.admin_update_profile(uuid, text, text, text, text, text[], text, text, boolean);
DROP FUNCTION IF EXISTS public.admin_update_profile(uuid, text, text, text, text, text[], text, boolean);

CREATE OR REPLACE FUNCTION public.admin_update_profile(
  p_user_id     uuid,
  p_full_name   text    DEFAULT NULL,
  p_username    text    DEFAULT NULL,
  p_employee_id text    DEFAULT NULL,
  p_role        text    DEFAULT NULL,
  p_country     text[]  DEFAULT NULL,
  p_region      text    DEFAULT NULL,
  p_site        text    DEFAULT NULL,
  p_phone       text    DEFAULT NULL,
  p_notes       text    DEFAULT NULL,
  p_approved    boolean DEFAULT NULL,
  p_locked      boolean DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_role text;
BEGIN
  v_caller_role := (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1);
  IF v_caller_role IS DISTINCT FROM 'Admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Admin role required');
  END IF;
  IF p_user_id = auth.uid() AND p_locked = true THEN
    RETURN jsonb_build_object('success', false, 'error', 'You cannot lock your own account');
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
    updated_at  = now()
  WHERE id = p_user_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT  EXECUTE ON FUNCTION public.admin_update_profile TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_update_profile FROM PUBLIC, anon;

-- ── 4. ADD MISSING COLUMNS ────────────────────────────────────────────────
ALTER TABLE public.accidents
  ADD COLUMN IF NOT EXISTS country text;
CREATE INDEX IF NOT EXISTS idx_accidents_country ON public.accidents(country);

ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS pressure_reading numeric(6,1);

ALTER TABLE public.tyre_records
  ADD COLUMN IF NOT EXISTS fitment_date date
  GENERATED ALWAYS AS (CAST(issue_date AS date)) STORED;

-- ── 5. ACCIDENT NOTIFICATION HELPER ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_elevated_users(
  p_type        text,
  p_title       text,
  p_body        text,
  p_entity_type text DEFAULT 'accident',
  p_entity_id   uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
  SELECT id, p_type, p_title, p_body, p_entity_type, p_entity_id
    FROM public.profiles
   WHERE role IN ('Admin', 'Manager', 'Director')
     AND locked  = false
     AND (approved IS NULL OR approved = true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_elevated_users FROM PUBLIC, anon, authenticated;

-- ── 6. ACCIDENT NOTIFICATION TRIGGER ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dispatch_accident_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_asset  text;
  v_site   text;
  v_label  text;
BEGIN
  v_asset := COALESCE(NEW.asset_no, OLD.asset_no, 'Unknown asset');
  v_site  := COALESCE(NEW.site,     OLD.site,     '');

  IF TG_OP = 'INSERT' THEN
    PERFORM public.notify_elevated_users(
      'accident',
      'New Accident Reported — ' || v_asset,
      format('Asset %s (%s) | Severity: %s', v_asset, v_site, COALESCE(NEW.severity, 'Unknown')),
      'accident', NEW.id
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND (OLD.claim_status IS DISTINCT FROM NEW.claim_status) THEN
    v_label := CASE NEW.claim_status
      WHEN 'filed'    THEN 'Insurance Claim Filed'
      WHEN 'approved' THEN 'Claim Approved'
      WHEN 'rejected' THEN 'Claim Rejected'
      WHEN 'settled'  THEN 'Claim Settled'
      ELSE                  'Claim Status Updated'
    END;
    PERFORM public.notify_elevated_users(
      CASE WHEN NEW.claim_status IN ('approved','settled') THEN 'success'
           WHEN NEW.claim_status = 'rejected' THEN 'warning' ELSE 'info' END,
      v_label || ' — ' || v_asset,
      format('Asset %s (%s) | %s → %s%s', v_asset, v_site,
        COALESCE(OLD.claim_status,'none'), COALESCE(NEW.claim_status,'none'),
        CASE WHEN NEW.claim_amount IS NOT NULL THEN ' | Amount: ' || NEW.claim_amount ELSE '' END),
      'accident', NEW.id
    );
  END IF;

  IF TG_OP = 'UPDATE' AND (OLD.closure_status IS DISTINCT FROM NEW.closure_status) THEN
    v_label := CASE NEW.closure_status
      WHEN 'pending_closure' THEN 'Closure Requested'
      WHEN 'closed'          THEN 'Accident Closed'
      ELSE                        'Closure Status Changed'
    END;
    PERFORM public.notify_elevated_users(
      CASE WHEN NEW.closure_status = 'closed' THEN 'success' ELSE 'info' END,
      v_label || ' — ' || v_asset,
      format('Asset %s (%s) → %s', v_asset, v_site, NEW.closure_status),
      'accident', NEW.id
    );
  END IF;

  IF TG_OP = 'UPDATE'
     AND (OLD.status IS DISTINCT FROM NEW.status)
     AND NEW.status = 'Insurance Claim'
  THEN
    PERFORM public.notify_elevated_users(
      'warning',
      'Insurance Claim Opened — ' || v_asset,
      format('Asset %s (%s) moved to Insurance Claim.%s', v_asset, v_site,
        CASE WHEN NEW.insurance_claim_no IS NOT NULL THEN ' Claim No: ' || NEW.insurance_claim_no ELSE '' END),
      'accident', NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accident_notifications ON public.accidents;
CREATE TRIGGER trg_accident_notifications
  AFTER INSERT OR UPDATE ON public.accidents
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_accident_notifications();

-- ── 7. NOTIFICATIONS INSERT POLICY ───────────────────────────────────────
DROP POLICY IF EXISTS "notifications_insert_rpc" ON public.notifications;
CREATE POLICY "notifications_insert_rpc"
  ON public.notifications FOR INSERT
  WITH CHECK (false);

-- ── 8. REFRESH STATS ─────────────────────────────────────────────────────
ANALYZE public.profiles;
ANALYZE public.accidents;
ANALYZE public.inspections;
ANALYZE public.tyre_records;
