-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V19.sql — Accident Deep Claims Module
--
-- Adds a full claims-management layer on top of the existing `accidents` table
-- without altering its base columns (purely additive, idempotent, safe to re-run):
--   • Claim / responsibility / closure-workflow columns on `accidents`
--   • accident_remarks   — chronological case log (notes, insurance updates …)
--   • accident_parts     — parts/repair line items with cost + status
--   • notifications      — generic per-user inbox (powers admin approval alerts)
--   • RPCs for the close → admin-approval workflow (SECURITY DEFINER)
--
-- Works regardless of whether the live `accidents` table uses the web schema
-- (severity Minor/Major/Total Loss) or the mobile schema — everything new is
-- keyed by accident_id.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. CLAIM / RESPONSIBILITY / CLOSURE COLUMNS ON accidents
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS responsible_party     text;   -- who is at fault
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS liable_party          text;   -- who is liable
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS payer                 text;   -- who will pay
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS driver_name           text;
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS insurer               text;
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS policy_no             text;
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS claim_status          text DEFAULT 'none';  -- none|filed|approved|rejected|settled
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS claim_amount          numeric(14,2);
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS claim_approved_amount numeric(14,2);
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS deductible            numeric(14,2);
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS parts_cost            numeric(14,2) DEFAULT 0;

-- Closure approval workflow
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS closure_status        text DEFAULT 'open';  -- open|pending_closure|closed
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS close_requested_by    uuid REFERENCES public.profiles(id);
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS close_requested_at    timestamptz;
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS close_request_note    text;
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS closure_approved_by   uuid REFERENCES public.profiles(id);
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS closure_approved_at   timestamptz;
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS closure_rejected_reason text;

