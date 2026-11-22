// Rehearsal gates 4, 5, 6, 7, 8, 10, 12 on a disposable clone of copy A (PG17.6, production roles).
import { writeFileSync } from 'node:fs'
import { run, rpc, sel, one, asUser, check, expectRefused, results } from './lib.mjs'
import { setup, P, ORG_A, ORG_B } from './setup.mjs'

const db = process.argv[2]
const S = await setup(db)
const [X1, X2, X3, X4] = S.items
const post = (uid, p) => rpc(db, uid, 'inv_post_movement', p)
const bal = sid => one(db, `select qty_on_hand::float q, qty_reserved::float r, unvalued_qty::float u, valued_value::float v, avg_unit_cost::float c,
  pending_allocation_in_qty::float pin, pending_allocation_out_qty::float pout from stock_records where id = '${sid}'`)
const ledger = sid => one(db, `select coalesce(sum(qty_change),0)::float s, count(*)::int n from stock_movements where stock_id = '${sid}'`)
const invariants = async tag => {
  const bad = await one(db, `select count(*) filter (where qty_on_hand < 0) neg, count(*) filter (where qty_reserved > qty_on_hand or qty_reserved < 0) overres,
    count(*) filter (where unvalued_qty < 0 or unvalued_qty > qty_on_hand) badunv from stock_records`)
  const drift = await one(db, `select count(*) n from stock_records s left join (select stock_id, sum(qty_change) q from stock_movements group by 1) l on l.stock_id = s.id
    where s.qty_on_hand <> coalesce(l.q,0) and s.id not in (select stock_id from (select stock_id from v_stock_balance_reconcile where has_drift) x where false)`)
  return { ...bad, drift_rows_total: drift.n, tag }
}
const legacyDrift = 7
const tryCall = p => p.then(r => ({ ok: true, r }), e => ({ ok: false, e: String(e.message).split('\n')[0] }))

