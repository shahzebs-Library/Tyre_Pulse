-- WO-1: one permission resolver for work orders (who may do what, on which work order).
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-15 from the LIVE policies, triggers and helper
--         functions of public.work_orders, wo_tasks, wo_assignments and tech_activity_events (read
--         only). Applied only to a private copy of the local staging database (tp_workorder,
--         synthetic companies) by supabase/tests/staging_work_order_permissions.sh.
--         NEEDS THE OWNER'S YES before it goes anywhere near production.
--
-- DEPENDS ON: 20261113130000_cur_work_orders_manager_director_default.sql (apply that first).
-- FOLLOWED BY: 20261115160500_wo_policies_and_guards.sql (this file alone changes NO behaviour:
--         it adds a table, seed rows and functions that nothing calls yet).
--
-- WHAT THIS IS
--   The owner's decision of 2026-11-15, stored as DATA instead of role names inside policies:
--     work_order_role_rules(organisation_id, role, actions[], scope)
--   organisation_id NULL = the built-in default every company starts from. A company row for the
--   same role replaces the default for that company (an empty actions list switches the role off).
--   actions: create | edit | assign | progress | qc
--   scope:   all      every work order inside the person's company, country and site walls
--            tyre     tyre work only (work_order_is_tyre)
--            assigned only work orders the person is assigned to (work_order_is_assigned)
--   Never configurable, Admin and super admin only: deleting a work order, changing a closed work
--   order, changing the cost of an approved work order. These are refused in the resolver itself.
--
--   Precedence for a signed-in, approved, unlocked person:
--     1. super admin: yes.  2. another company's row: no.  3. Admin: yes.
--     4. the three Admin-only actions: no.
--     5. country wall (app_can_see_country) and site wall (app_can_see_site; a work order with no
--        site needs all-sites access): no when outside.
--     6. a per-user revoke in Access Control (work_orders create / edit): no.
--     7. a per-user grant in Access Control (work_orders create -> create; edit -> edit, progress,
--        qc): yes, scope all.
--     8. the role has a rule (company row, else built-in default): the rule decides, nothing else.
--        This table is then the ONE place that role's work order rights are set; the Access
--        Control matrix switches for work_orders create / edit no longer decide for that role.
--     9. the role has no rule: Access Control decides as it does today (app_user_can work_orders
--        create -> create; edit -> edit, progress, qc), scope all. This keeps Tyre Data Collector
--        and Data Monitor Officer exactly where their stored matrix puts them.
--    10. otherwise no.
--
-- SEED (built-in defaults). Role names are profiles.role values as they exist on production
--   (read 2026-11-15; counts are approved accounts):
--     Manager (3), Director (0)                                   all five actions, scope all
--     Workshop Supervisor (7), Maintenance Supervisor (1),
--     Workshop Area Manager (0), Workshop Maintenance Area Manager (1)   all five, scope all
--     Tire Planning Engineer (1), Tyre Engineer (0, staging name)        all five, scope tyre
--     Tyre Man (17), Mechanic (0), Electrician (0) and the workshop trades that already have the
--     mobile workshop module on production (Diesel Mechanic 2, Plant Mechanic 2, Assistant Plant
--     Mechanic 1, Hydraulic Mechanic 0 approved, Auto Electrician 1, Plant Electrician 3, Senior
--     Technician 1, Senior Plant Technician 1, Senior Plant & Chiller Technician 1, Ice Plant
--     Technician 3, Welder 3, Welder Cum Fabricator 1, Painter 1, Denter 1, Concrete Breaker 1,
--     Helper Workshop 5, Helper Plant 5, Helper PMV 5, Helper Ice Plant 1)   progress, scope assigned
--   Not seeded (not in the owner's decision): PMV Manager, Fleet Supervisor, Store Keeper,
--   Inspector, Reporter, Driver, Tyre Data Collector, Data Monitor Officer.
--
-- SECURITY
--   Every function is SECURITY DEFINER with search_path pinned, re-checks the company itself, and is
--   revoked from PUBLIC and anon. The table has RLS: read by an approved person of the same company
--   (and the built-in rows), written by an Admin of that company or a super admin only.
--
-- VERIFY (rolled back, after applying)
--   begin;
--   select count(*) from public.work_order_role_rules where organisation_id is null;      -- 30
--   select has_function_privilege('anon','public.work_order_can(text,uuid,text,text,boolean,uuid)','EXECUTE'); -- f
--   select public.work_order_is_tyre('Tyre Change', null, null),                           -- t
--          public.work_order_is_tyre('Repair', null, null),                                -- f
--          public.work_order_is_tyre('Repair', 'S1', null);                                -- t
--   -- as a Manager (set request.jwt.claims sub; set local role authenticated):
--   --   select public.work_order_my_access();   -- scopes create/edit/assign/progress/qc = all
--   -- as a Tyre Man: progress = assigned, everything else null.
--   rollback;
--
-- ROLLBACK (only after 20261115160500 has been rolled back, which is what calls these)
--   The functions and the table are unused once the policies are restored. Removing them is a
--   removal statement and is left to a person: remove the functions work_order_can,
--   work_order_can_job, work_order_scope, work_order_my_access, work_order_is_assigned,
--   work_order_is_tyre, work_order_is_closed, then the table public.work_order_role_rules.

begin;

-- 1. The rule table ---------------------------------------------------------------------------
create table if not exists public.work_order_role_rules (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id),
  role            text not null,
  actions         text[] not null default '{}',
  scope           text not null default 'all',
  active          boolean not null default true,
  note            text,
  updated_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint work_order_role_rules_scope_chk check (scope in ('all', 'tyre', 'assigned')),
  constraint work_order_role_rules_actions_chk
    check (actions <@ array['create', 'edit', 'assign', 'progress', 'qc']::text[]),
  constraint work_order_role_rules_role_chk check (btrim(role) <> '')
);