CREATE INDEX IF NOT EXISTS idx_accidents_closure_status ON public.accidents(closure_status);
CREATE INDEX IF NOT EXISTS idx_accidents_claim_status   ON public.accidents(claim_status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. ACCIDENT REMARKS  (case timeline / log)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.accident_remarks (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  accident_id  uuid        NOT NULL REFERENCES public.accidents(id) ON DELETE CASCADE,
  author_id    uuid        REFERENCES public.profiles(id),
  author_name  text,
  remark       text        NOT NULL,
  -- note | insurance | repair | responsibility | status_change | closure_request | closure_approved | closure_rejected
  remark_type  text        DEFAULT 'note',
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accident_remarks_accident ON public.accident_remarks(accident_id, created_at DESC);

ALTER TABLE public.accident_remarks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "accident_remarks_all" ON public.accident_remarks;
CREATE POLICY "accident_remarks_all" ON public.accident_remarks FOR ALL TO authenticated
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. ACCIDENT PARTS  (parts list / repair line items)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.accident_parts (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  accident_id  uuid        NOT NULL REFERENCES public.accidents(id) ON DELETE CASCADE,
  part_name    text        NOT NULL,
  part_number  text,
  quantity     numeric(10,2) DEFAULT 1,
  unit_cost    numeric(14,2) DEFAULT 0,
  total_cost   numeric(14,2) GENERATED ALWAYS AS (COALESCE(quantity,0) * COALESCE(unit_cost,0)) STORED,
  supplier     text,
  status       text        DEFAULT 'needed',  -- needed|ordered|received|fitted
  created_by   uuid        REFERENCES public.profiles(id),
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accident_parts_accident ON public.accident_parts(accident_id);

ALTER TABLE public.accident_parts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "accident_parts_all" ON public.accident_parts;
CREATE POLICY "accident_parts_all" ON public.accident_parts FOR ALL TO authenticated
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Keep accidents.parts_cost in sync with the parts line items.
CREATE OR REPLACE FUNCTION public.sync_accident_parts_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_accident uuid := COALESCE(NEW.accident_id, OLD.accident_id);
BEGIN
  UPDATE public.accidents
     SET parts_cost = COALESCE((
       SELECT SUM(total_cost) FROM public.accident_parts WHERE accident_id = v_accident
     ), 0)
   WHERE id = v_accident;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_accident_parts_cost ON public.accident_parts;
CREATE TRIGGER trg_sync_accident_parts_cost
  AFTER INSERT OR UPDATE OR DELETE ON public.accident_parts
  FOR EACH ROW EXECUTE FUNCTION public.sync_accident_parts_cost();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. NOTIFICATIONS  (per-user inbox)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.notifications (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type         text        DEFAULT 'info',
  title        text        NOT NULL,
  body         text,
  entity_type  text,       -- e.g. 'accident'
  entity_id    uuid,
  read         boolean     DEFAULT false,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, read, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
-- Users see and update only their own notifications. Cross-user inserts happen
-- exclusively through the SECURITY DEFINER RPCs below.
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. WORKFLOW RPCs
-- ═══════════════════════════════════════════════════════════════════════════════

-- Elevated-role check (admin / manager / director), case-insensitive.
CREATE OR REPLACE FUNCTION public.is_elevated_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid()
       AND lower(regexp_replace(COALESCE(role,''), '\s+', '_', 'g')) IN ('admin','manager','director')
  );
$$;

-- A field user requests closure → status becomes pending_closure and every
-- elevated user is notified to review and approve.
CREATE OR REPLACE FUNCTION public.request_accident_closure(p_accident_id uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name  text;
  v_asset text;
BEGIN
  SELECT COALESCE(full_name, username, 'User') INTO v_name FROM public.profiles WHERE id = auth.uid();
  SELECT asset_no INTO v_asset FROM public.accidents WHERE id = p_accident_id;

  UPDATE public.accidents
     SET closure_status     = 'pending_closure',
         close_requested_by = auth.uid(),
         close_requested_at = now(),
         close_request_note = p_note
   WHERE id = p_accident_id;

  INSERT INTO public.accident_remarks (accident_id, author_id, author_name, remark, remark_type)
  VALUES (p_accident_id, auth.uid(), v_name,
          'Requested closure' || CASE WHEN p_note IS NOT NULL AND p_note <> '' THEN ': ' || p_note ELSE '' END,
          'closure_request');

  INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
  SELECT p.id, 'closure_request',
         'Accident closure requested',
         'Asset ' || COALESCE(v_asset,'—') || ' closure submitted by ' || v_name || ' — review & approve.',
         'accident', p_accident_id
    FROM public.profiles p
   WHERE lower(regexp_replace(COALESCE(p.role,''), '\s+', '_', 'g')) IN ('admin','manager','director')
     AND p.id <> auth.uid();
END;
$$;

-- An elevated user approves the requested closure.
CREATE OR REPLACE FUNCTION public.approve_accident_closure(p_accident_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name      text;
  v_requester uuid;
BEGIN
  IF NOT public.is_elevated_user() THEN
    RAISE EXCEPTION 'Only Admin, Manager or Director can approve closures';
  END IF;

  SELECT COALESCE(full_name, username, 'Approver') INTO v_name FROM public.profiles WHERE id = auth.uid();
  SELECT close_requested_by INTO v_requester FROM public.accidents WHERE id = p_accident_id;

  UPDATE public.accidents
     SET closure_status      = 'closed',
         status              = 'Closed',
         closure_approved_by = auth.uid(),
         closure_approved_at = now()
   WHERE id = p_accident_id;

  INSERT INTO public.accident_remarks (accident_id, author_id, author_name, remark, remark_type)
  VALUES (p_accident_id, auth.uid(), v_name, 'Closure approved', 'closure_approved');

  IF v_requester IS NOT NULL AND v_requester <> auth.uid() THEN
    INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
    VALUES (v_requester, 'closure_approved', 'Closure approved',
            'Your accident closure was approved by ' || v_name || '.', 'accident', p_accident_id);
  END IF;
END;
$$;

-- An elevated user rejects the requested closure → back to open with a reason.
CREATE OR REPLACE FUNCTION public.reject_accident_closure(p_accident_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name      text;
  v_requester uuid;
BEGIN
  IF NOT public.is_elevated_user() THEN
    RAISE EXCEPTION 'Only Admin, Manager or Director can reject closures';
  END IF;

  SELECT COALESCE(full_name, username, 'Reviewer') INTO v_name FROM public.profiles WHERE id = auth.uid();
  SELECT close_requested_by INTO v_requester FROM public.accidents WHERE id = p_accident_id;

  UPDATE public.accidents
     SET closure_status          = 'open',
         closure_rejected_reason = p_reason
   WHERE id = p_accident_id;

  INSERT INTO public.accident_remarks (accident_id, author_id, author_name, remark, remark_type)
  VALUES (p_accident_id, auth.uid(), v_name,
          'Closure rejected' || CASE WHEN p_reason IS NOT NULL AND p_reason <> '' THEN ': ' || p_reason ELSE '' END,
          'closure_rejected');

  IF v_requester IS NOT NULL AND v_requester <> auth.uid() THEN
    INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
    VALUES (v_requester, 'closure_rejected', 'Closure rejected',
            'Your accident closure was rejected by ' || v_name ||
            CASE WHEN p_reason IS NOT NULL AND p_reason <> '' THEN ': ' || p_reason ELSE '' END,
            'accident', p_accident_id);
  END IF;
END;
$$;

-- Mark one notification read (own only).
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.notifications SET read = true WHERE id = p_id AND user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.is_elevated_user()                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_accident_closure(uuid, text)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_accident_closure(uuid)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_accident_closure(uuid, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid)             TO authenticated;