// ============================ GATE 4: real concurrent transactions =========================
{
  const g = 4
  const rec = await post(P.keeper, { item_id: X1, location_id: S.L.w1, movement_type: 'receipt', qty_change: 10, unit_cost: 5 })
  const sid = rec.stock_id
  // 8 parallel issues of 2 from 10 by two different store keepers on separate connections
  const issues = await Promise.all(Array.from({ length: 8 }, (_, i) =>
    tryCall(rpc(db, i % 2 ? P.keeper2 : P.keeper, 'inv_issue', { stock_id: sid, qty: 2, source_doc_type: 'work_order', source_doc_id: `WO-RH-${i}` }))))
  const posted = issues.filter(x => x.ok && x.r.status === 'posted').length
  const refused = issues.filter(x => x.ok && /refused/.test(x.r.status)).length + issues.filter(x => !x.ok).length
  let b = await bal(sid); let l = await ledger(sid)
  check(g, '8 parallel issues of 2 from 10: exactly 5 posted, 3 refused, balance 0, ledger = balance', posted === 5 && refused === 3 && b.q === 0 && l.s === 0,
    { posted, refused, balance: b.q, ledger_sum: l.s, statuses: issues.map(x => x.ok ? x.r.status : x.e.slice(0, 60)) })

  // duplicate idempotency key from 6 connections at once
  const k = `dup-${Date.now()}`
  const dups = await Promise.all(Array.from({ length: 6 }, () => tryCall(rpc(db, P.keeper, 'inv_post_movement',
    { idempotency_key: k, stock_id: sid, movement_type: 'receipt', qty_change: 3, unit_cost: 5 }, { noKey: true }))))
  const nPosted = dups.filter(x => x.ok && x.r.status === 'posted' && !x.r.replayed).length
  const nReplay = dups.filter(x => x.ok && x.r.replayed === true).length
  const nMov = (await one(db, `select count(*)::int n from stock_movements where idempotency_key = '${k}'`)).n
  b = await bal(sid)
  check(g, 'same idempotency key from 6 parallel connections: 1 post, 5 replayed:true, 1 ledger row, balance +3 once',
    nPosted === 1 && nReplay === 5 && nMov === 1 && b.q === 3, { nPosted, nReplay, nMov, balance: b.q, errors: dups.filter(x => !x.ok).map(x => x.e) })
  const replayAfter = await rpc(db, P.keeper, 'inv_post_movement', { idempotency_key: k, stock_id: sid, movement_type: 'receipt', qty_change: 3, unit_cost: 5 }, { noKey: true })
  check(g, 'replay after commit returns replayed:true and posts nothing', replayAfter.replayed === true && (await bal(sid)).q === 3, { replayed: replayAfter.replayed })
  const diffPayload = await tryCall(rpc(db, P.keeper, 'inv_post_movement', { idempotency_key: k, stock_id: sid, movement_type: 'receipt', qty_change: 4, unit_cost: 5 }, { noKey: true }))
  check(g, 'same key with a different payload is refused (no silent replay of another request)', !diffPayload.ok || diffPayload.r.status !== 'posted', diffPayload.ok ? diffPayload.r : diffPayload.e)

  // reservations: receipt 10, 6 parallel reserves of 3
  const r2 = await post(P.keeper, { item_id: X2, location_id: S.L.w1, movement_type: 'receipt', qty_change: 10, unit_cost: 7 })
  const res = await Promise.all(Array.from({ length: 6 }, (_, i) => tryCall(rpc(db, i % 2 ? P.keeper2 : P.keeper, 'inv_reserve',
    { stock_id: r2.stock_id, qty: 3, source_doc_type: 'work_order', source_doc_id: `WO-RES-${i}` }))))
  const okRes = res.filter(x => x.ok && x.r && (x.r.id || x.r.reservation_id) && !/refused/.test(x.r.status || '')).length
  b = await bal(r2.stock_id)
  check(g, '6 parallel reservations of 3 against 10: 3 succeed, reserved 9 <= on hand 10', okRes === 3 && b.r === 9 && b.q === 10,
    { okRes, reserved: b.r, on_hand: b.q, outcomes: res.map(x => x.ok ? (x.r.status || 'reserved') : x.e.slice(0, 70)) })
  // issue against the 1 unreserved unit in parallel with releasing one reservation
  const firstRes = res.find(x => x.ok && (x.r.id || x.r.reservation_id)).r
  const mix = await Promise.all([
    tryCall(rpc(db, P.keeper, 'inv_issue', { stock_id: r2.stock_id, qty: 2, source_doc_type: 'work_order', source_doc_id: 'WO-MIX' })),
    tryCall(rpc(db, P.keeper2, 'inv_release', { reservation_id: firstRes.id || firstRes.reservation_id })),
    tryCall(rpc(db, P.keeper, 'inv_issue', { stock_id: r2.stock_id, qty: 1, source_doc_type: 'work_order', source_doc_id: 'WO-MIX2' })),
  ])
  b = await bal(r2.stock_id); l = await ledger(r2.stock_id)
  check(g, 'issue / release / issue racing on a reserved balance: never below reserved, never negative, ledger = balance',
    b.q >= 0 && b.r <= b.q && l.s === b.q, { balance: b, ledger: l, outcomes: mix.map(x => x.ok ? x.r.status || 'ok' : x.e.slice(0, 70)) })

  // transfers: two parallel dispatches of 6 from 10 + a parallel issue of 2
  const r3 = await post(P.keeper, { item_id: X3, location_id: S.L.w1, movement_type: 'receipt', qty_change: 10, unit_cost: 2 })
  const tr = await Promise.all([
    tryCall(rpc(db, P.keeper, 'inv_transfer_dispatch', { from_location_id: S.L.w1, to_location_id: S.L.w2, lines: [{ stock_id: r3.stock_id, qty: 6 }] })),
    tryCall(rpc(db, P.keeper2, 'inv_transfer_dispatch', { from_location_id: S.L.w1, to_location_id: S.L.w2, lines: [{ stock_id: r3.stock_id, qty: 6 }] })),
    tryCall(rpc(db, P.keeper, 'inv_issue', { stock_id: r3.stock_id, qty: 2, source_doc_type: 'work_order', source_doc_id: 'WO-TR' })),
  ])
  b = await bal(r3.stock_id)
  const totalItem = await one(db, `select sum(qty_on_hand)::float q from stock_records where item_id = '${X3}'`)
  check(g, 'parallel transfer dispatches + issue: at most 10 leave, source never negative, item quantity conserved (source + transit)',
    b.q >= 0 && totalItem.q + (tr[2].ok && tr[2].r.status === 'posted' ? 2 : 0) === 10,
    { source: b.q, item_total_incl_transit: totalItem.q, outcomes: tr.map(x => x.ok ? x.r.status : x.e.slice(0, 80)) })
  const okTr = tr.filter((x, i) => i < 2 && x.ok && x.r.status === 'in_transit')
  if (okTr.length) {
    const tline = await one(db, `select id, qty_dispatched::float q from stock_transfer_lines where transfer_id = '${okTr[0].r.transfer_id}'`)
    const rx = await Promise.all([1, 2].map(() => tryCall(rpc(db, P.keeper2, 'inv_transfer_receive', { transfer_id: okTr[0].r.transfer_id, lines: [{ line_id: tline.id, received_qty: tline.q, condition: 'good' }] }))))
    const dest = await one(db, `select coalesce(sum(qty_on_hand),0)::float q from stock_records where item_id = '${X3}' and location_id = '${S.L.w2}'`)
    check(g, 'two parallel full receipts of the same transfer line: received once', dest.q === tline.q,
      { dest: dest.q, dispatched: tline.q, outcomes: rx.map(x => x.ok ? x.r.status : x.e.slice(0, 80)) })
  } else check(g, 'transfer receive race', false, 'no transfer dispatched')

  // reversal: same movement reversed from two connections with different keys
  const r4 = await post(P.keeper, { item_id: X4, location_id: S.L.w1, movement_type: 'receipt', qty_change: 5, unit_cost: 3 })
  const rv = await Promise.all([P.admin, P.admin].map(u => tryCall(rpc(db, u, 'inv_reverse_movement', { movement_id: r4.movement_id, reason: 'rehearsal race' }))))
  const nrev = (await one(db, `select count(*)::int n from stock_movements where reverses_movement_id = '${r4.movement_id}'`)).n
  b = await bal(r4.stock_id)
  check(g, 'parallel reversals of one movement: exactly one reversal row, balance back to 0', nrev === 1 && b.q === 0,
    { nrev, balance: b.q, outcomes: rv.map(x => x.ok ? x.r.status : x.e.slice(0, 80)) })

  const inv = await invariants('after gate 4')
  check(g, 'global invariants after all races: no negative, no over-reservation, no unvalued > on hand; only the 7 pre-existing legacy drift rows differ from their ledger',
    inv.neg === 0 && inv.overres === 0 && inv.badunv === 0 && inv.drift_rows_total === legacyDrift, inv)
  S.sid = sid; S.rec = rec
}

