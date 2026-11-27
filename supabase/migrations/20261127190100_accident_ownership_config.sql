-- =============================================================================
-- Accident ownership + notification settings (owner-editable).
--
-- STATUS: APPLIED LIVE 2026-11-28 on owner OK (apply all five). Result: byte-exact; 20 team roles + 24 notify rules; assessment KSA -> VINAY.
--         (was: AUTHORED, NOT APPLIED.) Apply in order:
--   20261127190100_accident_ownership_config.sql      (this file)
--   20261127190200_accident_case_bootstrap.sql
--   20261127190250_accident_legacy_close_data.sql      (data only, separate)
--   20261127190300_accident_owner_notify.sql
--   20261127190400_accident_my_tasks_scan.sql
--
-- WRITES: only an Admin or a super admin (app_is_org_admin) changes who owns a
-- step or who is told; every active user can read the settings.
--
-- WHAT IT ADDS
--   accident_team_roles   - per workstream (optionally per country / site) who owns
--                           the step: a role and/or named people, plus the SLA target
--                           per severity. A NULL target means "not set": no timer runs.
--                           No time is invented here.
--   accident_notify_rules - per event, who is told: the step owner, roles, named
--                           people and/or the driver who filed the report.
--   helpers               - _accident_is_test_profile (test/demo accounts never get
--                           real routing), accident_people_for (role + named people in
--                           scope), accident_resolve_ws_owner (most specific rule),
--                           accident_notify_configured (does the org run on the new
--                           rules for an event), accident_team_role_preview (settings
--                           preview: "will notify N people, M have a phone").
--
-- Seeds sensible defaults the owner can change, for every organisation that has
-- accidents. SLA targets are left NULL on purpose (owner sets them).
--
-- VERIFY RESULT (run live 2026-11-27 via execute_sql, rolled back):
--   20 team roles + 24 notify rules over 2 orgs; assessment -> VINAY (only real
--   Workshop Maintenance Area Manager in KSA); fleet_validation -> role-owned (3 Fleet
--   Supervisors); repair -> role-owned (the PMV Manager is in UAE, not KSA);
--   Test User / Demo Manager = test profiles, adnan = real; 1 real KSA Manager.
-- VERIFY (run in a transaction, then ROLLBACK):
--   select count(*) from accident_team_roles;             -- 10 per org seeded
--   select count(*) from accident_notify_rules;           -- >= 11 per org seeded
--   select * from accident_resolve_ws_owner('00000000-0000-0000-0000-000000000001',
--          'assessment', 'KSA', null, null);              -- VINAY (single person)
--   select _accident_is_test_profile(id), full_name from profiles
--    where full_name in ('Test User','Demo Manager');      -- true, true
--
-- ROLLBACK:
--   drop function if exists public.accident_team_role_preview(text,text,text,uuid[],text);
--   drop function if exists public.accident_notify_configured(uuid,text);
--   drop function if exists public.accident_resolve_ws_owner(uuid,text,text,text,uuid);
--   drop function if exists public.accident_people_for(uuid,text[],uuid[],text,text);
--   drop function if exists public._accident_is_test_profile(uuid);
--   drop table if exists public.accident_notify_rules;
--   drop table if exists public.accident_team_roles;
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Who owns each step
-- ---------------------------------------------------------------------------
create table if not exists public.accident_team_roles (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null default public.app_current_org(),
  workstream_key       text not null,
  country              text,
  site                 text,
  owner_role           text,
  owner_user_ids       uuid[] not null default '{}',
  sla_minutes_minor    integer,
  sla_minutes_moderate integer,
  sla_minutes_major    integer,
  warning_pct          numeric not null default 80,
  active               boolean not null default true,
  updated_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint accident_team_roles_ws_chk check (
    workstream_key = any (public.accident_workstream_keys())),
  constraint accident_team_roles_owner_chk check (
    owner_role is not null or cardinality(owner_user_ids) > 0),
  constraint accident_team_roles_sla_chk check (
    coalesce(sla_minutes_minor, 1) > 0 and coalesce(sla_minutes_moderate, 1) > 0
    and coalesce(sla_minutes_major, 1) > 0),
  constraint accident_team_roles_warn_chk check (warning_pct > 0 and warning_pct < 100)
);

create unique index if not exists accident_team_roles_scope_uidx
  on public.accident_team_roles (organisation_id, workstream_key,
     coalesce(country, ''), coalesce(upper(site), ''));

alter table public.accident_team_roles enable row level security;

create policy accident_team_roles_org_isolation on public.accident_team_roles
  as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));

create policy accident_team_roles_select on public.accident_team_roles
  for select to authenticated using ((select public.app_is_active()));

create policy accident_team_roles_write on public.accident_team_roles
  for all to authenticated
  using ((select public.app_is_org_admin()))
  with check ((select public.app_is_org_admin()));

create or replace trigger set_updated_at_accident_team_roles
  before update on public.accident_team_roles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Who is told about each event
