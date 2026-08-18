-- V599 - Workshop Supervisor: a real, assignable role that can sign off the
--        workshop sheets, plus the targeting that lets the trades see them.
--
-- STATUS: APPLIED live on jhssdmeruxtrlqnwfksc.
--
-- WHY
-- The owner is creating accounts for the trades and asked for a Workshop
-- Supervisor who approves. Measured before writing anything:
--   * custom_roles held Maintenance Supervisor, Workshop Area Manager and
--     Workshop Maintenance Area Manager - but NO 'Workshop Supervisor'.
--     V282's normalize_profiles_role() accepts a built-in OR any custom_roles
--     name and silently rewrites anything else to 'Reporter', so until the row
--     exists the role CANNOT be assigned: the save reports success and stores
--     Reporter. That is the V592 defect class, and it is why the row comes
--     first in this migration.
--   * checklist_is_supervisor() listed 8 roles, none of them the new one.
--   * Workshop Daily Checklist targeted {Mechanic, Electrician, Maintenance
--     Supervisor} and did not include Tyre Man, who the owner calls one of its
--     audiences ("the mechanics/tyreman checklist").
--
-- ORGANISATION_ID IS SET EXPLICITLY AND THAT IS LOAD-BEARING. The column
-- defaults to app_current_org(), which is NULL outside a user session, and a
-- null-org row is invisible to everyone - the V395 trap. All 12 existing rows
-- are org 00000000-...-0001, so the new one matches them.
--
-- SAFE BY CONSTRUCTION: adding a name to custom_roles only WIDENS what the
-- normaliser accepts. It cannot change a stored row and it grants nothing on
-- its own - a custom role is deny-by-default in the access matrix.
--
-- ROLLBACK
--   delete from custom_roles where name = 'Workshop Supervisor';
--   -- then re-create both functions without 'Workshop Supervisor', and
--   -- restore assignee_roles from _bak.checklist_roles_v599.

begin;

-- 1. The role itself, so it can actually be assigned ------------------------
insert into public.custom_roles (organisation_id, name, description, active)
select '00000000-0000-0000-0000-000000000001'::uuid,
       'Workshop Supervisor',
       'Supervises workshop trades; signs off the workshop daily checklist at the first approval rung.',
       true
where not exists (select 1 from public.custom_roles where name = 'Workshop Supervisor');

-- 2. The first approval rung -------------------------------------------------
-- A supervisor signs first, then the area manager closes. Workshop Supervisor
-- joins the FIRST rung only: promoting them to the closing rung would collapse
-- the two-stage ladder V594 exists to create.
create or replace function public.checklist_is_supervisor()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.is_super_admin() or public.get_my_role() = any (array[
    'Admin','Manager','Director','Maintenance Supervisor','Fleet Supervisor',
    'Workshop Supervisor',
    'PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager'
  ]);
$function$;

-- 3. Targeting ---------------------------------------------------------------
-- assignee_roles NULL means "everyone" (V591). It must never become '{}',
-- which reads as "targeted at nobody" and would hide the sheet from the whole
-- fleet - so every write here appends to a non-empty array.
create table if not exists _bak.checklist_roles_v599 as
  select id, name, assignee_roles, now() as backed_up_at
  from public.checklist_templates
  where status = 'published';

update public.checklist_templates
set assignee_roles = (
  select array_agg(distinct r order by r)
  from unnest(coalesce(assignee_roles, '{}') || array['Workshop Supervisor','Tyre Man']) r
)
where name = 'Workshop Daily Checklist'
  and assignee_roles is not null;

update public.checklist_templates
set assignee_roles = (
  select array_agg(distinct r order by r)
  from unnest(coalesce(assignee_roles, '{}') || array['Workshop Supervisor']) r
)
where name = 'Fleet Transit Mixer Checklist'
  and assignee_roles is not null;

-- 4. Guards - abort rather than half-apply ----------------------------------
do $$
declare v_missing int;
begin
  if not exists (select 1 from public.custom_roles
                 where name = 'Workshop Supervisor' and active) then
    raise exception 'V599: the Workshop Supervisor role row was not created';
  end if;

  select count(*) into v_missing
  from public.checklist_templates
  where name in ('Workshop Daily Checklist','Fleet Transit Mixer Checklist')
    and not ('Workshop Supervisor' = any (assignee_roles));
  if v_missing > 0 then
    raise exception 'V599: % workshop template(s) do not target Workshop Supervisor', v_missing;
  end if;

  -- A template that was targeted must never end up targeted at nobody.
  if exists (select 1 from public.checklist_templates
             where status = 'published'
               and assignee_roles is not null
               and cardinality(assignee_roles) = 0) then
    raise exception 'V599: a published template ended up with an empty audience';
  end if;
end $$;

commit;
