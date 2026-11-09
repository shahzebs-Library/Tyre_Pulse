// Reassignment notification (20261109190000): the new assignee is alerted in-app and on their phone,
// the previous assignee is told in-app, and a notification failure never blocks the reassignment.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createWorkforceDb, asClient, createAssignment, newKey, U } from './fixtures/workforce_harness.mjs'

const db = await createWorkforceDb()
after(() => db.close())

// Minimal stand-ins for the delivery tables the trigger writes to.
await db.exec(`
  create schema if not exists workforce_internal;
  create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid, type text, title text,
    body text, entity_type text, entity_id uuid);
  create table public.domain_events(id bigserial primary key, event_type text, entity_type text, entity_id text,
    organisation_id uuid, actor_id uuid, payload jsonb, status text);
  create table public.workflow_notifications(id bigserial primary key, event_id bigint, organisation_id uuid,
    instance_id uuid, event_type text, payload jsonb, recipient_count int, status text);
  create table public.push_tokens_stub(user_id uuid, token text);
  create function public._user_push_tokens(p uuid) returns setof text language sql stable as $$
    select token from public.push_tokens_stub where user_id = p $$;
  insert into public.push_tokens_stub values ('${U.employee2}', 'ExponentPushToken[test]');
`)
await db.exec(readFileSync(new URL('../migrations/20261109190000_workforce_reassign_notify.sql', import.meta.url), 'utf8'))

const reassign = (a, to) => asClient(db, U.manager, async () =>
  (await db.query('select public.workforce_reassign($1,$2,$3,$4) r', [a, to, 'Shift handover', newKey()])).rows[0].r)

test('reassignment alerts the new assignee (in-app + push) and tells the previous one', async () => {
  const a = await createAssignment(db, U.manager)
  const r = await reassign(a, U.employee2)
  assert.equal(r.result, 'applied')
  const notes = (await db.query('select user_id, title from public.notifications where entity_id=$1 order by title', [a])).rows
  assert.deepEqual(notes.map(n => [n.user_id, n.title]), [
    [U.employee2, 'Work handed over to you'],
    [U.employee, 'Work reassigned to a colleague'],
  ])
  const push = (await db.query("select recipient_count, payload->'push'->>'title' t from public.workflow_notifications")).rows
  assert.equal(push.length, 1)
  assert.equal(push[0].recipient_count, 1)
  assert.equal(push[0].t, 'Work handed over to you')
})

test('a broken notification path never blocks the reassignment', async () => {
  const a = await createAssignment(db, U.manager)
  await db.exec('alter table public.notifications rename to notifications_off')
  try {
    const r = await reassign(a, U.employee2)
    assert.equal(r.result, 'applied')
    const owner = (await db.query('select assigned_to from public.workforce_assignments where id=$1', [a])).rows[0].assigned_to
    assert.equal(owner, U.employee2)
  } finally {
    await db.exec('alter table public.notifications_off rename to notifications')
  }
})

test('an update that keeps the same assignee sends nothing', async () => {
  const a = await createAssignment(db, U.manager)
  const before = (await db.query('select count(*)::int n from public.notifications')).rows[0].n
  await asClient(db, U.manager, () => db.query("update public.workforce_assignments set title='Renamed' where id=$1", [a]))
  const after_ = (await db.query('select count(*)::int n from public.notifications')).rows[0].n
  assert.equal(after_, before)
})
