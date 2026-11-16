import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createBaselineDb, createDb, applyDraft, asClient, capabilityMatrix, val, one,
  ORG_A, ORG_B, U,
} from './fixtures/tenant_saas_harness.mjs'

// TEN-9: tenant lifecycle (pending draft 20261113113000 on top of TEN-6, TEN-7, TEN-8).
// app_is_active and handle_new_user are verbatim live bodies (the latter as patched by TEN-8).

const ALL = ['ten6', 'ten7', 'ten8', 'ten9']
const uid = n => `00000000-0000-0000-0000-0000000008${String(n).padStart(2, '0')}`
const signUp = (db, n, email, meta = {}) =>
  db.exec(`insert into auth.users(id, email, raw_user_meta_data) values ('${uid(n)}', '${email}', '${JSON.stringify(meta)}'::jsonb)`)
const profile = (db, n) => one(db, `select org_id, role, approved from public.profiles where id = '${uid(n)}'`)
const provision = (db, as, name = 'Acme Readymix', email = 'owner@acme.test', plan = 'trial') =>
  asClient(db, as, () => val(db, `select public.admin_provision_organisation('${name}', '${email}', '${plan}', 14, 'UAE', 'new customer')`))
const companyAUsers = db => val(db, `select count(*)::int from public.profiles where org_id = '${ORG_A}'`)

test('provisioning: super admin only, organisation + subscription + owner invitation in one transaction', async () => {
  const db = await createDb(ALL)
  for (const u of [U.adminA, U.managerA, U.adminB]) {
    await assert.rejects(provision(db, u), /Only a super admin/)
  }
  assert.equal(await val(db, `select has_function_privilege('anon', 'public.admin_provision_organisation(text,text,text,int,text,text)', 'execute')`), false)

  const orgs0 = await val(db, `select count(*)::int from public.organisations`)
  // atomic: an unknown plan leaves nothing behind
  await assert.rejects(provision(db, U.superadmin, 'Ghost Co', 'g@ghost.test', 'platinum'), /Unknown or inactive plan/)
  assert.equal(await val(db, `select count(*)::int from public.organisations`), orgs0)

  const r = await provision(db, U.superadmin)
  assert.equal(r.ok, true)
  assert.equal(r.status, 'trialing')
  assert.ok(r.invite_token.length >= 32)
  const org = await one(db, `select name, locked, active, primary_country from public.organisations where id = '${r.organisation_id}'`)
  assert.deepEqual(org, { name: 'Acme Readymix', locked: false, active: true, primary_country: 'UAE' })
  const sub = await one(db, `select plan_code, status, trial_ends_at > now() + interval '13 days' as has_end from public.org_subscriptions where organisation_id = '${r.organisation_id}'`)
  assert.deepEqual(sub, { plan_code: 'trial', status: 'trialing', has_end: true }, 'a real trial with an end date, not an endless one')
  const inv = await one(db, `select role, is_owner, email, token_hash <> '${r.invite_token}' as hashed from public.org_invitations where organisation_id = '${r.organisation_id}'`)
  assert.deepEqual(inv, { role: 'Admin', is_owner: true, email: 'owner@acme.test', hashed: true })
  assert.equal(await val(db, `select count(*)::int from public.console_sessions where action = 'provision_org'`), 1)
  // with entitlement enforcement on, the new tenant is in good standing from the first minute
  await db.exec(`update public.system_config set value = 'on' where key = 'entitlement_enforcement'`)
  assert.equal(await val(db, `select public._org_standing('${r.organisation_id}')`), 'ok')
  await db.close()
})

