-- profiles: a user can no longer change the columns that decide their own access.
--
-- FINDINGS: RLS-1 (P1) + AUTH-3 (P1)  - audit 2026-11-12.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12. Verified by
--   rolled-back impersonation (VERIFY block at the foot).
--
-- WHAT WAS WRONG (reproduced live as a Driver with no site scope, rolled back):
--   update own profiles.sites = {ALL}            -> 1 row; tyre_records 2249 -> 8353
--   update own countries / web_access / module_overrides / employee_id / email -> 1 row each
--   guard_profile_privileged_cols only compared role, approved, locked,
--   is_super_admin, country, site (scalar), org_id, organisation_id.
--
-- WHAT THIS DOES. The guard now also treats these as privileged when the change
-- comes from a signed-in session (auth.uid() is not null):
--   sites, countries, web_access, module_overrides, employee_id, email, username
-- Rules after the change:
--   super admin                  : may change anything (unchanged)
--   Admin, target in own org     : may change them (unchanged checks apply)
--   anyone else, own row         : refused 42501 - EXCEPT username (see below)
--   no session (service role, cron, auth triggers) : new columns not guarded,
--     so account-recovery / provisioning / email sync keep working. The eight
--     original columns behave exactly as before for every caller.
-- USERNAME stays self-editable because the web Settings page saves
--   {full_name, username} for the signed-in user. It is refused only when the new
--   username equals another person's employee id (login identifier squatting:
--   get_email_by_identifier resolves a username before an employee id). Username
--   uniqueness itself is already enforced by profiles_username_lower_uidx.
--
-- LEGITIMATE SELF-WRITES READ BEFORE THE CHANGE (all still allowed):
--   web    Settings.jsx            full_name, username
--          profileAvatar.js        avatar_url
--   Expo   notifications.ts        push_token, push_token_updated_at
--          profileLanguage.ts      language
--   Flutter                        none (push goes through register_user_device)
--   sign-up (web Login.jsx, Expo register.tsx) writes no profile row; the row is
--   created by handle_new_user (INSERT - this trigger is BEFORE UPDATE only).
-- ADMIN PATHS (each proven by rolled-back test):
--   admin_update_profile (super admin), admin_set_web_access (super / Admin),
--   admin_set_user_sites (switches the guard off around its own update),
--   provision_approved_driver_account (runs as an Admin actor), console user
--   editor direct update as super admin.
--
-- -------------------------------------------------------------------- PRE-FLIGHT
-- Data loss: none (function body only). Rename/removal/type/CHECK: none.
-- Locks: CREATE OR REPLACE FUNCTION only. No table lock, no data touched.
-- Triggers: same trigger (trg_guard_profile_privileged, BEFORE UPDATE), same
--   function name; SECURITY DEFINER + search_path=public preserved; no grant change.
-- Method: the new body is built from the LIVE pg_get_functiondef by two anchored
--   replacements; the block aborts unless each anchor is found exactly once.
-- PostgREST: raises 42501 / 23505 only.
-- Client behaviour that changes: a non-admin who tries to change their own
--   employee id, email, site list, web access or module overrides gets a
--   permission error (no client offers these). Username change to someone
--   else's employee id is refused.
-- Rollback: at the foot.

do $mig$
declare
  v_def text;
  v_a   text := E'     and NEW.organisation_id is not distinct from OLD.organisation_id then\n    return NEW;\n  end if;';
  v_b   text := E'  -- Only an Admin may change any privileged column at all.\n  if public.get_my_role() is distinct from ''Admin'' then';
  v_a_new text;
  v_b_new text;