-- ---------------------------------------------------------------------------
create table if not exists public.accident_notify_rules (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null default public.app_current_org(),
  event_key          text not null,
  name               text,
  notify_owner       boolean not null default false,
  roles              text[] not null default '{}',
  user_ids           uuid[] not null default '{}',
  notify_driver      boolean not null default false,
  only_when_serious  boolean not null default false,
  serious_cost       numeric not null default 20000,
  channel_in_app     boolean not null default true,
  channel_push       boolean not null default true,
  stalled_days       integer,
  active             boolean not null default true,
  updated_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint accident_notify_rules_event_chk check (event_key in (
    'accident.reported','accident.workstream_assigned','accident.stage_changed',
    'accident.claim_changed','accident.sla_warning','accident.sla_breach',
    'accident.stalled','accident.closure_requested','accident.closure_decided',
    'accident.driver_status','accident.task_digest')),
  constraint accident_notify_rules_stalled_chk check (stalled_days is null or stalled_days > 0)
);

create index if not exists accident_notify_rules_org_event_idx
  on public.accident_notify_rules (organisation_id, event_key) where active;

alter table public.accident_notify_rules enable row level security;

create policy accident_notify_rules_org_isolation on public.accident_notify_rules
  as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));

create policy accident_notify_rules_select on public.accident_notify_rules
  for select to authenticated using ((select public.app_is_active()));

create policy accident_notify_rules_write on public.accident_notify_rules
  for all to authenticated
  using ((select public.app_is_org_admin()))
  with check ((select public.app_is_org_admin()));

create or replace trigger set_updated_at_accident_notify_rules
  before update on public.accident_notify_rules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------

-- Test / demo accounts never receive real routing.
create or replace function public._accident_is_test_profile(p_user uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select p.full_name ~* '^\s*(test|demo)\M'
        or coalesce(p.username, '') ~* '^(test|demo)'
        or coalesce(p.email, '') ~* '^(test|demo)[^@]*@'
      from public.profiles p where p.id = p_user), false);
$$;

-- Real, active people for a set of roles and named users, inside a case scope
-- (org + country + site). Named people are honoured even outside the role list.
create or replace function public.accident_people_for(
  p_org uuid, p_roles text[], p_user_ids uuid[], p_country text, p_site text)
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select distinct p.id
    from public.profiles p
   where (p.organisation_id = p_org or p.org_id = p_org)
     and coalesce(p.locked, false) = false
     and (p.approved is null or p.approved = true)
     and not public._accident_is_test_profile(p.id)
     and (
       p.id = any (coalesce(p_user_ids, '{}'::uuid[]))
       or (
         p.role = any (coalesce(p_roles, '{}'::text[]))
         and (coalesce(array_length(p.country, 1), 0) = 0 or p_country is null
              or p_country = any (p.country))
         and (p.site is null or btrim(p.site) = '' or p_site is null
              or upper(p.site) = upper(p_site)
              or upper(p_site) = any (select upper(x) from unnest(coalesce(p.sites, '{}'::text[])) x)
              or 'ALL' = any (coalesce(p.sites, '{}'::text[])))
       )
     );
$$;

-- Most specific ownership rule for a workstream: site > country > org-wide.
-- owner_id is a person only when the rule names exactly one, or the role holds
-- exactly one real person in scope, or the reporter holds the role. Otherwise the
-- step is owned by the role (owner_id null, owner_role set).
-- A rule whose role resolves to NOBODY in the case's country/site (e.g. a KSA
-- case owned by "PMV Manager" when the only PMV Manager is in UAE) does not own
-- the step: owner_role comes back null and unstaffed_role names the role, so the
-- step reads unowned and Admin/Manager are told "No one can take step X".
create or replace function public.accident_resolve_ws_owner(
  p_org uuid, p_ws text, p_country text, p_site text, p_reporter uuid)
returns table (owner_id uuid, owner_role text, rule_id uuid, unstaffed_role text)
language plpgsql stable security definer
set search_path = public
as $$
declare
  r record;
  v_people uuid[];
begin
  select tr.* into r
    from public.accident_team_roles tr
   where tr.organisation_id = p_org and tr.active and tr.workstream_key = p_ws
     and (tr.country is null or tr.country = p_country)
     and (tr.site is null or upper(tr.site) = upper(coalesce(p_site, '')))
   order by (tr.site is not null) desc, (tr.country is not null) desc, tr.updated_at desc
   limit 1;
  if not found then
    return;
  end if;

  if cardinality(r.owner_user_ids) = 1
     and exists (select 1 from public.accident_people_for(p_org, '{}', r.owner_user_ids, p_country, p_site)) then
    owner_id := r.owner_user_ids[1];
  else
    select coalesce(array_agg(x), '{}') into v_people
      from public.accident_people_for(p_org, case when r.owner_role is null then '{}'::text[]
                                                  else array[r.owner_role] end,
                                      '{}', p_country, p_site) x;
    if p_reporter is not null and p_reporter = any (v_people) then
      owner_id := p_reporter;
    elsif cardinality(v_people) = 1 then
      owner_id := v_people[1];
    end if;
  end if;
  rule_id := r.id;
  if owner_id is null and (r.owner_role is null or cardinality(coalesce(v_people, '{}')) = 0) then
    -- nobody in scope can take it: leave the step unowned, never "assigned"
    owner_role := null;
    unstaffed_role := coalesce(r.owner_role, 'named person');
  else
    owner_role := r.owner_role;
  end if;
  return next;