test('invitation: the owner lands in the new organisation only; Company A is never the fallback for a token', async () => {
  for (const mode of ['true', 'false']) {
    const db = await createDb(ALL)
    await db.exec(`update public.system_config set value = '${mode}' where key = 'single_tenant_mode'`)
    const a0 = await companyAUsers(db)
    const r = await provision(db, U.superadmin)

    await signUp(db, 1, 'owner@acme.test', { username: 'acme_owner', invite_token: r.invite_token })
    assert.deepEqual(await profile(db, 1), { org_id: r.organisation_id, role: 'Admin', approved: true }, `mode ${mode}`)
    assert.equal(await asClient(db, uid(1), () => val(db, `select public.app_current_org()`)), r.organisation_id)
    assert.equal(await asClient(db, uid(1), () => val(db, `select count(*)::int from public.vehicle_fleet`)), 0, 'an empty app, none of Company A')

    // single use
    await signUp(db, 2, 'owner@acme.test', { username: 'acme_owner2', invite_token: r.invite_token })
    assert.deepEqual(await profile(db, 2), { org_id: null, role: 'Reporter', approved: false }, 'a used token gives no organisation')
    // wrong e-mail, garbage token
    const r2 = await provision(db, U.superadmin, 'Beta Mix', 'boss@beta.test')
    await signUp(db, 3, 'intruder@evil.test', { username: 'intruder', invite_token: r2.invite_token })
    assert.equal((await profile(db, 3)).org_id, null)
    await signUp(db, 4, 'x@y.test', { username: 'garbage', invite_token: 'not-a-token' })
    assert.equal((await profile(db, 4)).org_id, null)
    // expired
    await db.exec(`update public.org_invitations set expires_at = now() - interval '1 minute' where organisation_id = '${r2.organisation_id}'`)
    await signUp(db, 5, 'boss@beta.test', { username: 'late_boss', invite_token: r2.invite_token })
    assert.equal((await profile(db, 5)).org_id, null)

    assert.equal(await companyAUsers(db), a0, `no token sign-up reached Company A (mode ${mode})`)
    // a sign-up with NO token still behaves as TEN-8 defines for the mode
    await signUp(db, 6, 'plain@example.test', { username: 'plain' })
    assert.equal((await profile(db, 6)).org_id, mode === 'true' ? ORG_A : null)
    await db.close()
  }
})

test('members: a tenant Admin invites into its own organisation only', async () => {
  const db = await createDb(ALL)
  await db.exec(`update public.system_config set value = 'false' where key = 'single_tenant_mode'`)
  await assert.rejects(asClient(db, U.managerB, () => db.query(`select public.org_invite_member('x@b.test', 'Reporter')`)), /Only an Admin/)
  await assert.rejects(asClient(db, U.adminB, () => db.query(`select public.org_invite_member('x@b.test', 'Insurance Officer')`)), /Unknown role/)
  const inv = await asClient(db, U.adminB, () => val(db, `select public.org_invite_member('driver@b.test', 'Driver')`))
  const open = await asClient(db, U.adminB, () => val(db, `select public.org_invite_member(null, 'Tyre Man')`))
  await signUp(db, 11, 'driver@b.test', { username: 'b_driver', invite_token: inv.invite_token })
  await signUp(db, 12, 'b_tyre@users.tyrepulse.app', { username: 'b_tyre', invite_token: open.invite_token })
  assert.deepEqual(await profile(db, 11), { org_id: ORG_B, role: 'Driver', approved: true })
  assert.deepEqual(await profile(db, 12), { org_id: ORG_B, role: 'Tyre Man', approved: true })

  // isolation of the invitation table; the token hash is not selectable
  assert.equal(await asClient(db, U.adminA, () => val(db, `select count(*)::int from public.org_invitations`)), 0)
  assert.equal(await asClient(db, U.adminB, () => val(db, `select count(*)::int from public.org_invitations`)), 2)
  assert.equal(await asClient(db, U.managerB, () => val(db, `select count(*)::int from public.org_invitations`)), 0)
  await assert.rejects(asClient(db, U.adminB, () => db.query(`select token_hash from public.org_invitations`)), /permission denied/)
  await assert.rejects(asClient(db, U.adminB, () =>
    db.exec(`insert into public.org_invitations(organisation_id, role, token_hash, expires_at) values ('${ORG_A}', 'Admin', 'x', now() + interval '1 day')`)),
  /permission denied|row-level security/)

  // revoke: own organisation only
  const inv2 = await asClient(db, U.adminB, () => val(db, `select public.org_invite_member('late@b.test', 'Reporter')`))
  assert.equal((await asClient(db, U.adminA, () => val(db, `select public.org_revoke_invitation('${inv2.invitation_id}')`))).ok, false)
  assert.equal((await asClient(db, U.adminB, () => val(db, `select public.org_revoke_invitation('${inv2.invitation_id}')`))).ok, true)
  await signUp(db, 13, 'late@b.test', { username: 'late', invite_token: inv2.invite_token })
  assert.equal((await profile(db, 13)).org_id, null)
  await db.close()
})

