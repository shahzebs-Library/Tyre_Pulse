-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V22.sql — Admin locking enforcement + Accident notifications
--
-- Builds on V21. Additive + idempotent, safe to re-run.
--
--   1. profiles.locked column (was UI-only, never persisted)
--   2. get_my_role() hardened — returns NULL when locked=true OR approved=false
--   3. admin_update_profile RPC — adds p_locked + p_site + p_phone + p_notes params
--   4. Accident notification triggers — new accident + claim_status change
--      notifies Admin / Manager / Director roles via notifications table
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. ADD locked COLUMN TO profiles ──────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_locked ON public.profiles(locked) WHERE locked = true;

-- ── 2. HARDEN get_my_role() ───────────────────────────────────────────────────
-- Returns NULL if the user's profile is locked or not yet approved.
-- Because every RLS policy calls get_my_role() IN (...), a NULL result means
-- no role matches → the user cannot read/write any protected table — instant
-- access revocation without needing JWT invalidation or a server restart.

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role
    FROM public.profiles
   WHERE id       = auth.uid()
     AND locked   = false
     AND (approved IS NULL OR approved = true)
   LIMIT 1;
$$;

-- ── 3. UPDATED admin_update_profile RPC ───────────────────────────────────────
-- Adds p_locked, p_site, p_phone, p_notes parameters.
-- Safe to re-run; replaces the previous version in-place.

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
  -- Only Admins may call this function
  v_caller_role := (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1);
  IF v_caller_role IS DISTINCT FROM 'Admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Admin role required');
  END IF;

  -- Prevent locking yourself out
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

-- ── 4. ACCIDENT NOTIFICATIONS ─────────────────────────────────────────────────
-- Triggers on the accidents table that fan-out notifications to all
-- Admin / Manager / Director users whenever:
--   a) A new accident record is created
--   b) claim_status changes (filed / approved / rejected / settled)
--   c) closure_status changes to pending_closure or closed

-- Helper: fan-out a notification to all elevated-role users
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

-- Accident event dispatcher
CREATE OR REPLACE FUNCTION public.dispatch_accident_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_asset   text;
  v_site    text;
  v_label   text;
BEGIN
  v_asset := COALESCE(NEW.asset_no, OLD.asset_no, 'Unknown asset');
  v_site  := COALESCE(NEW.site,     OLD.site,     '');

  -- ── A. New accident created ──────────────────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    PERFORM public.notify_elevated_users(
      'accident',
      'New Accident Reported',
      format(
        '%s — %s%s | Severity: %s',
        v_asset,
        v_site,
        CASE WHEN v_site <> '' THEN '' ELSE '' END,
        COALESCE(NEW.severity, 'Unknown')
      ),
      'accident',
      NEW.id
    );
    RETURN NEW;
  END IF;

  -- ── B. claim_status changed ───────────────────────────────────────────────
  IF TG_OP = 'UPDATE' AND (OLD.claim_status IS DISTINCT FROM NEW.claim_status) THEN
    v_label := CASE NEW.claim_status
      WHEN 'filed'    THEN 'Insurance Claim Filed'
      WHEN 'approved' THEN 'Claim Approved'
      WHEN 'rejected' THEN 'Claim Rejected'
      WHEN 'settled'  THEN 'Claim Settled'
      ELSE                  'Claim Status Updated'
    END;

    PERFORM public.notify_elevated_users(
      CASE NEW.claim_status
        WHEN 'approved' THEN 'success'
        WHEN 'rejected' THEN 'warning'
        ELSE 'info'
      END,
      v_label || ' — ' || v_asset,
      format(
        'Asset %s (%s) — %s → %s%s',
        v_asset, v_site,
        COALESCE(OLD.claim_status, 'none'),
        COALESCE(NEW.claim_status, 'none'),
        CASE WHEN NEW.claim_amount IS NOT NULL
          THEN format(' | Amount: %s', NEW.claim_amount) ELSE '' END
      ),
      'accident',
      NEW.id
    );
  END IF;

  -- ── C. closure_status changed ─────────────────────────────────────────────
  IF TG_OP = 'UPDATE' AND (OLD.closure_status IS DISTINCT FROM NEW.closure_status) THEN
    v_label := CASE NEW.closure_status
      WHEN 'pending_closure' THEN 'Closure Requested'
      WHEN 'closed'          THEN 'Accident Closed'
      ELSE                        'Closure Status Changed'
    END;

    PERFORM public.notify_elevated_users(
      CASE NEW.closure_status
        WHEN 'closed' THEN 'success'
        ELSE 'info'
      END,
      v_label || ' — ' || v_asset,
      format('Asset %s (%s) — status changed to %s', v_asset, v_site, NEW.closure_status),
      'accident',
      NEW.id
    );
  END IF;

  -- ── D. status changed to Insurance Claim ─────────────────────────────────
  IF TG_OP = 'UPDATE'
     AND (OLD.status IS DISTINCT FROM NEW.status)
     AND NEW.status = 'Insurance Claim'
  THEN
    PERFORM public.notify_elevated_users(
      'warning',
      'Insurance Claim Opened — ' || v_asset,
      format(
        'Asset %s (%s) moved to Insurance Claim status.%s',
        v_asset, v_site,
        CASE WHEN NEW.insurance_claim_no IS NOT NULL
          THEN ' Claim No: ' || NEW.insurance_claim_no ELSE '' END
      ),
      'accident',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accident_notifications ON public.accidents;
CREATE TRIGGER trg_accident_notifications
  AFTER INSERT OR UPDATE ON public.accidents
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_accident_notifications();

-- ── 5. NOTIFICATIONS INSERT POLICY ───────────────────────────────────────────
-- The trigger runs SECURITY DEFINER so it bypasses RLS.
-- But add an explicit policy so the RPC can also insert from app code if needed.
DROP POLICY IF EXISTS "notifications_insert_rpc" ON public.notifications;
CREATE POLICY "notifications_insert_rpc"
  ON public.notifications FOR INSERT
  WITH CHECK (false); -- app never inserts directly; only SECURITY DEFINER triggers

-- ── 6. REFRESH STATS ─────────────────────────────────────────────────────────
ANALYZE public.profiles;
ANALYZE public.accidents;
ANALYZE public.notifications;
