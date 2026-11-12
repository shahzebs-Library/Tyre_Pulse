// TEN-3: platform-wide configuration tables must be writable by a super admin only.
// Write and read policies below are the LIVE expressions (pg_policies, 2026-11-12).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { USERS, asUser, createDb, pendingMigration, written } from './fixtures/tenant_isolation_harness.mjs';

const migration = await pendingMigration('20261113102000_ten3_platform_tables_super_admin_write.sql');

// Really open today: the Admin test matches the stored Title Case role.
const OPEN = [
  ['modules', 'modules_write', `(is_super_admin() OR (get_my_role() = 'Admin'::text))`, true],
  ['subscription_plans', 'subscription_plans_admin_write',
    `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = 'Admin'::text))))`, true],
  ['due_alert_rules', 'due_alert_rules_write',
    `(( SELECT is_super_admin() AS is_super_admin) OR (( SELECT get_my_role() AS get_my_role) = 'Admin'::text))`, true],
  ['brand_aliases', 'Admin write brand aliases', `(( SELECT get_my_role() AS get_my_role) = 'Admin'::text)`, false],
];
// Closed today only because app_role() lower-cases the role, so "= 'Admin'" is never true.
const DEAD_ARM = ['metric_registry', 'metric_versions', 'quality_rules', 'data_assets', 'lineage_edges',
  'dashboard_registry', 'widget_bindings', 'releases', 'release_impacts'];
const ALL = [...OPEN.map(o => o[0]), ...DEAD_ARM];

async function setup() {
  const db = await createDb();
  // subscription_plans_admin_write reads profiles as the caller; minimal own-row read policy.
  await db.exec(`alter table public.profiles enable row level security; grant select on public.profiles to authenticated;
    create policy profiles_select on public.profiles for select to authenticated using (true);`);
  for (const [t, pol, expr, hasCheck] of OPEN) {
    await db.exec(`create table public.${t} (k text primary key, v text);
      alter table public.${t} enable row level security;
      grant select, insert, update, delete on public.${t} to authenticated;
      create policy ${t}_read on public.${t} for select to authenticated using (true);
      create policy "${pol}" on public.${t} for all to public using ${expr}${hasCheck ? ` with check ${expr}` : ''};
      insert into public.${t} values ('shared', 'original');`);
  }
  for (const t of DEAD_ARM) {
    await db.exec(`create table public.${t} (k text primary key, v text);
      alter table public.${t} enable row level security;
      grant select, insert, update, delete on public.${t} to authenticated;
      create policy ${t}_read on public.${t} for select to public using (app_is_active());
      create policy ${t}_write on public.${t} for all to public
        using ((is_super_admin() OR (app_role() = 'Admin'::text))) with check ((is_super_admin() OR (app_role() = 'Admin'::text)));
      insert into public.${t} values ('shared', 'original');`);
  }
  return db;
}
const upd = (db, uid, t) => asUser(db, uid, () => written(db, `update public.${t} set v = 'changed by ' || $1 where k = 'shared'`, [uid]));
const ins = (db, uid, t) => asUser(db, uid, () => db.query(`insert into public.${t} values ($1, 'x')`, [`row-${uid}`]));
const value = async (db, t) => (await db.query(`select v from public.${t} where k = 'shared'`)).rows[0].v;

test('TEN-3 BEFORE: a second tenant Admin rewrites four shared platform tables', async () => {
  const db = await setup();
  try {
    for (const [t] of OPEN) {
      assert.equal(await upd(db, USERS.adminB, t), 1, `tenant B Admin updates ${t}`);
      assert.equal(await value(db, t), `changed by ${USERS.adminB}`, `the shared ${t} row changed for every company`);
      await ins(db, USERS.adminB, t);
      assert.equal(await asUser(db, USERS.adminB, () => written(db, `delete from public.${t} where k like 'row-%'`)), 1);
      assert.equal(await upd(db, USERS.mgrB, t), 0, 'a Manager cannot');
    }
    // Correction to the audit report: on the nine registry tables the Admin arm is dead code.
    for (const t of DEAD_ARM) {
      assert.equal(await upd(db, USERS.adminB, t), 0, `${t}: a plain Admin already writes 0 rows (app_role() is lower case)`);
      assert.equal(await upd(db, USERS.superA, t), 1);
    }
  } finally { await db.close(); }
});

test('TEN-3 AFTER: only a super admin writes; everyone keeps reading', async () => {
  const db = await setup();
  try {
    await db.exec(migration);
    await db.exec(migration); // idempotent: second run skips every policy
    for (const t of ALL) {
      for (const who of ['adminB', 'adminA', 'mgrA', 'mgrB']) {
        assert.equal(await upd(db, USERS[who], t), 0, `${who} writes 0 rows to ${t}`);
        await assert.rejects(ins(db, USERS[who], t), e => e.code === '42501', `${who} cannot insert into ${t}`);
        assert.equal(await asUser(db, USERS[who], () => written(db, `delete from public.${t}`)), 0);
      }
      assert.equal(await value(db, t), 'original', `${t}: privileged read shows the shared row untouched`);
      for (const who of ['adminB', 'mgrA', 'userA']) {
        const rows = await asUser(db, USERS[who], () => db.query(`select count(*)::int n from public.${t}`));
        assert.equal(rows.rows[0].n, 1, `${who} still reads ${t}`);
      }
      assert.equal(await upd(db, USERS.superA, t), 1, `Company A super admin still updates ${t}`);
      await ins(db, USERS.superA, t);
      assert.equal(await asUser(db, USERS.superA, () => written(db, `delete from public.${t} where k like 'row-%'`)), 1);
    }
    const left = await db.query(`select count(*)::int n from pg_policies where schemaname = 'public' and cmd = 'ALL'
      and (qual like '%Admin%' or coalesce(with_check, '') like '%Admin%')`);
    assert.equal(left.rows[0].n, 0);
  } finally { await db.close(); }
});

test('TEN-3 migration aborts when a named policy is missing or has an unexpected expression', async () => {
  const db = await setup();
  try {
    await db.exec(`alter policy releases_write on public.releases rename to releases_write_renamed`);
    await assert.rejects(db.exec(migration), /TEN-3 aborted: policy "releases_write"/);
    await db.exec(`alter policy releases_write_renamed on public.releases rename to releases_write;
      alter policy modules_write on public.modules using (true)`);
    await assert.rejects(db.exec(migration), /unexpected expression/);
  } finally { await db.close(); }
});
