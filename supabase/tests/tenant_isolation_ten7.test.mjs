import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createBaselineDb, createDb, applyDraft, asClient, capabilityMatrix, val,
  ORG_A, ORG_B, U,
} from './fixtures/tenant_saas_harness.mjs'

// TEN-7: per-tenant configuration (pending draft 20261113111000 on top of TEN-6), proven against
// verbatim copies of the live normalize_site / normalize_site_name / normalize_brand /
// app_user_can / get_user_module_permissions / normalize_profiles_role bodies.

const A_USERS = { super: U.superadmin, admin: U.adminA, manager: U.managerA, tyreman: U.tyremanA, supervisor: U.supervisorA, reporter: U.reporterA }
const SITES = ['nhc-st', 'Dhaban-ST', 'redsea', '  jed   yard ', 'RIY_ST', 'Plain Site', 'yard 1']

// The same Company A writes, replayed on any database: session inserts, a Table Editor style
// insert (no session, no organisation) and the sites registry.
async function companyAWrites (db) {
  for (const [i, s] of SITES.entries()) {
    await asClient(db, U.managerA, () => db.exec(`insert into public.vehicle_fleet(country, asset_no, site) values ('KSA', 'A${i}', '${s}')`))
    await db.exec(`insert into public.vehicle_fleet(country, asset_no, site) values ('KSA', 'TE${i}', '${s}')`)
    await asClient(db, U.adminA, () => db.exec(`insert into public.sites(country, name) values ('KSA', '${s}')`))
  }
  const fleet = (await db.query(`select asset_no, site, organisation_id from public.vehicle_fleet where asset_no ~ '^(A|TE)[0-9]' order by asset_no`)).rows
  const sites = (await db.query(`select name, organisation_id from public.sites order by name`)).rows
  const perms = {}
  for (const [n, uid] of Object.entries(A_USERS)) {
    perms[n] = await asClient(db, uid, () => val(db, `select public.get_user_module_permissions()`))
  }
  const brand = await asClient(db, U.managerA, () => val(db, `select public.normalize_brand(' Traingle ')`))
  return JSON.stringify({ fleet, sites, perms, brand, matrix: await capabilityMatrix(db, A_USERS) })
}

test('Company A resolves exactly what it resolves today (aliases, -ST strip, sites registry, matrix, brand)', async () => {
  const base = await createBaselineDb()
  const before = await companyAWrites(base)
  await base.close()
  const db = await createDb(['ten6', 'ten7'])
  const after = await companyAWrites(db)
  assert.equal(after, before)
  assert.match(after, /"site":"NHC"/)
  assert.match(after, /"site":"RIY"/, 'the -ST strip still applies to Company A')
  assert.match(after, /"brand":"TRIANGLE"/)
  await db.close()
})

test('tenant B site names are stored as typed: Company A aliases and the -ST strip do not apply', async () => {
  const db = await createDb(['ten6', 'ten7'])
  const ins = (uid, asset, site) => asClient(db, uid, () =>
    db.exec(`insert into public.vehicle_fleet(country, asset_no, site) values ('KSA', '${asset}', '${site}')`))
  await ins(U.managerB, 'B1', 'nhc-st')        // equals a Company A alias
  await ins(U.managerB, 'B2', 'depot_st')      // ends in the suffix Company A strips
  const rows = (await db.query(`select asset_no, site from public.vehicle_fleet where organisation_id = '${ORG_B}' order by asset_no`)).rows
  assert.deepEqual(rows, [{ asset_no: 'B1', site: 'NHC-ST' }, { asset_no: 'B2', site: 'DEPOT_ST' }])
  await asClient(db, U.adminB, () => db.exec(`insert into public.sites(country, name) values ('KSA', 'nhc-st')`))
  assert.equal(await val(db, `select name from public.sites where organisation_id = '${ORG_B}'`), 'NHC-ST')
  assert.equal(await asClient(db, U.managerB, () => val(db, `select public.normalize_brand('traingle')`)), 'Traingle',
    'Company A brand alias does not apply to tenant B')
  await db.close()
})

