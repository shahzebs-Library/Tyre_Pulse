import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createBaselineDb, createDb, applyDraft, asClient, seedVehicles, capabilityMatrix, val, one,
  ORG_A, ORG_B, ORG_C, U,
} from './fixtures/tenant_saas_harness.mjs'

// TEN-6: entitlement enforcement (pending draft 20261113110000), proven against verbatim copies
// of the live app_user_can / enforce_plan_limit / ensure_org_subscription / overview bodies.
// Company A in this harness holds 30 vehicles: above the trial cap of 25, like production
// (about 1,618 against 25).

const A_USERS = { super: U.superadmin, admin: U.adminA, manager: U.managerA, tyreman: U.tyremanA, supervisor: U.supervisorA, reporter: U.reporterA }
const insertVehicle = (db, uid, asset) =>
  asClient(db, uid, () => db.exec(`insert into public.vehicle_fleet(country, asset_no) values ('KSA', '${asset}')`))
const enforce = db => db.exec(`update public.system_config set value = 'on' where key = 'entitlement_enforcement'`)
const trial = (db, org, ends) => db.exec(`insert into public.org_subscriptions(organisation_id, plan_code, status, trial_ends_at)
  values ('${org}', 'trial', 'trialing', ${ends})`)

test('baseline reproduces production: no row = unlimited, and one trial row turns the cap on Company A (CF-08)', async () => {
  const db = await createBaselineDb()
  await seedVehicles(db, ORG_A, 30)
  await insertVehicle(db, U.managerA, 'BASE-1')
  await asClient(db, U.managerA, () => db.query(`select public.ensure_org_subscription()`))
  await assert.rejects(insertVehicle(db, U.managerA, 'BASE-2'), /Plan limit reached/)
  await db.close()
})

test('Company A: explicit internal row first, vehicle insert still works, capability matrix unchanged (switch off and on)', async () => {
  const base = await createBaselineDb()
  const before = await capabilityMatrix(base, A_USERS)
  await base.close()

  const db = await createDb(['ten6'])
  await seedVehicles(db, ORG_A, 30)
  const sub = await one(db, `select plan_code, status from public.org_subscriptions where organisation_id = '${ORG_A}'`)
  assert.deepEqual(sub, { plan_code: 'internal', status: 'active' })
  assert.equal(await val(db, `select value from public.system_config where key = 'entitlement_enforcement'`), 'off')

  // switch off
  assert.equal(await capabilityMatrix(db, A_USERS), before, 'app_user_can identical with the switch off')
  await insertVehicle(db, U.managerA, 'A-OFF-1')
  // The Billing page path can no longer create a trial row for Company A.
  await asClient(db, U.managerA, () => db.query(`select public.ensure_org_subscription()`))
  assert.equal(await val(db, `select plan_code from public.org_subscriptions where organisation_id = '${ORG_A}'`), 'internal')
  await insertVehicle(db, U.managerA, 'A-OFF-2')

  // switch on
  await enforce(db)
  assert.equal(await capabilityMatrix(db, A_USERS), before, 'app_user_can identical with the switch on')
  await insertVehicle(db, U.managerA, 'A-ON-1')
  const ent = await asClient(db, U.managerA, () => val(db, `select public.get_my_entitlements()`))
  assert.equal(ent.standing, 'ok')
  assert.equal(ent.plan_code, 'internal')
  for (const [k, m] of Object.entries(ent.modules)) assert.equal(m.entitled, true, `Company A entitled to ${k}`)
  assert.equal(ent.modules.vehicle_washing.platform_status, 'disabled', 'platform status is reported, not enforced')
  assert.equal(await val(db, `select count(*)::int from public.vehicle_fleet where organisation_id = '${ORG_A}'`), 33)
  await db.close()
})

