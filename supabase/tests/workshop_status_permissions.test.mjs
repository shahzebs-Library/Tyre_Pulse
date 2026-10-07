import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// PGlite harness for supabase/migrations/20261007100000_workshop_status_permissions.sql,
// applied on top of the Loop 1 foundation. Unlike the Loop 1 harness, the
// permission stubs here are REAL logic over stub tables, so a test exercises
// the same decision path production does:
// (SECURITY DEFINER, as in production, so RLS can call them as the client.)
//   app_is_active   approved and not locked profile
//   is_super_admin  profiles.is_super_admin and not locked
//   app_user_can    a copy of the live function (view branch): approved/unlocked,
//                   super or Admin -> true, 'delete' -> false, role default from
//                   module_permissions (org_id null, latest updated_at), then
//                   user_access_grants revoke (wins) / grant.

const FOUNDATION = readFileSync(
  new URL('../migrations/20261007090000_workshop_status_foundation.sql', import.meta.url), 'utf8')
const PERMISSIONS = readFileSync(
  new URL('../migrations/20261007100000_workshop_status_permissions.sql', import.meta.url), 'utf8')

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const org = id(900)
const U = {
  ground: id(1), electrician: id(2), supervisor: id(3), manager: id(4), admin: id(5), superAdmin: id(6),
  reporter: id(7), locked: id(8), unapproved: id(9), director: id(10), fleetSup: id(11), revoked: id(12),
  granted: id(13)
}

const ACTIONS = ['view', 'view_removed', 'view_uploads', 'view_activity', 'view_reports', 'view_audit',
  'update', 'upload', 'confirm', 'assign', 'disposition', 'export', 'archive', 'restore',
  'soft_delete', 'configure', 'permanent_delete']

// Independent expectation of the seeded matrix (deliberately NOT imported from
// the client mirror, so a drift on either side fails here or in the Vitest).
const GROUND = ['view', 'update']
const SUPERVISOR = ['view', 'update', 'upload', 'confirm', 'assign', 'disposition', 'export',
  'view_removed', 'view_uploads', 'view_activity', 'view_reports', 'restore']
const MANAGER = ['view', 'update', 'assign', 'disposition', 'export',
  'view_removed', 'view_uploads', 'view_activity', 'view_reports', 'archive', 'restore']
const ADMIN = ACTIONS.filter(a => a !== 'permanent_delete')

const db = new PGlite()
const isCode = code => e => e?.code === code
const rec = {}

async function asUser (uid, fn) {
  await db.exec(`set test.uid = '${uid}'`)
  try { return await fn() } finally { await db.exec('reset test.uid') }
}
// RLS only applies to a non-superuser role.
async function asClient (uid, fn) {
  await db.exec(`set test.uid = '${uid}'; set role authenticated`)
  try { return await fn() } finally { await db.exec('reset role; reset test.uid') }
}
const can = async (uid, action) => asUser(uid, async () =>
  (await db.query('select public.workshop_status_can($1) ok', [action])).rows[0].ok)
const allowed = async uid => {
  const out = []
  for (const a of ACTIONS) if (await can(uid, a)) out.push(a)
  return out
}
const sorted = a => [...a].sort()
const count = async (sql, params = []) => (await db.query(sql, params)).rows[0].n

async function withCtx (fn) {
  return db.transaction(async tx => {
    await tx.query("select set_config('workshop.source', 'system', true)")
    return fn(tx)
  })
}

