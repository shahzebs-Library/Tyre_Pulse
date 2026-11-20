// REAL two-connection concurrency on the local staging PostgreSQL cluster
// (/var/lib/postgresql/tp-staging, 127.0.0.1:54329, started as postgres with pg_ctl).
// PGlite is one connection, so true races are only provable here. Skipped (not failed)
// when the cluster is not running. A throwaway database is created from the harness
// platform + seed + all inventory migrations, raced, and dropped. Synthetic data only;
// it never touches tyrepulse_staging or any mirror database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { PLATFORM_SQL, SEED_SQL, MIGRATIONS, sqlOf, id, U } from './inventory_harness.test.mjs'

const PORT = process.env.TP_STAGING_PORT || '54329'
const psqlArgs = db => ['postgres', '-c', `psql -h 127.0.0.1 -p ${PORT} -d ${db} -v ON_ERROR_STOP=1 -X -At -q`]
const up = () => {
  const r = spawnSync('su', ['postgres', '-c', `psql -h 127.0.0.1 -p ${PORT} -d postgres -Atc 'select 1'`], { encoding: 'utf8' })
  return r.status === 0 && r.stdout.trim() === '1'
}
const run = (db, sql) => new Promise((resolve, reject) => {
  const p = spawn('su', psqlArgs(db))
  let out = ''; let err = ''
  p.stdout.on('data', d => { out += d }); p.stderr.on('data', d => { err += d })
  p.on('close', c => (c === 0 ? resolve(out.trim()) : reject(new Error(err || `psql exit ${c}`))))
  p.stdin.end(sql)
})
const as = (uid, sql) => `select set_config('test.uid', '${uid}', false); set role authenticated; ${sql}`

test('staging: two real connections cannot oversell a balance, and a double-submit posts once', { skip: !up() && 'staging cluster not running on 127.0.0.1:' + PORT }, async () => {
  const db = `inv_conc_${Date.now()}`
  await run('postgres', `create database ${db}`)
  try {
    // cluster-wide roles already exist on the staging cluster
    const platform = PLATFORM_SQL.replace('create role authenticated; create role anon; create role service_role;', () => 'select 1;')
    await run(db, platform)
    await run(db, SEED_SQL)
    for (const f of MIGRATIONS) await run(db, sqlOf(f))
    const loc = JSON.parse((await run(db, as(U.admin, `select public.inv_location_upsert('{"idempotency_key":"l1","country":"KSA","site":"S1","location_type":"warehouse","code":"WH1"}'::jsonb)`))).split('\n').pop())
    const rec = JSON.parse((await run(db, as(U.keeper, `select public.inv_post_movement('{"idempotency_key":"r1","item_id":"${id(100)}","location_id":"${loc.id}","movement_type":"receipt","qty_change":10,"unit_cost":3}'::jsonb)`))).split('\n').pop())
    const sid = rec.stock_id

    // Race 1: A holds the balance row lock while B tries to issue the same 6 units.
    const a = run(db, as(U.keeper, `begin; select public.inv_issue('{"idempotency_key":"a1","stock_id":"${sid}","qty":6}'::jsonb); select pg_sleep(1.5); commit;`))
    await new Promise(r => setTimeout(r, 400))
    const t0 = Date.now()
    const b = run(db, as(U.admin, `select public.inv_issue('{"idempotency_key":"b1","stock_id":"${sid}","qty":6}'::jsonb)`))
    const [, bOut] = await Promise.all([a, b])
    const waited = Date.now() - t0
    const bRes = JSON.parse(bOut.split('\n').pop())
    assert.equal(bRes.status, 'refused_shortage', 'the second connection waited for the lock and saw 4 left')
    assert.ok(waited >= 700, `B should have blocked on A's row lock (waited ${waited} ms)`)

    // Race 2: the same idempotency key from two connections at once posts exactly once.
    const p = `select public.inv_issue('{"idempotency_key":"dup","stock_id":"${sid}","qty":1}'::jsonb)`
    const both = await Promise.all([run(db, as(U.keeper, p)), run(db, as(U.keeper, p))])
    const res = both.map(o => JSON.parse(o.split('\n').pop()))
    assert.equal(res.filter(r => r.replayed === true).length, 1)
    const led = await run(db, `select sum(qty_change)::text || '|' || count(*) || '|' || (select qty_on_hand from stock_records where id = '${sid}') from stock_movements where stock_id = '${sid}'`)
    assert.equal(led, '3|3|3', 'ledger sum = balance: 10 in, 6 out, 1 out; three movements')
  } finally {
    await run('postgres', `drop database if exists ${db} with (force)`)
  }
})
