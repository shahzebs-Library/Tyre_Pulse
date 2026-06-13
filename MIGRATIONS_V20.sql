-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V20.sql — Recovery claims + full accident audit surfacing
--
-- Builds on V19. Additive + idempotent, safe to re-run.
--   • accidents: recovery-claims columns (recovered amount/date/source/status/ref)
--   • accident_parts: audit trigger → reuses existing accident_audit_log
--   • get_accident_audit() RPC: audit rows joined to the actor's profile name
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. RECOVERY CLAIMS COLUMNS
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS recovered_amount   numeric(14,2);
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS recovery_date      date;
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS recovery_source    text;   -- insurer|third_party|driver|warranty|none
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS recovery_status    text DEFAULT 'pending'; -- pending|partial|recovered|written_off
ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS recovery_reference text;

CREATE INDEX IF NOT EXISTS idx_accidents_recovery_status ON public.accidents(recovery_status);

-- 2. PARTS AUDIT — reuse the existing accident_audit_log table
CREATE OR REPLACE FUNCTION public.log_accident_part_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.accident_audit_log (accident_id, changed_by, action, old_values, new_values)
    VALUES (NEW.accident_id, auth.uid(), 'part_added', NULL, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
      INSERT INTO public.accident_audit_log (accident_id, changed_by, action, old_values, new_values)
      VALUES (NEW.accident_id, auth.uid(), 'part_updated', to_jsonb(OLD), to_jsonb(NEW));
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.accident_audit_log (accident_id, changed_by, action, old_values, new_values)
    VALUES (OLD.accident_id, auth.uid(), 'part_removed', to_jsonb(OLD), NULL);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_accident_parts_audit ON public.accident_parts;
CREATE TRIGGER trg_accident_parts_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.accident_parts
  FOR EACH ROW EXECUTE FUNCTION public.log_accident_part_change();

-- 3. AUDIT RPC — rows joined to the actor's profile name
CREATE OR REPLACE FUNCTION public.get_accident_audit(p_accident_id uuid)
RETURNS TABLE (
  id          uuid,
  accident_id uuid,
  changed_by  uuid,
  actor_name  text,
  changed_at  timestamptz,
  action      text,
  old_values  jsonb,
  new_values  jsonb
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.accident_id, a.changed_by,
         COALESCE(p.full_name, p.username, 'System') AS actor_name,
         a.changed_at, a.action, a.old_values, a.new_values
    FROM public.accident_audit_log a
    LEFT JOIN public.profiles p ON p.id = a.changed_by
   WHERE a.accident_id = p_accident_id
   ORDER BY a.changed_at DESC
   LIMIT 100;
$$;

GRANT EXECUTE ON FUNCTION public.get_accident_audit(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_accident_audit(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.log_accident_part_change() FROM PUBLIC, anon, authenticated;