before(async () => {
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles(id uuid primary key, full_name text, username text, role text,
      is_super_admin boolean default false, approved boolean default true, locked boolean default false);
    create function public.app_current_org() returns uuid language sql stable as $$ select '${org}'::uuid $$;
    create function public.app_is_active() returns boolean language sql stable security definer as $$
      select exists (select 1 from public.profiles where id = auth.uid()
                      and coalesce(approved, true) and not coalesce(locked, false)) $$;
    create function public.is_super_admin() returns boolean language sql stable security definer as $$
      select exists (select 1 from public.profiles where id = auth.uid()
                      and coalesce(is_super_admin, false) and not coalesce(locked, false)) $$;
    create function public.app_sees_all_countries() returns boolean language sql stable as $$ select true $$;
    create function public.app_country_scope() returns text[] language sql stable as $$ select null::text[] $$;
    create function public.app_sees_all_sites() returns boolean language sql stable as $$ select true $$;
    create function public.app_site_scope() returns text[] language sql stable as $$ select null::text[] $$;
    create table public.module_permissions(role text, module_key text, enabled boolean, org_id uuid,
      updated_at timestamptz default now());
    create table public.user_access_grants(user_id uuid, module_key text, capability text default 'view',
      effect text, expires_at timestamptz);
    create function public.app_user_can(p_key text, p_cap text) returns boolean
    language plpgsql stable security definer set search_path = public as $$
    declare v_uid uuid := auth.uid(); v_role text; v_super boolean := false;
      v_cap text := coalesce(nullif(btrim(p_cap), ''), 'view'); v_default boolean := false;
    begin
      if v_uid is null then return false; end if;
      select role, coalesce(is_super_admin, false) into v_role, v_super from public.profiles
       where id = v_uid and coalesce(approved, true) = true and coalesce(locked, false) = false;
      if not found then return false; end if;
      if v_super is true or v_role = 'Admin' then return true; end if;
      if v_cap = 'delete' then return false; end if;
      if v_cap = 'view' then
        v_default := coalesce((select enabled from public.module_permissions
          where org_id is null and role = v_role and module_key = p_key
          order by updated_at desc nulls last limit 1), false);
      end if;
      if exists (select 1 from public.user_access_grants g where g.user_id = v_uid and g.module_key = p_key
                 and g.capability = v_cap and g.effect = 'revoke'
                 and (g.expires_at is null or g.expires_at > now())) then return false; end if;
      if v_default then return true; end if;
      return exists (select 1 from public.user_access_grants g where g.user_id = v_uid and g.module_key = p_key
                 and g.capability = v_cap and g.effect = 'grant'
                 and (g.expires_at is null or g.expires_at > now()));
    end $$;
    create table public.vehicle_fleet(id uuid primary key);
    create table public.asset_breakdowns(id uuid primary key, organisation_id uuid, country text,
      asset_no text, returned_to_service boolean);
    insert into public.profiles (id, full_name, role, is_super_admin, approved, locked) values
      ('${U.ground}', 'Ground', 'Mechanic', false, true, false),
      ('${U.electrician}', 'Sparks', 'Electrician', false, true, false),
      ('${U.supervisor}', 'Super Visor', 'Workshop Supervisor', false, true, false),
      ('${U.manager}', 'Manny', 'Manager', false, true, false),
      ('${U.admin}', 'Addie', 'Admin', false, true, false),
      ('${U.superAdmin}', 'Owner', 'Admin', true, true, false),
      ('${U.reporter}', 'Rep', 'Reporter', false, true, false),
      ('${U.locked}', 'Locked', 'Workshop Supervisor', false, true, true),
      ('${U.unapproved}', 'New', 'Workshop Supervisor', false, false, false),
      ('${U.director}', 'Dee', 'Director', false, true, false),
      ('${U.fleetSup}', 'Fleet', 'Fleet Supervisor', false, true, false),
      ('${U.revoked}', 'Revoked', 'Workshop Supervisor', false, true, false),
      ('${U.granted}', 'Granted', 'Mechanic', false, true, false);
    -- Existing admin choices that must survive both migrations:
    --   Director has Daily Ops OFF, so Loop 1 copies daily_ops:workshop = false.
    --   Fleet Supervisor archive was explicitly switched off.
    insert into public.module_permissions (role, module_key, enabled, org_id) values
      ('Manager', 'daily_ops', true, null),
      ('Director', 'daily_ops', false, null),
      ('Reporter', 'daily_ops', false, null),
      ('Fleet Supervisor', 'daily_ops:workshop:archive', false, null);
    grant usage on schema public, auth to authenticated;
  `)
  await db.exec(FOUNDATION)
  await db.exec(PERMISSIONS)

  // Records: one live, one that left the report, one soft-deleted. Created by
  // the admin, so their 'added' events carry the admin as actor.
  await asUser(U.admin, () => withCtx(async tx => {
    const ins = async (asset, extra) => (await tx.query(
      `insert into workshop_status_records (country, asset_no, site, current_active, daily_report_status, deleted_at)
       values ('KSA', $1, 'NHC', $2, $3, $4) returning id`,
      [asset, extra.active, extra.status, extra.deleted ?? null])).rows[0].id
    rec.live = await ins('TM1', { active: true, status: 'active' })
    rec.removed = await ins('TM2', { active: false, status: 'removed_from_current_report' })
    rec.deleted = await ins('TM3', { active: false, status: 'removed_from_current_report', deleted: new Date().toISOString() })
    rec.upload = (await tx.query(
      "insert into workshop_status_uploads (country, file_name) values ('KSA', 'daily.xlsx') returning id")).rows[0].id
    await tx.query("insert into workshop_status_upload_rows (upload_id, outcome, asset_no) values ($1, 'new', 'TM1')", [rec.upload])
    await tx.query("insert into workshop_status_events (upload_id, event_type) values ($1, 'upload_previewed')", [rec.upload])
    await tx.query(`insert into workshop_status_attachments (record_id, storage_path, file_name) values
      ($1, 'a/live.jpg', 'live.jpg'), ($2, 'a/removed.jpg', 'removed.jpg')`, [rec.live, rec.removed])
    // The insert stamp clears deleted_at, so a removed file is deleted in a second step.
    await tx.query(`insert into workshop_status_attachments (record_id, storage_path, file_name)
      values ($1, 'a/gone.jpg', 'gone.jpg')`, [rec.live])
    await tx.query("update workshop_status_attachments set deleted_at = now() where file_name = 'gone.jpg'")
  }))
  // The ground user's own events: one on a record they cannot see, one export.
  await asUser(U.ground, () => withCtx(async tx => {
    await tx.query("insert into workshop_status_events (record_id, event_type) values ($1, 'manual_update')", [rec.removed])
    await tx.query("insert into workshop_status_events (record_id, event_type) values ($1, 'export')", [rec.live])
  }))
  // An event by someone else on the removed record (ground must not see it).
  await asUser(U.supervisor, () => withCtx(tx =>
    tx.query("insert into workshop_status_events (record_id, event_type, reason) values ($1, 'manual_update', 'sup')", [rec.removed])))
})

after(async () => { await db.close() })

test('1. role defaults: each group gets exactly the seeded actions', async () => {
  assert.deepEqual(sorted(await allowed(U.ground)), sorted(GROUND))
  assert.deepEqual(sorted(await allowed(U.electrician)), sorted(GROUND))
  assert.deepEqual(sorted(await allowed(U.supervisor)), sorted(SUPERVISOR))
  assert.deepEqual(sorted(await allowed(U.manager)), sorted(MANAGER))
  assert.deepEqual(sorted(await allowed(U.admin)), sorted(ADMIN))
  assert.deepEqual(sorted(await allowed(U.superAdmin)), sorted(ACTIONS))
  assert.deepEqual(await allowed(U.reporter), [], 'an unlisted role gets nothing')
})

test('2. permanent_delete is super admin only - Admin, a role row or a grant cannot open it', async () => {
  assert.equal(await can(U.superAdmin, 'permanent_delete'), true)
  assert.equal(await can(U.admin, 'permanent_delete'), false)
  await db.exec(`insert into module_permissions (role, module_key, enabled, org_id) values
    ('Workshop Supervisor', 'daily_ops:workshop:permanent_delete', true, null);
    insert into user_access_grants (user_id, module_key, effect) values
    ('${U.manager}', 'daily_ops:workshop:permanent_delete', 'grant')`)
  try {
    assert.equal(await can(U.supervisor, 'permanent_delete'), false)
    assert.equal(await can(U.manager, 'permanent_delete'), false)
  } finally {
    await db.exec(`delete from module_permissions where module_key = 'daily_ops:workshop:permanent_delete';
      delete from user_access_grants where module_key = 'daily_ops:workshop:permanent_delete'`)
  }
})

test('3. per-user revoke beats a role default; per-user grant opens an action', async () => {
  await db.exec(`insert into user_access_grants (user_id, module_key, effect) values
    ('${U.revoked}', 'daily_ops:workshop:upload', 'revoke'),
    ('${U.granted}', 'daily_ops:workshop:export', 'grant'),
    ('${U.granted}', 'daily_ops:workshop:soft_delete', 'grant')`)
  assert.equal(await can(U.revoked, 'upload'), false)
  assert.equal(await can(U.revoked, 'confirm'), true, 'other supervisor actions stay')
  assert.equal(await can(U.granted, 'export'), true)
  assert.equal(await can(U.granted, 'soft_delete'), true, 'soft_delete opens by explicit grant')
  assert.equal(await can(U.ground, 'soft_delete'), false)
  assert.equal(await can(U.supervisor, 'configure'), false, 'configure has no role default')
  assert.equal(await can(U.manager, 'view_audit'), false, 'view_audit has no role default')

  // Revoking the module view closes every action at once.
  await db.exec(`insert into user_access_grants (user_id, module_key, effect) values
    ('${U.revoked}', 'daily_ops:workshop', 'revoke')`)
  assert.deepEqual(await allowed(U.revoked), [])
  // An expired grant is ignored.
  await db.exec(`insert into user_access_grants (user_id, module_key, effect, expires_at) values
    ('${U.ground}', 'daily_ops:workshop:archive', 'grant', now() - interval '1 day')`)
  assert.equal(await can(U.ground, 'archive'), false)
})

test('4. locked, unapproved or signed-out sessions and unknown actions get false', async () => {
  assert.deepEqual(await allowed(U.locked), [])
  assert.deepEqual(await allowed(U.unapproved), [])
  assert.equal((await db.query("select public.workshop_status_can('view') ok")).rows[0].ok, false, 'no auth.uid')
  for (const a of ['delete', 'drop_everything', '', null, 'VIEW_REMOVED_X']) {
    assert.equal(await can(U.superAdmin, a), false, `super admin unknown action ${a}`)
    assert.equal(await can(U.admin, a), false, `admin unknown action ${a}`)
  }
  assert.equal(await can(U.supervisor, ' Upload '), true, 'action names are trimmed and case-folded')
})

test('5. existing admin choices are kept and the seed is idempotent', async () => {
  // Director had Daily Ops off: Loop 1 copies only enabled rows, so the
  // Loop 2 manager matrix gives Director the module view (one row, no copy).
  const dir = (await db.query(`select enabled from module_permissions
    where role = 'Director' and module_key = 'daily_ops:workshop'`)).rows
  assert.deepEqual(dir.map(r => r.enabled), [true])
  assert.equal(await can(U.director, 'view'), true)
  assert.equal(await can(U.director, 'upload'), false, 'managers do not upload')
  // The explicit Fleet Supervisor archive = false survived.
  assert.equal(await can(U.fleetSup, 'archive'), false)
  assert.equal(await can(U.fleetSup, 'restore'), true)

  const total = async () => count(`select count(*)::int n from module_permissions where module_key like 'daily_ops:workshop%'`)
  const before = await total()
  await db.exec(PERMISSIONS)
  assert.equal(await total(), before, 're-running adds no rows')
  assert.equal(await count(`select count(*)::int n from (select role, module_key from module_permissions
    where org_id is null group by role, module_key having count(*) > 1) d`), 0, 'no duplicate role + key')
  // Admin needs no seed row; permanent_delete never gets one.
  assert.equal(await count(`select count(*)::int n from module_permissions
    where role = 'Admin' and module_key like 'daily_ops:workshop%'`), 0)
  assert.equal(await count(`select count(*)::int n from module_permissions
    where module_key = 'daily_ops:workshop:permanent_delete'`), 0)
})

test('6. workshop_status_my_permissions returns the full map; grants are authenticated-only', async () => {
  const map = await asUser(U.supervisor, async () =>
    (await db.query('select public.workshop_status_my_permissions() m')).rows[0].m)
  assert.deepEqual(Object.keys(map).sort(), sorted(ACTIONS))
  for (const a of ACTIONS) assert.equal(map[a], SUPERVISOR.includes(a), a)
  const anon = await db.query(`select has_function_privilege('anon', 'public.workshop_status_can(text)', 'execute') a,
    has_function_privilege('anon', 'public.workshop_status_my_permissions()', 'execute') b,
    has_function_privilege('authenticated', 'public.workshop_status_can(text)', 'execute') c,
    has_function_privilege('authenticated', 'public.workshop_status_my_permissions()', 'execute') d`)
  assert.deepEqual(anon.rows[0], { a: false, b: false, c: true, d: true })
})

test('7. RLS: records - removed needs view_removed, soft-deleted needs soft_delete', async () => {
  const ids = async uid => asClient(uid, async () =>
    (await db.query('select id from workshop_status_records order by asset_no')).rows.map(r => r.id))
  assert.deepEqual(await ids(U.ground), [rec.live])
  assert.deepEqual(await ids(U.supervisor), [rec.live, rec.removed])
  assert.deepEqual(await ids(U.manager), [rec.live, rec.removed])
  assert.deepEqual(await ids(U.admin), [rec.live, rec.removed, rec.deleted])
  assert.deepEqual(await ids(U.superAdmin), [rec.live, rec.removed, rec.deleted])
  assert.deepEqual(await ids(U.reporter), [])
  assert.deepEqual(await ids(U.locked), [])
})

test('8. RLS: uploads and upload rows need view_uploads', async () => {
  const n = async (uid, t) => asClient(uid, () => count(`select count(*)::int n from ${t}`))
  assert.equal(await n(U.ground, 'workshop_status_uploads'), 0)
  assert.equal(await n(U.ground, 'workshop_status_upload_rows'), 0)
  assert.equal(await n(U.supervisor, 'workshop_status_uploads'), 1)
  assert.equal(await n(U.supervisor, 'workshop_status_upload_rows'), 1)
  assert.equal(await n(U.manager, 'workshop_status_uploads'), 1)
})

test('9. RLS: events - own events and visible records, full log needs view_activity', async () => {
  const rows = async uid => asClient(uid, async () =>
    (await db.query('select record_id, event_type, actor_id, upload_id from workshop_status_events')).rows)

  const ground = await rows(U.ground)
  // The 'added' event of the live record (visible record).
  assert.ok(ground.some(e => e.record_id === rec.live && e.event_type === 'added'))
  // Their own manual update on a record they cannot see.
  assert.ok(ground.some(e => e.record_id === rec.removed && e.actor_id === U.ground && e.event_type === 'manual_update'))
  // Not: someone else's activity on the removed record, the deleted record, the
  // upload event, or even their own export event.
  assert.ok(!ground.some(e => e.record_id === rec.removed && e.actor_id !== U.ground))
  assert.ok(!ground.some(e => e.record_id === rec.deleted))
  assert.ok(!ground.some(e => e.upload_id === rec.upload && e.record_id === null))
  assert.ok(!ground.some(e => e.event_type === 'export'))

  const sup = await rows(U.supervisor)
  assert.ok(sup.some(e => e.event_type === 'export'), 'view_activity reveals exports')
  assert.ok(sup.some(e => e.upload_id === rec.upload && e.record_id === null))
  assert.ok(sup.some(e => e.record_id === rec.deleted), 'view_activity is the full log')
  assert.equal((await rows(U.reporter)).length, 0)
})

test('10. RLS: attachments follow record visibility; removed files need soft_delete', async () => {
  const names = async uid => asClient(uid, async () =>
    (await db.query('select file_name from workshop_status_attachments order by file_name')).rows.map(r => r.file_name))
  assert.deepEqual(await names(U.ground), ['live.jpg'])
  assert.deepEqual(await names(U.supervisor), ['live.jpg', 'removed.jpg'])
  assert.deepEqual(await names(U.admin), ['gone.jpg', 'live.jpg', 'removed.jpg'])
  assert.deepEqual(await names(U.reporter), [])
})

test('11. clients still cannot INSERT, UPDATE or DELETE anything', async () => {
  for (const uid of [U.ground, U.supervisor, U.admin, U.superAdmin]) {
    await asClient(uid, async () => {
      await assert.rejects(db.query("insert into workshop_status_records (country, asset_no) values ('KSA', 'X1')"), isCode('42501'))
      await assert.rejects(db.query("update workshop_status_records set remarks = 'x' where id = $1", [rec.live]), isCode('42501'))
      await assert.rejects(db.query('delete from workshop_status_records where id = $1', [rec.live]), isCode('42501'))
      await assert.rejects(db.query("insert into workshop_status_events (event_type) values ('export')"), isCode('42501'))
      await assert.rejects(db.query("insert into workshop_status_uploads (country, file_name) values ('KSA', 'x.xlsx')"), isCode('42501'))
      await assert.rejects(db.query('delete from workshop_status_upload_rows'), isCode('42501'))
      await assert.rejects(db.query("update workshop_status_attachments set deleted_at = now()"), isCode('42501'))
    })
  }
})
