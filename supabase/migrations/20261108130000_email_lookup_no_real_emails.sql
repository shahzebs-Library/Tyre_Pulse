-- ============================================================================
-- 20261108130000_email_lookup_no_real_emails
-- STATUS: APPLIED LIVE (2026-11-08, project jhssdmeruxtrlqnwfksc, via MCP).
--
-- WHY
--   public.get_email_by_identifier(identifier) is an ANONYMOUS SECURITY
--   DEFINER RPC. It returned the real auth email for any username / employee
--   id, so anyone who knew a username learned that person's email (an account
--   enumeration + email disclosure oracle).
--
--   The web app and the Flutter app no longer call it: a username sign-in now
--   goes through the `sign-in` edge function (supabase/functions/sign-in),
--   which resolves the email with the service role and never returns it.
--
--   The RETIRED Expo app (hundreds of installed phones, builds frozen) still
--   calls this RPC and then signInWithPassword(email, password). 765 of 769
--   accounts carry a made-up address ending '@users.tyrepulse.app'; that
--   address reveals nothing, so it is still returned and field staff keep
--   signing in on the old app. For the few accounts with a REAL email the
--   function now returns NULL; those people (admins/managers) type their
--   email instead, or use the web / Flutter app where username sign-in works
--   through the edge function.
--
--   Same signature, same grants (anon + authenticated, not PUBLIC), so
--   CREATE OR REPLACE keeps the existing privileges. No DROP.
--
-- ROLLBACK
--   Re-create the previous body: identical, but RETURN v_email unconditionally
--   (drop the synthetic-domain check below).
-- ============================================================================

create or replace function public.get_email_by_identifier(identifier text)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_id    text := btrim(identifier);
  v_email text;
begin
  if v_id is null or v_id = '' then
    return null;
  end if;

  -- Username first (exact, case-insensitive)...
  select au.email into v_email
  from auth.users au
  join public.profiles p on p.id = au.id
  where lower(p.username) = lower(v_id)
  limit 1;

  -- ...then employee code.
  if v_email is null then
    select au.email into v_email
    from auth.users au
    join public.profiles p on p.id = au.id
    where lower(p.employee_id) = lower(v_id)
    limit 1;
  end if;

  -- Only a made-up sign-in address is ever handed out. A real email is never
  -- disclosed to an anonymous caller.
  if v_email is null or lower(v_email) not like '%@users.tyrepulse.app' then
    return null;
  end if;

  return v_email;
end;
$function$;

comment on function public.get_email_by_identifier(text) is
  'Legacy Expo sign-in lookup. Returns ONLY synthetic @users.tyrepulse.app addresses; '
  'NULL for real emails (20261108130000). Web + Flutter use the sign-in edge function.';

revoke execute on function public.get_email_by_identifier(text) from public;
grant execute on function public.get_email_by_identifier(text) to anon, authenticated;
