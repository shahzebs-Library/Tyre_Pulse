import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { randomUUID, createHmac } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('recovery reservations and attempts enforce limits and service-only grants', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table password_recovery_challenges (
        id uuid primary key, user_id uuid, purpose text, channel text,
        destination_hash text, code_hash text, requester_hash text,
        expires_at timestamptz, created_at timestamptz default now(),
        attempts integer default 0, consumed_at timestamptz);
      grant all on password_recovery_challenges to service_role;`);
    await db.exec(await readFile(new URL('../security-rollout/migrations/20260909074840_atomic_recovery_limits.sql', import.meta.url), 'utf8'));
    const permissions = await db.query(`select
      has_function_privilege('anon','reserve_recovery_challenge(jsonb)','EXECUTE') as anon,
      has_function_privilege('authenticated','claim_recovery_attempt(uuid,text,text,uuid)','EXECUTE') as authed,
      has_function_privilege('service_role','reserve_recovery_challenge(jsonb)','EXECUTE') as service`);
    assert.deepEqual(permissions.rows[0], { anon: false, authed: false, service: true });
    const challenge = (overrides = {}) => ({ id: randomUUID(), user_id: randomUUID(),
      purpose: 'password_recovery', channel: 'email', destination_hash: 'destination',
      code_hash: 'hash', requester_hash: 'requester', ...overrides });
    const reserve = async (row) => (await db.query('select reserve_recovery_challenge($1) as ok', [JSON.stringify(row)])).rows[0].ok;
    const first = challenge();
    assert.equal(await reserve(first), true);
    const results = await Promise.all(Array.from({ length: 9 }, () => reserve(challenge())));
    assert.equal(results.filter(Boolean).length, 4);
    assert.equal(await reserve(challenge({ requester_hash: 'other' })), false, 'destination limit spans requesters');
    assert.equal(await reserve(challenge({ destination_hash: 'other' })), false, 'requester limit spans destinations');
    const attempt = async (id, purpose = 'password_recovery', user = null) => (await db.query(
      "select claim_recovery_attempt($1,$2,'email',$3) as result", [id, purpose, user])).rows[0].result;
    const attempts = await Promise.all(Array.from({ length: 12 }, () => attempt(first.id)));
    assert.equal(attempts.filter(Boolean).length, 5);
    assert.deepEqual(attempts.filter(Boolean).map(x => x.attempts), [1, 2, 3, 4, 5]);
    const contact = challenge({ purpose: 'contact_verification', requester_hash: 'new', destination_hash: 'new' });
    assert.equal(await reserve(contact), true);
    assert.equal(await attempt(contact.id, 'contact_verification', randomUUID()), null);
    assert.equal((await attempt(contact.id, 'contact_verification', contact.user_id)).attempts, 1);
    await db.query('update password_recovery_challenges set consumed_at=now() where id=$1', [contact.id]);
    assert.equal(await attempt(contact.id, 'contact_verification', contact.user_id), null);
    await db.query("update password_recovery_challenges set created_at=now()-interval '16 minutes'");
    const expired = challenge();
    assert.equal(await reserve(expired), true, 'window expires');
    await db.query("update password_recovery_challenges set expires_at=now()-interval '1 second' where id=$1", [expired.id]);
    assert.equal(await attempt(expired.id), null);
  } finally { await db.close(); }
});

async function billingHandler(error = null) {
  let handler;
  const writes = [];
  const source = stripTypeScriptTypes((await readFile(new URL('../security-rollout/functions/billing-webhook/index.ts', import.meta.url), 'utf8'))
    .replace(/^import .*createClient.*\r?\n/m, ''));
  const query = { upsert(patch) { writes.push(patch); return Promise.resolve({ error }); },
    update(patch) { writes.push(patch); return { eq: async () => ({ error }) }; } };
  vm.runInNewContext(source, { TextEncoder, Response, Date, crypto: globalThis.crypto,
    console: { error() {} }, createClient: () => ({ from: () => query }),
    Deno: { env: { get: () => 'local-test-secret' }, serve: fn => { handler = fn; } } });
  return { writes, send: async (type, object) => {
    const body = JSON.stringify({ type, data: { object } });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', 'local-test-secret').update(`${timestamp}.${body}`).digest('hex');
    return handler(new Request('https://local.invalid', { method: 'POST', body,
      headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` } }));
  } };
}