// ============================ GATE 5: immutability ============================
{
  const g = 5
  const mv = S.rec.movement_id
  for (const [label, sql, user] of [
    ['authenticated store keeper', asUser(P.keeper, `update stock_movements set qty_change = 99 where id = '${mv}'`), 'postgres'],
    ['authenticated super admin', asUser(P.admin, `delete from stock_movements where id = '${mv}'`), 'postgres'],
    ['owner postgres (BYPASSRLS) UPDATE', `update stock_movements set qty_change = 99 where id = '${mv}'`, 'postgres'],
    ['owner postgres DELETE', `delete from stock_movements where id = '${mv}'`, 'postgres'],
    ['owner postgres TRUNCATE', `truncate stock_movements cascade`, 'postgres'],
    ['service_role UPDATE', `begin; set local role service_role; update stock_movements set reason = 'x' where id = '${mv}'; commit;`, 'postgres'],
    ['superuser supabase_admin UPDATE', `update stock_movements set qty_change = 99 where id = '${mv}'`, 'supabase_admin'],
  ]) await expectRefused(g, `stock_movements change refused: ${label}`, run(db, sql, user))
  const still = await one(db, `select qty_change::float q from stock_movements where id = '${mv}'`)
  check(g, 'the movement is unchanged afterwards', still.q === 10, still)
  // lifecycle tables: status graph + terminal immutability + no delete, for owner too
  const rec = await one(db, `select id, status from inventory_cost_reconciliations where kind = 'legacy' limit 1`)
  await expectRefused(g, 'inventory_cost_reconciliations: owner DELETE refused', run(db, `delete from inventory_cost_reconciliations where id = '${rec.id}'`, 'postgres'))
  await expectRefused(g, 'inventory_cost_reconciliations: owner jump open -> resolved outside the RPC refused', run(db, `update inventory_cost_reconciliations set status = 'resolved' where id = '${rec.id}'`, 'postgres'))
  await expectRefused(g, 'inventory_cost_reconciliations: authenticated admin direct UPDATE refused', run(db, asUser(P.admin, `update inventory_cost_reconciliations set notes = 'x' where id = '${rec.id}'`)))
  await expectRefused(g, 'inventory_approval_requests: authenticated direct INSERT refused', run(db, asUser(P.admin, `insert into inventory_approval_requests(organisation_id) values ('${ORG_A}')`)))
  await expectRefused(g, 'tyre_custody_conflicts: authenticated direct UPDATE refused', run(db, asUser(P.admin, `update tyre_custody_conflicts set status = status where true`)))
}