test('tenant B own alias rewrites only tenant B rows; it does not rewrite or hide Company A data', async () => {
  const db = await createDb(['ten6', 'ten7'])
  const ins = (uid, asset, site) => asClient(db, uid, () =>
    db.exec(`insert into public.vehicle_fleet(country, asset_no, site) values ('KSA', '${asset}', '${site}')`))
  await ins(U.managerA, 'A-1', 'yard 1')
  await ins(U.managerA, 'A-2', 'nhc-st')
  const aBefore = (await db.query(`select md5(string_agg(asset_no || '|' || site, ',' order by asset_no)) h, count(*)::int n
    from public.vehicle_fleet where organisation_id = '${ORG_A}'`)).rows[0]

  // tenant B Admin creates its own aliases, including one that collides with a Company A alias
  await asClient(db, U.adminB, () => db.exec(`insert into public.org_alias_overrides(kind, alias, canonical) values
    ('site', 'yard 1', 'main yard'), ('site', 'NHC-ST', 'north hub'), ('brand', 'Traingle', 'TRI-B')`))
  await ins(U.managerB, 'B-1', 'Yard 1')
  await ins(U.managerB, 'B-2', 'nhc-st')
  assert.deepEqual((await db.query(`select site from public.vehicle_fleet where organisation_id = '${ORG_B}' order by asset_no`)).rows,
    [{ site: 'MAIN YARD' }, { site: 'NORTH HUB' }])
  assert.equal(await asClient(db, U.managerB, () => val(db, `select public.normalize_brand('traingle')`)), 'TRI-B')

  // Company A: existing rows untouched, new rows resolve as before, brand alias unchanged
  const aAfter = (await db.query(`select md5(string_agg(asset_no || '|' || site, ',' order by asset_no)) h, count(*)::int n
    from public.vehicle_fleet where organisation_id = '${ORG_A}'`)).rows[0]
  assert.deepEqual(aAfter, aBefore)
  await ins(U.managerA, 'A-3', 'yard 1')
  await ins(U.managerA, 'A-4', 'nhc-st')
  assert.deepEqual((await db.query(`select site from public.vehicle_fleet where asset_no in ('A-3', 'A-4') order by asset_no`)).rows,
    [{ site: 'YARD 1' }, { site: 'NHC' }])
  assert.equal(await asClient(db, U.managerA, () => val(db, `select public.normalize_brand('traingle')`)), 'TRIANGLE')
  assert.equal(await asClient(db, U.managerA, () => val(db, `select count(*)::int from public.vehicle_fleet`)), 4,
    'Company A still reads all of its own rows and none of tenant B')

  // isolation of the alias table itself
  assert.equal(await asClient(db, U.adminA, () => val(db, `select count(*)::int from public.org_alias_overrides`)), 0)
  await assert.rejects(asClient(db, U.adminB, () =>
    db.exec(`insert into public.org_alias_overrides(organisation_id, kind, alias, canonical) values ('${ORG_A}', 'site', 'NHC', 'HIJACK')`)),
  /row-level security/)
  await assert.rejects(asClient(db, U.managerB, () =>
    db.exec(`insert into public.org_alias_overrides(kind, alias, canonical) values ('site', 'X', 'Y')`)), /row-level security/)
  assert.equal(await val(db, `select count(*)::int from public.site_aliases`), 3, 'global alias table untouched')
  await db.close()
})

test('role matrix: tenant B edits its own matrix; Company A global rows and results do not move', async () => {
  const db = await createDb(['ten6', 'ten7'])
  const can = (uid, k, c = 'view') => asClient(db, uid, () => val(db, `select public.app_user_can('${k}', '${c}')`))
  const globalHash = () => val(db, `select md5(string_agg(role || module_key || enabled, ',' order by role, module_key)) from public.module_permissions where org_id is null`)
  const h0 = await globalHash()
  const mA0 = await capabilityMatrix(db, A_USERS)

  assert.equal(await can(U.managerB, 'tyre_records'), true, 'built-in role inherits the platform default')
  // a tenant B role that shares its NAME with a Company A custom role inherits nothing
  assert.equal(await can(U.supervisorB, 'tyre_records'), false)
  assert.equal(await can(U.supervisorA, 'tyre_records'), true)
  assert.deepEqual(await asClient(db, U.supervisorB, () => val(db, `select public.get_user_module_permissions()`)), {})
  assert.deepEqual(await asClient(db, U.supervisorA, () => val(db, `select public.get_user_module_permissions()`)),
    { tyre_records: true, scheduled_reports: true })

  const n = await asClient(db, U.adminB, () => val(db, `select public.set_org_module_permissions(
    '[{"role":"Manager","module_key":"tyre_records","enabled":false},
      {"role":"Fleet Supervisor","module_key":"tyre_records","enabled":true},
      {"role":"Admin","module_key":"tyre_records","enabled":false}]'::jsonb, 'tenant B matrix')`))
  assert.equal(n, 3)
  assert.equal(await can(U.managerB, 'tyre_records'), false)
  assert.equal(await can(U.supervisorB, 'tyre_records'), true)
  assert.equal(await can(U.adminB, 'tyre_records'), true, 'the Admin role cannot be stripped')
  assert.equal((await asClient(db, U.managerB, () => val(db, `select public.get_user_module_permissions()`))).tyre_records, false)

  assert.equal(await globalHash(), h0, 'no global row was written')
  assert.equal(await capabilityMatrix(db, A_USERS), mA0, 'Company A matrix unchanged')
  assert.equal(await val(db, `select count(*)::int from public.module_permissions where org_id = '${ORG_A}'`), 0)

  await assert.rejects(asClient(db, U.managerB, () =>
    db.query(`select public.set_org_module_permissions('[{"role":"Manager","module_key":"x","enabled":true}]'::jsonb)`)), /Only an Admin/)
  await assert.rejects(asClient(db, U.adminB, () =>
    db.query(`select public.set_org_module_permissions('[{"role":"Workshop Lead","module_key":"x","enabled":true}]'::jsonb)`)), /Unknown role/)
  await db.close()
})

