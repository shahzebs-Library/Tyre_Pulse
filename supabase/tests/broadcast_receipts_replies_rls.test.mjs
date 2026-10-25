import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
// RLS negative/positive tests for broadcast_recipient_receipts + broadcast_replies,
// running the real migration against PGlite.
const sql = await readFile(new URL('../migrations/20261025140000_broadcast_receipts_replies_ddl.sql', import.meta.url), 'utf8')
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const [SENDER, RECIP, OUTSIDER] = [id(1), id(2), id(3)]
const BC = id(100)

async function build() {
  const db = new PGlite()
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth, public TO authenticated, anon;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
    CREATE TABLE public.broadcast_messages(id uuid PRIMARY KEY, sent_by uuid);
    GRANT SELECT ON public.broadcast_messages TO authenticated;
    INSERT INTO auth.users VALUES ('${SENDER}'),('${RECIP}'),('${OUTSIDER}');
    INSERT INTO public.broadcast_messages VALUES ('${BC}','${SENDER}');
  `)
  await db.exec(sql)
  await db.exec(`INSERT INTO public.broadcast_recipient_receipts(broadcast_id,recipient_id) VALUES ('${BC}','${RECIP}');`)
  return db
}
async function as(db, actor, fn) {
  await db.exec(`SET test.actor='${actor}'; SET ROLE authenticated;`)
  try { return await fn() } finally { await db.exec(`RESET ROLE; RESET test.actor;`) }
}
const count = async (db, t) => (await db.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n

test('migration is idempotent', async () => {
  const db = await build()
  await db.exec(sql)
})

test('receipts: recipient and sender see it, outsider does not', async () => {
  const db = await build()
  assert.equal(await as(db, RECIP, () => count(db, 'broadcast_recipient_receipts')), 1)
  assert.equal(await as(db, SENDER, () => count(db, 'broadcast_recipient_receipts')), 1)
  assert.equal(await as(db, OUTSIDER, () => count(db, 'broadcast_recipient_receipts')), 0)
})

test('receipts: recipient can mark read, others cannot, identity columns locked', async () => {
  const db = await build()
  const upd = (actor) => as(db, actor, async () =>
    (await db.query(`UPDATE public.broadcast_recipient_receipts SET read_at=now() WHERE broadcast_id='${BC}' RETURNING 1`)).rows.length)
  assert.equal(await upd(RECIP), 1)
  assert.equal(await upd(OUTSIDER), 0)
  assert.equal(await upd(SENDER), 0)
  await assert.rejects(as(db, RECIP, () =>
    db.query(`UPDATE public.broadcast_recipient_receipts SET recipient_id='${OUTSIDER}'`)), /permission denied/)
  await assert.rejects(as(db, RECIP, () =>
    db.query(`INSERT INTO public.broadcast_recipient_receipts(broadcast_id,recipient_id) VALUES ('${BC}','${OUTSIDER}')`)), /permission denied|row-level security/)
})

test('replies: only a recipient can reply, as themselves, non-empty', async () => {
  const db = await build()
  const ins = (actor, author, body) => as(db, actor, () =>
    db.query(`INSERT INTO public.broadcast_replies(broadcast_id,author_id,body) VALUES ('${BC}','${author}','${body}')`))
  await ins(RECIP, RECIP, 'ok')
  await assert.rejects(ins(OUTSIDER, OUTSIDER, 'hi'), /row-level security/)
  await assert.rejects(ins(RECIP, SENDER, 'spoof'), /row-level security/)
  await assert.rejects(ins(RECIP, RECIP, '   '), /check/)
})

test('replies: visible to author, sender and recipients, not outsiders', async () => {
  const db = await build()
  await db.exec(`INSERT INTO public.broadcast_replies(broadcast_id,author_id,body) VALUES ('${BC}','${RECIP}','hello')`)
  assert.equal(await as(db, RECIP, () => count(db, 'broadcast_replies')), 1)
  assert.equal(await as(db, SENDER, () => count(db, 'broadcast_replies')), 1)
  assert.equal(await as(db, OUTSIDER, () => count(db, 'broadcast_replies')), 0)
})
