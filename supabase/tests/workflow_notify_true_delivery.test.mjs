import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../migrations/20261128110000_workflow_notify_true_delivery.sql', import.meta.url), 'utf8')
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`

const STUBS = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth; CREATE SCHEMA net;
  CREATE TABLE auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
  CREATE TABLE public.profiles(id uuid primary key, locked boolean, recovery_email text, recovery_email_verified_at timestamptz);
  CREATE TABLE public.cron_config(name text primary key, value text);
  INSERT INTO public.cron_config VALUES ('workflow_notify_secret','s'),('anon_key','k');
  CREATE TABLE net._http_response(id bigint primary key, status_code int, content text, error_msg text);
  CREATE SEQUENCE net.req_seq;
  CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) RETURNS bigint
    LANGUAGE sql AS $$ SELECT nextval('net.req_seq') $$;
  CREATE TABLE public.workflow_notifications(id bigint primary key, payload jsonb default '{}', status text default 'pending'
    check (status in ('pending','delivered','failed','skipped')), attempts int default 0, next_attempt_at timestamptz default now(),
    request_id bigint, response_status int, result jsonb, last_error text, delivered_at timestamptz);
`

async function withDb(fn) {
  const db = new PGlite()
  try { await db.exec(STUBS + migration); await fn(db) } finally { await db.close() }
}

async function settle(db, rowId, status, content) {
  await db.query('INSERT INTO net._http_response VALUES ($1,$2,$3,null)', [100 + rowId, status, content])
  await db.query('UPDATE workflow_notifications SET request_id=$1, attempts=1 WHERE id=$2', [100 + rowId, rowId])
}

test('sent=0 is never marked delivered; transient retries; nothing deliverable is skipped', async () => {
  await withDb(async db => {
    for (const n of [1, 2, 3, 4, 5]) await db.query('INSERT INTO workflow_notifications(id) VALUES ($1)', [n])
    await settle(db, 1, 200, JSON.stringify({ sent_total: 2, transient_total: 0, failed_total: 0 }))
    await settle(db, 2, 200, JSON.stringify({ sent_total: 0, transient_total: 3, failed_total: 0, retry_after_seconds: 600 }))
    await settle(db, 3, 200, JSON.stringify({ sent_total: 0, transient_total: 0, failed_total: 4 }))
    await settle(db, 4, 200, JSON.stringify({ sent_total: 0, transient_total: 0, failed_total: 0 }))
    // Legacy response shape from an older edge deploy: 0 sent everywhere.
    await settle(db, 5, 200, JSON.stringify({ email: 0, push: 0, whatsapp: 0, skipped: ['push(fcm): THIRD_PARTY_AUTH_ERROR'] }))
    await db.query('SELECT public.deliver_workflow_notifications()')
    const rows = (await db.query(`SELECT id, status, next_attempt_at > now() + interval '9 minutes' AS waits FROM workflow_notifications ORDER BY id`)).rows
    assert.equal(rows[0].status, 'delivered')
    assert.equal(rows[1].status, 'pending'); assert.equal(rows[1].waits, true)
    assert.equal(rows[2].status, 'failed')
    assert.equal(rows[3].status, 'skipped')
    assert.notEqual(rows[4].status, 'delivered')
  })
})

test('a transient row stops retrying after 6 attempts', async () => {
  await withDb(async db => {
    await db.query('INSERT INTO workflow_notifications(id) VALUES (1)')
    await settle(db, 1, 200, JSON.stringify({ sent_total: 0, transient_total: 1 }))
    await db.query('UPDATE workflow_notifications SET attempts=6 WHERE id=1')
    await db.query('SELECT public.deliver_workflow_notifications()')
    assert.equal((await db.query('SELECT status FROM workflow_notifications')).rows[0].status, 'failed')
  })
})

test('notify_allowed_emails returns only real verified addresses and is service_role only', async () => {
  await withDb(async db => {
    await db.exec(`
      INSERT INTO auth.users VALUES
        ('${id(1)}','driver1@users.tyrepulse.app', now()),
        ('${id(2)}','boss@example.com', now()),
        ('${id(3)}','new@example.com', null),
        ('${id(4)}','tm@users.tyrepulse.app', now());
      INSERT INTO public.profiles VALUES
        ('${id(1)}', false, null, null),
        ('${id(2)}', false, null, null),
        ('${id(3)}', false, null, null),
        ('${id(4)}', false, 'Tm.Real@Example.com', now());`)
    const r = (await db.query(`SELECT user_id, email FROM notify_allowed_emails(ARRAY['${id(1)}','${id(2)}','${id(3)}','${id(4)}']::uuid[]) ORDER BY user_id`)).rows
    assert.deepEqual(r.map(x => x.email), ['boss@example.com', 'tm.real@example.com'])
    for (const role of ['anon', 'authenticated']) {
      const ok = (await db.query(`SELECT has_function_privilege('${role}', 'public.notify_allowed_emails(uuid[])', 'EXECUTE') ok`)).rows[0].ok
      assert.equal(ok, false, role)
    }
    assert.equal((await db.query(`SELECT has_function_privilege('service_role','public.notify_allowed_emails(uuid[])','EXECUTE') ok`)).rows[0].ok, true)
  })
})