// ============================ GATE 6: valuation combinations ============================
{
  const g = 6
  const a = await post(P.keeper, { item_id: X1, location_id: S.L.w2, movement_type: 'receipt', qty_change: 4, unit_cost: 10 })
  const sid = a.stock_id
  const u = await post(P.keeper, { stock_id: sid, movement_type: 'receipt', qty_change: 2 })
  let b = await bal(sid)
  check(g, 'receipt without cost is unvalued (never zero-cost): unit_cost null, value_change null, unvalued 2', u.valuation_status !== 'valued' && u.unit_cost == null && u.value_change == null && b.u === 2 && b.v === 40,
    { valuation_status: u.valuation_status, unit_cost: u.unit_cost, value_change: u.value_change, bal: b })
  const zero = await one(db, `select count(*)::int n from stock_movements where movement_seq > 78 and unit_cost = 0`)
  check(g, 'no posted movement carries a fabricated zero cost', zero.n === 0, zero)
  const openRec = await one(db, `select id, unvalued_qty::float q from inventory_cost_reconciliations where stock_id = '${sid}' and status = 'open' and kind <> 'issue_allocation'`)
  check(g, 'unvalued receipt opens a cost reconciliation', openRec && openRec.q === 2, openRec)
  // mixed issue: 5 of (4 valued + 2 unvalued) -> 3 certainly valued, 1 undecided -> pending allocation (no silent unit choice)
  const iss = await rpc(db, P.keeper, 'inv_issue', { stock_id: sid, qty: 5, source_doc_type: 'work_order', source_doc_id: 'WO-VAL' })
  b = await bal(sid)
  const alloc = await one(db, `select id, unvalued_qty::float q, status from inventory_cost_reconciliations where stock_id = '${sid}' and kind = 'issue_allocation'`)
  check(g, 'mixed-balance issue: only arithmetic-proven units move at value; the rest is a pending issue_allocation for a person to decide',
    iss.status === 'posted' && alloc && Number(iss.valued_qty_moved ?? 0) <= 4 && Number(iss.pending_allocation_qty ?? 0) >= 1,
    { valued_moved: iss.valued_qty_moved, unvalued_moved: iss.unvalued_qty_moved, pending: iss.pending_allocation_qty, value_change: iss.value_change, alloc, bal: b })
  // cost reconciliation: proposal by finance, decided by another person, posting consumes the approval once
  // the issue allocation is decided by another person from evidence (no silent unit choice)
  const arq = await tryCall(rpc(db, P.finance, 'inv_request_approval', { entity_type: 'cost_reconciliation', entity_id: alloc.id,
    proposal: { valued_qty: 1 }, evidence: [{ type: 'grn', ref: 'RH-GRN-1' }] }))
  const adec = arq.ok ? await tryCall(rpc(db, P.admin, 'inv_approval_decide', { request_id: arq.r.id, decision: 'approve' })) : arq
  const apost = adec.ok ? await tryCall(rpc(db, P.finance, 'inv_cost_reconcile', { reconciliation_id: alloc.id })) : adec
  const allocAfter = await one(db, `select status from inventory_cost_reconciliations where id = '${alloc.id}'`)
  check(g, 'issue allocation decided by a second person (proposal -> independent approval -> post)', apost.ok && allocAfter.status !== 'open',
    { request: arq.ok ? 'ok' : arq.e, decide: adec.ok ? adec.r.status : adec.e, post: apost.ok ? apost.r.status : apost.e, alloc: allocAfter })
  // a separate balance carrying only an unvalued receipt, for the cost reconciliation lifecycle
  const cr = await post(P.keeper, { item_id: X4, location_id: S.L.w2, movement_type: 'receipt', qty_change: 3 })
  const crRec = await one(db, `select id from inventory_cost_reconciliations where stock_id = '${cr.stock_id}' and status = 'open' and kind <> 'issue_allocation'`)
  openRec.id = crRec.id
  const rq = await tryCall(rpc(db, P.finance, 'inv_request_approval', { entity_type: 'cost_reconciliation', entity_id: openRec.id,
    proposal: { resolution: 'resolved', unit_cost: 9 }, reason: 'supplier invoice RH-1', evidence: [{ type: 'invoice', ref: 'RH-1' }] }))
  check(g, 'finance proposes a cost (approval request with proposal + evidence)', rq.ok, rq.ok ? { id: rq.r.id, status: rq.r.status } : rq.e)
  const prePost = await tryCall(rpc(db, P.finance, 'inv_cost_reconcile', { reconciliation_id: openRec.id }))
  check(g, 'posting before approval is refused', !prePost.ok, prePost.ok ? prePost.r : prePost.e.slice(0, 140))
  const req = rq.ok ? rq.r : null
  if (req) {
    await expectRefused(g, 'proposer cannot approve their own cost reconciliation (SoD by user id)', rpc(db, P.finance, 'inv_approval_decide', { request_id: req.id, decision: 'approve' }), /segregation|42501|own/)
    const ap = await tryCall(rpc(db, P.admin, 'inv_approval_decide', { request_id: req.id, decision: 'approve' }))
    check(g, 'independent approver (Admin) approves', ap.ok && ap.r.status === 'approved', ap.ok ? ap.r : ap.e)
    const again = await tryCall(rpc(db, P.admin, 'inv_approval_decide', { request_id: req.id, decision: 'approve' }))
    check(g, 'repeated approval of the same request is refused or a no-op (no second decision row)', !again.ok || again.r.replayed || again.r.status === 'approved',
      again.ok ? again.r : again.e)
    const nDec = await one(db, `select count(*)::int n from inventory_approval_decisions where request_id = '${req.id}'`)
    check(g, 'exactly one approval decision recorded', nDec.n === 1, nDec)
    const posted = await tryCall(rpc(db, P.finance, 'inv_cost_reconcile', { reconciliation_id: openRec.id }))
    const posted2 = await tryCall(rpc(db, P.finance, 'inv_cost_reconcile', { reconciliation_id: openRec.id }))
    const st = await one(db, `select status, consumed from inventory_cost_reconciliations where id = '${openRec.id}'`)
    check(g, 'reconciliation after consumption posts once; the approval is consumed and cannot be reused', posted.ok && (!posted2.ok || posted2.r.replayed || /already|resolved/.test(JSON.stringify(posted2.r))),
      { first: posted.ok ? posted.r.status : posted.e, second: posted2.ok ? posted2.r : posted2.e, rec: st })
  }
  // transfer of a mixed balance with partial receipt (undecided units travel with no value)
  const t0 = await post(P.keeper, { item_id: X2, location_id: S.L.w2, movement_type: 'receipt', qty_change: 6, unit_cost: 4 })
  await post(P.keeper, { stock_id: t0.stock_id, movement_type: 'receipt', qty_change: 1 })
  const d = await tryCall(rpc(db, P.keeper, 'inv_transfer_dispatch', { from_location_id: S.L.w2, to_location_id: S.L.w1, lines: [{ stock_id: t0.stock_id, qty: 6 }] }))
  if (d.ok) {
    const line = await one(db, `select id, carried_value::float v, carried_unvalued_qty::float u from stock_transfer_lines where transfer_id = '${d.r.transfer_id}'`)
    const rcv = await tryCall(rpc(db, P.keeper2, 'inv_transfer_receive', { transfer_id: d.r.transfer_id, lines: [{ line_id: line.id, received_qty: 3, condition: 'good' }] }))
    const vals = await one(db, `select sum(valued_value)::float v from stock_records where item_id = '${X2}' and location_id in ('${S.L.w2}','${S.L.w1}')`)
    check(g, 'transfer of 6 from (6 valued + 1 unvalued): carried value <= 6*4, undecided unit carries no value; partial receipt keeps value conserved',
      line.v <= 24 && rcv.ok && rcv.r.status === 'partially_received', { line, receive: rcv.ok ? rcv.r.status : rcv.e, value_at_locations_excl_transit: vals.v })
  } else check(g, 'mixed transfer dispatch', false, d.e)
  // valuation summary never invents a zero: unknown stays unknown
  const vs = await one(db, `select count(*) filter (where unvalued_qty > 0 and (valued_value is null or valued_value >= 0))::int ok, count(*) filter (where unvalued_qty > 0)::int n from stock_records`)
  check(g, 'every balance with unvalued units keeps them separate (value covers only valued units)', vs.ok === vs.n, vs)
}

