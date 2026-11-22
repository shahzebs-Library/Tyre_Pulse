import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

// PGlite harness for the DRAFT migration
// supabase/pending_migrations/20261113141000_ops_webhook_reliable_delivery.sql
// (MODC-74). pg_net is replaced by a stub: net.http_post() records the request
// in net.sent and the test writes the answer into net._http_response, so no
// network call is ever made.

const SQL = readFileSync(new URL('../pending_migrations/20261113141000_ops_webhook_reliable_delivery.sql', import.meta.url), 'utf8')
const ORG_A = '00000000-0000-0000-0000-00000000000a'
const ORG_B = '00000000-0000-0000-0000-00000000000b'
const db = new PGlite({ extensions: { pgcrypto } })

const q = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await q(sql, params))[0]
const run = async () => (await one('select public.deliver_pending_webhooks() r')).r
const delivery = (id) => one('select * from webhook_deliveries where id = $1', [id])
const sub = (id) => one('select * from webhook_subscriptions where id = $1', [id])
let evSeq = 1000

async function makeSub (org, url = 'https://hooks.customer.example/in', extra = {}) {
  const r = await one(
    'insert into webhook_subscriptions(organisation_id, name, url, active) values ($1, $2, $3, $4) returning id, secret',
    [org, extra.name || 'hook', url, extra.active ?? true])
  return r
}
async function enqueue (subId, org, { ageHours = 0, payload = { hello: 'world' }, type = 'tyre.fitted' } = {}) {
  const r = await one(
    `insert into webhook_deliveries(subscription_id, event_id, organisation_id, event_type, payload, created_at, next_attempt_at)
     values ($1, $2, $3, $4, $5, now() - make_interval(hours => $6), now() - interval '1 second') returning id`,
    [subId, ++evSeq, org, type, JSON.stringify(payload), ageHours])
  return r.id
}
const answer = (requestId, status, { error = null, timedOut = false } = {}) =>
  db.query('insert into net._http_response(id, status_code, error_msg, timed_out) values ($1, $2, $3, $4)', [requestId, status, error, timedOut])
