// Gate 9: opening balances from the 43 live stock_records rows (disposable clone of copy A).
import { writeFileSync } from 'node:fs'
import { rpc, sel, one, check, results } from './lib.mjs'
import { P } from './setup.mjs'
const db = process.argv[2]
const H = `select md5(string_agg(concat_ws('|', id, site, description, stock_qty, min_level, critical_level, stock_status, reorder_qty, management_action, region, updated_by, updated_at, country, organisation_id, custom_data, unit_cost, currency, brand, tyre_size, last_counted_at, qty_on_hand, unvalued_qty, valued_value), ',' order by id)) h,
  (select md5(string_agg(to_jsonb(m)::text, ',' order by id)) from stock_movements m) mh, count(*)::int n from stock_records`
const before = await one(db, H)
const facts = await one(db, `select count(*)::int rows, sum(qty_on_hand)::float qty, count(*) filter (where unvalued_qty > 0)::int unvalued_rows, sum(unvalued_qty)::float unvalued_units,
  count(*) filter (where country is null)::int null_country_rows, (select count(*)::int from v_stock_balance_reconcile where has_drift) drift_rows from stock_records`)
check(9, 'the 43 legacy rows are preserved after the 16 migrations (qty 345); 33 rows / 302 units unvalued; 7 rows drift from their ledger',
  facts.rows === 43 && facts.unvalued_rows === 33 && facts.unvalued_units === 302 && facts.drift_rows === 7, facts)
const recs = await one(db, `select count(*)::int n, sum(unvalued_qty)::float q from inventory_cost_reconciliations where kind = 'legacy' and status = 'open'`)
check(9, 'each unvalued row is tracked by one open legacy cost reconciliation (never valued at 0)', recs.n === 33 && recs.q === 302, recs)
const b = await rpc(db, P.admin, 'inv_opening_batch_create', { country: 'KSA', reference: 'RH-LEGACY-KSA', source: 'legacy_stock_records' })
const bid = b.batch_id ?? b.id
const lines = await one(db, `select count(*)::int n, count(*) filter (where legacy_drift <> 0)::int drift, count(*) filter (where unit_cost is null)::int unpriced,
  count(*) filter (where history_certainty = 'uncertain')::int uncertain, sum(qty)::float qty from opening_balance_lines where batch_id = '${bid}'`)
check(9, 'Company A legacy seed for KSA: 35 lines (every Company A KSA row), all certain, unpriced lines keep a NULL cost (never 0)',
  lines.n === 35 && lines.drift === 0 && lines.unpriced === (await one(db, `select count(*)::int n from stock_records where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA' and avg_unit_cost is null`)).n, { batch: b, lines })
const zeroCost = await one(db, `select count(*)::int n from opening_balance_lines where unit_cost = 0`)
check(9, 'no opening line carries an invented zero cost', zeroCost.n === 0, zeroCost)
await (await import('./lib.mjs')).run(db, `insert into user_access_grants(user_id, module_key, capability, effect, note) values ('${P.orgB}','stock','create','grant','rh') on conflict do nothing`, 'supabase_admin')
const b2 = await rpc(db, P.orgB, 'inv_opening_batch_create', { country: 'KSA', reference: 'RH-LEGACY-DEMO', source: 'legacy_stock_records' })
const bid2 = b2.batch_id ?? b2.id
const l2 = await one(db, `select count(*)::int n, count(*) filter (where legacy_drift <> 0)::int drift, count(*) filter (where history_certainty = 'uncertain')::int uncertain,
  sum(legacy_drift)::float drift_units from opening_balance_lines where batch_id = '${bid2}'`)
check(9, 'the 7 drift rows (second company, DEMO YARD / DEMO PLANT) are seeded as uncertain with their legacy_drift recorded, not posted', l2.n === 7 && l2.drift === 7 && l2.uncertain === 7, { batch: b2, lines: l2 })
const cross = await one(db, `select count(*)::int n from opening_balance_lines l join opening_balance_batches b on b.id = l.batch_id join stock_records s on s.id = l.target_stock_id where s.organisation_id <> b.organisation_id`)
check(9, 'no batch line points at another company\'s stock row', cross.n === 0, cross)
const nullRow = await one(db, `select s.id, s.site, s.qty_on_hand::float q, exists (select 1 from opening_balance_lines l where l.target_stock_id = s.id) seeded from stock_records s where s.country is null`)
check(9, 'FINDING: the one live row with country NULL (NHC, 35 units) is not picked up by any country batch', nullRow && !nullRow.seeded, nullRow)
const after = await one(db, H)
check(9, 'source rows unchanged by the opening batch (stock_records + stock_movements hash before = after)', before.h === after.h && before.mh === after.mh, { before, after })
writeFileSync(`gate9_${db}.json`, JSON.stringify(results, null, 1))