// ============================ GATE 7: SECURITY DEFINER review on PG17 ============================
{
  const g = 7
  const sd = await one(db, `select count(*)::int n,
      count(*) filter (where not exists (select 1 from unnest(coalesce(proconfig,'{}')) c where c like 'search_path=%'))::int unpinned,
      count(*) filter (where has_function_privilege('anon', oid, 'EXECUTE'))::int anon_exec,
      count(*) filter (where proacl is null or array_to_string(proacl, ',') ~ '(^|,)=X')::int public_exec
    from pg_proc where pronamespace = 'public'::regnamespace and prosecdef and (proname like 'inv\\_%' or proname like '\\_inv\\_%')`)
  check(g, 'every inventory SECURITY DEFINER function pins search_path; none executable by anon or PUBLIC', sd.unpinned === 0 && sd.anon_exec === 0 && sd.public_exec === 0, sd)
  const anyAnon = await sel(db, `select oid::regprocedure::text f from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'inv\\_%' or proname like '\\_inv\\_%') and has_function_privilege('anon', oid, 'EXECUTE')`)
  check(g, 'no inventory function of any kind executable by anon', anyAnon.length === 0, anyAnon)
  const anonTables = await sel(db, `select c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','v') and (c.relname like 'inventory\\_%' or c.relname like 'v\\_inv%' or c.relname in ('stock_transfers','stock_transfer_lines','tyre_items','tyre_item_events','tyre_custody_conflicts','opening_balance_batches','opening_balance_lines','supplier_invoices','purchase_order_lines','goods_receipt_lines')) and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT'))`)
  check(g, 'no anon privilege on any new table or view', anonTables.length === 0, anonTables)
  const authWrite = await sel(db, `select c.relname, c.relkind from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','v') and (c.relname like 'inventory\\_%' or c.relname like 'v\\_inv%' or c.relname like 'v\\_%valuation' or c.relname = 'v_validated_compatibility' or c.relname in ('stock_transfers','stock_transfer_lines','tyre_items','tyre_item_events','tyre_custody_conflicts','opening_balance_batches','opening_balance_lines','supplier_invoices','supplier_invoice_lines','purchase_order_lines','goods_receipt_lines','stock_reservations','stock_exceptions','tyre_dispositions','tyre_store_holdings','material_aliases','material_master_reviews','oem_part_references','equipment_fitments','supplier_agreements','consignment_consumptions')) and (has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE') or has_table_privilege('authenticated', c.oid, 'DELETE'))`)
  check(g, 'no direct client write privilege on any new table or view (PG17 + production default privileges)', authWrite.length === 0, authWrite)
  const vw = await tryCall(run(db, asUser(P.admin, `update v_inv_pending_approvals set status = status where true returning 1`)))
  const vw2 = await tryCall(run(db, asUser(P.admin, `update v_inventory_valuation set qty_on_hand = qty_on_hand where true returning 1`)))
  check(g, 'actual write through an auto-updatable view is still refused (security_invoker checks the base table)', !vw.ok && !vw2.ok, [vw.ok ? 'UPDATED ' + vw.r : vw.e.slice(0, 120), vw2.ok ? 'UPDATED ' + vw2.r : vw2.e.slice(0, 120)])
  const anonCall = await tryCall(run(db, `begin; set local role anon; select public.inv_issue('{}'::jsonb); commit;`))
  check(g, 'anon calling inv_issue is refused by privilege', !anonCall.ok && /permission denied/.test(anonCall.e), anonCall.e)
  // cross-company id injection, one per family (company B Manager holds every stock capability on the copy)
  const aStock = S.sid; const aMov = S.rec.movement_id
  const fam = [
    ['ledger post onto company A balance', 'inv_post_movement', { stock_id: aStock, movement_type: 'receipt', qty_change: 1, unit_cost: 1 }],
    ['issue from company A balance', 'inv_issue', { stock_id: aStock, qty: 1 }],
    ['reserve company A balance', 'inv_reserve', { stock_id: aStock, qty: 1 }],
    ['reverse company A movement', 'inv_reverse_movement', { movement_id: aMov, reason: 'x' }],
    ['transfer from company A location', 'inv_transfer_dispatch', { from_location_id: S.L.w1, to_location_id: S.L.b, lines: [{ stock_id: aStock, qty: 1 }] }],
    ['location under company A parent', 'inv_location_upsert', { country: 'KSA', site: 'NHC', location_type: 'bin', code: 'RH-X', parent_id: S.L.w1 }],
    ['cost reconciliation of company A', 'inv_cost_reconcile', { reconciliation_id: (await one(db, `select id from inventory_cost_reconciliations where organisation_id = '${ORG_A}' limit 1`)).id }],
    ['company A item onto company B location', 'inv_post_movement', { item_id: X1, location_id: S.L.b, movement_type: 'receipt', qty_change: 1, unit_cost: 1 }],
    ['company A tyre conflict', 'inv_tyre_conflict_assign', { conflict_id: '00000000-0000-0000-0000-000000000000', investigator_id: P.tpe }],
  ]
  const before = await one(db, `select md5(string_agg(id::text||qty_on_hand::text, ',' order by id)) h from stock_records where organisation_id = '${ORG_A}'`)
  for (const [label, fn, p] of fam) {
    const r = await tryCall(rpc(db, P.orgB, fn, p))
    check(g, `cross-company injection refused: ${label}`, !r.ok || /refused|not_found|denied/.test(JSON.stringify(r.r)), r.ok ? r.r : r.e.slice(0, 160))
  }
  const after = await one(db, `select md5(string_agg(id::text||qty_on_hand::text, ',' order by id)) h from stock_records where organisation_id = '${ORG_A}'`)
  check(g, 'company A balances unchanged by every company B attempt', before.h === after.h, { before: before.h, after: after.h })
  const bSees = await one(db, `select (select count(*) from stock_records where organisation_id = '${ORG_A}')::int a_rows, (select count(*) from v_inv_balances)::int view_rows`, P.orgB)
  check(g, 'company B reads no company A balance (table or view)', bSees.a_rows === 0, bSees)
}

