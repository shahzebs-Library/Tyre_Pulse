-- V242: status-change governance (safe/non-breaking). A BEFORE UPDATE trigger blocks a STATUS
-- change ONLY when the current user is explicitly REVOKED the 'approve' capability for that module.
-- Nobody is revoked by default => existing status changes unaffected; Admin/super never blocked.
-- Applied live 2026-07-14. app_cap_revoked(key,cap) = false for admin/super, else EXISTS active revoke.
CREATE OR REPLACE FUNCTION public.app_cap_revoked(p_key text, p_cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.is_super_admin() OR public.get_my_role() = 'Admin' THEN false
    ELSE EXISTS (SELECT 1 FROM public.user_access_grants g
      WHERE g.user_id = auth.uid() AND g.module_key = p_key AND g.capability = p_cap
        AND g.effect = 'revoke' AND (g.expires_at IS NULL OR g.expires_at > now()))
  END;
$$;
REVOKE ALL ON FUNCTION public.app_cap_revoked(text,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.app_cap_revoked(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_status_change_capability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND public.app_cap_revoked(TG_ARGV[0], 'approve') THEN
    RAISE EXCEPTION 'You are not permitted to change the status for %.', TG_ARGV[0] USING errcode = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_status_cap_accidents ON public.accidents;
CREATE TRIGGER trg_status_cap_accidents BEFORE UPDATE ON public.accidents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_status_change_capability('accidents');
DROP TRIGGER IF EXISTS trg_status_cap_work_orders ON public.work_orders;
CREATE TRIGGER trg_status_cap_work_orders BEFORE UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_status_change_capability('work_orders');