test('suspension is enforced: a locked or inactive organisation reads and writes nothing; Company A is unaffected', async () => {
  const base = await createBaselineDb()
  const matrixBefore = await capabilityMatrix(base, { admin: U.adminA, manager: U.managerA, tyreman: U.tyremanA })
  await base.close()

  const db = await createDb(ALL)
  assert.equal(await capabilityMatrix(db, { admin: U.adminA, manager: U.managerA, tyreman: U.tyremanA }), matrixBefore)
  await db.exec(`insert into public.vehicle_fleet(organisation_id, country, asset_no) values ('${ORG_A}', 'KSA', 'A1'), ('${ORG_B}', 'KSA', 'B1')`)
  const reads = uid_ => asClient(db, uid_, () => val(db, `select count(*)::int from public.vehicle_fleet`))
  assert.equal(await reads(U.managerB), 1)
  assert.equal(await reads(U.managerA), 1)

  await db.exec(`update public.organisations set locked = true where id = '${ORG_B}'`)
  assert.equal(await asClient(db, U.managerB, () => val(db, `select public.app_is_active()`)), false)
  assert.equal(await reads(U.managerB), 0)
  assert.equal(await reads(U.adminB), 0, 'the customer Admin is locked out too')
  await assert.rejects(asClient(db, U.adminB, () =>
    db.exec(`insert into public.vehicle_fleet(country, asset_no) values ('KSA', 'B2')`)), /row-level security/)
  assert.equal(await reads(U.managerA), 1, 'Company A unaffected')
  assert.equal(await asClient(db, U.managerA, () => val(db, `select public.app_is_active()`)), true)

  await db.exec(`update public.organisations set locked = false, active = false where id = '${ORG_B}'`)
  assert.equal(await reads(U.managerB), 0, 'inactive is enforced as well')
  await db.exec(`update public.organisations set active = true where id = '${ORG_B}'`)
  assert.equal(await reads(U.managerB), 1, 'unlock restores access at once')

  // a super admin is not locked out by the state of its own organisation
  await db.exec(`update public.organisations set locked = true where id = '${ORG_A}'`)
  assert.equal(await asClient(db, U.superadmin, () => val(db, `select public.app_is_active()`)), true)
  assert.equal(await reads(U.managerA), 0)
  await db.close()
})

test('apply guard: the migration refuses to start while an organisation with members is locked', async () => {
  const db = await createDb(['ten6', 'ten7', 'ten8'])
  await db.exec(`update public.organisations set locked = true where id = '${ORG_B}'`)
  await assert.rejects(applyDraft(db, 'ten9'), /have members and are locked or inactive/)
  assert.equal(await val(db, `select to_regclass('public.org_invitations') is null`), true)
  assert.doesNotMatch(await val(db, `select pg_get_functiondef('public.app_is_active()'::regprocedure)`), /_org_active/)
  await db.close()
})