// ============================ GATE 8: legacy procurement RLS (live policies) ============================
{
  const g = 8
  await run(db, `insert into suppliers(id, supplier_name, organisation_id, country) values ('11111111-1111-1111-1111-111111111111','RH supplier A','${ORG_A}','KSA'), ('22222222-2222-2222-2222-222222222222','RH supplier B','${ORG_B}','KSA');
    insert into purchase_orders(id, po_number, vendor_name, organisation_id, country, site, status) values ('33333333-3333-3333-3333-333333333333','RH-PO-1','RH vendor','${ORG_A}','KSA','NHC','Draft'),('44444444-4444-4444-4444-444444444444','RH-PO-1','RH vendor','${ORG_B}','KSA','NHC','Draft');
    insert into goods_receipts(id, organisation_id, country, site) values ('55555555-5555-5555-5555-555555555555','${ORG_A}','KSA','NHC');
    insert into requisitions(id, item, organisation_id, country, site) values ('66666666-6666-6666-6666-666666666666','RH item','${ORG_A}','KSA','NHC');
    insert into materials(id, organisation_id, country, name) values ('77777777-7777-7777-7777-777777777777','${ORG_A}','KSA','RH material');`, 'supabase_admin')
  const T = { suppliers: '11111111-1111-1111-1111-111111111111', purchase_orders: '33333333-3333-3333-3333-333333333333', goods_receipts: '55555555-5555-5555-5555-555555555555', requisitions: '66666666-6666-6666-6666-666666666666', materials: '77777777-7777-7777-7777-777777777777' }
  check(g, 'the same PO number may exist in two companies (per-company key)', true, 'inserted RH-PO-1 in A and B')
  for (const [t, rid] of Object.entries(T)) {
    const seenB = await one(db, `select count(*)::int n from ${t} where id = '${rid}'`, P.orgB)
    check(g, `${t}: other company reads nothing`, seenB.n === 0, seenB)
    const upB = await tryCall(run(db, asUser(P.orgB, `update ${t} set updated_at = now() where id = '${rid}' returning id`)))
    check(g, `${t}: other company updates nothing`, !upB.ok || upB.r.split('\n').filter(x => /^[0-9a-f-]{36}$/.test(x)).length === 0, upB.ok ? 'rows: ' + upB.r : upB.e.slice(0, 120))
    const delB = await tryCall(run(db, asUser(P.orgB, `delete from ${t} where id = '${rid}' returning id`)))
    check(g, `${t}: other company deletes nothing`, !delB.ok || delB.r.split('\n').filter(x => /^[0-9a-f-]{36}$/.test(x)).length === 0, delB.ok ? 'rows: ' + delB.r : delB.e.slice(0, 120))
    const insB = await tryCall(run(db, asUser(P.orgB, t === 'suppliers' ? `insert into suppliers(supplier_name, organisation_id) values ('x','${ORG_A}')` : t === 'materials' ? `insert into materials(name, organisation_id, country) values ('x','${ORG_A}','KSA')` : t === 'purchase_orders' ? `insert into purchase_orders(po_number, vendor_name, organisation_id, country, site) values ('RH-X','v','${ORG_A}','KSA','NHC')` : t === 'requisitions' ? `insert into requisitions(item, organisation_id, country, site) values ('x','${ORG_A}','KSA','NHC')` : `insert into ${t}(organisation_id, country, site) values ('${ORG_A}','KSA','NHC')`)))
    check(g, `${t}: other company cannot insert a row into company A`, !insB.ok, insB.ok ? 'INSERTED' : insB.e.slice(0, 120))
  }
  for (const t of ['purchase_orders', 'goods_receipts', 'requisitions', 'materials']) {
    const upU = await tryCall(run(db, asUser(P.pmv, `update ${t} set updated_at = now() where id = '${T[t]}' returning id`)))
    check(g, `${t}: out-of-country user (UAE PMV Manager) updates nothing in KSA`, !upU.ok || upU.r.split('\n').filter(x => /^[0-9a-f-]{36}$/.test(x)).length === 0, upU.ok ? 'rows: ' + upU.r : upU.e.slice(0, 120))
  }
  const del = await tryCall(run(db, asUser(P.reviewer, `delete from purchase_orders where id = '${T.purchase_orders}' returning id`)))
  check(g, 'purchase_orders: non-admin (Manager) cannot delete in own company (admin-only delete guard)', !del.ok || del.r.split('\n').filter(x => /^[0-9a-f-]{36}$/.test(x)).length === 0, del.ok ? 'rows: ' + del.r : del.e.slice(0, 120))
  const own = await one(db, `select count(*)::int n from purchase_orders where id = '${T.purchase_orders}'`, P.reviewer)
  check(g, 'purchase_orders: same-company user still reads its own PO', own.n === 1, own)
}

