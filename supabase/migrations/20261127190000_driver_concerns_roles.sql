-- Driver Concerns (employee grievance), part 1 of 2: who handles a concern.
--
-- STATUS: AUTHORED, NOT APPLIED. Apply only on the owner's explicit yes, and
-- BEFORE 20261127191000_driver_concerns.sql (that file reads every object here).
--
-- WHAT THIS ADDS
--   1. The custom role "HR Officer". A role that is not a built-in and has no
--      custom_roles row is silently rewritten to Reporter by
--      normalize_profiles_role() (the V592 trap), so the role must exist BEFORE
--      the owner can assign it. organisation_id is set EXPLICITLY: the column
--      default app_current_org() is NULL outside a user session and a null-org
--      row is invisible to everyone. Nobody is assigned the role here; the owner
--      does that later in Console -> Users.
--   2. public.concern_handlers(user_id, level, org, country, site): a named
--      handler list so routing does not depend on role strings alone. A row says
--      "this person handles driver concerns at this level, in this country/site".
--      level: supervisor | incharge | manager | hr. Blank country/site = all.
--      Read by every active member of the org; written by Admin / super admin.
--   3. public.driver_concern_settings: one row per organisation holding the SLA
--      hours per step and the retention period. Seeded for Company A with the
--      owner's defaults (acknowledge 24h, supervisor 3d, incharge 3d, manager 5d,
--      HR acknowledge 24h, Pay and Safety steps 2d, keep 5 years after closing).
--      Checked first: no existing routing/settings table fits. accident_routing_rules
--      (V302) and accident_route_profiles are accident-specific vocabularies and
--      reusing them would mix two lifecycles; approval_matrix decides approvers of
--      one decision, not a stepped ladder with deadlines.
--
-- SECURITY
--   RLS on both tables: RESTRICTIVE org isolation + permissive read for active
--   members + write for Admin / super admin only (they configure, nobody else).
--
-- VERIFY (after apply)
--   select count(*) from public.custom_roles where name = 'HR Officer';          -- 1
--   select relrowsecurity from pg_class where relname in
--     ('concern_handlers','driver_concern_settings');                            -- t,t
--   select sla from public.driver_concern_settings
--    where organisation_id = '00000000-0000-0000-0000-000000000001';             -- 1 row
--
-- ROLLBACK (manual, run in the SQL editor; written as comments on purpose)
--   drop table public.driver_concern_settings;
--   drop table public.concern_handlers;
--   -- custom_roles 'HR Officer': deactivate rather than remove
--   update public.custom_roles set active = false where name = 'HR Officer';

begin;

-- 1. HR Officer custom role --------------------------------------------------
insert into public.custom_roles (organisation_id, name, description, active)
select '00000000-0000-0000-0000-000000000001'::uuid,
       'HR Officer',
       'Handles sensitive driver concerns (treatment, harassment, discrimination, threats). Sees sensitive cases; the fleet pool roles never do.',
       true
 where not exists (select 1 from public.custom_roles where name = 'HR Officer');

-- 2. concern_handlers --------------------------------------------------------
create table if not exists public.concern_handlers (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  level           text not null check (level in ('supervisor','incharge','manager','hr')),
  country         text,
  site            text,
  active          boolean not null default true,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);

create unique index if not exists concern_handlers_uniq
  on public.concern_handlers (organisation_id, user_id, level,
                              coalesce(country, ''), coalesce(site, ''));
create index if not exists concern_handlers_level_idx
  on public.concern_handlers (organisation_id, level) where active;

alter table public.concern_handlers enable row level security;

create policy concern_handlers_org_isolation on public.concern_handlers
  as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));

create policy concern_handlers_read on public.concern_handlers
  for select to authenticated using ((select public.app_is_active()));

create policy concern_handlers_write on public.concern_handlers
  for all to authenticated
  using ((select public.is_super_admin()) or (select public.app_role()) = 'admin')
  with check ((select public.is_super_admin()) or (select public.app_role()) = 'admin');

grant select, insert, update, delete on public.concern_handlers to authenticated;
revoke all on public.concern_handlers from anon;

-- 3. driver_concern_settings -------------------------------------------------
create table if not exists public.driver_concern_settings (
  organisation_id uuid primary key,
  -- hours per step; keys read by private.dc_sla_hours()
  sla             jsonb not null default jsonb_build_object(
                    'ack', 24, 'supervisor', 72, 'incharge', 72, 'manager', 120,
                    'hr_ack', 24, 'hr', 72, 'pay', 48, 'safety', 48),
  retention_years integer not null default 5 check (retention_years between 1 and 20),
  reopen_days     integer not null default 14 check (reopen_days between 1 and 90),
  updated_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now()
);

alter table public.driver_concern_settings enable row level security;

create policy driver_concern_settings_org_isolation on public.driver_concern_settings
  as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));

create policy driver_concern_settings_read on public.driver_concern_settings
  for select to authenticated using ((select public.app_is_active()));

create policy driver_concern_settings_write on public.driver_concern_settings
  for all to authenticated
  using ((select public.is_super_admin()) or (select public.app_role()) = 'admin')
  with check ((select public.is_super_admin()) or (select public.app_role()) = 'admin');

grant select, insert, update on public.driver_concern_settings to authenticated;
revoke all on public.driver_concern_settings from anon;

insert into public.driver_concern_settings (organisation_id)
values ('00000000-0000-0000-0000-000000000001')
on conflict (organisation_id) do nothing;

-- 4. Sidebar reach for the custom roles ------------------------------------
-- Custom roles get the sidebar from the module matrix (deny by default); the
-- web nav keys /driver-concerns by its route slug 'driver_concerns'. Global
-- rows (org_id null) like every other role row. This opens the PAGE only; who
-- sees which case is still decided by RLS in the next migration.
insert into public.module_permissions (role, module_key, enabled, org_id)
select r, 'driver_concerns', true, null
  from unnest(array['Fleet Supervisor','Fleet Foreman','Fleet Incharge','HR Officer']) r
 where not exists (select 1 from public.module_permissions m
                    where m.role = r and m.module_key = 'driver_concerns' and m.org_id is null);

commit;
