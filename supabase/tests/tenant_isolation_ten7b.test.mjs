// TEN-7b: the accident mailbox keys in the global system_config table must not be readable by
// another organisation. Pending draft 20261113115000 on top of TEN-6 and TEN-7. The select policies
// below are the LIVE expressions (pg_policies, read 2026-11-12).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createDb, asClient, val, U } from './fixtures/tenant_saas_harness.mjs'

const FILE = '20261113115000_ten7b_accident_mailbox_keys_legacy_org_only.sql'
const sql = readFileSync(new URL(`../pending_migrations/${FILE}`, import.meta.url), 'utf8')
const apply = async db => {
  try { await db.exec(`begin;\n${sql}\ncommit;`) } catch (e) { await db.exec('rollback').catch(() => {}); throw e }
}
const LIVE_POLICIES = `
  insert into public.system_config(key, value) values
    ('accident_email_cc', 'safety@example.test'), ('accident_email_subject_prefix', '[A]'), ('support_email', 'help@example.test');
  alter table public.system_config enable row level security;
  create policy system_config_read on public.system_config for select to public using (
    ((select public.app_is_active()) is true) and ((public.system_config_read_level(key) = 'all')
      or ((public.system_config_read_level(key) = 'elevated') and ((select public.app_is_elevated()) is true))
      or ((select public.is_super_admin()) is true)));
  create policy sc_read_authenticated on public.system_config for select to public using (
    ((select public.app_is_active()) is true) and ((public.system_config_read_level(key) = 'all')
      or ((public.system_config_read_level(key) = 'elevated') and ((select public.app_is_elevated()) is true))
      or ((select public.is_super_admin()) is true)));
  create policy sc_super_admin_all on public.system_config for all to public using (
    exists (select 1 from public.profiles where profiles.id = (select auth.uid()) and profiles.is_super_admin = true));`
const MAIL = `key in ('accident_email_to','accident_email_cc','accident_email_subject_prefix')`
const mailKeys = (db, uid) => asClient(db, uid, () => val(db, `select count(*)::int from public.system_config where ${MAIL}`))
const otherKeys = (db, uid) => asClient(db, uid, () =>
  val(db, `select coalesce(string_agg(key || '=' || coalesce(value, ''), ',' order by key), '') from public.system_config where not (${MAIL})`))
const setup = async () => { const db = await createDb(['ten6', 'ten7']); await db.exec(LIVE_POLICIES); return db }
const EVERYONE = [U.superadmin, U.adminA, U.managerA, U.tyremanA, U.reporterA, U.adminB, U.managerB, U.supervisorB, U.adminC]

test('TEN-7b BEFORE: an elevated user of tenant B reads the Company A accident mailbox keys', async () => {
  const db = await setup()
  assert.equal(await mailKeys(db, U.managerB), 3)
  assert.equal(await mailKeys(db, U.adminC), 3)
  assert.equal(await asClient(db, U.managerB, () => val(db, `select value from public.system_config where key = 'accident_email_to'`)), 'fleet@example.test')
  await db.close()
})

test('TEN-7b AFTER: mailbox keys are hidden from other organisations; Company A and every other key unchanged', async () => {
  const db = await setup()
  const before = {}
  for (const u of EVERYONE) before[u] = [await mailKeys(db, u), await otherKeys(db, u)]
  await apply(db)
  await apply(db) // idempotent
  const pol = (await db.query(`select permissive, cmd from pg_policies where tablename = 'system_config' and policyname = 'system_config_mailbox_keys_legacy_org'`)).rows
  assert.deepEqual(pol, [{ permissive: 'RESTRICTIVE', cmd: 'SELECT' }])
  assert.deepEqual((await db.query(`select has_function_privilege('authenticated', 'public.system_config_caller_in_legacy_org()', 'EXECUTE') a,
    has_function_privilege('anon', 'public.system_config_caller_in_legacy_org()', 'EXECUTE') n`)).rows[0], { a: true, n: false })

  // Other organisations: no mailbox key, by any role.
  for (const u of [U.adminB, U.managerB, U.supervisorB, U.adminC]) assert.equal(await mailKeys(db, u), 0, u)
  // Company A (the legacy config organisation) and the super admin: exactly as before.
  for (const u of [U.superadmin, U.adminA, U.managerA]) assert.equal(await mailKeys(db, u), 3, u)
  for (const u of [U.tyremanA, U.reporterA]) assert.equal(await mailKeys(db, u), 0, 'read level elevated is kept inside Company A')
  for (const u of [U.superadmin, U.adminA, U.managerA, U.tyremanA, U.reporterA]) {
    assert.deepEqual([await mailKeys(db, u), await otherKeys(db, u)], before[u], `Company A user ${u} reads what it read before`)
  }
  // Every key that is not a mailbox key is untouched for everyone, tenant B included.
  for (const u of EVERYONE) assert.equal(await otherKeys(db, u), before[u][1], `other keys for ${u}`)
  assert.match(before[U.managerB][1], /support_email=help@example.test/, 'the control key really is visible to tenant B')

  // The existing writers and definer readers keep working.
  assert.equal(await asClient(db, U.superadmin, () => val(db,
    `with w as (update public.system_config set value = 'fleet2@example.test' where key = 'accident_email_to' returning 1) select count(*)::int from w`)), 1)
  assert.equal(await asClient(db, U.managerA, () => val(db, `select public.org_config('accident_email_to')`)), 'fleet2@example.test')
  assert.equal(await asClient(db, U.adminB, () => val(db, `select public.org_config('accident_email_to')`)), null)
  assert.equal(await asClient(db, U.managerB, () => val(db,
    `with w as (update public.system_config set value = 'x' where key = 'accident_email_to' returning 1) select count(*)::int from w`)), 0)
  assert.equal(await val(db, `select value from public.system_config where key = 'accident_email_to'`), 'fleet2@example.test')
  await db.close()
})

test('TEN-7b ROLLBACK statement restores the shared read', async () => {
  const db = await setup()
  await apply(db)
  await db.exec(`alter policy system_config_mailbox_keys_legacy_org on public.system_config using (true)`)
  assert.equal(await mailKeys(db, U.managerB), 3)
  await db.close()
})

test('TEN-7b migration aborts without TEN-7, with row security off, or with no legacy organisation', async () => {
  const bare = await createDb()
  await bare.exec(LIVE_POLICIES)
  await assert.rejects(apply(bare), /TEN-7b aborted: public\._legacy_config_org\(\) is missing/)
  await bare.close()
  const off = await createDb(['ten6', 'ten7'])
  await assert.rejects(apply(off), /TEN-7b aborted: row level security is off/)
  await off.close()
  const gone = await setup()
  await gone.exec(`update public.system_config set value = '' where key = 'legacy_config_org'`)
  await assert.rejects(apply(gone), /TEN-7b aborted: system_config\.legacy_config_org does not name/)
  assert.equal(await val(gone, `select count(*)::int from pg_policies where policyname = 'system_config_mailbox_keys_legacy_org'`), 0)
  assert.equal(await val(gone, `select count(*)::int from pg_proc where proname = 'system_config_caller_in_legacy_org'`), 0)
  await gone.close()
})