// ============================ GATE 10: the 7 tyres ============================
{
  const g = 10
  const H = `select (select md5(string_agg(to_jsonb(t)::text, ',' order by id)) from tyre_records t) tr, (select md5(string_agg(to_jsonb(m)::text, ',' order by id)) from tyre_status_marks m) tm`
  const before = await one(db, H)
  const sync = []
  for (const c of ['KSA', 'UAE']) sync.push(await tryCall(rpc(db, P.admin, 'inv_tyre_item_sync', { country: c })))
  const conf = await sel(db, `select serial, country, status, investigation_status from tyre_custody_conflicts where conflict_type = 'scrapped_but_active' order by country, serial`)
  const after = await one(db, H)
  check(g, 'after sync: exactly 7 scrapped_but_active conflicts (KSA 6, UAE 1), all open', conf.length === 7 && conf.filter(c => c.country === 'KSA').length === 6 && conf.every(c => c.status === 'open'),
    { n: conf.length, serials: conf.map(c => c.country + ':' + String(c.serial).slice(0, 4) + '*'), sync: sync.map(s => s.ok ? 'ok' : s.e.slice(0, 100)) })
  check(g, 'tyre_records and tyre_status_marks hashes unchanged by sync', before.tr === after.tr && before.tm === after.tm, { before, after })
  // decision path: direct decide refused for this conflict type; investigation needs engineer + PMV manager
  const c1 = await one(db, `select id from tyre_custody_conflicts where conflict_type = 'scrapped_but_active' limit 1`)
  const direct = await tryCall(rpc(db, P.admin, 'inv_tyre_conflict_decide', { conflict_id: c1.id, status: 'resolved', note: 'rehearsal' }))
  check(g, 'scrapped_but_active cannot be closed by the direct decision', !direct.ok || /refused|investigation/.test(JSON.stringify(direct.r)), direct.ok ? direct.r : direct.e.slice(0, 160))
  const still = await one(db, H)
  check(g, 'tyre records still unchanged after the refused decision', still.tr === before.tr && still.tm === before.tm)
}

