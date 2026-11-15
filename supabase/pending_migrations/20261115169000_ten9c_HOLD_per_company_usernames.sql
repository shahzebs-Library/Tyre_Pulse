-- =============================================================================
-- TEN-9c  *** HOLD: POINT OF NO EASY RETURN ***  per-company usernames and employee ids.
-- STATUS: AUTHORED, NOT APPLIED, AND NOT TO BE APPLIED WITH THE REST OF THE SEQUENCE.
-- Run only on the local staging copy, as the LAST step, to prove the end state.
--
-- THIS FILE CONTAINS `drop index` AND `drop constraint`. That is unavoidable: the change
--   IS the removal of the five global unique keys. The Supabase confirm gate will stop
--   on it; the owner has to approve it in person.
--
-- WHAT IT DOES
--   Removes the keys that make a username and an employee id unique across ALL
--   companies. The per-company keys created by TEN-9 (profiles_org_username_lower_uidx,
--   profiles_org_employee_id_lower_uidx) stay and become the only rule:
--   unique inside a company, free to repeat across companies.
--
-- WHY IT IS THE POINT OF NO EASY RETURN
--   Every step before this one can be reverted by re-creating a function or turning a
--   switch off, with no data consequence. After this step a second company can create
--   "ahmed" while the current company has "ahmed". From the first such pair onward the
--   global keys CANNOT be re-created (the index build fails on the duplicates) until
--   someone renames real people's accounts. The step itself is quick to undo only while
--   no cross-company duplicate exists.
--
-- PRECONDITIONS (the file checks 1 to 3 and stops if any is false)
--   1. TEN-9b applied: sign-in resolves "<company code>/<name>" and prefers the legacy
--      company when a bare name is ambiguous.
--   2. The per-company keys exist and are valid.
--   3. No company has two accounts with the same username or employee id (the
--      per-company keys guarantee it; re-checked).
--   4. NOT checkable here: the sign-in edge function calls resolve_sign_in_user(); the
--      sign-up forms of a new company build "<username>+<company code>@users.tyrepulse.app";
--      a sign-in test on web and Flutter against a hosted staging project passed.
--
-- CURRENT COMPANY: no account changes. A current user who types a bare username still
--   signs in even when another company later creates the same name (TEN-9b rule 1).
--
-- NOT COVERED: guard_profile_privileged_cols still refuses a self-service username that
--   equals ANY company's employee id. That is stricter than needed, not looser.
--
-- ROLLBACK (only while this query returns 0 rows:
--     select lower(username) from profiles where username is not null group by 1 having count(*) > 1)
--   alter table public.profiles add constraint profiles_username_key unique (username);
--   create unique index profiles_username_lower_uidx on public.profiles (lower(username)) where username is not null and btrim(username) <> '';
--   create unique index ux_profiles_username_lower on public.profiles (lower(username)) where username is not null;
--   create unique index profiles_employee_id_lower_uidx on public.profiles (lower(employee_id)) where employee_id is not null and btrim(employee_id) <> '';
--   create unique index ux_profiles_employee_id_lower on public.profiles (lower(employee_id)) where employee_id is not null and employee_id <> '';
-- =============================================================================

do $$
declare v_dups int;
begin
  if to_regprocedure('public._resolve_sign_in_profile(text)') is null then
    raise exception 'TEN-9c needs TEN-9b applied first. Nothing applied.';
  end if;
  if (select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid
       where c.relname in ('profiles_org_username_lower_uidx', 'profiles_org_employee_id_lower_uidx')
         and i.indisvalid and i.indisunique) <> 2 then
    raise exception 'The per-company unique keys from TEN-9 are missing or not valid. Nothing applied.';
  end if;
  select count(*) into v_dups from (
    select 1 from public.profiles where username is not null and btrim(username) <> ''
     group by org_id, lower(username) having count(*) > 1
    union all
    select 1 from public.profiles where employee_id is not null and btrim(employee_id) <> ''
     group by org_id, lower(employee_id) having count(*) > 1) d;
  if v_dups > 0 then
    raise exception 'Found % duplicate name(s) inside one company. Nothing applied.', v_dups;
  end if;
  -- An account with no company is not covered by a per-company key (NULL org_id never
  -- collides), so it keeps its own unique names.
end $$;

create unique index if not exists profiles_no_org_username_lower_uidx
  on public.profiles (lower(username)) where org_id is null and username is not null and btrim(username) <> '';
create unique index if not exists profiles_no_org_employee_id_lower_uidx
  on public.profiles (lower(employee_id)) where org_id is null and employee_id is not null and btrim(employee_id) <> '';

alter table public.profiles drop constraint if exists profiles_username_key;
drop index if exists public.profiles_username_lower_uidx;
drop index if exists public.ux_profiles_username_lower;
drop index if exists public.profiles_employee_id_lower_uidx;
drop index if exists public.ux_profiles_employee_id_lower;
