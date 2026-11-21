// Physical inventory registration + company-wide identification
// (supabase/pending_migrations/20261122100000_inv_physical_inventory_master.sql, DRAFT).
// PGlite over the live-shaped inventory harness: three stores, duplicate proposals,
// company-wide search, variants, offline replay, photos, correction approval, opening
// balance hand-off, two-company isolation and a clean rollback.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildDb, rpc, call, q, one, id, U, ORG_A, code, asUser } from './inventory_harness.test.mjs'

const PENDING = f => readFileSync(new URL(`../pending_migrations/${f}`, import.meta.url), 'utf8')
const UP = PENDING('20261122100000_inv_physical_inventory_master.sql')
const DOWN = PENDING('20261122100000_inv_physical_inventory_master_ROLLBACK.sql')
const KSA_FILTER = id(100); const UAE_FILTER = id(102); const BRAKE = id(104)
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sha = c => c.repeat(64)

test('physical inventory master: identification, capture, review, corrections, isolation', async t => {
  const db = await buildDb()
  try {
    await db.exec(UP)
    const loc = {}
    for (const [site, codeName] of [['S1', 'WH1'], ['S2', 'WH2'], ['S3', 'WH3']]) {
      loc[site] = (await call(db, U.admin, 'inv_location_upsert', { country: 'KSA', site, location_type: 'warehouse', code: codeName })).id
    }

    await t.test('closed surface: helpers, client writes and anon', async () => {
      assert.deepEqual(await q(db, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.proname like '\\_inv\\_pi\\_%' and has_function_privilege('authenticated', p.oid, 'EXECUTE')`), [])
      const odd = await q(db, `select p.proname, pg_get_function_identity_arguments(p.oid) a from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and (p.proname like 'inv\\_pi\\_%' or p.proname like 'inv\\_material\\_%' or p.proname like 'inv\\_correction\\_%' or p.proname like 'inv\\_transfer\\_request%')
        and has_function_privilege('authenticated', p.oid, 'EXECUTE') and pg_get_function_identity_arguments(p.oid) <> 'p_payload jsonb'`)
      assert.deepEqual(odd, [], 'every client function takes exactly p_payload jsonb')
      assert.equal((await one(db, "select has_function_privilege('anon','public.inv_pi_capture(jsonb)','EXECUTE') as x")).x, false)
      for (const tbl of ['physical_inventory_captures', 'material_canonical', 'material_variants', 'material_correction_requests', 'physical_inventory_photos']) {
        assert.equal((await one(db, `select has_table_privilege('authenticated','public.${tbl}','INSERT') as x`)).x, false, tbl)
      }
    })

    let canonA, dupId, genuine, aftermarket
    await t.test('a proposal checks ALL company records for duplicates', async () => {
      const a = await call(db, U.keeper, 'inv_material_canonical_propose', { description: 'Engine oil filter', category: 'filter', base_uom: 'PCS',
        company_sku: 'GC-FLT-001', site: 'S1', references: [{ alias_type: 'oem', value: 'ABC-123/X', manufacturer: 'OEM Co' }] })
      canonA = a.id
      assert.equal(a.duplicate_count, 0)
      // another store, different spelling of the same OEM number
      const b = await call(db, U.site2Only, 'inv_material_canonical_propose', { description: 'Oil filter', site: 'S2',
        refs: { oem: 'abc 123 x' } })
      dupId = b.id
      assert.ok(b.duplicate_count >= 1)
      assert.equal(b.duplicates[0].canonical_id, canonA)
      // ERP SKU of another country is found as an unlinked candidate (code only)
      const c = await call(db, U.keeper, 'inv_material_canonical_propose', { description: 'Something', refs: { erp_sku: 'flt-01' } })
      assert.ok(c.duplicates.some(d => d.item_id === UAE_FILTER), 'UAE ERP item is a company duplicate candidate')
      assert.ok(!JSON.stringify(c.duplicates).includes(id(103)), 'another company is never a candidate')
      await call(db, U.approver, 'inv_material_canonical_decide', { canonical_id: c.id, decision: 'reject', note: 'test' })
    })

    await t.test('approval: separation of duties and duplicate confirmation', async () => {
      await assert.rejects(call(db, U.keeper, 'inv_material_canonical_decide', { canonical_id: canonA, decision: 'approve' }), code('42501'))
      await assert.rejects(call(db, U.reviewer, 'inv_material_canonical_decide', { canonical_id: canonA, decision: 'approve' }), code('42501'))
      const ok = await call(db, U.approver, 'inv_material_canonical_decide', { canonical_id: canonA, decision: 'approve' })
      assert.equal(ok.status, 'active')
      assert.equal((await one(db, `select bool_and(verified) v from material_aliases where canonical_id='${canonA}'`)).v, true)
      await assert.rejects(call(db, U.engineer, 'inv_material_canonical_decide', { canonical_id: dupId, decision: 'approve' }), code('22023'))
      await call(db, U.engineer, 'inv_material_canonical_decide', { canonical_id: dupId, decision: 'reject', note: 'same as GC-FLT-001' })
    })

    await t.test('variants: genuine needs evidence; ERP SKU mapping per country', async () => {
      genuine = (await call(db, U.keeper, 'inv_material_variant_propose', { canonical_id: canonA, manufacturer: 'OEM Co', part_number: 'ABC-123/X',
        part_classification: 'genuine' })).id
      await assert.rejects(call(db, U.approver, 'inv_material_variant_decide', { variant_id: genuine, decision: 'approve' }), code('22023'))
      await call(db, U.approver, 'inv_material_variant_decide', { variant_id: genuine, decision: 'reject', note: 'packaging only' })
      genuine = (await call(db, U.keeper, 'inv_material_variant_propose', { canonical_id: canonA, manufacturer: 'OEM Co', part_number: 'ABC-123/X',
        part_classification: 'genuine', evidence: [{ type: 'invoice', ref: 'INV-77' }] })).id
      await call(db, U.approver, 'inv_material_variant_decide', { variant_id: genuine, decision: 'approve' })
      aftermarket = (await call(db, U.keeper, 'inv_material_variant_propose', { canonical_id: canonA, manufacturer: 'FiltCo', part_number: 'FC 9981',
        part_classification: 'aftermarket' })).id
      await call(db, U.engineer, 'inv_material_variant_decide', { variant_id: aftermarket, decision: 'approve' })
      await call(db, U.approver, 'inv_material_link_item', { item_id: KSA_FILTER, variant_id: genuine })
      await call(db, U.approver, 'inv_material_link_item', { item_id: BRAKE, variant_id: aftermarket })
      await call(db, U.super, 'inv_material_link_item', { item_id: UAE_FILTER, variant_id: genuine })
      await assert.rejects(call(db, U.approver, 'inv_material_link_item', { item_id: KSA_FILTER, variant_id: aftermarket }), code('23505'))
      await assert.rejects(call(db, U.keeper, 'inv_material_link_item', { item_id: KSA_FILTER, canonical_id: canonA }), code('42501'))
    })

    await t.test('company-wide search, genuine and aftermarket separated, availability by store', async () => {
      await call(db, U.keeper, 'inv_post_movement', { item_id: KSA_FILTER, location_id: loc.S1, movement_type: 'receipt', qty_change: 6, unit_cost: 10 })
      await call(db, U.keeper, 'inv_post_movement', { item_id: BRAKE, location_id: loc.S2, movement_type: 'receipt', qty_change: 2 })
      const r = await rpc(db, U.keeper, 'inv_material_search', [JSON.stringify({ query: 'abc123x' })])
      assert.equal(r.results.length, 1)
      const hit = r.results[0]
      assert.deepEqual(hit.variants.map(v => v.classification), ['genuine', 'aftermarket'])
      assert.equal(hit.variants[0].availability.find(a => a.site === 'S1').available, 6)
      assert.equal(hit.variants[1].availability.find(a => a.site === 'S2').available, 2)
      // UAE-only user: identification shared, KSA ERP SKU and KSA stock not
      const u = await rpc(db, U.uaeOnly, 'inv_material_search', [JSON.stringify({ query: 'GC-FLT-001' })])
      assert.equal(u.results.length, 1)
      assert.deepEqual(u.results[0].erp_skus.map(e => e.country), ['UAE'])
      assert.equal(JSON.stringify(u.results[0].variants).includes('"S1"'), false, 'no KSA stock for a UAE user')
      // site-scoped keeper sees only its sites
      const s2 = await rpc(db, U.site2Only, 'inv_material_search', [JSON.stringify({ query: 'engine oil' })])
      assert.equal(JSON.stringify(s2.results).includes('"S1"'), false)
      // other company sees nothing
      const b = await rpc(db, U.adminB, 'inv_material_search', [JSON.stringify({ query: 'abc123x' })])
      assert.equal(b.results.length, 0)
    })

    let session, unknown, known
    await t.test('Start Physical Inventory: fast capture, offline replay, temp reference', async () => {
      session = await call(db, U.keeper, 'inv_pi_session_start', { country: 'KSA', site: 'S1', location_id: loc.S1 })
      assert.match(session.reference, /^PI-\d{8}-/)
      await assert.rejects(call(db, U.keeper, 'inv_pi_session_start', { country: 'KSA', site: 'S3' }), code('42501'))
      known = await rpc(db, U.keeper, 'inv_pi_capture', [JSON.stringify({ session_id: session.id, client_uuid: uuid(1), kind: 'identified',
        variant_id: genuine, quantity: 5, condition: 'new', scanned_code: 'ABC-123/X', scanned_code_type: 'oem' })])
      assert.equal(known.identification_status, 'identified')
      assert.equal(known.item_id, KSA_FILTER, 'country ERP SKU resolved from the variant')
      const replay = await rpc(db, U.keeper, 'inv_pi_capture', [JSON.stringify({ session_id: session.id, client_uuid: uuid(1), kind: 'identified',
        variant_id: genuine, quantity: 5 })])
      assert.equal(replay.duplicate, true); assert.equal(replay.id, known.id)
      // a retry with a different device timestamp (same client_uuid) is still a replay, never refused
      const replay2 = await call(db, U.keeper, 'inv_pi_capture', { idempotency_key: uuid(1), session_id: session.id, client_uuid: uuid(1),
        kind: 'identified', variant_id: genuine, quantity: 5, captured_at: new Date(Date.now() - 60000).toISOString() })
      assert.equal(replay2.duplicate, true); assert.equal(replay2.id, known.id)
      // a material picked without its variant has two KSA ERP SKUs (genuine and aftermarket): never pick one silently
      const amb = await rpc(db, U.keeper, 'inv_pi_capture', [JSON.stringify({ session_id: session.id, client_uuid: uuid(5), kind: 'identified',
        canonical_id: canonA, quantity: 2 })])
      assert.equal(amb.item_id, null)
      assert.deepEqual(amb.review_flags, ['ambiguous_erp_sku'])
      // customer-owned goods on the shelf are recorded, never turned into owned stock later
      await rpc(db, U.keeper, 'inv_pi_capture', [JSON.stringify({ session_id: session.id, client_uuid: uuid(6), kind: 'identified',
        variant_id: genuine, quantity: 1, ownership: 'customer' })])
      unknown = await rpc(db, U.keeper, 'inv_pi_capture', [JSON.stringify({ session_id: session.id, client_uuid: uuid(2), kind: 'unidentified',
        quantity: 3, condition: 'used', location_hint: 'rack B shelf 2', refs: { description: 'grey pump seal kit', aftermarket: 'SK-44' } })])
      assert.match(unknown.temp_ref, /^UNK-/)
      assert.equal(unknown.identification_status, 'pending_review')
      await assert.rejects(rpc(db, U.keeper, 'inv_pi_capture', [JSON.stringify({ session_id: session.id, client_uuid: uuid(3), quantity: -1 })]), code('22023'))
      // counted evidence is immutable even for the database owner
      await assert.rejects(db.exec(`update physical_inventory_captures set quantity = 9 where id = '${unknown.id}'`), /cannot be changed/)
      await assert.rejects(db.exec(`delete from physical_inventory_captures where id = '${unknown.id}'`), /cannot be deleted/)
    })

    await t.test('photos: company path, duplicate prevention, permanent link', async () => {
      const ok = await rpc(db, U.keeper, 'inv_pi_photo_attach', [JSON.stringify({ client_uuid: uuid(10), capture_id: unknown.id,
        storage_path: `physical_inventory/${ORG_A}/${session.id}/p1.jpg`, sha256: sha('a'), photo_role: 'label', purpose: 'identification' })])
      assert.equal(ok.duplicate, false)
      const again = await rpc(db, U.keeper, 'inv_pi_photo_attach', [JSON.stringify({ client_uuid: uuid(11), capture_id: unknown.id,
        storage_path: `physical_inventory/${ORG_A}/${session.id}/p1-retry.jpg`, sha256: sha('a'), photo_role: 'label', purpose: 'identification' })])
      assert.equal(again.duplicate, true, 'same bytes on the same capture are stored once')
      await rpc(db, U.keeper, 'inv_pi_photo_attach', [JSON.stringify({ client_uuid: uuid(12), capture_id: unknown.id,
        storage_path: `physical_inventory/${ORG_A}/${session.id}/p2.jpg`, sha256: sha('b'), photo_role: 'location', purpose: 'count_proof' })])
      await assert.rejects(rpc(db, U.keeper, 'inv_pi_photo_attach', [JSON.stringify({ client_uuid: uuid(13), capture_id: unknown.id,
        storage_path: 'physical_inventory/other-org/x.jpg', sha256: sha('c') })]), code('22023'))
      await assert.rejects(rpc(db, U.adminB, 'inv_pi_photo_attach', [JSON.stringify({ client_uuid: uuid(14), capture_id: unknown.id,
        storage_path: `physical_inventory/${id(901)}/x.jpg`, sha256: sha('d') })]), code('42501'))
      await assert.rejects(db.exec(`update physical_inventory_photos set storage_path = 'physical_inventory/x' where client_uuid = '${uuid(10)}'`), /permanent/)
    })

    await t.test('unidentified review: not by the counter; mapping keeps count and photos', async () => {
      await assert.rejects(call(db, U.keeper, 'inv_pi_capture_map', { capture_id: unknown.id, decision: 'map_existing', canonical_id: canonA }), code('42501'))
      await assert.rejects(call(db, U.engineer, 'inv_pi_capture_map', { capture_id: unknown.id, decision: 'create_new',
        canonical: { description: 'Pump seal kit' }, variant: { part_number: 'SK-44', part_classification: 'genuine' } }), code('22023'))
      const m = await call(db, U.engineer, 'inv_pi_capture_map', { capture_id: unknown.id, decision: 'create_new',
        canonical: { description: 'Pump seal kit', company_sku: 'GC-SEAL-9' }, variant: { part_number: 'SK-44', part_classification: 'aftermarket' } })
      assert.equal(m.identification_status, 'mapped')
      const cap = await one(db, `select quantity, temp_ref, captured_by from physical_inventory_captures where id='${unknown.id}'`)
      assert.equal(Number(cap.quantity), 3); assert.equal(cap.temp_ref, unknown.temp_ref); assert.equal(cap.captured_by, U.keeper)
      const photos = await q(db, `select purpose from physical_inventory_photos where canonical_id='${m.canonical_id}'`)
      assert.deepEqual(photos.map(p => p.purpose), ['identification'], 'only the identification photo becomes reusable')
      assert.equal((await one(db, `select count(*)::int n from physical_inventory_photos where capture_id='${unknown.id}'`)).n, 2)
    })

    await t.test('correction centre: side-by-side, no self-approval, history kept, stale guard', async () => {
      const req = await call(db, U.keeper, 'inv_correction_request', { target_kind: 'canonical', target_id: canonA, action: 'field_update',
        topic: 'company_sku', new_value: { company_sku: 'GC-FLT-001A' }, reason: 'ERP renumbered' })
      const row = await one(db, `select old_value->>'company_sku' o, new_value->>'company_sku' n from material_correction_requests where id='${req.id}'`)
      assert.deepEqual(row, { o: 'GC-FLT-001', n: 'GC-FLT-001A' })
      await assert.rejects(call(db, U.keeper, 'inv_correction_decide', { request_id: req.id, decision: 'approve' }), code('42501'))
      await call(db, U.approver, 'inv_correction_decide', { request_id: req.id, decision: 'approve' })
      const old = await rpc(db, U.keeper, 'inv_material_search', [JSON.stringify({ query: 'GC-FLT-001' })])
      assert.ok(old.results[0].matched_on.includes('superseded_historical'), 'old SKU is still findable as history')
      const ev = await q(db, `select event from material_correction_events where request_id='${req.id}' order by id`)
      assert.deepEqual(ev.map(e => e.event), ['submitted', 'approved', 'applied'])
      await assert.rejects(db.exec(`delete from material_correction_events where request_id='${req.id}'`), /append-only/)
      const r2 = await call(db, U.keeper, 'inv_correction_request', { target_kind: 'canonical', target_id: canonA, action: 'field_update', topic: 'brand', new_value: { brand: 'X' }, reason: 'brand on box' })
      const r3 = await call(db, U.keeper, 'inv_correction_request', { target_kind: 'canonical', target_id: canonA, action: 'field_update', topic: 'brand', new_value: { brand: 'Y' }, reason: 'brand on invoice' })
      await call(db, U.approver, 'inv_correction_decide', { request_id: r2.id, decision: 'approve' })
      await assert.rejects(call(db, U.approver, 'inv_correction_decide', { request_id: r3.id, decision: 'approve' }), code('PT409'))
      await assert.rejects(call(db, U.keeper, 'inv_correction_request', { target_kind: 'variant', target_id: aftermarket, action: 'field_update',
        new_value: { part_classification: 'genuine' }, reason: 'box says genuine' }), code('22023'))
      await assert.rejects(call(db, U.keeper, 'inv_correction_request', { target_kind: 'item', target_id: KSA_FILTER, action: 'field_update',
        new_value: { item_name: 'x' }, reason: 'r' }), code('22023'))
    })

    await t.test('discovery never posts stock; opening batch goes through the governed workflow', async () => {
      const before = await one(db, 'select count(*)::int n, sum(qty_on_hand)::numeric s from stock_records')
      await assert.rejects(call(db, U.keeper, 'inv_pi_to_opening_batch', { session_id: session.id }), code('22023'))
      await rpc(db, U.keeper, 'inv_pi_capture', [JSON.stringify({ session_id: session.id, client_uuid: uuid(4), kind: 'unidentified', quantity: 1 })])
      await call(db, U.keeper, 'inv_pi_session_close', { session_id: session.id })
      const ob = await call(db, U.keeper, 'inv_pi_to_opening_batch', { session_id: session.id })
      assert.equal(ob.lines, 1, 'only the identified capture with a KSA ERP SKU')
      assert.ok(ob.skipped.some(s => s.reason === 'not_identified'), 'unidentified stays out')
      assert.ok(ob.skipped.some(s => s.reason === 'no_erp_sku_for_country'), 'a new material without a KSA ERP SKU waits for the link')
      assert.ok(ob.skipped.some(s => s.reason === 'ambiguous_erp_sku'), 'ambiguous ERP SKU waits for a person to choose')
      assert.ok(ob.skipped.some(s => s.reason === 'ownership_needs_decision' && s.ownership === 'customer'), 'customer stock is never posted as owned')
      assert.equal((await one(db, `select count(*)::int n from opening_balance_lines where batch_id='${ob.id}' and ownership <> 'owned'`)).n, 0)
      const lines = await q(db, `select mapping_status, missing_cost, issues from opening_balance_lines where batch_id='${ob.id}'`)
      assert.equal(lines.length, 1)
      assert.equal(lines[0].mapping_status, 'needs_review')
      assert.ok(lines.every(l => l.missing_cost === true), 'no price invented')
      assert.ok(lines.some(l => JSON.stringify(l.issues).includes('existing_balance_at_location')), 'item already on hand at WH1 is held for review')
      const after = await one(db, 'select count(*)::int n, sum(qty_on_hand)::numeric s from stock_records')
      assert.deepEqual(after, before, 'no balance changed')
      await assert.rejects(call(db, U.keeper, 'inv_pi_to_opening_batch', { session_id: session.id }), code('23505'))
    })

    await t.test('two companies: nothing crosses', async () => {
      await assert.rejects(rpc(db, U.adminB, 'inv_pi_capture', [JSON.stringify({ session_id: session.id, client_uuid: uuid(20), quantity: 1 })]), code('P0002'))
      const d = await rpc(db, U.adminB, 'inv_pi_dashboard', [JSON.stringify({})])
      assert.equal(Number(d.captures), 0)
      assert.equal((await asUser(db, U.adminB, () => q(db, 'select * from material_canonical'))).length, 0)
      assert.equal((await asUser(db, U.adminB, () => q(db, 'select * from v_inv_pi_captures'))).length, 0)
      const mine = await rpc(db, U.admin, 'inv_pi_dashboard', [JSON.stringify({ site: 'S1' })])
      assert.equal(Number(mine.captures), 5)
      assert.equal(Number(mine.ambiguous_erp_sku), 1)
      assert.equal(Number(mine.ownership_needs_decision), 1)
      assert.equal(Number(mine.pending_review), 1)
      assert.equal(mine.by_employee[0].user_id, U.keeper)
    })

    await t.test('transfer request instead of re-purchase', async () => {
      const tr = await call(db, U.site2Only, 'inv_transfer_request', { item_id: KSA_FILTER, site: 'S2', from_site: 'S1', qty: 2, reason: 'S1 holds 6' })
      await assert.rejects(call(db, U.site2Only, 'inv_transfer_request_decide', { request_id: tr.id, decision: 'approve' }), code('42501'))
      const ok = await call(db, U.keeper, 'inv_transfer_request_decide', { request_id: tr.id, decision: 'approve' })
      assert.equal(ok.status, 'approved')
    })

    await t.test('rollback refuses with data, then restores the original alias table', async () => {
      await assert.rejects(db.exec(DOWN), /Export them/)
      await db.exec('rollback')
      await db.exec(`begin; set local inv.rollback_discard = 'on'; ${DOWN.replace(/^begin;|commit;\s*$/gm, '')} commit;`)
      assert.equal((await one(db, "select to_regclass('public.material_canonical') r")).r, null)
      assert.equal((await one(db, "select is_nullable from information_schema.columns where table_name='material_aliases' and column_name='item_id'")).is_nullable, 'NO')
      await db.exec(UP) // apply again cleanly
    })
  } finally { await db.close() }
})
