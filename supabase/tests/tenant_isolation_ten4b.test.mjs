// TEN-4b: get_user_module_permissions(p_user_id) must not answer for a user of another organisation.
// Pending draft 20261113114000, proven against the verbatim live body (tenant_saas_harness) both
// before and after TEN-7 has patched the same function.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createDb, asClient, val, U } from './fixtures/tenant_saas_harness.mjs'

const FILE = '20261113114000_ten4b_module_permissions_same_org.sql'
const sql = readFileSync(new URL(`../pending_migrations/${FILE}`, import.meta.url), 'utf8')
// Live ACL: authenticated and service_role may execute; anon and PUBLIC may not.
const LIVE_ACL = `revoke all on function public.get_user_module_permissions(uuid) from public;
  grant execute on function public.get_user_module_permissions(uuid) to authenticated, service_role;`
const perms = (db, caller, target) => asClient(db, caller, () =>
  val(db, target ? `select public.get_user_module_permissions('${target}')` : 'select public.get_user_module_permissions()'))
const denied = e => e.code === '42501' && e.message === 'not authorized'
const A = [U.superadmin, U.adminA, U.managerA, U.tyremanA, U.supervisorA, U.reporterA]
const ownMaps = async db => {
  const out = {}
  for (const u of [...A, U.adminB, U.managerB, U.supervisorB, U.adminC]) out[u] = await perms(db, u)
  return JSON.stringify(out)
}

for (const drafts of [[], ['ten6', 'ten7']]) {
  const label = drafts.length ? 'on top of TEN-6 and TEN-7' : 'on the live body'

  test(`TEN-4b BEFORE (${label}): a tenant B user reads the module map of a Company A user`, async () => {
    const db = await createDb(drafts)
    await db.exec(LIVE_ACL)
    const leaked = await perms(db, U.managerB, U.managerA)
    assert.ok(Object.keys(leaked).length > 0, 'the foreign map is returned')
    assert.deepEqual(leaked, await perms(db, U.managerA), 'and it is exactly the Company A user own map')
    await db.close()
  })

  test(`TEN-4b AFTER (${label}): foreign ids are refused, own organisation and super admin still answer`, async () => {
    const db = await createDb(drafts)
    await db.exec(LIVE_ACL)
    const before = await ownMaps(db)
    const crossBefore = JSON.stringify(await perms(db, U.managerA, U.tyremanA))
    await db.exec(`begin;\n${sql}\ncommit;`)
    await db.exec(`begin;\n${sql}\ncommit;`) // idempotent

    const meta = (await db.query(`select prosecdef d, proconfig::text c,
        has_function_privilege('authenticated', oid, 'EXECUTE') a, has_function_privilege('anon', oid, 'EXECUTE') n,
        (length(prosrc) - length(replace(prosrc, 'TEN-4b', ''))) / 6 hits
      from pg_proc where oid = 'public.get_user_module_permissions(uuid)'::regprocedure`)).rows[0]
    assert.deepEqual(meta, { d: true, c: '{search_path=public}', a: true, n: false, hits: 1 }, 'definer, search_path, ACL kept; patched once')

    // Refused: a foreign user, a foreign super admin, and an id that does not exist (same answer).
    for (const [caller, target] of [[U.managerB, U.managerA], [U.adminB, U.superadmin], [U.adminB, U.adminC],
      [U.managerA, U.managerB], [U.adminA, U.adminB], [U.managerB, '99999999-0000-0000-0000-000000000000']]) {
      await assert.rejects(perms(db, caller, target), denied, `${caller} -> ${target}`)
    }

    // Unchanged: every user's own map (no argument and own id), for both companies.
    assert.equal(await ownMaps(db), before, 'own maps byte-identical before and after')
    for (const u of [U.managerA, U.managerB]) assert.deepEqual(await perms(db, u, u), await perms(db, u))
    // Unchanged: a lookup inside one organisation, by any role.
    assert.equal(JSON.stringify(await perms(db, U.managerA, U.tyremanA)), crossBefore)
    assert.deepEqual(await perms(db, U.tyremanA, U.managerA), await perms(db, U.managerA))
    assert.deepEqual(await perms(db, U.managerB, U.adminB), await perms(db, U.adminB))
    // Unchanged: a super admin reads any organisation.
    assert.deepEqual(await perms(db, U.superadmin, U.managerB), await perms(db, U.managerB))
    // Unchanged: a server-side caller (no session; the harness reports the service role).
    assert.deepEqual(await val(db, `select public.get_user_module_permissions('${U.managerB}')`), await perms(db, U.managerB))
    // A request with no user and the anon or authenticated JWT role is not a server-side caller.
    for (const r of ['anon', 'authenticated']) {
      await db.exec(`create or replace function auth.role() returns text language sql stable as $$ select '${r}' $$`)
      await assert.rejects(db.query(`select public.get_user_module_permissions('${U.managerB}')`), denied, r)
    }
    await db.close()
  })
}

test('TEN-4b migration aborts when the live function no longer matches its anchor', async () => {
  const db = await createDb()
  await db.exec(`create or replace function public.get_user_module_permissions(p_user_id uuid default null) returns jsonb
    language plpgsql security definer set search_path to 'public' as $$ begin return '{}'::jsonb; end $$;`)
  await assert.rejects(db.exec(`begin;\n${sql}\ncommit;`), /TEN-4b aborted: anchor found 0/)
  await db.exec('rollback').catch(() => {})
  assert.equal(await val(db, `select position('TEN-4b' in prosrc) from pg_proc where proname = 'get_user_module_permissions'`), 0)
  await db.close()
})
