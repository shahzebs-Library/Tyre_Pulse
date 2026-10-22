import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const load = name => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const migrations = [
  '20261022093000_workforce_daily_work.sql',
  '20261022095000_workforce_assignments.sql',
  '20261022104000_workforce_evidence.sql',
  '20261022111000_workforce_assignment_execution.sql',
  '20261022112000_workforce_notifications.sql',
  '20261022112500_workforce_manager_permissions.sql',
  '20261022113000_workforce_transition_guard.sql',
  '20261022124500_workforce_push_integration.sql',
  '20261022130000_workforce_assignment_tenant_check.sql',
];
const sql = (await Promise.all(migrations.map(load))).join('\n');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ORG_A = id(1), ORG_B = id(2);
const MGR_A = id(10), EMP_A = id(11), EMP_A2 = id(12), MGR_B = id(20), EMP_B = id(21), DIR_A = id(13);

async function setup() {
  const db = new PGlite();
  await db.exec(`
   CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
   CREATE TABLE profiles(id uuid PRIMARY KEY,org_id uuid,organisation_id uuid,role text,approved boolean DEFAULT true,locked boolean DEFAULT false,full_name text);
   CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT org_id FROM public.profiles WHERE id=auth.uid() $$;
   CREATE FUNCTION get_my_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT role FROM public.profiles WHERE id=auth.uid() $$;
   CREATE FUNCTION app_is_org_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce((SELECT role='Admin' FROM public.profiles WHERE id=auth.uid()),false) $$;
   CREATE TABLE push_tokens(user_id uuid,token text);
   CREATE FUNCTION public._user_push_tokens(u uuid) RETURNS SETOF text LANGUAGE sql AS $$ SELECT token FROM public.push_tokens WHERE user_id=u $$;
   CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,type text,title text,body text,entity_type text,entity_id uuid);
   CREATE TABLE domain_events(id bigserial PRIMARY KEY,event_type text,entity_type text,entity_id text,organisation_id uuid,actor_id uuid,payload jsonb,status text);
   CREATE TABLE workflow_notifications(id bigserial PRIMARY KEY,event_id bigint,organisation_id uuid,instance_id uuid,event_type text,payload jsonb,recipient_count int,status text);
   CREATE SCHEMA storage;
   CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,owner_id text);
   CREATE FUNCTION storage.foldername(n text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array(n,'/') $$;
   ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
   GRANT USAGE ON SCHEMA auth,storage TO authenticated;
   INSERT INTO profiles(id,org_id,organisation_id,role,full_name) VALUES
     ('${MGR_A}','${ORG_A}','${ORG_A}','Manager','Mgr A'),('${DIR_A}','${ORG_A}','${ORG_A}','Director','Dir A'),
     ('${EMP_A}','${ORG_A}','${ORG_A}','Driver','Emp A'),('${EMP_A2}','${ORG_A}','${ORG_A}','Driver','Emp A2'),
     ('${MGR_B}','${ORG_B}','${ORG_B}','Manager','Mgr B'),('${EMP_B}','${ORG_B}','${ORG_B}','Driver','Emp B');
   GRANT SELECT ON profiles TO authenticated;
   GRANT SELECT,INSERT ON notifications TO authenticated;
   BEGIN; ${sql} COMMIT;
  `);
  return db;
}
const actor = (db, who) => db.exec(`RESET ROLE; SET test.actor='${who}'; SET ROLE authenticated`);
const asSuper = db => db.exec('RESET ROLE');
const insert = (db, to, title = 'Task') => db.query(
  'insert into workforce_assignments(title,assigned_to,assigned_by) values ($1,$2,auth.uid()) returning id,organisation_id', [title, to]);

test('workforce assignment tenant isolation', async t => {
  const db = await setup();
  await actor(db, MGR_A);
  const mine = (await insert(db, EMP_A, 'Replace tyre')).rows[0];
  await t.test('manager assigns within own tenant; row is stamped with the manager org', () => {
    assert.equal(mine.organisation_id, ORG_A);
  });
  await t.test('manager cannot assign work to an employee of another tenant', async () => {
    await assert.rejects(insert(db, EMP_B, 'Cross tenant'), e => e.code === '42501');
    await asSuper(db);
    assert.equal((await db.query("select count(*)::int n from workforce_assignments where assigned_to=$1", [EMP_B])).rows[0].n, 0);
  });
  await t.test('manager cannot assign on behalf of another manager', async () => {
    await actor(db, MGR_A);
    await assert.rejects(db.query('insert into workforce_assignments(title,assigned_to,assigned_by) values ($1,$2,$3)', ['Spoof', EMP_A, MGR_B]), e => e.code === '42501');
  });
  await t.test('ordinary employee cannot create assignments', async () => {
    await actor(db, EMP_A);
    await assert.rejects(insert(db, EMP_A2, 'Self made'), e => e.code === '42501');
  });
  await t.test('tenant B manager sees nothing of tenant A, employee sees only own', async () => {
    await actor(db, MGR_B);
    assert.equal((await db.query('select id from workforce_assignments')).rows.length, 0);
    await actor(db, MGR_A);
    await insert(db, EMP_A2, 'Other employee');
    await actor(db, EMP_A);
    const rows = (await db.query('select assigned_to from workforce_assignments')).rows;
    assert.deepEqual(rows.map(r => r.assigned_to), [EMP_A]);
  });
  await t.test('tenant B manager cannot update or advance tenant A assignments', async () => {
    await actor(db, MGR_B);
    const r = await db.query("update workforce_assignments set status='cancelled' where id=$1 returning id", [mine.id]);
    assert.equal(r.rows.length, 0);
  });
  await t.test('Director counts as a manager but still only within own tenant', async () => {
    await actor(db, DIR_A);
    const rows = (await db.query('select id from workforce_assignments')).rows;
    assert.ok(rows.length >= 2);
    await assert.rejects(insert(db, EMP_B, 'Dir cross'), e => e.code === '42501');
  });
});

