// Client API contract (20261120107000): one p_payload jsonb per write, idempotency_key
// replay / reuse rules, positional implementations closed to clients, web-named read
// views that mask money and respect the blind count (PGlite, synthetic data).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDb, rpc, call, q, one, id, U, code, asUser } from './inventory_harness.test.mjs'

const FILTER = id(100)
const j = JSON.stringify

test('api contract: payload writes, idempotency, closed internals, masked views', async t => {
  const db = await buildDb()
  try {
    await t.test('missing idempotency_key is refused; replay returns the stored result', async () => {
      await assert.rejects(rpc(db, U.admin, 'inv_location_upsert', [j({ country: 'KSA', site: 'S1', location_type: 'warehouse', code: 'WH1' })]), code('22023'))
      const p = { idempotency_key: 'loc-1', country: 'KSA', site: 'S1', location_type: 'warehouse', code: 'WH1' }
      const a = await call(db, U.admin, 'inv_location_upsert', p)
      const b = await call(db, U.admin, 'inv_location_upsert', p)
      assert.equal(b.id, a.id)
      assert.equal(b.replayed, true)
      assert.equal((await one(db, 'select count(*)::int as n from inventory_locations')).n, 1)
      await assert.rejects(call(db, U.admin, 'inv_location_upsert', { ...p, code: 'WH9' }), code('23505'))
      await assert.rejects(call(db, U.admin, 'inv_audit_start', { idempotency_key: 'loc-1', audit_id: id(1) }), code('23505'))
    })

    await t.test('positional implementations are not callable by a signed-in user', async () => {
      const r = await q(db, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like '\\_inv\\_%' and p.proname not in ('_inv_audit_can_see_expected','_inv_audit_open_for_counter','_inv_cap_for','_inv_posting_on','_inv_approval_block_reason') and has_function_privilege('authenticated', p.oid, 'EXECUTE')`)
      assert.deepEqual(r, [])
      const pub = await q(db, `select p.proname, pg_get_function_identity_arguments(p.oid) as a from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'inv\\_%'
        and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and pg_get_function_result(p.oid) <> 'trigger' and p.proname not in ('inv_can','inv_blind_hides_balance','inv_canon_serial','inv_movement_kind',
          'inv_approver_roles','inv_tyre_investigator_roles')`) // the last two: read-only role lists (113000 / 114000)
      const odd = pub.filter(x => x.a !== 'p_payload jsonb' && !['inv_audit_counter_view', 'inv_valuation_summary'].includes(x.proname))
      assert.deepEqual(odd, [], 'every client write takes exactly p_payload jsonb')
      for (const x of await q(db, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'inv\\_%' and has_function_privilege('anon', p.oid, 'EXECUTE')
          and pg_get_function_result(p.oid) <> 'trigger' and p.proname not in ('inv_can','inv_blind_hides_balance','inv_canon_serial','inv_movement_kind')`)) {
        assert.fail(`anon can execute ${x.proname}`)
      }
    })

    await t.test('web-named views: money hidden without view_value, visible with it', async () => {
      const wh = (await one(db, "select id from inventory_locations where code='WH1'")).id
      await rpc(db, U.keeper, 'inv_post_movement', [j({ idempotency_key: 'api-r1', item_id: FILTER, location_id: wh, movement_type: 'receipt', qty_change: 5, unit_cost: 4 })])
      const keeperView = await asUser(db, U.keeper, () => q(db, "select item_code, location_code, qty_on_hand, avg_unit_cost, valuation_status from v_inv_balances where location_code = 'WH1'"))
      assert.equal(keeperView.length, 1)
      assert.equal(keeperView[0].location_code, 'WH1')
      assert.equal(keeperView[0].avg_unit_cost, null, 'keeper has no stock:view_value')
      assert.equal(keeperView[0].valuation_status, 'valued')
      const rev = await asUser(db, U.reviewer, () => q(db, "select avg_unit_cost from v_inv_balances where location_code = 'WH1'"))
      assert.equal(Number(rev[0].avg_unit_cost), 4)
      const mv = await asUser(db, U.keeper, () => q(db, "select movement_type, value_change from v_inv_movements where location_code = 'WH1'"))
      assert.equal(mv[0].value_change, null)
      assert.equal((await asUser(db, U.adminB, () => q(db, "select * from v_inv_balances where location_code = 'WH1'"))).length, 0, 'other company sees nothing')
    })

    await t.test('counter view carries Flutter keys and the web `lines` alias', async () => {
      const wh = (await one(db, "select id from inventory_locations where code='WH1'")).id
      const audit = (await call(db, U.reviewer, 'inv_audit_create', { country: 'KSA', site: 'S1', audit_type: 'bin', blind: true,
        counter_id: U.counter, reviewer_id: U.reviewer, approver_id: U.approver, scope: { location_ids: [wh] } })).id
      await call(db, U.reviewer, 'inv_audit_schedule', { audit_id: audit, due_at: new Date(Date.now() + 864e5).toISOString() })
      await call(db, U.reviewer, 'inv_audit_start', { audit_id: audit })
      const v = await rpc(db, U.counter, 'inv_audit_counter_view', [audit])
      assert.ok(Array.isArray(v.items) && Array.isArray(v.lines))
      assert.deepEqual(v.lines, v.items)
      assert.ok(!JSON.stringify(v).includes('"qty_on_hand"') && !JSON.stringify(v).includes('expected'), 'no expected quantity reaches the counter')
      const sub = await call(db, U.counter, 'inv_count_submit', { audit_id: audit, device_id: 'd1',
        lines: [{ client_uuid: '00000000-0000-4000-8000-000000000001', location_id: wh, item_id: FILTER, counted_qty: 5 }] })
      assert.equal(sub.accepted.length, 1)
      const dup = await call(db, U.counter, 'inv_count_submit', { audit_id: audit, device_id: 'd1',
        lines: [{ client_uuid: '00000000-0000-4000-8000-000000000001', location_id: wh, item_id: FILTER, counted_qty: 5 }] })
      assert.equal(dup.duplicates.length, 1, 'line retries are idempotent per client_uuid without an outer key')
      assert.equal((await asUser(db, U.counter, () => q(db, "select * from v_inv_balances where location_code = 'WH1'"))).length, 0, 'blind policy holds through the view')
    })
  } finally { await db.close() }
})