test('per-tenant module switch (TEN-6 override) for B leaves Company A entitled', async () => {
  const db = await createDb(['ten6', 'ten7'])
  await db.exec(`update public.system_config set value = 'on' where key = 'entitlement_enforcement'`)
  await asClient(db, U.superadmin, () => db.query(`select public.set_org_module_override('${ORG_B}', 'fleet_master', 'off', 'tenant B switch')`))
  assert.equal(await asClient(db, U.managerB, () => val(db, `select public.app_user_can('fleet_master', 'view')`)), false)
  assert.equal(await asClient(db, U.adminA, () => val(db, `select public.app_user_can('fleet_master', 'view')`)), true)
  assert.equal(await asClient(db, U.managerA, () => val(db, `select public.org_entitled('fleet_master')`)), true)
  await db.close()
})

test('custom role names are per organisation; tenant settings do not borrow Company A values', async () => {
  const db = await createDb(['ten6', 'ten7'])
  await db.exec(`insert into public.custom_roles(organisation_id, name) values ('${ORG_A}', 'Insurance Officer')`)
  await db.exec(`update public.profiles set role = 'Insurance Officer' where id in ('${U.reporterA}', '${U.managerB}')`)
  assert.equal(await val(db, `select role from public.profiles where id = '${U.reporterA}'`), 'Insurance Officer')
  assert.equal(await val(db, `select role from public.profiles where id = '${U.managerB}'`), 'Reporter',
    'tenant B cannot take a role only Company A defines')

  const cfg = (uid, k) => asClient(db, uid, () => val(db, `select public.org_config('${k}')`))
  assert.equal(await cfg(U.managerA, 'accident_email_to'), 'fleet@example.test')
  assert.equal(await cfg(U.tyremanA, 'accident_email_to'), null, 'read level elevated is kept')
  assert.equal(await cfg(U.adminA, 'company_logo'), 'logo-a.png')
  assert.equal(await cfg(U.adminB, 'accident_email_to'), null, 'tenant B does not read the Company A mailbox')
  assert.equal(await cfg(U.adminB, 'company_logo'), null)
  await asClient(db, U.adminB, () => db.query(`select public.set_org_config('company_logo', 'logo-b.png')`))
  assert.equal(await cfg(U.adminB, 'company_logo'), 'logo-b.png')
  assert.equal(await cfg(U.adminA, 'company_logo'), 'logo-a.png')
  assert.equal(await val(db, `select value from public.system_config where key = 'company_logo'`), 'logo-a.png')
  await assert.rejects(asClient(db, U.managerB, () => db.query(`select public.set_org_config('company_logo', 'x')`)), /Only an Admin/)
  await assert.rejects(asClient(db, U.adminB, () => db.query(`select public.set_org_config('maintenance_mode', 'true')`)), /Not a tenant setting/)
  assert.equal(await val(db, `select public.system_config_read_level('legacy_config_org')`), 'super')
  await db.close()
})

test('grants and guard', async () => {
  const db = await createDb(['ten6', 'ten7'])
  const priv = (role, fn) => val(db, `select has_function_privilege('${role}', '${fn}', 'execute')`)
  for (const fn of ['public._legacy_config_org()', 'public._org_inherits_legacy_config(uuid)', 'public._global_matrix_applies(uuid,text)', 'public._unscoped_row_org()']) {
    assert.equal(await priv('authenticated', fn), false, fn)
    assert.equal(await priv('anon', fn), false, fn)
  }
  for (const fn of ['public.set_org_module_permissions(jsonb,text)', 'public.org_config(text)', 'public.set_org_config(text,text)']) {
    assert.equal(await priv('authenticated', fn), true, fn)
    assert.equal(await priv('anon', fn), false, fn)
  }
  await db.close()

  const drift = await createBaselineDb({ mutateBaseline: s => s.replace('from public.site_aliases a where a.alias = new.site;', 'from public.site_aliases a where a.alias =  new.site;') })
  await applyDraft(drift, 'ten6')
  await assert.rejects(applyDraft(drift, 'ten7'), /anchor found 0 time/)
  assert.equal(await val(drift, `select to_regclass('public.org_alias_overrides') is null`), true, 'aborted as a whole')
  assert.equal(await val(drift, `select count(*)::int from public.system_config where key = 'legacy_config_org'`), 0)
  await drift.close()
})