test('workforce transition guard', async t => {
  const db = await setup();
  await actor(db, MGR_A);
  const { id: aid } = (await insert(db, EMP_A, 'Flow')).rows[0];
  const move = (who, status) => actor(db, who).then(() => db.query('update workforce_assignments set status=$2 where id=$1 returning status', [aid, status]));
  await t.test('employee cannot jump assigned -> submitted or verify own work', async () => {
    await assert.rejects(move(EMP_A, 'submitted'), /Invalid employee assignment transition|row-level security/);
    await assert.rejects(move(EMP_A, 'verified'), /row-level security|Invalid employee assignment transition/);
  });
  await t.test('employee follows assigned -> acknowledged -> in_progress -> blocked -> in_progress -> submitted', async () => {
    for (const s of ['acknowledged', 'in_progress', 'blocked', 'in_progress', 'submitted']) {
      assert.equal((await move(EMP_A, s)).rows[0].status, s);
    }
  });
  await t.test('employee cannot edit a submitted assignment', async () => {
    const r = await move(EMP_A, 'in_progress');
    assert.equal(r.rows.length, 0);
  });
  await t.test('another employee cannot move it', async () => {
    const r = await move(EMP_A2, 'in_progress');
    assert.equal(r.rows.length, 0);
  });
  await t.test('employee cannot change content or reassign', async () => {
    await actor(db, MGR_A);
    const second = (await insert(db, EMP_A, 'Content')).rows[0].id;
    await actor(db, EMP_A);
    await assert.rejects(db.query("update workforce_assignments set title='Changed', status='acknowledged' where id=$1", [second]), /status only/);
    await assert.rejects(db.query("update workforce_assignments set assigned_to=$2, status='acknowledged' where id=$1", [second, EMP_A2]), /immutable|row-level security/);
  });
  await t.test('manager verifies; verified work is immutable even for the manager', async () => {
    assert.equal((await move(MGR_A, 'verified')).rows[0].status, 'verified');
    await assert.rejects(move(MGR_A, 'in_progress'), /Closed assignments are immutable/);
  });
  await t.test('organisation cannot be moved', async () => {
    await actor(db, MGR_A);
    const third = (await insert(db, EMP_A, 'Org move')).rows[0].id;
    await assert.rejects(db.query('update workforce_assignments set organisation_id=$2 where id=$1', [third, ORG_B]), e => /immutable|row-level security/.test(e.message));
  });
});

test('assignment push enqueue', async t => {
  const db = await setup();
  const created = async (to, title) => {
    await actor(db, MGR_A);
    return (await insert(db, to, title)).rows[0].id;
  };
  const q = async text => { await asSuper(db); return (await db.query(text)).rows; };
  await t.test('no token: in-app notification written, push skipped', async () => {
    const aid = await created(EMP_A, 'No token task');
    const n = await q(`select user_id,entity_id,title from notifications where entity_id='${aid}'`);
    assert.equal(n.length, 1); assert.equal(n[0].user_id, EMP_A);
    assert.equal((await q('select * from workflow_notifications')).length, 0);
    assert.equal((await q('select * from domain_events')).length, 0);
  });
  await t.test('tokens: exactly one queued row, all devices, no cross-user recipients', async () => {
    await asSuper(db);
    await db.query("insert into push_tokens values ($1,'tok-1'),($1,'tok-2'),($2,'other-user')", [EMP_A2, EMP_A]);
    const aid = await created(EMP_A2, 'Token task');
    const rows = await q('select * from workflow_notifications');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'pending'); assert.equal(rows[0].recipient_count, 2);
    assert.deepEqual(rows[0].payload.recipients.map(r => r.push_token).sort(), ['tok-1', 'tok-2']);
    assert.ok(rows[0].payload.recipients.every(r => r.user_id === EMP_A2));
    assert.equal(rows[0].payload.entity_id, aid);
    assert.equal(rows[0].payload.link, '/workforce-daily');
    assert.equal(rows[0].organisation_id, ORG_A);
  });
  await t.test('status updates never re-notify (dedupe: INSERT only)', async () => {
    await actor(db, MGR_A);
    const aid = (await insert(db, EMP_A2, 'Update me')).rows[0].id;
    const before = (await q('select count(*)::int n from workflow_notifications'))[0].n;
    const nBefore = (await q('select count(*)::int n from notifications'))[0].n;
    await actor(db, EMP_A2);
    await db.query("update workforce_assignments set status='acknowledged' where id=$1", [aid]);
    assert.equal((await q('select count(*)::int n from workflow_notifications'))[0].n, before);
    assert.equal((await q('select count(*)::int n from notifications'))[0].n, nBefore);
  });
  await t.test('title is truncated and a push failure never blocks assignment creation', async () => {
    await asSuper(db);
    await db.query('alter table workflow_notifications rename to workflow_notifications_x');
    await actor(db, MGR_A);
    const long = 'x'.repeat(500);
    const r = await insert(db, EMP_A2, long);
    assert.equal(r.rows.length, 1);
    await asSuper(db);
    const n = (await db.query("select body from notifications where entity_id=$1", [r.rows[0].id])).rows[0];
    assert.equal(n.body.length, 240);
    await db.query('alter table workflow_notifications_x rename to workflow_notifications');
  });
});