create unique index if not exists work_order_role_rules_org_role_uidx
  on public.work_order_role_rules (
    coalesce(organisation_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(role)));

comment on table public.work_order_role_rules is
  'WO-1: which work order actions a role has, per company (organisation_id null = built-in default). '
  'Read by work_order_scope(). Actions: create, edit, assign, progress, qc. Scope: all, tyre, assigned.';

alter table public.work_order_role_rules enable row level security;

create policy work_order_role_rules_read on public.work_order_role_rules
  for select to authenticated
  using ((select public.app_is_active())
         and (organisation_id is null
              or organisation_id = (select public.app_current_org())
              or (select public.is_super_admin())));

create policy work_order_role_rules_insert on public.work_order_role_rules
  for insert to authenticated
  with check ((select public.is_super_admin())
              or ((select public.app_can_admin_delete())
                  and organisation_id is not null
                  and organisation_id = (select public.app_current_org())));

create policy work_order_role_rules_update on public.work_order_role_rules
  for update to authenticated
  using ((select public.is_super_admin())
         or ((select public.app_can_admin_delete())
             and organisation_id is not null
             and organisation_id = (select public.app_current_org())))
  with check ((select public.is_super_admin())
              or ((select public.app_can_admin_delete())
                  and organisation_id is not null
                  and organisation_id = (select public.app_current_org())));

revoke all on public.work_order_role_rules from anon;
grant select, insert, update on public.work_order_role_rules to authenticated;

