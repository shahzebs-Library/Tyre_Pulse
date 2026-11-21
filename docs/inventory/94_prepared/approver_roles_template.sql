-- =============================================================================
-- 94_prepared/approver_roles_template.sql
-- STATUS: TEMPLATE, NOT APPLIED. The OWNER must name the people. Nothing here assigns
--         anyone until the placeholders are replaced (an unreplaced placeholder fails
--         the uuid cast, so the file cannot run by accident).
-- Run ONLY AFTER 20261120113000 (it creates the custom roles 'Inventory Controller' and
-- 'Finance Manager' in every company; 0 holders today).
--
-- What the roles may approve (inv_approver_roles, 113000):
--   stock_adjustment        Admin, Director, Manager, Inventory Controller, Finance Manager,
--                           PMV Manager, Workshop Area Manager, Workshop Maintenance Area Manager
--   recount_assignment      Admin, Director, Manager, Inventory Controller, PMV Manager,
--                           Workshop Area Manager, Workshop Maintenance Area Manager
--   opening_balance_batch   Admin, Director, Manager, Inventory Controller, Finance Manager
--   cost_reconciliation     Admin, Director, Manager, Finance Manager
--   tyre_conflict_correction PMV Manager only
-- Approval also needs the stock capability (adjustment_approve / discrepancy_review /
-- financial_post ...) and scope (country/site); separation of duties is by user id.
--
-- IMPORTANT: profiles.role is SINGLE-VALUED. Assigning 'Inventory Controller' REPLACES
-- the person's current role (and every module default / approval rung tied to it).
-- Prefer people whose current role carries nothing they still need, or ask for a
-- dedicated account. This template snapshots the old role so it can be restored.
--
-- RECOMMENDED PATH: Console -> Users (super admin, admin_update_profile) and Console ->
-- Access Control for the capability grants. The SQL below is the equivalent for the
-- SQL editor; trg_guard_profile_privileged blocks a role change from a session without
-- a profile, so it is disabled for the one UPDATE and re-enabled in the same txn
-- (documented precedent in PROJECT_MEMORY "Super-admin ownership swap").
-- =============================================================================
begin;

create schema if not exists _bak;
create table if not exists _bak.inv_role_assignment_20261120 (
  user_id uuid primary key, old_role text not null, new_role text not null,
  changed_at timestamptz not null default now());
revoke all on _bak.inv_role_assignment_20261120 from public;

-- Fill in: one row per person. new_role must be 'Inventory Controller' or 'Finance Manager'.
create temp table _assign (user_id uuid, new_role text) on commit drop;
insert into _assign values
  ('<INVENTORY_CONTROLLER_USER_UUID>'::uuid, 'Inventory Controller'),
  ('<FINANCE_MANAGER_USER_UUID>'::uuid,      'Finance Manager');

do $$
declare r record; v_n int;
begin
  for r in select a.*, p.role as cur_role, p.org_id, p.approved, p.locked, p.is_super_admin
             from _assign a left join public.profiles p on p.id = a.user_id loop
    if r.cur_role is null then raise exception 'User % not found.', r.user_id; end if;
    if r.new_role not in ('Inventory Controller','Finance Manager') then
      raise exception 'Role % is not an inventory approver role.', r.new_role; end if;
    if not coalesce(r.approved,false) or coalesce(r.locked,false) then
      raise exception 'User % is not approved / is locked.', r.user_id; end if;
    if r.cur_role in ('Store Keeper','Admin') or coalesce(r.is_super_admin,false) then
      raise exception 'User % holds % - not reassigned by this template (SoD / last-admin).', r.user_id, r.cur_role; end if;
    select count(*) into v_n from public.custom_roles c
     where c.organisation_id = r.org_id and c.name = r.new_role and coalesce(c.active, true);
    if v_n <> 1 then raise exception 'Custom role % missing in org % (apply 113000 first).', r.new_role, r.org_id; end if;
  end loop;
end $$;

insert into _bak.inv_role_assignment_20261120 (user_id, old_role, new_role)
select a.user_id, p.role, a.new_role from _assign a join public.profiles p on p.id = a.user_id
on conflict (user_id) do nothing;

alter table public.profiles disable trigger trg_guard_profile_privileged;
update public.profiles p set role = a.new_role from _assign a where p.id = a.user_id;
alter table public.profiles enable trigger trg_guard_profile_privileged;

do $$ begin
  if (select tgenabled from pg_trigger where tgname = 'trg_guard_profile_privileged'
        and tgrelid = 'public.profiles'::regclass) <> 'O' then
    raise exception 'trg_guard_profile_privileged not re-enabled'; end if;
  if exists (select 1 from _assign a join public.profiles p on p.id = a.user_id where p.role <> a.new_role) then
    raise exception 'A role was rewritten by normalize_profiles_role (custom role not accepted).'; end if;
end $$;
commit;

-- Capabilities each approver also needs (grant through Console -> Access Control, or
-- user_access_grants rows module 'stock', effect 'grant'):
--   Inventory Controller: view, view_value, audit_create, audit_history, recount,
--                         discrepancy_review, adjustment_approve (not financial_post)
--   Finance Manager:      view, view_value, financial_post, adjustment_approve
-- Optional thresholds: inventory_approval_limits (113000 inv_* RPC, Admin only).

-- VERIFY: select id, role from public.profiles where id in (select user_id from _bak.inv_role_assignment_20261120);
-- ROLLBACK:
-- begin;
-- alter table public.profiles disable trigger trg_guard_profile_privileged;
-- update public.profiles p set role = b.old_role from _bak.inv_role_assignment_20261120 b where p.id = b.user_id;
-- alter table public.profiles enable trigger trg_guard_profile_privileged;
-- commit;
