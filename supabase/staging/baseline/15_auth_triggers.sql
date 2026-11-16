-- Tyre Pulse staging baseline: the two application triggers that live on auth.users
-- Hand-written from a read-only catalog read (pg_get_triggerdef). Works on the local stand-in
-- auth.users and on a hosted Supabase project.
-- @@
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
-- @@
CREATE TRIGGER trg_auto_confirm_synthetic BEFORE INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.auto_confirm_synthetic_email();
