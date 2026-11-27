import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { EMAIL_STUBS, SEED_USERS, id, ORG_A, ORG_B } from './fixtures/email_stubs.mjs'

const read = f => readFile(new URL(`../migrations/${f}`, import.meta.url), 'utf8')
const P0B = await read('20261128110000_workflow_notify_true_delivery.sql')
const P1 = await read('20261128111000_email_outbox.sql')

async function withDb(fn) {
  const db = new PGlite()
  try {
    await db.exec(EMAIL_STUBS + SEED_USERS)
    // notify_allowed_emails reads deliver_workflow_notifications' net._http_response only when called.
    await db.exec('CREATE TABLE net._http_response(id bigint, status_code int, content text, error_msg text);' + P0B + P1)
    await fn(db)
  } finally { await db.close() }
}
const enqueue = (db, args) => db.query(
  `SELECT public.enqueue_email($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) AS id`,
  [args.org ?? ORG_A, args.event ?? 'assignment.new', args.tpl ?? 'assignment.new', args.user ?? null, args.addr ?? null,
   'accident', 'abc', JSON.stringify(args.data ?? {}), args.key ?? `k-${Math.random()}`]).then(r => r.rows[0].id)

test('enqueue accepts verified staff and external mailboxes, rejects synthetic, locked and cross-org', async () => {
  await withDb(async db => {
    assert.ok(await enqueue(db, { user: id(1) }), 'real admin')
    assert.equal(await enqueue(db, { user: id(2) }), null, 'synthetic driver')
    assert.equal(await enqueue(db, { user: id(4) }), null, 'locked user')
    assert.equal(await enqueue(db, { user: id(3) }), null, 'user from another org')
    assert.ok(await enqueue(db, { addr: 'claims@insurer.com' }), 'external mailbox')
    assert.equal(await enqueue(db, { addr: 'x@users.tyrepulse.app' }), null)
    assert.equal(await enqueue(db, { addr: "a@b.com\r\nBcc: z@z.com" }), null, 'CR/LF in address')
    const ar = await enqueue(db, { user: id(5) })
    const row = (await db.query('SELECT locale, audience, to_address FROM email_outbox WHERE id=$1', [ar])).rows[0]
    assert.deepEqual(row, { locale: 'ar', audience: 'staff', to_address: 'sara@example.com' })
    const ext = (await db.query(`SELECT audience FROM email_outbox WHERE to_address='claims@insurer.com'`)).rows[0]
    assert.equal(ext.audience, 'external')
  })
})

test('dedupe: same key queues once; a failed row can be re-queued', async () => {
  await withDb(async db => {
    const a = await enqueue(db, { user: id(1), key: 'same' })
    const b = await enqueue(db, { user: id(1), key: 'same' })
    assert.ok(a); assert.equal(b, null)
    await db.query(`UPDATE email_outbox SET status='failed' WHERE id=$1`, [a])
    assert.ok(await enqueue(db, { user: id(1), key: 'same' }))
  })
})

test('suppressed addresses are refused at enqueue and at claim', async () => {
  await withDb(async db => {
    const a = await enqueue(db, { user: id(1) })
    await db.query(`INSERT INTO email_suppressions(address, reason) VALUES ('owner@example.com','bounce')`)
    assert.equal(await enqueue(db, { user: id(1) }), null)
    const claimed = (await db.query('SELECT * FROM email_outbox_claim(20)')).rows
    assert.equal(claimed.length, 0)
    assert.equal((await db.query('SELECT status FROM email_outbox WHERE id=$1', [a])).rows[0].status, 'suppressed')
  })
})

test('claim re-checks org membership at send time', async () => {
  await withDb(async db => {
    const a = await enqueue(db, { user: id(1) })
    await db.query(`UPDATE profiles SET organisation_id=$1 WHERE id=$2`, [ORG_B, id(1)])
    assert.equal((await db.query('SELECT * FROM email_outbox_claim(20)')).rows.length, 0)
    assert.equal((await db.query('SELECT status FROM email_outbox WHERE id=$1', [a])).rows[0].status, 'suppressed')
  })
})

test('claim caps at 20, report handles sent / transient backoff / dead / dry run', async () => {
  await withDb(async db => {
    for (let i = 0; i < 25; i++) await enqueue(db, { addr: `m${i}@insurer.com` })
    const c = (await db.query('SELECT * FROM email_outbox_claim(100)')).rows
    assert.equal(c.length, 20)
    await db.query(`SELECT email_outbox_report($1,'sent','resend','re_1')`, [c[0].id])
    await db.query(`SELECT email_outbox_report($1,'transient','resend',null,'rate',120)`, [c[1].id])
    await db.query(`SELECT email_outbox_report($1,'permanent','resend',null,'bad')`, [c[2].id])
    await db.query(`SELECT email_outbox_report($1,'dry_run')`, [c[3].id])
    await db.query(`UPDATE email_outbox SET attempts=8 WHERE id=$1`, [c[4].id])
    await db.query(`SELECT email_outbox_report($1,'transient','resend',null,'rate')`, [c[4].id])
    const st = async i => (await db.query(`SELECT status, next_attempt_at > now() + interval '100 seconds' AS later FROM email_outbox WHERE id=$1`, [c[i].id])).rows[0]
    assert.equal((await st(0)).status, 'sent')
    assert.deepEqual(await st(1), { status: 'pending', later: true })
    assert.equal((await st(2)).status, 'failed')
    assert.equal((await st(3)).status, 'dry_run')
    assert.equal((await st(4)).status, 'dead')
  })
})

test('mode defaults to dry_run; clients cannot touch the queue', async () => {
  await withDb(async db => {
    assert.equal((await db.query('SELECT email_dispatch_mode() m')).rows[0].m, 'dry_run')
    for (const fn of ['public.enqueue_email(uuid,text,text,uuid,text,text,text,jsonb,text,text,text)', 'public.email_outbox_claim(integer)', 'public.email_outbox_report(bigint,text,text,text,text,integer)', 'public.email_dispatch_kick()']) {
      for (const role of ['anon', 'authenticated']) {
        const ok = (await db.query(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') ok`)).rows[0].ok
        assert.equal(ok, false, `${role} ${fn}`)
      }
    }
    for (const t of ['email_outbox', 'email_suppressions', 'email_events']) {
      const ok = (await db.query(`SELECT has_table_privilege('authenticated','public.${t}','SELECT') ok`)).rows[0].ok
      assert.equal(ok, false, t)
    }
    await db.exec(`SET test.actor='${id(5)}'`)
    await assert.rejects(db.query('SELECT email_outbox_health()'))
    await db.exec(`SET test.actor='${id(1)}'`)
    const h = (await db.query('SELECT email_outbox_health() h')).rows[0].h
    assert.equal(h.mode, 'dry_run')
  })
})