-- 2. Seed: the owner's decision of 2026-11-15 as built-in defaults ------------------------------
insert into public.work_order_role_rules (organisation_id, role, actions, scope, note)
select null, v.role, v.actions, v.scope, 'Built-in default (owner decision 2026-11-15)'
from (values
  ('Manager',                            array['create','edit','assign','progress','qc'], 'all'),
  ('Director',                           array['create','edit','assign','progress','qc'], 'all'),
  ('Workshop Supervisor',                array['create','edit','assign','progress','qc'], 'all'),
  ('Maintenance Supervisor',             array['create','edit','assign','progress','qc'], 'all'),
  ('Workshop Area Manager',              array['create','edit','assign','progress','qc'], 'all'),
  ('Workshop Maintenance Area Manager',  array['create','edit','assign','progress','qc'], 'all'),
  ('Tire Planning Engineer',             array['create','edit','assign','progress','qc'], 'tyre'),
  ('Tyre Engineer',                      array['create','edit','assign','progress','qc'], 'tyre'),
  ('Tyre Man',                           array['progress'], 'assigned'),
  ('Mechanic',                           array['progress'], 'assigned'),
  ('Electrician',                        array['progress'], 'assigned'),
  ('Diesel Mechanic',                    array['progress'], 'assigned'),
  ('Plant Mechanic',                     array['progress'], 'assigned'),
  ('Assistant Plant Mechanic',           array['progress'], 'assigned'),
  ('Hydraulic Mechanic',                 array['progress'], 'assigned'),
  ('Auto Electrician',                   array['progress'], 'assigned'),
  ('Plant Electrician',                  array['progress'], 'assigned'),
  ('Senior Technician',                  array['progress'], 'assigned'),
  ('Senior Plant Technician',            array['progress'], 'assigned'),
  ('Senior Plant & Chiller Technician',  array['progress'], 'assigned'),
  ('Ice Plant Technician',               array['progress'], 'assigned'),
  ('Welder',                             array['progress'], 'assigned'),
  ('Welder Cum Fabricator',              array['progress'], 'assigned'),
  ('Painter',                            array['progress'], 'assigned'),
  ('Denter',                             array['progress'], 'assigned'),
  ('Concrete Breaker',                   array['progress'], 'assigned'),
  ('Helper Workshop',                    array['progress'], 'assigned'),
  ('Helper Plant',                       array['progress'], 'assigned'),
  ('Helper PMV',                         array['progress'], 'assigned'),
  ('Helper Ice Plant',                   array['progress'], 'assigned')
) as v(role, actions, scope)
where not exists (
  select 1 from public.work_order_role_rules r
   where r.organisation_id is null and lower(btrim(r.role)) = lower(btrim(v.role)));

-- 3. Pure helpers ------------------------------------------------------------------------------
-- Tyre work: the tyre job types of the work_type CHECK, or a job that names a tyre.
-- MIRROR of TYRE_WORK_TYPES / isTyreWorkOrder in src/lib/workOrderAccess.js. Change both.
create or replace function public.work_order_is_tyre(p_work_type text, p_tyre_serial text, p_tyre_position text)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select coalesce(lower(btrim(p_work_type)) in (
           'tyre change', 'rotation', 'balancing', 'alignment', 'retread',
           'puncture repair', 'pressure check'), false)
      or coalesce(btrim(p_tyre_serial), '') <> ''
      or coalesce(btrim(p_tyre_position), '') <> '';
$function$;

-- Closed: the terminal statuses. MIRROR of CLOSED_STATUS_KEYS in src/lib/workOrderAccess.js.
create or replace function public.work_order_is_closed(p_status text)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select coalesce(lower(btrim(p_status)) in ('completed', 'closed', 'cancelled', 'canceled'), false);
$function$;