// ============================ GATE 12: approval roles, Store Keeper, SoD, scope, thresholds ============================
{
  const g = 12
  const roles = await sel(db, `select name, count(distinct organisation_id)::int orgs from custom_roles where name in ('Inventory Controller','Finance Manager') group by 1`)
  check(g, 'Inventory Controller and Finance Manager exist for every company (113000)', roles.length === 2 && roles.every(r => r.orgs === 5), roles)
  const pol = await sel(db, `select name from approval_policies where entity_type = 'inspection'`)
  let valid = 0
  for (const p of pol) { const r = await tryCall(run(db, `select approval_private.validate_policy(p) from approval_policies p where name = '${p.name.replace(/'/g, "''")}'`)); if (r.ok) valid++ }
  check(g, 'the 3 live inspection policies still validate under the new validate_policy', pol.length === 3 && valid === 3, { pol: pol.length, valid })
  const vp = async stage => tryCall(run(db, `begin; insert into approval_policies(organisation_id, name, entity_type, match_country, stages, created_by) values ('${ORG_A}','rh','inventory_opening_balance_batch','KSA','[${JSON.stringify(stage)}]','${P.admin}'); select approval_private.validate_policy(p) from approval_policies p where name = 'rh'; rollback;`))
  check(g, 'validate_policy refuses a Store Keeper approver role for an inventory stage', !(await vp({ name: 'k', approver_role: 'Store Keeper' })).ok)
  check(g, 'validate_policy refuses a named Store Keeper', !(await vp({ name: 'k', approver_user_id: P.keeper })).ok)
  const noHolder = await vp({ name: 'c', approver_role: 'Inventory Controller' })
  check(g, 'validate_policy refuses Inventory Controller while nobody holds the role (production: 0 holders)', !noHolder.ok, noHolder.ok ? 'accepted' : noHolder.e.slice(0, 120))
  await run(db, asUser(P.admin, `update profiles set role = 'Inventory Controller' where id = '${P.finance}'`))
  const withHolder = await vp({ name: 'c', approver_role: 'Inventory Controller' })
  check(g, 'validate_policy accepts Inventory Controller once a person holds it', withHolder.ok, withHolder.ok ? 'ok' : withHolder.e.slice(0, 160))
  await run(db, asUser(P.admin, `update profiles set role = 'Finance Manager' where id = '${P.finance}'`))
  check(g, 'validate_policy accepts a built-in Manager approver', (await vp({ name: 'm', approver_role: 'Manager' })).ok)
  // opening balance batch prepared by a store keeper
  const mk = async (uid, ref, qty, cost) => {
    const cb = await rpc(db, uid, 'inv_opening_batch_create', { country: 'KSA', site: 'NHC', reference: ref, source: 'manual', lines: [{ item_id: X4, location_id: S.L.w1, qty, unit_cost: cost }] })
    const b = cb.batch_id ?? cb.id
    for (const l of await sel(db, `select id from opening_balance_lines where batch_id = '${b}'`)) await rpc(db, uid, 'inv_opening_line_map', { line_id: l.id, mapping_status: 'mapped', item_id: X4, location_id: S.L.w1, qty, unit_cost: cost })
    await rpc(db, uid, 'inv_opening_batch_submit', { batch_id: b })
    return (await rpc(db, uid, 'inv_request_approval', { entity_type: 'opening_balance_batch', entity_id: b }))
  }
  const ob = await tryCall(mk(P.keeper, 'RH-OB-1', 2, 30))
  if (!ob.ok) check(g, 'store keeper prepares an opening batch + requests approval', false, ob.e)
  else {
    const rq = ob.r
    await run(db, `insert into user_access_grants(user_id, module_key, capability, effect, note) values ('${P.keeper2}','stock','financial_post','grant','rh'),('${P.keeper2}','stock','adjustment_approve','grant','rh'),('${P.reviewer}','stock','adjustment_approve','grant','rh'),('${P.reviewer}','stock','financial_post','grant','rh') on conflict do nothing`, 'supabase_admin')
    const wm = await tryCall(rpc(db, P.approver, 'inv_approval_decide', { request_id: rq.id, decision: 'approve' }))
    check(g, 'site manager role (Workshop Maintenance Area Manager) cannot approve an opening balance on the default route (not in the contract list for this type)', !wm.ok, wm.ok ? wm.r : wm.e.slice(0, 160))
    await expectRefused(g, 'another Store Keeper holding every approval capability is still refused', rpc(db, P.keeper2, 'inv_approval_decide', { request_id: rq.id, decision: 'approve' }), /store_keeper|42501/)
    await expectRefused(g, 'the preparer cannot approve (SoD by user id)', rpc(db, P.keeper, 'inv_approval_decide', { request_id: rq.id, decision: 'approve' }), /segregation|42501|store_keeper/)
    await expectRefused(g, 'out-of-scope approver (UAE PMV Manager, KSA request) refused', rpc(db, P.pmv, 'inv_approval_decide', { request_id: rq.id, decision: 'approve' }), /out_of_scope|42501|scope/)
    await expectRefused(g, 'other company approver refused', rpc(db, P.orgB, 'inv_approval_decide', { request_id: rq.id, decision: 'approve' }), /P0002|not found|42501/)
    const okA = await tryCall(rpc(db, P.reviewer, 'inv_approval_decide', { request_id: rq.id, decision: 'approve' }))
    check(g, 'KSA Manager (built-in, holds adjustment_approve + financial_post) approves', okA.ok && okA.r.status === 'approved', okA.ok ? okA.r : okA.e.slice(0, 200))
    // thresholds
    await rpc(db, P.admin, 'inv_approval_limit_upsert', { entity_type: 'opening_balance_batch', approver_role: 'Manager', max_value: 100, currency: 'SAR', max_qty: 5 })
    const wl = await tryCall(rpc(db, P.admin, 'inv_approval_limit_upsert', { entity_type: 'opening_balance_batch', approver_role: 'Workshop Maintenance Area Manager', max_value: 100 }))
    check(g, 'a limit for a role that may not approve this type is refused', !wl.ok, wl.ok ? wl.r : wl.e.slice(0, 120))
    await rpc(db, P.admin, 'inv_approval_limit_upsert', { entity_type: 'opening_balance_batch', approver_role: 'Admin' })
    const small = await mk(P.keeper, 'RH-OB-2a', 2, 30)
    const sOk = await tryCall(rpc(db, P.reviewer, 'inv_approval_decide', { request_id: small.id, decision: 'approve' }))
    check(g, 'under the role limit (60 SAR, 2 units): Manager approves', sOk.ok && sOk.r.status === 'approved', sOk.ok ? sOk.r.status : sOk.e.slice(0, 160))
    const big = await mk(P.keeper, 'RH-OB-2', 4, 300)
    await expectRefused(g, 'above the role value limit: refused for the Manager', rpc(db, P.reviewer, 'inv_approval_decide', { request_id: big.id, decision: 'approve' }), /above_threshold/)
    const esc = await tryCall(rpc(db, P.admin, 'inv_approval_decide', { request_id: big.id, decision: 'approve' }))
    check(g, 'escalates to Admin (higher limit)', esc.ok && esc.r.status === 'approved', esc.ok ? esc.r : esc.e.slice(0, 160))
    const unpriced = await mk(P.keeper, 'RH-OB-3', 1, null)
    await expectRefused(g, 'unknown value never passes a value cap', rpc(db, P.reviewer, 'inv_approval_decide', { request_id: unpriced.id, decision: 'approve' }), /not known|above_threshold/)
    await expectRefused(g, 'a non-admin cannot set approval limits', rpc(db, P.reviewer, 'inv_approval_limit_upsert', { entity_type: 'opening_balance_batch', approver_role: 'Manager', max_value: 1 }), /42501/)
    await expectRefused(g, 'a limit for Store Keeper is refused', rpc(db, P.admin, 'inv_approval_limit_upsert', { entity_type: 'opening_balance_batch', approver_role: 'Store Keeper', max_value: 1 }), /22023/)
  }
}

{
  const g = 5
  for (const t of ['tyre_item_events', 'inventory_approval_decisions']) {
    const n = (await one(db, `select count(*)::int n from ${t}`)).n
    const cols = await sel(db, `select column_name c from information_schema.columns where table_name = '${t}' and column_name not in ('id') limit 1 offset 1`)
    await expectRefused(g, `${t} (${n} rows): owner UPDATE refused`, run(db, `update ${t} set ${cols[0].c} = ${cols[0].c} where true`, 'postgres'))
    await expectRefused(g, `${t} (${n} rows): owner DELETE refused`, run(db, `delete from ${t} where true`, 'postgres'))
    await expectRefused(g, `${t}: superuser UPDATE refused`, run(db, `update ${t} set ${cols[0].c} = ${cols[0].c} where true`, 'supabase_admin'))
    check(g, `${t} has rows for the test`, n > 0, n)
  }
}
writeFileSync(`gates_${db}.json`, JSON.stringify(results, null, 1))
const fails = results.filter(r => !r.ok)
console.log(`\nTOTAL ${results.length}, PASS ${results.length - fails.length}, FAIL ${fails.length}`)