test('a NEW tenant with no subscription row is not an endless trial once enforcement is on', async () => {
  const db = await createDb(['ten6'])
  // Tenant D is created AFTER the migration, so it has no row.
  const D = '00000000-0000-0000-0000-000000000904'
  const adminD = '00000000-0000-0000-0000-000000000041'
  await db.exec(`insert into public.organisations(id, name, slug) values ('${D}', 'Tenant D', 'tenant-d');
    insert into public.profiles(id, username, role, org_id, approved) values ('${adminD}', 'admin_d', 'Admin', '${D}', true)`)

  // switch off: legacy behaviour (documented, this is why the switch must be flipped before selling)
  assert.equal(await asClient(db, adminD, () => val(db, `select public.org_entitled('tyre_records')`)), true)

  await enforce(db)
  assert.equal(await asClient(db, adminD, () => val(db, `select public.org_entitled('tyre_records')`)), false)
  assert.equal(await asClient(db, adminD, () => val(db, `select public.app_user_can('tyre_records', 'create')`)), false,
    'a customer Admin does not bypass entitlement')
  assert.equal((await asClient(db, adminD, () => val(db, `select public.get_my_entitlements()`))).standing, 'no_subscription')
  await assert.rejects(insertVehicle(db, adminD, 'D-1'), /no active subscription/)
  await assert.rejects(
    asClient(db, adminD, () => db.exec(`insert into public.tyre_records(country, serial_no) values ('KSA', 'D-S1')`)),
    /row-level security/)
  // ensure_org_subscription no longer hands out a trial
  await asClient(db, adminD, () => db.query(`select public.ensure_org_subscription()`))
  assert.equal(await val(db, `select count(*)::int from public.org_subscriptions where organisation_id = '${D}'`), 0)
  const ov = await asClient(db, adminD, () => val(db, `select public.get_subscription_overview()`))
  assert.equal(ov.subscription.status, 'expired')
  assert.equal(await val(db, `select count(*)::int from public.vehicle_fleet where organisation_id = '${D}'`), 0)
  // the platform owner is not a customer Admin
  assert.equal(await asClient(db, U.superadmin, () => val(db, `select public.org_entitled('tyre_records')`)), true)
  await db.close()
})

test('a trial tenant is capped at its plan limit, an expired or open-ended trial is not entitled, Company A is untouched', async () => {
  const db = await createDb(['ten6'])
  await enforce(db)
  await seedVehicles(db, ORG_A, 30)
  await db.exec(`update public.org_subscriptions set plan_code = 'trial', status = 'trialing', trial_ends_at = now() + interval '14 days'
    where organisation_id = '${ORG_B}'`)
  await seedVehicles(db, ORG_B, 24, 'B')
  await insertVehicle(db, U.adminB, 'B-25')                                  // 25th: allowed
  await assert.rejects(insertVehicle(db, U.adminB, 'B-26'), /Plan limit reached for vehicles/)
  await insertVehicle(db, U.managerA, 'A-31')                                // Company A at 30: allowed
  assert.equal(await val(db, `select count(*)::int from public.vehicle_fleet where organisation_id = '${ORG_B}'`), 25)

  await db.exec(`update public.org_subscriptions set trial_ends_at = now() - interval '1 day' where organisation_id = '${ORG_B}'`)
  assert.equal(await asClient(db, U.adminB, () => val(db, `select public.org_entitled('tyre_records')`)), false)
  assert.equal((await asClient(db, U.adminB, () => val(db, `select public.get_my_entitlements()`))).standing, 'trial_expired')
  await assert.rejects(insertVehicle(db, U.adminB, 'B-X'), /no active subscription/)

  await db.exec(`update public.org_subscriptions set trial_ends_at = null where organisation_id = '${ORG_B}'`)
  assert.equal(await asClient(db, U.adminB, () => val(db, `select public.org_entitled('tyre_records')`)), false,
    'trialing with no end date is not entitled')

  assert.equal(await asClient(db, U.managerA, () => val(db, `select public.org_entitled('tyre_records')`)), true)
  await db.close()
})

test('plan feature mapping and per-tenant override: on restores one module, off for B never touches A', async () => {
  const db = await createDb(['ten6'])
  await enforce(db)
  await db.exec(`update public.modules set min_plan_feature = 'report_scheduling' where module_id = 'scheduled_reports';
    update public.org_subscriptions set plan_code = 'trial', status = 'trialing', trial_ends_at = now() + interval '14 days'
      where organisation_id = '${ORG_B}'`)
  const ent = (uid, k) => asClient(db, uid, () => val(db, `select public.org_entitled('${k}')`))
  assert.equal(await ent(U.managerB, 'scheduled_reports'), false, 'trial plan lacks report_scheduling')
  assert.equal(await ent(U.managerB, 'tyre_records'), true)
  assert.equal(await ent(U.managerB, 'erp_sync'), false, 'a plan feature key can be asked directly')
  assert.equal(await ent(U.managerA, 'scheduled_reports'), true, 'internal plan carries every feature')
  assert.equal(await asClient(db, U.managerB, () => val(db, `select public.app_user_can('scheduled_reports', 'view')`)), false)
  assert.equal(await asClient(db, U.managerA, () => val(db, `select public.app_user_can('scheduled_reports', 'view')`)), true)

  // only a super admin sets an override
  await assert.rejects(asClient(db, U.adminB, () =>
    db.query(`select public.set_org_module_override('${ORG_B}', 'scheduled_reports', 'on', 'self grant')`)), /Only a super admin/)
  await assert.rejects(asClient(db, U.adminB, () =>
    db.exec(`insert into public.org_module_overrides(organisation_id, module_key, state) values ('${ORG_B}', 'scheduled_reports', 'on')`)),
  /row-level security/)
  await asClient(db, U.superadmin, () =>
    db.query(`select public.set_org_module_override('${ORG_B}', 'scheduled_reports', 'on', 'pilot add-on')`))
  assert.equal(await ent(U.managerB, 'scheduled_reports'), true)
  assert.equal(await ent(U.managerB, 'erp_sync'), false, 'exactly one module restored')

  await asClient(db, U.superadmin, () =>
    db.query(`select public.set_org_module_override('${ORG_B}', 'tyre_records', 'off', 'switched off for tenant B')`))
  assert.equal(await ent(U.managerB, 'tyre_records'), false)
  assert.equal(await ent(U.managerA, 'tyre_records'), true, 'tenant B switch does not reach Company A')
  // tenant A cannot see tenant B override rows
  assert.equal(await asClient(db, U.adminA, () => val(db, `select count(*)::int from public.org_module_overrides`)), 0)
  await db.close()
})

