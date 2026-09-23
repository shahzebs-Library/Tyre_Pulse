import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { prepareRecords, externalPath } from '../../scripts/provision-driver-accounts.mjs'

const sql = await readFile(new URL('../migrations/20260912112256_approved_driver_account_provisioning.sql', import.meta.url), 'utf8')
const auditFix = await readFile(new URL('../migrations/20260912112751_fix_driver_provisioning_audit_action.sql', import.meta.url), 'utf8')
const authFix = await readFile(new URL('../migrations/20260912112847_driver_import_private_auth_verification.sql', import.meta.url), 'utf8')
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
test('import refuses duplicate identities, replacement passwords and repository credential paths', () => {
  const row = { 'Employee ID': '90001', Name: 'Fixture driver', Position: 'DCO - Concrete Pump Driver / Operator', Password: 'FixtureOnly!12345', 'Proposed Country': 'KSA' }
  assert.equal(prepareRecords([row])[0].employeeId, '90001')
  assert.throws(() => prepareRecords([row, row]), /repeated identity/)
  assert.throws(() => prepareRecords([{ ...row, 'Existing Username': 'keep_me' }]), /replacement password/)
  assert.throws(() => prepareRecords([{ ...row, 'Proposed Country': 'Other' }]), /approved KSA/)
  assert.throws(() => externalPath(fileURLToPath(new URL('../../credentials.xlsx', import.meta.url))), /outside the repository/)
})

test('provisioning preserves old profiles, limits new-account approval and links idempotently', async t => {
  const db = new PGlite()
  try {
    await db.exec(`
      CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_app_meta_data jsonb);
      CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text,approved boolean,locked boolean,
        org_id uuid,organisation_id uuid,employee_id text,username text,full_name text,
        country text[],countries text[],region text,site text,sites text[]);
      CREATE TABLE public.drivers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),driver_id text,driver_name text,
        country text,organisation_id uuid,created_by uuid,custom_data jsonb);
      CREATE TABLE public.audit_log(table_name text,record_id uuid,action text CHECK(action IN ('INSERT','UPDATE','DELETE')),changed_by uuid,user_id uuid,organisation_id uuid,details jsonb);
      INSERT INTO profiles(id,role,approved,locked,org_id,organisation_id,employee_id,username,country)
      VALUES('${id(1)}','Admin',true,false,'${id(9)}','${id(9)}','90000','admin',ARRAY['KSA']),
        ('${id(2)}','Reporter',false,false,'${id(9)}','${id(9)}','90001','90001',ARRAY['KSA']),
        ('${id(3)}','Reporter',true,false,'${id(9)}','${id(9)}','90002','existing_username',ARRAY['KSA']),
        ('${id(4)}','Admin',true,false,'${id(8)}','${id(8)}','90003','other_admin',ARRAY['KSA']);
      INSERT INTO auth.users VALUES('${id(2)}','{"driver_import_batch":"fixture-batch"}'),('${id(3)}','{}');
      ${sql}
      ${auditFix}
      ${authFix}
      GRANT ALL ON profiles,drivers,audit_log TO service_role;
    `)
    const provision = (overrides = {}) => {
      const p = { user: id(2), actor: id(1), org: id(9), emp: '90001', name: 'Fixture driver', country: 'KSA', position: 'Concrete Pump Driver / Operator', iqama: null, batch: 'fixture-batch', preserve: false, ...overrides }
      return db.query('select public.provision_approved_driver_account($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result', Object.values(p))
    }
    await t.test('anonymous and normal authenticated callers cannot provision users', async () => {
      await db.exec('SET ROLE authenticated')
      await assert.rejects(provision(), e => e.code === '42501')
      await db.exec('RESET ROLE; SET ROLE anon')
      await assert.rejects(provision(), e => e.code === '42501')
      await db.exec('RESET ROLE; SET ROLE service_role')
    })
    await t.test('rejects foreign administrators and unmarked existing users', async () => {
      await assert.rejects(provision({ actor: id(4) }), e => e.code === '42501')
      await assert.rejects(provision({ batch: 'wrong-batch' }), e => e.code === '42501')
      await assert.rejects(provision({ user: id(3), emp: '90002' }), e => e.code === '42501')
      assert.equal((await db.query('select count(*)::int n from drivers')).rows[0].n, 0)
    })
    await t.test('new users get Driver access, KSA and no fabricated site or broad site permission', async () => {
      const r = (await provision()).rows[0].result
      assert.equal(r.workspace_linked, false)
      const p = (await db.query('select * from profiles where id=$1', [id(2)])).rows[0]
      assert.equal(p.role, 'Driver'); assert.equal(p.approved, true); assert.deepEqual(p.sites, []); assert.equal(p.site, null)
      const d = (await db.query('select * from drivers')).rows[0]
      assert.equal(d.custom_data.position, 'Concrete Pump Driver / Operator'); assert.equal(d.custom_data.employee_iqama, null)
      await provision()
      assert.equal((await db.query('select count(*)::int n from drivers')).rows[0].n, 1)
      assert.equal((await db.query('select count(*)::int n from audit_log')).rows[0].n, 1)
    })
    await t.test('existing account stays byte-for-byte unchanged', async () => {
      const before = (await db.query('select * from profiles where id=$1', [id(3)])).rows[0]
      await provision({ user: id(3), emp: '90002', preserve: true })
      assert.deepEqual((await db.query('select * from profiles where id=$1', [id(3)])).rows[0], before)
    })
    await t.test('resuming after workspace rollout links once and refuses conflicting ownership', async () => {
      await db.exec('RESET ROLE; CREATE TABLE driver_account_links(driver_id uuid PRIMARY KEY,user_id uuid UNIQUE,organisation_id uuid,linked_by uuid); GRANT ALL ON driver_account_links TO service_role; SET ROLE service_role')
      const r = (await provision()).rows[0].result
      assert.equal(r.workspace_linked, true)
      await provision()
      assert.equal((await db.query('select count(*)::int n from driver_account_links')).rows[0].n, 1)
      await db.query('update driver_account_links set user_id=$1', [id(3)])
      await assert.rejects(provision(), e => e.code === '23505')
    })
  } finally { await db.close() }
})
