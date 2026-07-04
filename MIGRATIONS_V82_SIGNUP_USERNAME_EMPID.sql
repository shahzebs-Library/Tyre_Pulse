-- V82: allow account creation with just a username + employee ID (no email).
-- Supabase Auth requires an email, so the client mints a synthetic, non-routable
-- address from the username (<slug>@users.tyrepulse.app) the user never sees.
--   1. auto_confirm_synthetic_email(): BEFORE INSERT trigger on auth.users marks
--      those synthetic addresses confirmed, so the account can sign in even with
--      "Confirm email" ON (a real link could never reach the fake domain).
--      Real-email signups are untouched.
--   2. handle_new_user() now also copies employee_id + email from signup metadata
--      into the profile (approved stays false — admin approval still required).
--   3. Unique indexes make username and employee_id true login identifiers.
-- Verified in a rolled-back probe.

CREATE OR REPLACE FUNCTION public.auto_confirm_synthetic_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.email LIKE '%@users.tyrepulse.app' AND NEW.email_confirmed_at IS NULL THEN
    NEW.email_confirmed_at := now();
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_auto_confirm_synthetic ON auth.users;
CREATE TRIGGER trg_auto_confirm_synthetic BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auto_confirm_synthetic_email();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
begin
  insert into public.profiles (id, username, full_name, role, region, employee_id, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'full_name',
    'Reporter',
    coalesce(new.raw_user_meta_data->>'region', 'KSA'),
    nullif(new.raw_user_meta_data->>'employee_id',''),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end $fn$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_profiles_username_lower
  ON public.profiles (lower(username)) WHERE username IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_profiles_employee_id_lower
  ON public.profiles (lower(employee_id)) WHERE employee_id IS NOT NULL AND employee_id <> '';
