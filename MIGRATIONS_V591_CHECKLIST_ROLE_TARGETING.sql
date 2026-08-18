-- =====================================================================================
-- V591 - A CHECKLIST CAN NAME THE TRADES IT IS FOR, AND THOSE TRADES NOW EXIST
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc as
--         `v591_checklist_role_targeting`.
-- =====================================================================================
--
-- THE ASK (owner): "checklists ... will be assigned to mechanics and electricians like
-- technician roles, and one checklist is for driver, will be on driver roles there."
--
-- MEASURED FIRST, and BOTH halves of that sentence were impossible before this:
--
--   1. `checklist_templates` had NO role column of any kind. The only role field in the
--      whole checklist schema is `checklist_schedules.assignee_role` (singular) and
--      `checklist_assignments.assignee_role` - and `checklist_schedules` holds ZERO
--      rows, so it has never been used. Mobile `listTemplates()` therefore returned
--      every published template to every signed-in user, and `listAssignments()` did
--      not read `assignee_role` at all.
--
--   2. THERE IS NO MECHANIC AND NO ELECTRICIAN ROLE IN THIS SYSTEM. Counted live:
--      profiles.role holds Admin 2, Director 1, Inspector 2, Manager 2, PMV Manager 1,
--      Reporter 2, Tire Planning Engineer 1, Tyre Data Collector 9, Tyre Man 17,
--      Workshop Maintenance Area Manager 1 - and custom_roles held 7 names, none of
--      them a trade. `mobile/lib/permissions.ts` even says so in a comment on the
--      `workshop` module: "The app has no dedicated technician/mechanic/foreman roles
--      ... so the shop-floor roles are tyre_man + inspector". So "assign this to the
--      electricians" could not be expressed even in principle.
--
--
-- WHY `assignee_roles` IS NULLABLE AND WHY NULL MEANS EVERYONE
--
-- A narrowing column that defaults to hiding would have silently taken the three
-- published checklists away from the 17 Tyre Men who use them the moment it shipped.
-- NULL (and empty) = every role = exactly today's behaviour, so all 6 existing
-- templates are untouched until a person deliberately narrows one. Verified after
-- apply: `assignee_roles is not null` matches 0 rows.
--
-- IT IS `text[]`, NOT `text`, ON PURPOSE. The owner's own example needs it: a workshop
-- sheet is for the mechanics AND the electricians, while the daily vehicle check is for
-- the drivers alone. `checklist_schedules.assignee_role` is singular and that is part of
-- why it was never usable.
--
--
-- TARGETING, NOT A SECURITY BOUNDARY - stated plainly rather than implied
--
-- The filter lives in the READERS (mobile listTemplates, the web checklist surfaces),
-- not in an RLS policy. That is deliberate and it is the honest description:
--   * templates are ALREADY walled by the existing org + country policies, so nothing
--     crosses a tenant or a country because of this column;
--   * a published template carries no PII - it is a list of questions;
--   * a RESTRICTIVE policy here would also hide the template from the Admin who is
--     authoring it and from the builder's own preview, i.e. it would break the feature
--     it is meant to serve.
-- So: a mechanic will not be OFFERED the electrician's checklist. Do not describe this
-- as preventing them from reading it.
--
--
-- THE ROLE VOCABULARY IS profiles.role Title Case
--
-- Stored values are the same strings `profiles.role` holds ('Mechanic', 'Tyre Man'),
-- because that is what `module_permissions.role` and `checklist_schedules.assignee_role`
-- already compare against - PROJECT_MEMORY records the trap where a role row keyed on
-- anything else silently matches nothing. The mobile app normalises both sides at the
-- comparison point (lowercase + underscore) so its own `tyre_man` matches 'Tyre Man'.
--
--
-- HOW THE TWO NEW ROLES BECOME REAL
--
-- `normalize_profiles_role()` (V282) accepts a built-in name OR any row in
-- `custom_roles` - checked org-agnostically, and it does NOT check `active`. So a
-- custom_roles row is the whole mechanism; there is no CHECK constraint to widen.
--
-- `organisation_id` IS SET EXPLICITLY. Its default is `app_current_org()`, which is
-- NULL outside a user session, and a null-org row is invisible to everyone - the same
-- trap already recorded for `sites` in V395.
--
-- PROVEN WITHOUT DISABLING ANY GUARD: `trg_guard_profile_privileged` blocks a direct
-- role UPDATE from an MCP session (get_my_role() is NULL there), and disabling it on a
-- live `profiles` is not worth doing for a test. Instead the REAL
-- `normalize_profiles_role()` was attached to a throwaway temp table and fed the role
-- names directly:
--     Mechanic -> Mechanic · Electrician -> Electrician · Driver -> Driver
--     Tyre Man -> Tyre Man · 'Nonsense Role' -> Reporter (correct fallback)
--
-- ROLLBACK:
--   alter table public.checklist_templates drop column assignee_roles;
--   delete from public.custom_roles where name in ('Mechanic','Electrician');
-- =====================================================================================

alter table public.checklist_templates
  add column if not exists assignee_roles text[];

comment on column public.checklist_templates.assignee_roles is
  'Roles this checklist is for, as profiles.role values (Title Case). NULL or empty = every role. '
  'This is TARGETING, not a security boundary: templates are already org+country scoped by RLS and a '
  'published template carries no PII, so the filter lives in the readers (mobile listTemplates, web '
  'MyChecklists) rather than in a policy that would also hide the template from the admin who authors it.';

insert into public.custom_roles (organisation_id, name, description, active)
select '00000000-0000-0000-0000-000000000001'::uuid, v.name, v.descr, true
from (values
  ('Mechanic',    'Workshop mechanic. Fills mechanical checklists and records job activity.'),
  ('Electrician', 'Workshop electrician. Fills electrical checklists and records job activity.')
) as v(name, descr)
where not exists (select 1 from public.custom_roles c where c.name = v.name);
