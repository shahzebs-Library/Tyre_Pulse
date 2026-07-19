-- V280 - Add public.profiles to the supabase_realtime publication.
--
-- AuthContext already subscribes to realtime UPDATEs on the signed-in user's own
-- profile row (channel `profile:<uid>`, filter id=eq.<uid>) so an admin changing
-- a user's ROLE / lock / approval takes effect on that user's OPEN session with
-- no re-login. But profiles was never added to the publication (V227 added only
-- user_access_grants + module_permissions), so that subscription was dormant and
-- role changes only applied on reload / next tab refocus.
--
-- Adding profiles here makes the role change propagate INSTANTLY. Realtime honours
-- RLS: a normal user only receives their OWN profile row (profiles_select scopes
-- to self/org), so this exposes nothing new - it only wakes the existing handler.
-- Paired with the AuthContext change that re-pulls the role-keyed module map on a
-- profile update, a role reassignment now takes full effect immediately.
--
-- Idempotent: only adds the table when it is not already published.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'profiles'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles';
  END IF;
END $$;

-- Rollback:
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.profiles;