-- Is the signed-in person assigned to this work order (owner, an active assignment, or a task)?
-- Answers only about the caller, so it cannot be used to look up anybody else.
create or replace function public.work_order_is_assigned(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select auth.uid() is not null and p_job_id is not null and (
    exists (select 1 from public.work_orders w
             where w.id = p_job_id and w.assigned_owner_id = auth.uid()
               and w.organisation_id = public.app_current_org())
    or exists (select 1 from public.wo_assignments a
                where a.job_id = p_job_id and a.user_id = auth.uid() and a.active is true
                  and a.organisation_id = public.app_current_org())
    or exists (select 1 from public.wo_tasks t
                where t.job_id = p_job_id and t.assignee_user_id = auth.uid()
                  and t.organisation_id = public.app_current_org()));
$function$;

-- 4. The role part of the answer: which scope does the caller have for an action? ---------------
-- Returns 'all', 'tyre', 'assigned' or NULL (not allowed). No row is looked at here.
create or replace function public.work_order_scope(p_action text)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text; v_org uuid; v_super boolean;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_cap text;
  v_rule record;
begin
  if v_uid is null then return null; end if;
  select role, org_id, coalesce(is_super_admin, false) into v_role, v_org, v_super
    from public.profiles
   where id = v_uid and coalesce(approved, false) = true and coalesce(locked, false) = false;
  if not found then return null; end if;
  if v_super or v_role = 'Admin' then return 'all'; end if;
  if v_action not in ('create', 'edit', 'assign', 'progress', 'qc') then return null; end if;

  v_cap := case when v_action = 'create' then 'create' else 'edit' end;
  if exists (
    select 1 from public.user_access_grants g
     where g.user_id = v_uid and g.module_key = 'work_orders' and g.capability = v_cap
       and g.effect = 'revoke' and (g.expires_at is null or g.expires_at > now())
  ) then return null; end if;

  -- A per-user grant in Access Control adds the job-level rights for that one person.
  if v_action <> 'assign' and exists (
    select 1 from public.user_access_grants g
     where g.user_id = v_uid and g.module_key = 'work_orders' and g.capability = v_cap
       and g.effect = 'grant' and (g.expires_at is null or g.expires_at > now())
  ) then return 'all'; end if;

  -- A role with a rule is decided by its rule alone (company row first, else built-in default).
  select r.actions, r.scope into v_rule
    from public.work_order_role_rules r
   where r.active is true
     and lower(btrim(r.role)) = lower(btrim(v_role))
     and (r.organisation_id = v_org or r.organisation_id is null)
   order by (r.organisation_id is not null) desc
   limit 1;
  if found then
    if v_action = any (v_rule.actions) then return v_rule.scope; end if;
    return null;
  end if;

  -- A role with no rule: Access Control decides, as it does today.
  if v_action in ('create', 'edit', 'progress', 'qc') and public.app_user_can('work_orders', v_cap) then
    return 'all';
  end if;
  return null;
end;
$function$;

-- 5. The whole answer for one work order ------------------------------------------------------
-- p_action: create | edit | assign | progress | qc | delete | override_closed | approved_cost
create or replace function public.work_order_can(
  p_action text, p_org uuid, p_country text, p_site text, p_is_tyre boolean, p_job_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text; v_org uuid; v_super boolean;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_scope text;
begin
  if v_uid is null then return false; end if;
  select role, org_id, coalesce(is_super_admin, false) into v_role, v_org, v_super
    from public.profiles
   where id = v_uid and coalesce(approved, false) = true and coalesce(locked, false) = false;
  if not found then return false; end if;
  if v_super and public.is_super_admin() then return true; end if;
  if p_org is null or v_org is null or p_org <> v_org then return false; end if;
  if v_role = 'Admin' then return true; end if;
  if v_action in ('delete', 'override_closed', 'approved_cost') then return false; end if;

  if p_country is not null and not public.app_can_see_country(p_country) then return false; end if;
  if coalesce(btrim(p_site), '') = '' then
    if not public.app_sees_all_sites() then return false; end if;
  elsif not public.app_can_see_site(p_site) then
    return false;
  end if;

  v_scope := public.work_order_scope(v_action);
  if v_scope is null then return false; end if;
  if v_scope = 'all' then return true; end if;
  if v_scope = 'tyre' then return coalesce(p_is_tyre, false); end if;
  if v_scope = 'assigned' then return public.work_order_is_assigned(p_job_id); end if;
  return false;
end;
$function$;

-- The same answer for a row that only carries the work order id (tasks, assignments, events).
create or replace function public.work_order_can_job(p_action text, p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((
    select public.work_order_can(p_action, w.organisation_id, w.country::text, w.site::text,
             public.work_order_is_tyre(w.work_type::text, w.tyre_serial::text, w.tyre_position::text), w.id)
      from public.work_orders w where w.id = p_job_id), false);
$function$;

-- 6. What the screen needs: the caller's scope per action, in one call --------------------------
create or replace function public.work_order_my_access()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'admin',    public.app_can_admin_delete(),
    'create',   public.work_order_scope('create'),
    'edit',     public.work_order_scope('edit'),
    'assign',   public.work_order_scope('assign'),
    'progress', public.work_order_scope('progress'),
    'qc',       public.work_order_scope('qc'),
    'all_sites', public.app_sees_all_sites());
$function$;

do $do$
declare f text;
begin
  foreach f in array array[
    'public.work_order_is_tyre(text,text,text)',
    'public.work_order_is_closed(text)',
    'public.work_order_is_assigned(uuid)',
    'public.work_order_scope(text)',
    'public.work_order_can(text,uuid,text,text,boolean,uuid)',
    'public.work_order_can_job(text,uuid)',
    'public.work_order_my_access()'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$do$;

select anum_integration.apply_reader_policies();

commit;
