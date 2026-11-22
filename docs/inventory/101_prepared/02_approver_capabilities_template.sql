-- =============================================================================
-- 101_prepared/02_approver_capabilities_template.sql
-- STATUS: TEMPLATE, NOT APPLIED. The OWNER must name each person (doc 101 section 4).
-- Unreplaced <...> placeholders fail the uuid cast, so the file cannot run by accident.
--
-- Measured 2026-11-21 (read-only impersonation): adnan mohammad alhaj ali (Manager, KSA)
-- and VINAY KUMAR T (Workshop Maintenance Area Manager, KSA) resolve inv_can() to
-- view=true and EVERY other stock capability false. Today only the two Admin / super-admin
-- accounts can approve anything in inventory.
--
-- Role eligibility is fixed in the database (inv_approver_roles, 113000):
--   stock_adjustment          Admin, Director, Manager, Inventory Controller, Finance Manager,
--                             PMV Manager, Workshop Area Manager, Workshop Maintenance Area Manager
--   recount_assignment        same without Finance Manager
--   opening_balance_batch     Admin, Director, Manager, Inventory Controller, Finance Manager
--   cost_reconciliation       Admin, Director, Manager, Finance Manager
--   tyre_conflict_correction  PMV Manager only
-- A person needs BOTH an eligible role AND the capability below. Separation of duties is by
-- user id and cannot be granted away (doc 101 s4.3).
--
-- Grants are per named person (user_access_grants), never role-wide, so a future holder of
-- the role does not inherit financial authority.
-- =============================================================================
begin;

create temp table _people (user_id uuid, bundle text) on commit drop;
insert into _people values
  ('<INVENTORY_CONTROLLER_USER_UUID>'::uuid, 'inventory_controller'),
  ('<FINANCE_MANAGER_USER_UUID>'::uuid,      'finance_manager'),
  ('<KSA_PMV_MANAGER_USER_UUID>'::uuid,      'pmv_manager'),
  ('<RECOUNT_OFFICER_USER_UUID>'::uuid,      'recount_officer');

create temp table _bundle (bundle text, cap text) on commit drop;
insert into _bundle values
  -- Inventory Controller: plans audits, reviews discrepancies, approves non-financial adjustments.
  ('inventory_controller','view'), ('inventory_controller','audit_create'), ('inventory_controller','recount'),
  ('inventory_controller','discrepancy_review'), ('inventory_controller','adjustment_approve'),
  ('inventory_controller','audit_history'), ('inventory_controller','export'),
  -- Finance Manager: values stock and posts cost decisions; never counts or moves stock.
  ('finance_manager','view'), ('finance_manager','view_value'), ('finance_manager','financial_post'),
  ('finance_manager','audit_history'), ('finance_manager','export'),
  -- PMV Manager (KSA): tyre conflict corrections and scrap; no valuation.
  ('pmv_manager','view'), ('pmv_manager','discrepancy_review'), ('pmv_manager','adjustment_approve'),
  ('pmv_manager','scrap_approve'), ('pmv_manager','audit_history'),
  -- Independent recount officer: counts what they are assigned (counter_id), nothing else.
  ('recount_officer','view'), ('recount_officer','count');

do $$
declare r record; v_need text[];
begin
  for r in select p.*, pr.role, pr.approved, pr.locked, pr.is_super_admin, pr.country, pr.org_id
             from _people p left join public.profiles pr on pr.id = p.user_id loop
    if r.role is null then raise exception 'User % not found.', r.user_id; end if;
    if not coalesce(r.approved,false) or coalesce(r.locked,false) then
      raise exception 'User % is not approved or is locked.', r.user_id; end if;
    if r.role = 'Store Keeper' and r.bundle <> 'recount_officer' then
      raise exception 'A Store Keeper cannot hold an approver bundle (113000 refuses them anyway).'; end if;
    v_need := case r.bundle
      when 'inventory_controller' then array['Inventory Controller','Manager','Director','Workshop Maintenance Area Manager','Workshop Area Manager']
      when 'finance_manager'      then array['Finance Manager','Manager','Director']
      when 'pmv_manager'          then array['PMV Manager']
      else null end;
    if v_need is not null and not (r.role = any (v_need)) then
      raise exception 'User % has role %, which inv_approver_roles does not allow for %.', r.user_id, r.role, r.bundle; end if;
    if r.bundle = 'pmv_manager' and not ('KSA' = any (r.country)) then
      raise exception 'The KSA PMV Manager must be scoped to KSA (the 7 conflicts are KSA).'; end if;
  end loop;
  if (select count(distinct user_id) from _people) <> (select count(*) from _people) then
    raise exception 'One person per bundle: do not stack approver bundles on one account.'; end if;
end $$;

insert into public.user_access_grants (org_id, user_id, module_key, capability, effect, granted_by, note)
select pr.org_id, p.user_id, 'stock', b.cap, 'grant',
       'd2d43a5f-0906-4f7a-9577-e36d89164914'::uuid, 'inv-ops-2026-11-21: ' || p.bundle
  from _people p join _bundle b on b.bundle = p.bundle join public.profiles pr on pr.id = p.user_id
on conflict (user_id, module_key, capability, effect) do nothing;

-- Optional value limit per role (113000 refuses an approval above the limit, and refuses a
-- valued approval when no limit exists for the role). Owner sets the amounts:
-- select public.inv_approval_limit_upsert(jsonb_build_object(...));   -- see 20261120113000 line 249

commit;

-- ROLLBACK (exact):
-- delete from public.user_access_grants where module_key = 'stock' and note like 'inv-ops-2026-11-21: %'
--    and note <> 'inv-ops-2026-11-21: Store Keeper site-scoped operations';