begin
  select pg_get_functiondef('public.guard_profile_privileged_cols()'::regprocedure) into v_def;

  if (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a) <> 1 then
    raise exception 'anchor A not found exactly once';
  end if;
  if (length(v_def) - length(replace(v_def, v_b, ''))) / length(v_b) <> 1 then
    raise exception 'anchor B not found exactly once';
  end if;
  if position('NEW.sites' in v_def) > 0 then
    raise exception 'guard already extended';
  end if;

  v_a_new := E'     and NEW.organisation_id is not distinct from OLD.organisation_id\n'
          || E'     and not (auth.uid() is not null and (\n'
          || E'              NEW.sites            is distinct from OLD.sites\n'
          || E'           or NEW.countries        is distinct from OLD.countries\n'
          || E'           or NEW.web_access       is distinct from OLD.web_access\n'
          || E'           or NEW.module_overrides is distinct from OLD.module_overrides\n'
          || E'           or NEW.employee_id      is distinct from OLD.employee_id\n'
          || E'           or NEW.email            is distinct from OLD.email\n'
          || E'           or NEW.username         is distinct from OLD.username)) then\n'
          || E'    return NEW;\n  end if;';

  v_b_new := E'  -- Self-service username change (web Settings page). Allowed for the row\n'
          || E'  -- owner when it is the ONLY guarded change and the new name is not another\n'
          || E'  -- person''s employee id (login identifier squatting).\n'
          || E'  if public.get_my_role() is distinct from ''Admin''\n'
          || E'     and NEW.id = auth.uid()\n'
          || E'     and NEW.username is distinct from OLD.username\n'
          || E'     and NEW.role            is not distinct from OLD.role\n'
          || E'     and NEW.approved        is not distinct from OLD.approved\n'
          || E'     and NEW.locked          is not distinct from OLD.locked\n'
          || E'     and NEW.is_super_admin  is not distinct from OLD.is_super_admin\n'
          || E'     and NEW.country         is not distinct from OLD.country\n'
          || E'     and NEW.site            is not distinct from OLD.site\n'
          || E'     and NEW.org_id          is not distinct from OLD.org_id\n'
          || E'     and NEW.organisation_id is not distinct from OLD.organisation_id\n'
          || E'     and NEW.sites            is not distinct from OLD.sites\n'
          || E'     and NEW.countries        is not distinct from OLD.countries\n'
          || E'     and NEW.web_access       is not distinct from OLD.web_access\n'
          || E'     and NEW.module_overrides is not distinct from OLD.module_overrides\n'
          || E'     and NEW.employee_id      is not distinct from OLD.employee_id\n'
          || E'     and NEW.email            is not distinct from OLD.email then\n'
          || E'    if exists (select 1 from public.profiles p\n'
          || E'                where p.id <> NEW.id\n'
          || E'                  and nullif(btrim(coalesce(p.employee_id, '''')), '''') is not null\n'
          || E'                  and lower(btrim(p.employee_id)) = lower(btrim(coalesce(NEW.username, '''')))) then\n'
          || E'      raise exception ''That username is already in use.'' using errcode = ''23505'';\n'
          || E'    end if;\n'
          || E'    return NEW;\n'
          || E'  end if;\n\n'
          || v_b;

  v_def := replace(v_def, v_a, v_a_new);
  v_def := replace(v_def, v_b, v_b_new);
  execute v_def;
end
$mig$;

comment on function public.guard_profile_privileged_cols() is
  'BEFORE UPDATE guard on profiles. Privileged: role, approved, locked, is_super_admin, country, site, org_id, organisation_id (all callers) and sites, countries, web_access, module_overrides, employee_id, email, username (signed-in sessions). Username alone is self-editable unless it equals another profile''s employee id. 2026-11-12 RLS-1 / AUTH-3.';

-- ============================================================================
-- VERIFY (rolled-back impersonation)
--   Driver 54eca847-... own row: sites / countries / web_access / module_overrides /
--     employee_id / email  -> ERR 42501 each; tyre_records stays 2249
--     full_name + language + push_token + avatar_url + phone -> 1 row
--     username = free value -> 1 row ; username = another profile's employee id -> 23505
--   locked account 6627f7f6-... own sites -> 42501
--   super admin: direct update of another user's sites/web_access -> 1 row;
--     admin_update_profile(username, employee_id) -> success; admin_set_user_sites -> ok;
--     admin_set_web_access -> ok
--   no session (service role path): update recovery/email columns -> allowed
--
-- ROLLBACK: re-create the function from the body recorded in
--   supabase/migrations (V307 form): the same function with the two inserted
--   blocks removed, i.e. the early-return test ends at
--   "and NEW.organisation_id is not distinct from OLD.organisation_id then"
--   and the "Self-service username change" block is absent.
