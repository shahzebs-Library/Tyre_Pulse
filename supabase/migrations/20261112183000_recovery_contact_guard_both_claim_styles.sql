-- A signed-in user can no longer set their own recovery contact or mark it verified.
--
-- FINDING: AUTH-6 (P2)  - audit 2026-11-12.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12. Verified by
--   rolled-back impersonation (VERIFY block at the foot).
--
-- WHAT WAS WRONG (reproduced live, rolled back): with only the JSON claims
--   setting present (request.jwt.claims - what the API provides), an ordinary
--   user ran
--     update profiles set recovery_email = ..., recovery_email_verified_at = now()
--   on their own row -> 1 row updated. The guard trigger read only the legacy
--   per-claim setting request.jwt.claim.role, found nothing and let it through.
--   A verified recovery address is what the account-recovery service trusts to
--   hand out a sign-in link.
--
-- WHAT THIS DOES
--   guard_recovery_contact_columns reads the role from BOTH claim styles. The
--   four recovery columns may change only when no API request is in progress
--   (migration, scheduled job) or every claim style present says service_role
--   (the account-recovery edge function writes with the service key). Claims
--   that cannot be parsed count as "not the service".
--
-- -------------------------------------------------------------------- PRE-FLIGHT
-- Writers of the four columns: supabase/functions/account-recovery only (service
--   key). Settings.jsx only displays them. No database function writes them.
-- Trigger: trg_guard_recovery_contact_columns, BEFORE UPDATE on profiles, enabled;
--   unchanged. Same function signature, owner and grants.
-- Data loss: none. Client behaviour that changes: none (the app never wrote
--   these columns directly).
-- Rollback: re-create the function with the single-line role read
--   nullif(current_setting('request.jwt.claim.role', true), '').

create or replace function public.guard_recovery_contact_columns()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_legacy text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_json   text;
  request_role text;
begin
  if v_claims is not null then
    begin
      v_json := nullif(v_claims::jsonb ->> 'role', '');
    exception when others then
      -- claims present but unreadable: treat as an API caller that is not the service
      v_json := 'unknown';
    end;
  end if;
  request_role := coalesce(v_json, v_legacy);

  -- No request role at all = not an API request (migration, scheduled job).
  -- Through the API only the service role (the verification service) may
  -- change the recovery contact columns. If the two claim styles disagree the
  -- change is refused unless both say service_role.
  if (request_role is not null or v_legacy is not null)
     and not (
       coalesce(v_json, 'service_role') = 'service_role'
       and coalesce(v_legacy, 'service_role') = 'service_role'
     )
     and (
       new.recovery_email is distinct from old.recovery_email
       or new.recovery_email_verified_at is distinct from old.recovery_email_verified_at
       or new.recovery_phone is distinct from old.recovery_phone
       or new.recovery_phone_verified_at is distinct from old.recovery_phone_verified_at
     ) then
    raise exception 'recovery contacts must be changed through the verification service'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- ------------------------------------------------------------------------ VERIFY
-- (run 2026-11-12, one rolled-back transaction, own profile row)
--   before: JSON claims only, role authenticated, set recovery e-mail + verified -> 1 row
--   after:
--   JSON claims only, authenticated: recovery_email + verified_at   -> 42501
--   JSON claims only, authenticated: recovery_phone_verified_at     -> 42501
--   same user, unrelated self edit (full_name = full_name)          -> 1 row (control)
--   JSON claims role service_role, database role service_role       -> 1 row (the service path)
--   legacy setting only, authenticated                              -> 42501
--   no claims at all (job / migration)                              -> allowed
