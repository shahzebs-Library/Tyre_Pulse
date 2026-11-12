-- AUTH-1 (P1): MFA was enforced only in client code. A password-only (aal1)
-- session of an MFA-enrolled super admin passed is_super_admin() and every
-- policy and RPC that relies on it.
--
-- STATUS: APPLIED LIVE 2026-11-12 (owner approved), verified.
--
-- Rule: an unlocked super admin whose account has a verified MFA factor is
-- super admin only in a session that completed MFA (JWT aal = aal2). An
-- account with no verified factor is unchanged (MFA enrolment for super
-- admins is still an app-level requirement, AUTH-10).
--
-- Effect: on the web app and console nothing changes (both already demand the
-- code before admitting the session). In the Flutter and Expo apps, which
-- have no MFA step yet, a super admin acts with their ordinary role only.
-- Break-glass if an authenticator is lost: remove the factor from the
-- Supabase dashboard (Authentication > Users), then enrol again.
--
-- TESTING NOTE: impersonation tests that need super-admin rights must set the
-- claim, e.g. json_build_object('sub', '<uuid>', 'role', 'authenticated', 'aal', 'aal2').
--
-- VERIFY (as the same super admin):
--   claims aal = aal1 -> select public.is_super_admin();  -- false
--   claims aal = aal2 -> select public.is_super_admin();  -- true
--
-- ROLLBACK: re-create the function without the aal clause:
--   select coalesce((select is_super_admin from public.profiles
--                    where id = auth.uid() and locked = false), false);

create or replace function public.is_super_admin()
 returns boolean
 language sql
 stable parallel safe security definer
 set search_path to 'public'
as $function$
  select coalesce((select p.is_super_admin from public.profiles p
                   where p.id = auth.uid() and p.locked = false), false)
     and (
       coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
       or not exists (select 1 from auth.mfa_factors f
                      where f.user_id = auth.uid() and f.status = 'verified')
     );
$function$;

comment on function public.is_super_admin() is
  'True for an unlocked super admin. If the account has a verified MFA factor, the session must have completed MFA (JWT aal = aal2); a password-only session is not super admin. Impersonation tests must set the aal claim.';