const makeDue = (id) => db.query("update webhook_deliveries set next_attempt_at = now() - interval '1 second' where id = $1", [id])
async function asUser (org, elevated, fn) {
  await db.exec(`set test.org = '${org}'; set test.elevated = '${elevated ? 'on' : 'off'}'`)
  try { return await fn() } finally { await db.exec('reset test.org; reset test.elevated') }
}

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema extensions; create extension pgcrypto schema extensions;
    create schema net;
    create table net._http_response(id bigint primary key, status_code integer, error_msg text,
      timed_out boolean, created timestamptz default now());
    create table net.sent(id bigserial primary key, url text, headers jsonb, body jsonb, at timestamptz default now());
    create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
        headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000)
      returns bigint language plpgsql as $$
      declare v bigint;
      begin
        if url like '%raise-me%' then raise exception 'stub: cannot queue'; end if;
        insert into net.sent(url, headers, body) values (url, headers, body) returning id into v;
        return v;
      end $$;
    create function public.app_current_org() returns uuid language sql stable as $$
      select nullif(current_setting('test.org', true), '')::uuid $$;
    create function public.is_elevated_user() returns boolean language sql stable as $$
      select coalesce(current_setting('test.elevated', true), 'off') = 'on' $$;
    create table public.system_logs(id uuid primary key default gen_random_uuid(), organisation_id uuid,
      module_id text, severity text not null, source text, message text not null,
      detail jsonb not null default '{}'::jsonb, error_fingerprint text, resolved boolean not null default false,
      created_at timestamptz not null default now());
    create table public.webhook_subscriptions(
      id uuid primary key default gen_random_uuid(), organisation_id uuid not null, name text not null,
      url text not null check (url ~* '^https://'),
      secret text not null default encode(extensions.gen_random_bytes(24), 'hex'),
      event_types text[], active boolean not null default true, consecutive_failures integer not null default 0,
      disabled_reason text, last_success_at timestamptz, last_failure_at timestamptz, created_by uuid,
      created_at timestamptz not null default now());
    create table public.webhook_deliveries(
      id bigserial primary key,
      subscription_id uuid not null references public.webhook_subscriptions(id) on delete cascade,
      event_id bigint not null, organisation_id uuid, event_type text not null,
      payload jsonb not null default '{}'::jsonb,
      status text not null default 'pending' check (status in ('pending','delivered','failed')),
      attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
      request_id bigint, response_status integer, last_error text,
      created_at timestamptz not null default now(), delivered_at timestamptz,
      unique (subscription_id, event_id));
  `)
  await db.exec(SQL)
})

test('URL safety: public https only', async () => {
  const ok = async (u) => (await one('select public.webhook_url_is_safe($1) r', [u])).r
  assert.equal(await ok('https://hooks.customer.example/in?x=1'), true)
  assert.equal(await ok('https://8.8.8.8/hook'), true)
  for (const bad of [
    'http://hooks.customer.example/in', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.1.2.3/x',
    'https://192.168.1.5/x', 'https://172.16.0.9/x', 'https://172.31.255.1/x', 'https://169.254.169.254/latest/meta-data',
    'https://100.64.0.1/x', 'https://0.0.0.0/x', 'https://[::1]/x', 'https://db.internal/x', 'https://printer.local/x',
    'https://intranet/x', 'https://user:pw@hooks.customer.example/x', 'https://', '', null, 'ftp://x.example/y',
    'https://hooks.customer.example/a b',
  ]) assert.equal(await ok(bad), false, String(bad))
  assert.equal(await ok('https://172.32.0.1/x'), true)
})

test('an unsafe address is refused when a webhook is saved', async () => {
  await assert.rejects(() => makeSub(ORG_A, 'https://127.0.0.1/hook'), /not allowed/)
  const s = await makeSub(ORG_A)
  await assert.rejects(() => db.query("update webhook_subscriptions set url = 'https://10.0.0.1/x' where id = $1", [s.id]), /not allowed/)
})

test('a delivery is sent signed, then marked delivered on 2xx', async () => {
  const s = await makeSub(ORG_A)
  const id = await enqueue(s.id, ORG_A, { payload: { a: 1, text: 'x y' } })
  const r1 = await run()
  assert.equal(r1.sent, 1)
  let d = await delivery(id)
  assert.equal(d.attempts, 1)
  assert.ok(d.request_id)
  assert.ok(d.last_attempt_at)
  const sent = await one('select * from net.sent where id = $1', [d.request_id])
  const h = sent.headers
  assert.equal(h['X-TyrePulse-Event'], 'tyre.fitted')
  assert.equal(h['X-TyrePulse-Delivery'], String(id))
  assert.equal(h['X-TyrePulse-Attempt'], '1')
  // The signature must verify against the exact text Postgres sends.
  const body = (await one('select payload::text t from webhook_deliveries where id = $1', [id])).t
  const legacy = 'sha256=' + createHmac('sha256', s.secret).update(body).digest('hex')
  assert.equal(h['X-TyrePulse-Signature'], legacy)
  const ts = h['X-TyrePulse-Timestamp']
  const v1 = createHmac('sha256', s.secret).update(`${ts}.${body}`).digest('hex')
  assert.equal(h['X-TyrePulse-Signature-V2'], `t=${ts},v1=${v1}`)
  assert.ok(Math.abs(Number(ts) - Date.now() / 1000) < 120)
  // A second run before the answer arrives must not send it again.
  assert.equal((await run()).sent, 0)
  await answer(d.request_id, 200)
  const r2 = await run()
  assert.equal(r2.delivered, 1)
  d = await delivery(id)
  assert.equal(d.status, 'delivered')
  assert.equal(d.response_status, 200)
  assert.equal(d.request_id, null)
  assert.ok((await sub(s.id)).last_success_at)
})

test('a failing receiver is retried with backoff and ends as dead-letter with a reason and a log row', async () => {
  const s = await makeSub(ORG_A, 'https://hooks.customer.example/405')
  const id = await enqueue(s.id, ORG_A)
  await db.query('update webhook_deliveries set max_attempts = 3 where id = $1', [id])
  for (let attempt = 1; attempt <= 3; attempt++) {
    await makeDue(id)
    assert.equal((await run()).sent, 1, `attempt ${attempt} sent`)
    const d = await delivery(id)
    assert.equal(d.attempts, attempt)
    await answer(d.request_id, 405)
    const r = await run()
    const after = await delivery(id)
    if (attempt < 3) {
      assert.equal(r.retrying, 1)
      assert.equal(after.status, 'pending')
      assert.equal(after.last_error, 'HTTP 405')
      // backoff: 2 then 4 minutes, plus at most 20 percent jitter
      const waitMin = (new Date(after.next_attempt_at) - Date.now()) / 60000
      const base = 2 ** attempt
      assert.ok(waitMin > base - 0.2 && waitMin < base * 1.2 + 0.2, `wait ${waitMin} for attempt ${attempt}`)
      // not due yet, so it is not sent again
      assert.equal((await run()).sent, 0)
    } else {
      assert.equal(r.dead, 1)
      assert.equal(after.status, 'failed')
      assert.ok(after.dead_at)
      assert.match(after.dead_reason, /Gave up after 3 attempts/)
      assert.equal(after.response_status, 405)
    }
  }
  const logs = await q("select * from system_logs where source = 'webhooks' and error_fingerprint = $1", [`webhook:dead:${s.id}`])
  assert.equal(logs.length, 1)
  assert.equal(logs[0].organisation_id, ORG_A)
  assert.equal(logs[0].module_id, 'integrations')
  assert.equal(logs[0].severity, 'error')
  // No address and no secret in the log text or detail.
  const dump = JSON.stringify(logs[0])
  assert.ok(!dump.includes('hooks.customer.example'))
  assert.ok(!dump.includes(s.secret))
  assert.equal((await sub(s.id)).consecutive_failures, 3)
})

test('a timeout and a lost response both count as failed attempts', async () => {
  const s = await makeSub(ORG_A)
  const a = await enqueue(s.id, ORG_A)
  const b = await enqueue(s.id, ORG_A)
  await run()
  const da = await delivery(a)
  await answer(da.request_id, null, { error: 'Timeout was reached', timedOut: true })
  // b: no response row at all, and the attempt is 20 minutes old
  await db.query("update webhook_deliveries set last_attempt_at = now() - interval '20 minutes' where id = $1", [b])
  const r = await run()
  assert.equal(r.retrying, 2)
  assert.match((await delivery(a)).last_error, /did not answer within 10 seconds/)
  const db2 = await delivery(b)
  assert.equal(db2.request_id, null)
  assert.match(db2.last_error, /No response was recorded/)
  assert.equal(db2.status, 'pending')
})

test('a fresh in-flight request with no answer yet is left alone', async () => {
  const s = await makeSub(ORG_A)
  const id = await enqueue(s.id, ORG_A)
  await run()
  const r = await run()
  assert.equal(r.retrying, 0)
  assert.ok((await delivery(id)).request_id)
})

test('HTTP 410 is final at once and switches the webhook off', async () => {
  const s = await makeSub(ORG_A)
  const id = await enqueue(s.id, ORG_A)
  await run()
  await answer((await delivery(id)).request_id, 410)
  const r = await run()
  assert.equal(r.dead, 1)
  const d = await delivery(id)
  assert.equal(d.status, 'failed')
  assert.match(d.dead_reason, /410 Gone/)
  const sb = await sub(s.id)
  assert.equal(sb.active, false)
  assert.ok(sb.disabled_at)
  assert.equal((await q('select 1 from system_logs where error_fingerprint = $1', [`webhook:disabled:${s.id}`])).length, 1)
})

test('20 consecutive failures switch the webhook off and report it once', async () => {
  const s = await makeSub(ORG_A)
  await db.query('update webhook_subscriptions set consecutive_failures = 19 where id = $1', [s.id])
  const id = await enqueue(s.id, ORG_A)
  await run()
  await answer((await delivery(id)).request_id, 500)
  await run()
  const sb = await sub(s.id)
  assert.equal(sb.active, false)
  assert.equal(sb.consecutive_failures, 20)
  assert.match(sb.disabled_reason, /20 consecutive failures/)
  const logs = await q('select severity, organisation_id from system_logs where error_fingerprint = $1', [`webhook:disabled:${s.id}`])
  assert.deepEqual(logs, [{ severity: 'error', organisation_id: ORG_A }])
  // Switching it back on clears the counter so old failures cannot disable it again.
  await db.query('update webhook_subscriptions set active = true where id = $1', [s.id])
  const on = await sub(s.id)
  assert.equal(on.consecutive_failures, 0)
  assert.equal(on.disabled_reason, null)
  assert.equal(on.disabled_at, null)
})

test('rows stranded behind a switched-off webhook expire to dead-letter after 72 hours (the July rows)', async () => {
  const s = await makeSub(ORG_A)
  await db.query('update webhook_subscriptions set active = false where id = $1', [s.id])
  const old = await enqueue(s.id, ORG_A, { ageHours: 100 })
  const young = await enqueue(s.id, ORG_A, { ageHours: 5 })
  const sentBefore = (await one('select count(*)::int n from net.sent')).n
  const r = await run()
  assert.equal(r.expired, 1)
  assert.equal((await one('select count(*)::int n from net.sent')).n, sentBefore, 'nothing is sent for a switched-off webhook')
  const d = await delivery(old)
  assert.equal(d.status, 'failed')
  assert.match(d.dead_reason, /72 hours because the webhook was switched off/)
  assert.equal((await delivery(young)).status, 'pending')
  assert.equal((await q('select 1 from system_logs where error_fingerprint = $1', [`webhook:expired:${s.id}`])).length, 1)
})

test('a delivery whose organisation differs from its webhook is never sent', async () => {
  const s = await makeSub(ORG_A)
  const id = await enqueue(s.id, ORG_B)
  const before = (await one('select count(*)::int n from net.sent')).n
  await run()
  assert.equal((await one('select count(*)::int n from net.sent')).n, before)
  assert.equal((await delivery(id)).attempts, 0)
  await db.query("update webhook_deliveries set created_at = now() - interval '80 hours' where id = $1", [id])
  await run()
  assert.match((await delivery(id)).dead_reason, /different organisations/)
})

test('one organisation with a backlog cannot starve another (20 per organisation per run)', async () => {
  await db.exec("update webhook_deliveries set status = 'failed' where status = 'pending'")
  const a = await makeSub(ORG_A)
  const b = await makeSub(ORG_B)
  for (let i = 0; i < 30; i++) await enqueue(a.id, ORG_A)
  const bId = await enqueue(b.id, ORG_B)
  const r = await run()
  assert.equal(r.sent, 21)
  assert.equal((await delivery(bId)).attempts, 1)
  assert.equal((await one("select count(*)::int n from webhook_deliveries where subscription_id = $1 and attempts = 1", [a.id])).n, 20)
})

test('a request that cannot be queued fails that one row and the run continues', async () => {
  await db.exec("update webhook_deliveries set status = 'failed' where status = 'pending'")
  const bad = await makeSub(ORG_A, 'https://raise-me.customer.example/x')
  const good = await makeSub(ORG_B)
  const badId = await enqueue(bad.id, ORG_A)
  const goodId = await enqueue(good.id, ORG_B)
  const r = await run()
  assert.equal(r.sent, 1)
  assert.equal(r.retrying, 1)
  const d = await delivery(badId)
  assert.equal(d.attempts, 1)
  assert.match(d.last_error, /Could not send/)
  assert.equal(d.request_id, null)
  assert.ok((await delivery(goodId)).request_id)
})

test('send test: own organisation, elevated, active, one per minute, one attempt only', async () => {
  const s = await makeSub(ORG_A)
  const other = await makeSub(ORG_B)
  const call = (id) => one('select public.webhook_send_test($1) r', [id]).then((x) => x.r)
  await assert.rejects(() => asUser(ORG_A, false, () => call(s.id)), /permission/)
  assert.deepEqual(await asUser(ORG_A, true, () => call(other.id)), { ok: false, reason: 'not_found' })
  const ok = await asUser(ORG_A, true, () => call(s.id))
  assert.equal(ok.ok, true)
  const d = await delivery(ok.delivery_id)
  assert.equal(d.event_type, 'webhook.test')
  assert.equal(d.max_attempts, 1)
  assert.equal(d.organisation_id, ORG_A)
  assert.ok(Number(d.event_id) < 0)
  assert.deepEqual(await asUser(ORG_A, true, () => call(s.id)), { ok: false, reason: 'too_soon' })
  // one attempt: a 405 answer is final immediately
  await run()
  await answer((await delivery(ok.delivery_id)).request_id, 405)
  await run()
  assert.equal((await delivery(ok.delivery_id)).status, 'failed')
  await db.query('update webhook_subscriptions set active = false where id = $1', [s.id])
  await db.query("update webhook_deliveries set created_at = now() - interval '5 minutes' where subscription_id = $1", [s.id])
  assert.deepEqual(await asUser(ORG_A, true, () => call(s.id)), { ok: false, reason: 'webhook_inactive' })
})

test('retry: own organisation only, dead-letter rows only, exactly one more attempt', async () => {
  const s = await makeSub(ORG_A)
  const id = await enqueue(s.id, ORG_A)
  await db.query("update webhook_deliveries set status = 'failed', attempts = 8, dead_at = now(), dead_reason = 'x' where id = $1", [id])
  const call = (x) => one('select public.webhook_retry_delivery($1) r', [x]).then((y) => y.r)
  await assert.rejects(() => asUser(ORG_A, false, () => call(id)), /permission/)
  assert.deepEqual(await asUser(ORG_B, true, () => call(id)), { ok: false, reason: 'not_found' })
  assert.deepEqual(await asUser(ORG_A, true, () => call(id)), { ok: true })
  let d = await delivery(id)
  assert.equal(d.status, 'pending')
  assert.equal(d.max_attempts, 9)
  assert.equal(d.dead_reason, null)
  assert.deepEqual(await asUser(ORG_A, true, () => call(id)), { ok: false, reason: 'still_pending' })
  await run()
  d = await delivery(id)
  assert.equal(d.attempts, 9)
  await answer(d.request_id, 500)
  await run()
  assert.equal((await delivery(id)).status, 'failed')
})

test('failure reports are limited to one per webhook and kind per hour', async () => {
  const s = await makeSub(ORG_A)
  for (let i = 0; i < 3; i++) {
    const id = await enqueue(s.id, ORG_A)
    await db.query('update webhook_deliveries set max_attempts = 1 where id = $1', [id])
  }
  await run()
  for (const row of await q('select request_id from webhook_deliveries where subscription_id = $1', [s.id])) await answer(row.request_id, 500)
  const r = await run()
  assert.equal(r.dead, 3)
  assert.equal((await q('select 1 from system_logs where error_fingerprint = $1', [`webhook:dead:${s.id}`])).length, 1)
})

test('only cron may run the worker; the customer RPCs are for signed-in users only', async () => {
  const p = await one(`select
    has_function_privilege('anon', 'public.deliver_pending_webhooks()', 'EXECUTE') w_anon,
    has_function_privilege('authenticated', 'public.deliver_pending_webhooks()', 'EXECUTE') w_auth,
    has_function_privilege('anon', 'public.webhook_send_test(uuid)', 'EXECUTE') t_anon,
    has_function_privilege('authenticated', 'public.webhook_send_test(uuid)', 'EXECUTE') t_auth,
    has_function_privilege('anon', 'public.webhook_retry_delivery(bigint)', 'EXECUTE') r_anon,
    has_function_privilege('authenticated', 'public._webhook_log(uuid,text,text,text,jsonb)', 'EXECUTE') l_auth`)
  assert.deepEqual(p, { w_anon: false, w_auth: false, t_anon: false, t_auth: true, r_anon: false, l_auth: false })
})