end;
$$;

create or replace function public.accident_notify_configured(p_org uuid, p_event text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.accident_notify_rules n
                  where n.organisation_id = p_org and n.active and n.event_key = p_event);
$$;

-- Settings preview: who a role + named people resolve to, and how many have a phone.
create or replace function public.accident_team_role_preview(
  p_role text, p_country text, p_site text, p_user_ids uuid[], p_ws text default null)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_ids uuid[];
begin
  if not public.app_is_org_admin() then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  select coalesce(array_agg(x), '{}') into v_ids
    from public.accident_people_for(v_org,
           case when nullif(btrim(p_role), '') is null then '{}'::text[] else array[p_role] end,
           coalesce(p_user_ids, '{}'), nullif(p_country, ''), nullif(p_site, '')) x;
  return jsonb_build_object(
    'people', cardinality(v_ids),
    'with_device', (select count(*) from unnest(v_ids) u
                     where exists (select 1 from public._user_push_tokens(u))),
    'names', coalesce((select jsonb_agg(coalesce(nullif(btrim(p.full_name), ''), p.username) order by p.full_name)
                         from public.profiles p where p.id = any (v_ids)), '[]'::jsonb));
end;
$$;

revoke all on function public._accident_is_test_profile(uuid) from public, anon, authenticated;
revoke all on function public.accident_people_for(uuid,text[],uuid[],text,text) from public, anon, authenticated;
revoke all on function public.accident_resolve_ws_owner(uuid,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.accident_notify_configured(uuid,text) from public, anon;
revoke all on function public.accident_team_role_preview(text,text,text,uuid[],text) from public, anon;
grant execute on function public.accident_team_role_preview(text,text,text,uuid[],text) to authenticated;
grant execute on function public.accident_notify_configured(uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Defaults the owner can change (every org that has accidents)
-- ---------------------------------------------------------------------------
insert into public.accident_team_roles (organisation_id, workstream_key, owner_role, updated_by)
select o.org, d.ws, d.role, null
  from (select distinct organisation_id as org from public.accidents where organisation_id is not null) o
  cross join (values
    ('incident_evidence', 'Fleet Supervisor'),
    ('fleet_validation',  'Fleet Supervisor'),
    ('liability',         'Fleet Supervisor'),
    ('handover',          'Fleet Supervisor'),
    ('assessment',        'Workshop Maintenance Area Manager'),
    ('workshop_qc',       'Workshop Maintenance Area Manager'),
    ('repair',            'PMV Manager'),
    ('insurance',         'Admin'),
    ('finance',           'Admin'),
    ('corrective',        'Admin')
  ) as d(ws, role)
on conflict do nothing;

insert into public.accident_notify_rules
  (organisation_id, event_key, name, notify_owner, roles, notify_driver,
   only_when_serious, stalled_days, updated_by)
select o.org, d.ev, d.nm, d.own, d.roles, d.drv, d.serious, d.stalled, null
  from (select distinct organisation_id as org from public.accidents where organisation_id is not null) o
  cross join (values
    ('accident.reported',            'Reported: step owners + Manager', true,  array['Manager'],  false, false, null::int),
    ('accident.reported',            'Reported: Director when serious', false, array['Director'], false, true,  null::int),
    ('accident.workstream_assigned', 'Step assigned: owner',            true,  '{}'::text[], false, false, null::int),
    ('accident.stage_changed',       'Stage changed: owner',            true,  '{}'::text[], false, false, null::int),
    ('accident.claim_changed',       'Claim changed: owner + Admin',    true,  array['Admin'],    false, false, null::int),
    ('accident.sla_warning',         'SLA warning: owner',              true,  '{}'::text[], false, false, null::int),
    ('accident.sla_breach',          'SLA breach: owner + Manager',     true,  array['Manager'],  false, false, null::int),
    ('accident.stalled',             'Stalled case: owner + Manager',   true,  array['Manager'],  false, false, 14),
    ('accident.closure_requested',   'Closure requested: Admin',        false, array['Admin'],    false, false, null::int),
    ('accident.closure_decided',     'Closure decided: owner',          true,  '{}'::text[], false, false, null::int),
    ('accident.driver_status',       'Driver: own case status',         false, '{}'::text[], true,  false, null::int),
    ('accident.task_digest',         'Daily digest of open tasks',      true,  '{}'::text[], false, false, null::int)
  ) as d(ev, nm, own, roles, drv, serious, stalled)
where not exists (select 1 from public.accident_notify_rules x
                   where x.organisation_id = o.org and x.event_key = d.ev and x.name = d.nm);

commit;
