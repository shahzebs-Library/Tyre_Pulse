-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V220 — Fix: cannot delete an accident (FK violation on audit log)
-- ─────────────────────────────────────────────────────────────────────────────
-- Symptom:
--   DELETE on accidents failed with
--     insert or update on table "accident_audit_log" violates foreign key
--     constraint "accident_audit_log_accident_id_fkey"
--
-- Root cause:
--   accident_parts.accident_id → accidents(id) is ON DELETE CASCADE, so deleting
--   an accident cascade-deletes its parts. The AFTER DELETE trigger
--   trg_accident_parts_audit → log_accident_part_change() then inserted a
--   'part_removed' row into accident_audit_log referencing the accident that is
--   being deleted in the SAME statement, violating accident_audit_log's own FK
--   to accidents(id). log_accident_change() already guards this on the accidents
--   table; the accident_parts audit function did not.
--
-- Fix (idempotent CREATE OR REPLACE):
--   In the DELETE branch, only write the audit row when the parent accident still
--   exists — i.e. a genuine single-part removal. An accident-level cascade skips
--   the audit insert (the accident's own deletion is captured elsewhere).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.log_accident_part_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Only log a genuine single-part removal. When the whole accident is being
    -- deleted, the cascade removes its parts and the accident row no longer
    -- exists, so inserting here would violate accident_audit_log's FK.
    IF EXISTS (SELECT 1 FROM public.accidents WHERE id = OLD.accident_id) THEN
      INSERT INTO public.accident_audit_log (accident_id, changed_by, action, old_values, new_values)
      VALUES (OLD.accident_id, auth.uid(), 'part_removed', to_jsonb(OLD), NULL);
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- Restore the previous (unguarded) DELETE branch:
--   ELSIF TG_OP = 'DELETE' THEN
--     INSERT INTO public.accident_audit_log (accident_id, changed_by, action, old_values, new_values)
--     VALUES (OLD.accident_id, auth.uid(), 'part_removed', to_jsonb(OLD), NULL);
--     RETURN OLD;
-- (Not recommended — reintroduces the accident-delete FK violation.)
