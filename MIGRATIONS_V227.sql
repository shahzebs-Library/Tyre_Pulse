-- V227: Live access refresh (no re-login). Applied live 2026-07-14 (jhssdmeruxtrlqnwfksc).
-- Master Access Control changes (role matrix + per-user grants) should reach an affected user's
-- OPEN session without a re-login. AuthContext now refetches the access map on tab refocus and via
-- realtime on these two tables, so add them to the realtime publication. module_permissions needs an
-- authenticated SELECT policy for realtime to deliver its change events (role x module capability
-- flags are not sensitive; enforcement still runs through the SECURITY DEFINER RPCs).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='user_access_grants') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.user_access_grants';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='module_permissions') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.module_permissions';
  END IF;
END $$;

DROP POLICY IF EXISTS module_permissions_authenticated_read ON public.module_permissions;
CREATE POLICY module_permissions_authenticated_read ON public.module_permissions
  FOR SELECT TO authenticated USING (true);