test('recovery Edge fails closed on denied or failed atomic attempts and reservations', async () => {
  const source = stripTypeScriptTypes((await readFile(new URL('../security-rollout/functions/account-recovery/index.ts', import.meta.url), 'utf8'))
    .replace(/^import .*\r?\n/gm, ''));
  for (const action of ['verify_recovery', 'verify_contact', 'request_recovery', 'request_contact']) {
    for (const rpcError of [null, { message: 'simulated RPC failure' }]) {
      let handler;
      const calls = [];
      const actor = randomUUID();
      const admin = {
        rpc: async (name, args) => { calls.push({ name, args }); return { data: null, error: rpcError }; },
        auth: { getUser: async () => ({ data: { user: { id: actor } } }) },
        from: () => ({ delete: () => ({ lt: async () => ({ error: null }) }),
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
      };
      vm.runInNewContext(source, { TextEncoder, Response, Date, crypto: globalThis.crypto,
        console: { error() {} }, createClient: () => admin, corsHeaders: () => ({}),
        jsonResponse: (_req, body, status = 200) => new Response(JSON.stringify(body), { status }),
        fetch: () => { throw new Error('No delivery is allowed in this test'); },
        Deno: { env: { get: () => 'local-test-secret-with-more-than-32-characters' }, serve: fn => { handler = fn; } } });
      const response = await handler(new Request('https://local.invalid', { method: 'POST',
        headers: { authorization: 'Bearer local-test-token' }, body: JSON.stringify({ action,
          destination: 'local@example.invalid', channel: 'email', code: '123456', challengeId: randomUUID() }) }));
      assert.equal(response.status, rpcError ? 503 : action.startsWith('verify') ? 400 : action === 'request_contact' ? 429 : 202);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].name, action.startsWith('verify') ? 'claim_recovery_attempt' : 'reserve_recovery_challenge');
      if (action === 'verify_contact') assert.equal(calls[0].args.p_user_id, actor);
      assert.equal(response.headers.get('Cache-Control'), 'no-store, max-age=0');
    }
  }
});

test('billing rejects returned database failures for every reconciliation event', async () => {
  for (const type of ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted']) {
    const handler = await billingHandler({ message: 'simulated database failure' });
    const response = await handler.send(type, { id: 'sub_test', metadata: { plan_code: 'test', org_id: randomUUID() } });
    assert.equal(response.status, 500, type);
    assert.deepEqual(await response.json(), { error: 'reconciliation_failed' });
  }
});

test('billing preserves valid states and never activates unknown or unpaid states', async () => {
  for (const status of ['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', 'unknown']) {
    for (const cancel_at_period_end of [true, false]) {
      const handler = await billingHandler();
      assert.equal((await handler.send('customer.subscription.updated', { id: 'sub_test', status, cancel_at_period_end })).status, 200);
      assert.equal(handler.writes[0].status, ['active', 'trialing', 'past_due', 'canceled'].includes(status) ? status : 'expired');
    }
  }
});

test('fleet read-only users cannot write and document chunks inherit parent tenant scope', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated;
      create function app_user_can(text,text) returns boolean language sql as
        $$ select current_setting('test.can_write',true) = 'true' $$;
      create table vehicle_fleet (id integer primary key, organisation_id text, label text);
      create table knowledge_documents (id uuid primary key, organisation_id text);
      create table document_chunks (id uuid primary key, document_id uuid);
      alter table vehicle_fleet enable row level security;
      alter table knowledge_documents enable row level security;
      alter table document_chunks enable row level security;
      grant select,insert,update on vehicle_fleet to authenticated;
      grant select on knowledge_documents,document_chunks to authenticated;
      create policy fleet_broad on vehicle_fleet to authenticated using (true) with check (true);
      create policy fleet_org on vehicle_fleet as restrictive to authenticated
        using (organisation_id = current_setting('test.org')) with check (organisation_id = current_setting('test.org'));
      create policy document_org on knowledge_documents to authenticated using (organisation_id=current_setting('test.org'));
      create policy chunks_broad on document_chunks to authenticated using (true);
      insert into vehicle_fleet values (1,'a','original'),(2,'b','other');
      insert into knowledge_documents values ('00000000-0000-0000-0000-000000000001','a'),('00000000-0000-0000-0000-000000000002','b');
      insert into document_chunks values
        ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),
        ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002'),
        ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003');`);
    await db.exec(await readFile(new URL('../security-rollout/migrations/20260909075034_enforce_fleet_capabilities_and_chunk_scope.sql', import.meta.url), 'utf8'));
    await db.exec("set role authenticated; set test.org='a'; set test.can_write='false';");
    assert.equal((await db.query('select * from vehicle_fleet')).rows.length, 1);
    assert.equal((await db.query("update vehicle_fleet set label='blocked' returning id")).rows.length, 0);
    await assert.rejects(db.query("insert into vehicle_fleet values (3,'a','blocked')"), /row-level security/);
    assert.equal((await db.query('select * from document_chunks')).rows.length, 1, 'foreign and orphan chunks denied');
    await db.exec("set test.can_write='true';");
    assert.equal((await db.query("update vehicle_fleet set label='allowed' returning id")).rows.length, 1);
    await db.query("insert into vehicle_fleet values (3,'a','allowed')");
    await assert.rejects(db.query("insert into vehicle_fleet values (4,'b','blocked')"), /row-level security/);
    await assert.rejects(db.query("update vehicle_fleet set organisation_id='b' where id=1"), /row-level security/);
  } finally { await db.close(); }
});
