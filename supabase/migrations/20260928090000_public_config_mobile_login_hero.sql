-- Mobile login artwork chosen by an administrator (Console -> Mobile App).
--
-- Key `mobile_login_hero` in system_config holds a JSON object mapping each
-- login country to one of the artwork keys BUNDLED inside the Flutter app:
--   {"saudi_arabia":"fleet_machines","united_arab_emirates":"uae_landmark","egypt":"egypt_landmark"}
-- Allowed artwork keys: saudi_landmark, uae_landmark, egypt_landmark, fleet_machines.
-- The phone shows the login screen BEFORE sign-in, so it reads the choice
-- through get_public_config (anon-safe). The value is presentation only: it
-- carries no data, grants nothing, and an unknown or absent value falls back to
-- each country's own landmark on the phone.
--
-- Rollback: re-create get_public_config without 'mobile_login_hero'.

create or replace function public.get_public_config()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from public.system_config
  where key = any (array[
    'maintenance_mode','maintenance_message','registration_open','allow_signups',
    'require_approval','app_version','session_timeout_hours','two_factor_required',
    'password_min_length','default_currency','mobile_login_hero'
  ]);
$function$;

revoke all on function public.get_public_config() from public;
grant execute on function public.get_public_config() to anon, authenticated, service_role;