test('seat limit: the trial plan approves 3 members, the 4th is refused; Company A (internal) is not limited', async () => {
  const db = await createDb(['ten6'])
  await enforce(db)
  await db.exec(`update public.org_subscriptions set plan_code = 'trial', status = 'trialing', trial_ends_at = now() + interval '14 days'
    where organisation_id = '${ORG_B}'`)                                       // B already has 3 approved members
  await db.exec(`insert into public.profiles(id, username, role, org_id, approved) values
    ('00000000-0000-0000-0000-000000000051', 'b4', 'Reporter', '${ORG_B}', false),
    ('00000000-0000-0000-0000-000000000052', 'a_new', 'Reporter', '${ORG_A}', false)`)
  await assert.rejects(db.exec(`update public.profiles set approved = true where username = 'b4'`), /Plan limit reached for users/)
  await db.exec(`update public.profiles set approved = true where username = 'a_new'`)
  // a sign-up that arrives pre-approved over the limit is downgraded to pending, never failed
  await db.exec(`insert into public.profiles(id, username, role, org_id, approved) values
    ('00000000-0000-0000-0000-000000000053', 'b5', 'Reporter', '${ORG_B}', true)`)
  assert.equal(await val(db, `select approved from public.profiles where username = 'b5'`), false)
  await db.close()
})

test('grants: internal helpers are not callable by clients, anon reaches nothing', async () => {
  const db = await createDb(['ten6'])
  const priv = (role, fn) => val(db, `select has_function_privilege('${role}', '${fn}', 'execute')`)
  for (const fn of ['public._org_standing(uuid)', 'public._org_module_entitled(uuid,text)', 'public._entitlement_enforced()']) {
    assert.equal(await priv('authenticated', fn), false, `${fn} authenticated`)
    assert.equal(await priv('anon', fn), false, `${fn} anon`)
  }
  for (const fn of ['public.org_entitled(text)', 'public.get_my_entitlements()', 'public.set_org_module_override(uuid,text,text,text,timestamptz)']) {
    assert.equal(await priv('authenticated', fn), true, `${fn} authenticated`)
    assert.equal(await priv('anon', fn), false, `${fn} anon`)
  }
  assert.equal(await val(db, `select has_table_privilege('anon', 'public.org_module_overrides', 'select')`), false)
  assert.equal(await val(db, `select has_table_privilege('authenticated', 'public._fn_backup_ten6', 'select')`), false)
  await db.close()
})

test('anchor guard: a changed live body aborts the whole migration and leaves nothing behind', async () => {
  const db = await createBaselineDb({
    mutateBaseline: s => s.replace("if v_super is true or v_role = 'Admin' then return true; end if;",
      "if v_super is true or v_role = 'Admin' then return true;  end if;"),
  })
  await assert.rejects(applyDraft(db, 'ten6'), /anchor found 0 time/)
  assert.equal(await val(db, `select count(*)::int from public.subscription_plans where code = 'internal'`), 0)
  assert.equal(await val(db, `select to_regclass('public.org_module_overrides') is null`), true)
  assert.equal(await val(db, `select count(*)::int from public.org_subscriptions`), 0)
  await db.close()
})

test('rollback lever: switching enforcement off restores legacy answers at once', async () => {
  const db = await createDb(['ten6'])
  await enforce(db)
  await db.exec(`update public.org_subscriptions set plan_code = 'trial', status = 'expired' where organisation_id = '${ORG_C}'`)
  assert.equal(await asClient(db, U.managerC, () => val(db, `select public.app_user_can('tyre_records', 'view')`)), false)
  await db.exec(`update public.system_config set value = 'off' where key = 'entitlement_enforcement'`)
  assert.equal(await asClient(db, U.managerC, () => val(db, `select public.app_user_can('tyre_records', 'view')`)), true)
  await db.close()
})