test('purge draft: dry run by default, never Company A, real run only when locked and confirmed, tenant A rows intact', async () => {
  const db = await createDb(ALL)
  await db.exec(`
    insert into public.vehicle_fleet(organisation_id, country, asset_no) values ('${ORG_A}', 'KSA', 'A1'), ('${ORG_A}', 'KSA', 'A2'), ('${ORG_B}', 'KSA', 'B1');
    insert into public.tyre_records(organisation_id, country, serial_no) values ('${ORG_A}', 'KSA', 'SA'), ('${ORG_B}', 'KSA', 'SB1'), ('${ORG_B}', 'KSA', 'SB2');
    insert into public.module_permissions(module_key, role, org_id, enabled) values ('tyre_records', 'Manager', '${ORG_B}', false);
    insert into public.org_alias_overrides(organisation_id, kind, alias, canonical) values ('${ORG_B}', 'site', 'X', 'Y');`)
  const snapshotA = () => val(db, `select (select count(*) from public.vehicle_fleet where organisation_id = '${ORG_A}') || '/' ||
    (select count(*) from public.tyre_records where organisation_id = '${ORG_A}') || '/' ||
    (select count(*) from public.profiles where org_id = '${ORG_A}') || '/' ||
    (select count(*) from public.org_subscriptions where organisation_id = '${ORG_A}') || '/' ||
    (select count(*) from public.module_permissions where org_id is null)`)
  const a0 = await snapshotA()
  const fn = 'public.admin_purge_organisation(uuid,boolean,text,text)'
  assert.equal(await val(db, `select has_function_privilege('authenticated', '${fn}', 'execute')`), false)
  assert.equal(await val(db, `select has_function_privilege('anon', '${fn}', 'execute')`), false)
  await assert.rejects(asClient(db, U.superadmin, () => db.query(`select public.admin_purge_organisation('${ORG_B}')`)), /permission denied/)

  // default = dry run: counts only
  const dry = await val(db, `select public.admin_purge_organisation('${ORG_B}')`)
  assert.equal(dry.dry_run, true)
  assert.equal(dry.rows.vehicle_fleet, 1)
  assert.equal(dry.rows.tyre_records, 2)
  assert.equal(dry.rows.module_permissions, 1)
  assert.equal(dry.members, 3)
  assert.equal(await val(db, `select count(*)::int from public.tyre_records where organisation_id = '${ORG_B}'`), 2, 'dry run removed nothing')

  // Company A is refused even for a real, confirmed call
  await db.exec(`update public.organisations set locked = true where id = '${ORG_A}'`)
  const refusedA = await val(db, `select public.admin_purge_organisation('${ORG_A}', false, 'company-a', 'test')`)
  assert.deepEqual(refusedA, { ok: false, reason: 'legacy_organisation_is_never_purged' })
  await db.exec(`update public.organisations set locked = false where id = '${ORG_A}'`)

  // real run guards
  assert.equal((await val(db, `select public.admin_purge_organisation('${ORG_B}', false, 'tenant-b', 'offboard')`)).reason, 'organisation_must_be_locked_first')
  await db.exec(`update public.organisations set locked = true where id = '${ORG_B}'`)
  assert.equal((await val(db, `select public.admin_purge_organisation('${ORG_B}', false, 'wrong', 'offboard')`)).reason, 'confirmation_does_not_match_slug')
  assert.equal((await val(db, `select public.admin_purge_organisation('${ORG_B}', false, 'tenant-b', '')`)).reason, 'reason_required')
  assert.equal(await val(db, `select count(*)::int from public.tyre_records where organisation_id = '${ORG_B}'`), 2)

  const done = await val(db, `select public.admin_purge_organisation('${ORG_B}', false, 'tenant-b', 'customer off-boarded')`)
  assert.equal(done.ok, true)
  assert.equal(done.deleted.tyre_records, 2)
  assert.deepEqual(done.remaining, {}, 'no row carrying the tenant id is left in any organisation-scoped table')
  assert.equal(done.members_remaining, 3, 'member accounts are reported, not removed')
  assert.equal(await val(db, `select count(*)::int from public.vehicle_fleet where organisation_id = '${ORG_B}'`), 0)
  assert.equal(await snapshotA(), a0, 'Company A rows, members, subscription and the global matrix are intact')
  assert.equal(await val(db, `select count(*)::int from public.console_sessions where action = 'purge_org'`), 1)
  await db.close()
})

test('per-organisation identity indexes exist; the global keys are still in force (documented limit)', async () => {
  const db = await createDb(ALL)
  assert.equal(await val(db, `select count(*)::int from pg_indexes where indexname in ('profiles_org_username_lower_uidx', 'profiles_org_employee_id_lower_uidx')`), 2)
  await db.exec(`update public.system_config set value = 'false' where key = 'single_tenant_mode'`)
  const inv = await asClient(db, U.adminB, () => val(db, `select public.org_invite_member(null, 'Reporter')`))
  // 'mgr_a' is a Company A username: the tenant B sign-up is refused, it does not land in Company A
  const a0 = await companyAUsers(db)
  await assert.rejects(signUp(db, 21, 'dupe@b.test', { username: 'MGR_A', invite_token: inv.invite_token }), /duplicate key/)
  assert.equal(await companyAUsers(db), a0)
  await db.close()
})
