import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// PGlite harness for supabase/migrations/20261011150000_workshop_status_security_hardening.sql
// (loop 17). The migration only replaces workshop_status_can(), so its
// dependencies are stubbed from session settings:
//   test.active / test.super / test.view / test.can / test.sites
// test.sites mirrors profiles.sites: 'ALL' (or empty) = sees every site,
// anything else = a narrowed site scope.

const HARDENING = readFileSync(
  new URL('../migrations/20261011150000_workshop_status_security_hardening.sql', import.meta.url), 'utf8')
const PERMISSIONS = readFileSync(
  new URL('../migrations/20261007100000_workshop_status_permissions.sql', import.meta.url), 'utf8')

const ACTIONS = ['view', 'view_removed', 'view_uploads', 'view_activity', 'view_reports', 'view_audit',
  'update', 'upload', 'confirm', 'assign', 'disposition', 'export', 'archive', 'restore',
  'soft_delete', 'configure', 'permanent_delete']

const db = new PGlite()

async function as (settings, fn) {
  const keys = Object.keys(settings)
  for (const k of keys) await db.query('select set_config($1, $2, false)', [`test.${k}`, String(settings[k])])
  try { return await fn() } finally {
    for (const k of keys) await db.query('select set_config($1, $2, false)', [`test.${k}`, ''])
  }
}
const can = async action => (await db.query('select public.workshop_status_can($1) ok', [action])).rows[0].ok
const allowed = async () => {
  const out = []
  for (const a of ACTIONS) if (await can(a)) out.push(a)
  return out
}

before(async () => {
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create function public.app_is_active() returns boolean language sql stable as $$
      select coalesce(nullif(current_setting('test.active', true), ''), 'true') = 'true' $$;
    create function public.is_super_admin() returns boolean language sql stable as $$
      select coalesce(nullif(current_setting('test.super', true), ''), 'false') = 'true' $$;
    create function public.workshop_status_can_view() returns boolean language sql stable as $$
      select coalesce(nullif(current_setting('test.view', true), ''), 'true') = 'true' $$;
    create function public.app_user_can(p_key text, p_cap text) returns boolean language sql stable as $$
      select coalesce(nullif(current_setting('test.can', true), ''), 'true') = 'true' $$;
    create function public.app_sees_all_sites() returns boolean language sql stable as $$
      select upper(coalesce(nullif(current_setting('test.sites', true), ''), 'ALL')) in ('ALL', '*') $$;
  `)
  await db.exec(HARDENING)
})

after(async () => { await db.close() })

test('1. migration has no destructive statement and is re-runnable', async () => {
  const code = HARDENING.replace(/--[^\n]*/g, '')
  assert.doesNotMatch(code, /\b(drop|delete|truncate)\b/i)
  await db.exec(HARDENING)
})

test('2. a user who sees every site keeps exactly the pre-loop-17 behaviour', async () => {
  await as({ sites: 'ALL' }, async () => {
    // Every grantable action except the super-only one.
    assert.deepEqual(await allowed(), ACTIONS.filter(a => a !== 'permanent_delete'))
  })
})

test('3. a site-restricted user loses upload and confirm, nothing else', async () => {
  await as({ sites: 'NHC' }, async () => {
    assert.equal(await can('upload'), false)
    assert.equal(await can('confirm'), false)
    assert.deepEqual(await allowed(),
      ACTIONS.filter(a => !['upload', 'confirm', 'permanent_delete'].includes(a)))
  })
})

test('4. super admin is unaffected by site scope, including permanent_delete', async () => {
  await as({ super: 'true', sites: 'NHC' }, async () => {
    assert.deepEqual(await allowed(), ACTIONS)
  })
})

test('5. inactive sessions and unknown actions are still refused', async () => {
  await as({ active: 'false' }, async () => assert.deepEqual(await allowed(), []))
  await as({ super: 'true' }, async () => assert.equal(await can('drop_everything'), false))
})

test('6. permanent_delete stays super-admin only even with a grant', async () => {
  await as({ can: 'true', sites: 'ALL' }, async () => assert.equal(await can('permanent_delete'), false))
})

test('7. anon cannot execute; authenticated can', async () => {
  const r = (await db.query(`select
    has_function_privilege('anon', 'public.workshop_status_can(text)', 'execute') anon,
    has_function_privilege('authenticated', 'public.workshop_status_can(text)', 'execute') auth`)).rows[0]
  assert.equal(r.anon, false)
  assert.equal(r.auth, true)
})

test('8. action vocabulary did not drift from the permissions migration', () => {
  const list = sql => sql.match(/'view', 'view_removed'[\s\S]*?'permanent_delete'\]/)[0].replace(/\s+/g, ' ')
  assert.equal(list(HARDENING), list(PERMISSIONS))
})
