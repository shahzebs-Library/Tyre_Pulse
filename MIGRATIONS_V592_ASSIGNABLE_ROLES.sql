-- =====================================================================================
-- V592 - THREE ROLES THE WEB OFFERS IN ITS PICKERS COULD NEVER ACTUALLY BE SAVED
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc as
--         `v592_assignable_roles_the_web_already_offers`.
-- =====================================================================================
--
-- FOUND WHILE PROVING V591, NOT BY GREP. Having attached the real
-- `normalize_profiles_role()` to a throwaway temp table to prove Mechanic and
-- Electrician survive it, the cheap next move was to feed it EVERY role name the web
-- offers. Three of them do not survive:
--
--   Maintenance Supervisor -> Reporter
--   Data Monitor Officer   -> Reporter
--   Store Keeper           -> Reporter
--
-- The trigger accepts a built-in name OR a row in `custom_roles`, and these three are
-- in NEITHER. So an admin could pick one in the UI, the save reported success, and the
-- stored role was Reporter. Nothing raised. It reads to the user as "the role picker
-- does not work", which is exactly the class of complaint this session started from.
--
-- MAINTENANCE SUPERVISOR IS THE ONE THAT MATTERS, and it is squarely in the checklist
-- work: `src/lib/checklistAccess.js` makes it the CHECKLIST-ONLY role - the entire
-- purpose of that file is a person who may use the checklist area and nothing else -
-- and lists it in CHECKLIST_AUTHOR_ROLES beside Admin/Manager/Director. So the
-- checklist-only role could not be given to anybody, and that whole feature had no
-- route into production. The other two come from ACCESS_ROLES (src/lib/moduleCatalog.js)
-- and BUILTIN_NAV_ROLES (src/lib/commandSearch.js).
--
-- WHY THIS IS SAFE: adding a name to `custom_roles` only WIDENS what the trigger
-- accepts. It cannot change a stored row, cannot alter anyone's current access, and
-- cannot grant anything by itself - a role only gains modules once someone enables them
-- in Console -> Access Control, and a custom role is deny-by-default there
-- (ROLE_DEFAULTS has no custom-role entry).
--
-- VERIFIED AFTER, same throwaway-table method, all 16 names round-trip unchanged:
-- the 10 built-ins, these 3, V591's Mechanic + Electrician, and 'Nonsense Role' still
-- correctly falls back to Reporter. round_trip_ok 16, still_demoted 0.
--
-- NOT DONE, deliberately: the built-in ARRAY inside `normalize_profiles_role()` was not
-- edited. Rewriting a SECURITY DEFINER trigger body to hard-code three more names is a
-- bigger change than one INSERT for the same result, and custom_roles is the sanctioned
-- extension point V282 built for exactly this.
--
-- ROLLBACK:
--   delete from public.custom_roles
--    where name in ('Maintenance Supervisor','Data Monitor Officer','Store Keeper');
--   -- (safe only while no profile carries one of those roles)
-- =====================================================================================

insert into public.custom_roles (organisation_id, name, description, active)
select '00000000-0000-0000-0000-000000000001'::uuid, v.name, v.descr, true
from (values
  ('Maintenance Supervisor', 'Authors, schedules and reviews checklists. Restricted to the checklist area (see src/lib/checklistAccess.js).'),
  ('Data Monitor Officer',   'Monitors data quality and upload coverage.'),
  ('Store Keeper',           'Stores and stock counting.')
) as v(name, descr)
where not exists (select 1 from public.custom_roles c where c.name = v.name);
