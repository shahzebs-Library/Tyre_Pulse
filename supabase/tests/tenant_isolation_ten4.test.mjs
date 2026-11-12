// TEN-4: admin_set_user_sites / admin_set_web_access must act only inside the caller's organisation.
// Both RPCs and the profile guard trigger are faithful copies of the LIVE definitions (md5 checked).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { USERS, asUser, assertLiveMd5, code, createDb, liveFunction, pendingMigration } from './fixtures/tenant_isolation_harness.mjs';

const migration = await pendingMigration('20261113103000_ten4_admin_rpcs_same_org.sql');

async function setup() {
  const db = await createDb();
  await db.exec(`
    ${liveFunction('guard_profile_privileged_cols')}
    ${liveFunction('admin_set_user_sites')}
    ${liveFunction('admin_set_web_access')}
    create trigger trg_guard_profile_privileged before update on public.profiles
      for each row execute function public.guard_profile_privileged_cols();
    -- Live ACL: authenticated and service_role may execute; anon and PUBLIC may not.
    revoke all on function public.admin_set_user_sites(uuid, text[], text) from public;
    revoke all on function public.admin_set_web_access(uuid, boolean) from public;
    grant execute on function public.admin_set_user_sites(uuid, text[], text) to authenticated, service_role;
    grant execute on function public.admin_set_web_access(uuid, boolean) to authenticated, service_role;`);
  await assertLiveMd5(db, ['guard_profile_privileged_cols', 'admin_set_user_sites', 'admin_set_web_access']);
  return db;
}
const sites = (db, uid, target, list) => asUser(db, uid, () => db.query('select public.admin_set_user_sites($1,$2,$3)', [target, list, 'test']));
const web = (db, uid, target, on) => asUser(db, uid, () => db.query('select public.admin_set_web_access($1,$2)', [target, on]));
const profile = async (db, id) => (await db.query('select sites, web_access from public.profiles where id = $1', [id])).rows[0];
const guardOn = async (db) => (await db.query(
  `select tgenabled::text e from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'trg_guard_profile_privileged'`)).rows[0].e;

test('TEN-4 BEFORE: a tenant B Admin rewrites a Company A user site scope; web access is already blocked by the trigger', async () => {
  const db = await setup();
  try {
    assert.deepEqual((await profile(db, USERS.mgrA)).sites, ['NHC']);
    await sites(db, USERS.adminB, USERS.mgrA, null);
    assert.equal((await profile(db, USERS.mgrA)).sites, null, 'Company A user site scope cleared from another organisation');
    await sites(db, USERS.adminB, USERS.mgrA, ['all']);
    assert.deepEqual((await profile(db, USERS.mgrA)).sites, ['ALL'], 'and widened to every site');

    // The audit report listed admin_set_web_access too. Against the faithful copy the live
    // profile guard trigger refuses it, so that half of the finding is NOT reproduced.
    await assert.rejects(web(db, USERS.adminB, USERS.mgrA, false), code('42501'));
    assert.equal((await profile(db, USERS.mgrA)).web_access, true);
  } finally { await db.close(); }
});

test('TEN-4 AFTER: cross-organisation calls raise 42501, same-organisation and super admin calls still work', async () => {
  const db = await setup();
  try {
    await db.exec(migration);
    await db.exec(migration); // idempotent
    const acl = await db.query(`select proname, prosecdef d, proconfig::text c,
        has_function_privilege('authenticated', oid, 'EXECUTE') a, has_function_privilege('anon', oid, 'EXECUTE') n
      from pg_proc where pronamespace = 'public'::regnamespace and proname in ('admin_set_user_sites','admin_set_web_access') order by 1`);
    for (const r of acl.rows) assert.deepEqual([r.d, r.c, r.a, r.n], [true, '{search_path=public}', true, false], `${r.proname} keeps definer, search_path and ACL`);

    // Refused: foreign target, and an id that does not exist (same answer, so no existence oracle).
    for (const target of [USERS.mgrA, USERS.superA, '99999999-0000-0000-0000-000000000000']) {
      await assert.rejects(sites(db, USERS.adminB, target, null), e => e.code === '42501' && e.message === 'not authorized');
      await assert.rejects(web(db, USERS.adminB, target, false), e => e.code === '42501' && e.message === 'Not authorized to change web access.');
    }
    assert.deepEqual(await profile(db, USERS.mgrA), { sites: ['NHC'], web_access: true }, 'Company A row unchanged (privileged read)');
    assert.equal(await guardOn(db), 'O', 'a refused call leaves the profile guard trigger enabled');
    // Non-admins are still refused by the original role gate.
    await assert.rejects(sites(db, USERS.mgrA, USERS.userA, ['NHC']), code('42501'));
    await assert.rejects(web(db, USERS.mgrB, USERS.mgrB, false), code('42501'));

    // Company A super admin (the only admin type that exists today): any target, including another organisation.
    await sites(db, USERS.superA, USERS.mgrA, ['nhc', ' diriyah ']);
    assert.deepEqual((await profile(db, USERS.mgrA)).sites.sort(), ['DIRIYAH', 'NHC']);
    await web(db, USERS.superA, USERS.mgrA, false);
    assert.equal((await profile(db, USERS.mgrA)).web_access, false);
    await sites(db, USERS.superA, USERS.mgrB, ['B1']);
    await web(db, USERS.superA, USERS.mgrB, false);
    assert.deepEqual(await profile(db, USERS.mgrB), { sites: ['B1'], web_access: false });

    // A plain Admin manages users in its own organisation (future Company A Admin, tenant B Admin).
    await sites(db, USERS.adminA, USERS.userA, null);
    await web(db, USERS.adminA, USERS.userA, false);
    assert.deepEqual(await profile(db, USERS.userA), { sites: null, web_access: false });
    await sites(db, USERS.adminB, USERS.mgrB, ['B2']);
    await web(db, USERS.adminB, USERS.mgrB, true);
    assert.deepEqual(await profile(db, USERS.mgrB), { sites: ['B2'], web_access: true });
    assert.equal(await guardOn(db), 'O');
  } finally { await db.close(); }
});

test('TEN-4 migration aborts when a live function no longer matches its anchor', async () => {
  const db = await setup();
  try {
    await db.exec(`create or replace function public.admin_set_web_access(p_user_id uuid, p_web boolean) returns void
      language plpgsql security definer set search_path to 'public' as $$ begin null; end $$;`);
    await assert.rejects(db.exec(migration), /TEN-4 aborted/);
    // The whole DO block is one statement: the sibling function must not be left half-migrated.
    const { rows } = await db.query(`select position('TEN-4' in prosrc) > 0 g from pg_proc where proname = 'admin_set_user_sites'`);
    assert.equal(rows[0].g, false);
  } finally { await db.close(); }
});
