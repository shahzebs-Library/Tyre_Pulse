// Apply every inventory migration, roll them all back in reverse, and prove the
// legacy catalog (writers, policies, constraints, grants, columns) is restored.
// Also: a rollback refuses to discard inventory records unless told to (PGlite).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { buildDb, MIGRATIONS, ROLLBACKS, sqlOf, rpc, q, id, U } from './inventory_harness.test.mjs'

const TABLES = "('stock_records','stock_movements','stock','goods_receipts','requisitions','suppliers','purchase_orders','materials','material_master','work_order_stock_reservation_lines','tyre_records')"

async function fingerprint (db) {
  const one = async sql => (await q(db, sql)).map(r => JSON.stringify(r)).join('\n')
  return {
    functions: await one(`select n.nspname, p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as body,
        (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text)
           from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee <> 0) || '|public:' || (select count(*) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0) as acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public','private') order by 2`),
    policies: await one(`select tablename, policyname, permissive, cmd, roles::text, qual, with_check from pg_policies
       where schemaname = 'public' order by 1, 2`),
    constraints: await one(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint
       where connamespace = 'public'::regnamespace order by 1, 2`),
    columns: await one(`select table_name, column_name, is_nullable, column_default,
        case when table_name = 'stock_movements' and column_name in ('qty_before','qty_change','qty_after') then 'qty' else data_type end as t
       from information_schema.columns where table_schema = 'public' and table_name in ${TABLES} order by 1, 2`),
    grants: await one(`select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'authenticated' order by 1, 2`),
    relations: await one(`select relname, relkind from pg_class where relnamespace = 'public'::regnamespace
       and relkind in ('r','v','S') order by 1`),
    triggers: await one(`select tgrelid::regclass::text, tgname from pg_trigger where not tgisinternal order by 1, 2`),
    indexes: await one("select indexname from pg_indexes where schemaname = 'public' order by 1")
  }
}

async function rollbackAll (db, discard = false) {
  for (const f of [...ROLLBACKS].reverse()) {
    const sql = discard ? sqlOf(f).replace(/^begin;/m, "begin;\nset local inv.rollback_discard = 'on';") : sqlOf(f)
    try { await db.exec(sql) } catch (e) { e.message = `${f}: ${e.message}`; throw e }
  }
}

test('rollback restores the pre-inventory catalog exactly', async () => {
  const before = await buildDb({ upTo: 0 })
  const fpBefore = await fingerprint(before)
  await before.close()

  const db = await buildDb()
  await rollbackAll(db)
  const fpAfter = await fingerprint(db)
  for (const k of Object.keys(fpBefore)) assert.equal(fpAfter[k], fpBefore[k], `${k} differs after rollback`)
  // the legacy writers are back and answer as before
  assert.deepEqual((await q(db, `select public.post_stock_movement('${id(400)}', 'issue', 1) as r`))[0].r, { legacy: 'post' })
  await db.close()
})

test('rollback refuses to discard inventory records unless explicitly told to', async () => {
  const db = await buildDb()
  const wh = (await rpc(db, U.admin, 'inv_location_upsert', [JSON.stringify({ idempotency_key: 'rb-1', country: 'KSA', site: 'S1', location_type: 'warehouse', code: 'WH1' })])).id
  await rpc(db, U.keeper, 'inv_post_movement', [JSON.stringify({ idempotency_key: 'rb-2', item_id: id(100), location_id: wh, movement_type: 'receipt', qty_change: 3, unit_cost: 2 })])
  await db.exec(sqlOf(ROLLBACKS[ROLLBACKS.length - 1])) // 107: holds no business data
  for (const f of [...ROLLBACKS].reverse().slice(1, 6)) await db.exec(sqlOf(f)) // 106..102: nothing recorded there
  await assert.rejects(db.exec(sqlOf(ROLLBACKS[1])), /export them/) // 101: a location exists
  await db.exec("rollback")
  await db.exec(sqlOf(ROLLBACKS[1]).replace(/^begin;/m, "begin;\nset local inv.rollback_discard = 'on';"))
  await assert.rejects(db.exec(sqlOf(ROLLBACKS[0])), /new ledger has been used/)
  await db.exec("rollback")
  await db.exec(sqlOf(ROLLBACKS[0]).replace(/^begin;/m, "begin;\nset local inv.rollback_discard = 'on';"))
  const n = (await q(db, "select count(*)::int as n from public.stock_movements"))[0].n
  assert.ok(n >= 2, 'ledger rows are kept; only the new columns go')
  await db.close()
})

test('apply -> rollback -> apply again is clean', async () => {
  const db = await buildDb()
  await rollbackAll(db)
  for (const f of MIGRATIONS) await db.exec(sqlOf(f))
  assert.equal((await q(db, "select count(*)::int as n from pg_proc where proname = 'inv_post_movement'"))[0].n, 1)
  await db.close()
})

void PGlite
