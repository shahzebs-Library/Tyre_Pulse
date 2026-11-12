-- Sign-up: the country scope taken from client metadata is limited to known countries.
--
-- FINDING: AUTH-11 (P3)  - audit 2026-11-12.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12. Verified by reading the
--   live definition and evaluating the new expression (no auth user was created).
--
-- WHAT WAS WRONG (function body): handle_new_user copied
--   raw_user_meta_data.region - any text the client sends at sign-up - into
--   profiles.region and profiles.country (the country scope). A caller could
--   pre-select an arbitrary scope value that an approving admin might not notice.
--
-- WHAT THIS DOES
--   The region is matched case-insensitively against KSA / UAE / Egypt and stored
--   in that canonical spelling; anything else, or nothing, becomes the default
--   KSA (the previous default). Applied as one anchored replacement of the
--   declaration line in the LIVE definition; the rest of the function is
--   byte-identical: role stays 'Reporter', organisation stays the fixed company,
--   approval still follows system_config.require_approval, username and
--   employee_id are taken as before, sites stays empty (no access until an admin
--   assigns it).
--
-- -------------------------------------------------------------------- PRE-FLIGHT
-- Who sends region: web Login.jsx sends 'KSA'; the Expo and Flutter sign-up do
--   not send it. Live data: profiles.region is 'KSA' on all 769 rows.
-- Data loss: none. Existing rows untouched.
-- Client behaviour that changes: none for the shipped apps.
-- Not changed: username / employee_id are still client supplied (uniqueness and
--   the approval step are the control); a new account is still pending.
-- Rollback: restore the line
--   v_region text := coalesce(nullif(new.raw_user_meta_data->>'region',''), 'KSA');

do $mig$
declare
  v_def text;
  v_a text := E'  v_region text := coalesce(nullif(new.raw_user_meta_data->>''region'',''''), ''KSA'');\n';
  v_new text;
begin
  select replace(pg_get_functiondef(p.oid), E'\r', '') into v_def from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'handle_new_user';
  if (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a) <> 1 then
    raise exception 'handle_new_user: region line not found exactly once';
  end if;
  v_new := replace(v_def, v_a,
    E'  -- Sign-up metadata is written by the client: only a known country is honoured,\n' ||
    E'  -- anything else (or nothing) falls back to the default.\n' ||
    E'  v_region text := case upper(btrim(coalesce(new.raw_user_meta_data->>''region'','''')))\n' ||
    E'                     when ''KSA'' then ''KSA''\n' ||
    E'                     when ''UAE'' then ''UAE''\n' ||
    E'                     when ''EGYPT'' then ''Egypt''\n' ||
    E'                     else ''KSA'' end;\n');
  execute v_new;
end
$mig$;
select replace(pg_get_functiondef('public.handle_new_user()'::regprocedure), E'\r', '') ~ 'when ''EGYPT'' then ''Egypt''' as ok;

-- ------------------------------------------------------------------------ VERIFY
-- (2026-11-12) live definition carries the CASE; trigger on_auth_user_created on
--   auth.users still enabled; ACL unchanged (owner + service_role).
--   Expression results: 'KSA'->KSA, 'uae'->UAE, ' Egypt '->Egypt, 'ALL'->KSA,
--   '*'->KSA, 'KSA,UAE,Egypt'->KSA, 'Qatar'->KSA, missing->KSA.
