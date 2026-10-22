import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
// Negative access tests for Message the Team task / evidence / push-event objects.
// Runs the REAL migration SQL against PGlite with minimal stand-in parent tables.
// NOT covered here (no repo migration defines them; they exist live only):
//   broadcast_recipient_receipts / broadcast_replies RLS, and Supabase Storage API
//   enforcement of size/MIME (only bucket config + DB metadata checks are testable).
const read = f => readFile(new URL(`../migrations/${f}`, import.meta.url), 'utf8')
const transition = await read('20261022100900_tp_employee_action_transition.sql')
const evidence = await read('20261022102000_team_action_private_evidence.sql')
const pushEvents = await read('20261022113000_team_push_device_events.sql')
const senderVisibility = await read('20261022120000_team_broadcast_sender_push_event_visibility.sql')
const cleanup = await read('20261022122500_team_action_orphan_cleanup.sql')
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ORG = id(900), OTHER_ORG = id(901)
const [EMP, OTHER_EMP, FOREIGN, INACTIVE, MANAGER] = [id(1), id(2), id(3), id(4), id(5)]
const ACTION = id(100), INACTIVE_ACTION = id(101)

async function build() {
  const db = new PGlite()
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    GRANT USAGE ON SCHEMA auth, storage, public TO authenticated, anon;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, organisation_id uuid, org_id uuid, approved boolean, locked boolean);
    CREATE FUNCTION public.app_current_org() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT organisation_id FROM public.profiles WHERE id=auth.uid() $$;
    GRANT EXECUTE ON FUNCTION public.app_current_org() TO authenticated;
    CREATE TABLE public.action_items(id uuid PRIMARY KEY, organisation_id uuid, assigned_user_id uuid, status text,
      blocked_reason text, resolution text, completed_at timestamptz, updated_at timestamptz);
    CREATE TABLE public.broadcast_messages(id uuid PRIMARY KEY, sent_by uuid);
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name,'/') $$;
    GRANT SELECT,INSERT,DELETE ON storage.objects TO authenticated;
    GRANT SELECT ON public.profiles, public.action_items, public.broadcast_messages TO authenticated;
    INSERT INTO auth.users VALUES('${EMP}'),('${OTHER_EMP}'),('${FOREIGN}'),('${INACTIVE}'),('${MANAGER}');
    INSERT INTO public.profiles VALUES
     ('${EMP}','${ORG}','${ORG}',true,false),('${OTHER_EMP}','${ORG}','${ORG}',true,false),
     ('${FOREIGN}','${OTHER_ORG}','${OTHER_ORG}',true,false),('${INACTIVE}','${ORG}','${ORG}',true,true),
     ('${MANAGER}','${ORG}','${ORG}',true,false);
    INSERT INTO public.action_items(id,organisation_id,assigned_user_id,status) VALUES
     ('${ACTION}','${ORG}','${EMP}','open'),('${INACTIVE_ACTION}','${ORG}','${INACTIVE}','open');
    INSERT INTO public.broadcast_messages VALUES('${id(200)}','${MANAGER}');
    ${transition}
    ${evidence}
    ${pushEvents}
    ${senderVisibility}
    ${cleanup}
  `)
  return db
}
const as = async (db, user) => { await db.exec('RESET ROLE'); await db.exec(`SET test.actor='${user ?? ''}'`); await db.exec('SET ROLE authenticated') }
const code = fn => fn().then(() => null, e => e.code ?? e.message)
const move = (db, status, reason = null, resolution = null, action = ACTION) =>
  db.query('select (public.tp_employee_action_transition($1,$2,$3,$4)).status s', [action, status, reason, resolution])
const addEvidence = (db, uploader, action, path, mime = 'image/jpeg') =>
  db.query('insert into team_action_evidence(action_id,uploaded_by,storage_path,mime_type) values($1,$2,$3,$4)', [action, uploader, path, mime])
const evidenceCount = async db => (await db.query('select count(*)::int n from team_action_evidence')).rows[0].n

test('tp_employee_action_transition rejects unauthorized callers and changes nothing', async () => {
  const db = await build()
  try {
    await as(db, null)
    assert.equal(await code(() => move(db, 'acknowledged')), '42501', 'anonymous')
    await as(db, OTHER_EMP)
    assert.equal(await code(() => move(db, 'acknowledged')), '42501', 'other employee, same org')
    await as(db, MANAGER)
    assert.equal(await code(() => move(db, 'acknowledged')), '42501', 'manager is not the assignee')
    await as(db, FOREIGN)
    assert.equal(await code(() => move(db, 'acknowledged')), '42501', 'member of another org')
    await as(db, INACTIVE)
    assert.equal(await code(() => move(db, 'acknowledged', null, null, INACTIVE_ACTION)), '42501', 'locked assignee')
    await db.exec('RESET ROLE')
    assert.equal((await db.query(`select status from action_items where id='${ACTION}'`)).rows[0].status, 'open')
  } finally { await db.close() }
})

test('tp_employee_action_transition enforces the state machine and required text', async () => {
  const db = await build()
  try {
    await as(db, EMP)
    assert.equal(await code(() => move(db, 'resolved', null, 'long enough resolution')), '22023', 'open -> resolved')
    assert.equal(await code(() => move(db, 'open')), '22023', 'cannot set open')
    assert.equal(await code(() => move(db, 'bogus')), '22023')
    assert.equal(await code(() => move(db, 'blocked', 'abc')), '22023', 'short block reason')
    assert.equal((await move(db, 'acknowledged')).rows[0].s, 'acknowledged')
    assert.equal(await code(() => move(db, 'acknowledged')), '22023', 'acknowledged -> acknowledged')
    assert.equal(await code(() => move(db, 'resolved', null, 'long enough resolution')), '22023', 'acknowledged -> resolved')
    assert.equal((await move(db, 'in_progress')).rows[0].s, 'in_progress')
    assert.equal(await code(() => move(db, 'resolved', null, 'short')), '22023', 'short resolution')
    assert.equal((await move(db, 'blocked', 'waiting on a part')).rows[0].s, 'blocked')
    assert.equal(await code(() => move(db, 'resolved', null, 'long enough resolution')), '22023', 'blocked -> resolved')
    assert.equal((await move(db, 'in_progress')).rows[0].s, 'in_progress')
    assert.equal((await move(db, 'resolved', null, 'Replaced the tyre and torqued nuts')).rows[0].s, 'resolved')
    for (const s of ['acknowledged', 'in_progress', 'blocked', 'resolved'])
      assert.equal(await code(() => move(db, s, 'some reason', 'some resolution here')), '22023', `resolved is terminal (${s})`)
    await db.exec('RESET ROLE')
    const row = (await db.query(`select blocked_reason, resolution, completed_at from action_items where id='${ACTION}'`)).rows[0]
    assert.equal(row.blocked_reason, 'waiting on a part')
    assert.equal(row.resolution, 'Replaced the tyre and torqued nuts')
    assert.ok(row.completed_at)
  } finally { await db.close() }
})

test('tp_employee_action_transition is not callable by anon or PUBLIC', async () => {
  const db = await build()
  try {
    await db.exec('RESET ROLE')
    const r = await db.query(`select has_function_privilege('anon','public.tp_employee_action_transition(uuid,text,text,text)','execute') a,
      has_function_privilege('authenticated','public.tp_employee_action_transition(uuid,text,text,text)','execute') u`)
    assert.equal(r.rows[0].a, false)
    assert.equal(r.rows[0].u, true)
  } finally { await db.close() }
})

test('evidence metadata RLS: only the assignee may insert/read for their own action and path', async () => {
  const db = await build()
  try {
    await as(db, OTHER_EMP)
    assert.equal(await code(() => addEvidence(db, OTHER_EMP, ACTION, `${OTHER_EMP}/${ACTION}/a.jpg`)), '42501', 'other employee')
    await as(db, FOREIGN)
    assert.equal(await code(() => addEvidence(db, FOREIGN, ACTION, `${FOREIGN}/${ACTION}/a.jpg`)), '42501', 'other org')
    await as(db, EMP)
    assert.equal(await code(() => addEvidence(db, OTHER_EMP, ACTION, `${EMP}/${ACTION}/a.jpg`)), '42501', 'forged uploader')
    assert.equal(await code(() => addEvidence(db, EMP, ACTION, `${OTHER_EMP}/${ACTION}/a.jpg`)), '42501', "path in another user's folder")
    assert.equal(await code(() => addEvidence(db, EMP, ACTION, `${EMP}/${id(999)}/a.jpg`)), '42501', 'path for a different action')
    assert.equal(await code(() => addEvidence(db, EMP, ACTION, `${EMP}/${ACTION}/a.exe`, 'application/x-msdownload')), '23514', 'exe mime rejected')
    assert.equal(await code(() => addEvidence(db, EMP, ACTION, `${EMP}/${ACTION}/a.svg`, 'image/svg+xml')), '23514', 'svg rejected')
    assert.equal(await code(() => addEvidence(db, EMP, ACTION, `${EMP}/${ACTION}/ok.pdf`, 'application/pdf')), null, 'valid insert')
    assert.equal(await evidenceCount(db), 1)
    for (const u of [OTHER_EMP, FOREIGN, MANAGER, null]) {
      await as(db, u)
      assert.equal(await evidenceCount(db), 0, `evidence invisible to ${u}`)
    }
  } finally { await db.close() }
})

test('evidence rows are append-only for clients', async () => {
  const db = await build()
  try {
    await as(db, EMP)
    await addEvidence(db, EMP, ACTION, `${EMP}/${ACTION}/x.png`, 'image/png')
    assert.equal(await code(() => db.query("update team_action_evidence set mime_type='image/jpeg'")), '42501')
    assert.equal(await code(() => db.query('delete from team_action_evidence')), '42501')
  } finally { await db.close() }
})

test('evidence bucket is private with 10 MB and MIME allow-list configured', async () => {
  const db = await build()
  try {
    await db.exec('RESET ROLE')
    const b = (await db.query("select * from storage.buckets where id='team-action-evidence'")).rows[0]
    assert.equal(b.public, false)
    assert.equal(Number(b.file_size_limit), 10 * 1024 * 1024)
    assert.deepEqual([...b.allowed_mime_types].sort(), ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
  } finally { await db.close() }
})

test('storage object policies: upload/read/orphan-delete limited to the assignee', async () => {
  const db = await build()
  try {
    const put = path => db.query("insert into storage.objects(bucket_id,name) values('team-action-evidence',$1)", [path])
    const count = async () => (await db.query("select count(*)::int n from storage.objects where bucket_id='team-action-evidence'")).rows[0].n
    await as(db, OTHER_EMP)
    assert.equal(await code(() => put(`${OTHER_EMP}/${ACTION}/a.jpg`)), '42501', 'other employee upload')
    await as(db, FOREIGN)
    assert.equal(await code(() => put(`${FOREIGN}/${ACTION}/a.jpg`)), '42501', 'other org upload')
    await as(db, EMP)
    assert.equal(await code(() => put(`${OTHER_EMP}/${ACTION}/a.jpg`)), '42501', "someone else's folder")
    assert.equal(await code(() => put(`${EMP}/${id(999)}/a.jpg`)), '42501', 'unassigned action folder')
    assert.equal(await code(() => put(`${EMP}/${ACTION}/a.jpg`)), null)
    for (const u of [OTHER_EMP, FOREIGN, MANAGER, null]) { await as(db, u); assert.equal(await count(), 0, `object hidden from ${u}`) }
    await as(db, OTHER_EMP); await db.query("delete from storage.objects where name like '%a.jpg'")
    await as(db, FOREIGN); await db.query("delete from storage.objects where name like '%a.jpg'")
    await as(db, EMP)
    assert.equal(await count(), 1, 'foreign deletes removed nothing')
    await addEvidence(db, EMP, ACTION, `${EMP}/${ACTION}/a.jpg`)
    await db.query("delete from storage.objects where name like '%a.jpg'")
    assert.equal(await count(), 1, 'object with committed metadata cannot be deleted')
    await db.exec('RESET ROLE')
    await db.query("insert into storage.objects(bucket_id,name) values('team-action-evidence',$1)", [`${EMP}/${ACTION}/orphan.jpg`])
    await as(db, EMP)
    assert.equal(await count(), 2)
    await db.query("delete from storage.objects where name like '%orphan.jpg'")
    assert.equal(await count(), 1, 'orphan removed by assignee')
  } finally { await db.close() }
})

test('team_push_device_events: users write only their own rows; only the broadcast sender sees them', async () => {
  const db = await build()
  try {
    const ev = (user, msg, type = 'opened_by_user', etype = 'broadcast', eid = id(200)) =>
      db.query('insert into team_push_device_events(user_id,fcm_message_id,event_type,entity_type,entity_id) values($1,$2,$3,$4,$5)', [user, msg, type, etype, eid])
    const n = async () => (await db.query('select count(*)::int n from team_push_device_events')).rows[0].n
    await as(db, EMP)
    assert.equal(await code(() => ev(OTHER_EMP, 'm1')), '42501', 'cannot forge another user')
    assert.equal(await code(() => ev(EMP, '')), '42501', 'empty message id')
    assert.equal(await code(() => ev(EMP, 'm1', 'delivered_to_os')), '23514', 'OS-delivered is not an allowed event type')
    assert.equal(await code(() => ev(EMP, 'm1')), null)
    assert.equal(await code(() => ev(EMP, 'm1')), '23505', 'duplicate event id rejected')
    assert.equal(await code(() => ev(EMP, 'm1', 'received_foreground')), null)
    await as(db, OTHER_EMP); assert.equal(await n(), 0, 'another employee')
    await as(db, FOREIGN); assert.equal(await n(), 0, 'other org')
    await as(db, MANAGER); assert.equal(await n(), 2, 'sender sees events for own broadcast')
    await as(db, EMP)
    await ev(EMP, 'm2', 'opened_by_user', 'broadcast', id(201))
    await as(db, MANAGER)
    assert.equal(await n(), 2, 'not for broadcasts they did not send')
  } finally { await db.close() }
})
