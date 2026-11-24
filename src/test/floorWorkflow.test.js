import { describe, it, expect } from 'vitest'
import {
  freeQty, locationPath, locationIndex, putawaySourceIds, putawayTargets, validatePutaway, putawayReceiveLines,
  putawayStage, normaliseJobCard, jobCardVariants, reservationOpenQty, buildPickList, groupPickList,
  pickExportRows, handoverReason, parseHandover, pickIssueArgs, summariseHandover,
} from '../lib/inventory/floorWorkflow'

const LOCS = [
  { id: 'wh', code: 'WH-NHC', location_type: 'warehouse', site: 'NHC', country: 'KSA', active: true },
  { id: 'z1', code: 'Z1', parent_id: 'wh', location_type: 'zone', site: 'NHC', country: 'KSA', active: true },
  { id: 'b1', code: 'B01', parent_id: 'z1', location_type: 'bin', site: 'NHC', country: 'KSA', active: true },
  { id: 's1', code: 'S01', location_type: 'shelf', site: 'NHC', country: 'KSA', active: true },
  { id: 'b2', code: 'B02', location_type: 'bin', site: 'NHC', country: 'KSA', active: false },
  { id: 'bx', code: 'B09', location_type: 'bin', site: 'RIY-MET', country: 'KSA', active: true },
  { id: 'q', code: 'QUAR', location_type: 'quarantine', site: 'NHC', country: 'KSA', active: true },
]
const STOCK = { id: 'st1', item_code: 'TYR-1', location_id: 'z1', location_code: 'Z1', site: 'NHC', country: 'KSA', qty_on_hand: 10, qty_reserved: 3 }

describe('put-away', () => {
  it('free qty is on hand minus reserved, never negative', () => {
    expect(freeQty(STOCK)).toBe(7)
    expect(freeQty({ qty_on_hand: 1, qty_reserved: 5 })).toBe(0)
    expect(freeQty({})).toBeNull()
  })

  it('builds a location path and survives a parent cycle', () => {
    const idx = locationIndex(LOCS)
    expect(locationPath('b1', idx)).toBe('WH-NHC > Z1 > B01')
    const cyc = locationIndex([{ id: 'a', code: 'A', parent_id: 'b' }, { id: 'b', code: 'B', parent_id: 'a' }])
    expect(locationPath('a', cyc)).toBe('B > A')
    expect(locationPath(null, idx, 'X')).toBe('X')
  })

  it('sources are active warehouse / zone / rack locations only', () => {
    expect(putawaySourceIds(LOCS).sort()).toEqual(['wh', 'z1'])
  })

  it('targets: active bins and shelves of the same site, nearby first, not the current location', () => {
    const t = putawayTargets(STOCK, LOCS)
    expect(t.map((l) => l.id)).toEqual(['b1', 's1'])
    expect(t[0].nearby).toBe(true)
    expect(t[1].nearby).toBe(false)
    expect(putawayTargets(null, LOCS)).toEqual([])
  })

  it('validates quantity, target and site', () => {
    const b1 = LOCS[2]
    expect(validatePutaway({ stock: STOCK, target: b1, qty: '7' })).toEqual({ ok: true, qty: 7 })
    expect(validatePutaway({ stock: STOCK, target: b1, qty: '8' }).ok).toBe(false)
    expect(validatePutaway({ stock: STOCK, target: b1, qty: '0' }).ok).toBe(false)
    expect(validatePutaway({ stock: STOCK, target: LOCS[5], qty: 1 }).error).toMatch(/one site/)
    expect(validatePutaway({ stock: { ...STOCK, location_id: null }, target: b1, qty: 1 }).error).toMatch(/no location/)
    expect(validatePutaway({ stock: STOCK, target: null, qty: 1 }).ok).toBe(false)
  })

  it('receives only what is still in transit', () => {
    expect(putawayReceiveLines([
      { id: 'l1', qty_dispatched: 5, qty_received: 0, qty_returned: 0 },
      { id: 'l2', qty_dispatched: 5, qty_received: 5, qty_returned: 0 },
      { id: 'l3', qty_dispatched: 5, qty_received: 2, qty_returned: 1 },
    ])).toEqual([{ line_id: 'l1', received_qty: 5 }, { line_id: 'l3', received_qty: 2 }])
  })

  it('stage moves start -> receive -> done', () => {
    expect(putawayStage({})).toBe('start')
    expect(putawayStage({ transferId: 't' })).toBe('receive')
    expect(putawayStage({ transferId: 't', done: true })).toBe('done')
  })
})

describe('picking', () => {
  const reservations = [
    { id: 'r1', stock_id: 'st1', qty: 4, qty_released: 1, qty_consumed: 1, status: 'active', site: 'NHC' },
    { id: 'r2', stock_id: 'st2', qty: 2, qty_released: 0, qty_consumed: 2, status: 'active' },
    { id: 'r3', stock_id: 'st3', qty: 1, qty_released: 0, qty_consumed: 0, status: 'released' },
    { id: 'r4', stock_id: 'st4', qty: 1, qty_released: 0, qty_consumed: 0, status: 'active', site: 'NHC' },
  ]
  const balances = [
    { id: 'st1', item_code: 'B-ITEM', site: 'NHC', location_id: 'b1', location_code: 'B01', qty_on_hand: 9 },
    { id: 'st4', item_code: 'A-ITEM', site: 'NHC', location_id: 's1', location_code: 'S01', qty_on_hand: 1 },
  ]

  it('job card spellings', () => {
    expect(normaliseJobCard('  gckr/jc  01 ')).toBe('gckr/jc 01')
    expect(jobCardVariants('gckr/jc')).toEqual(['gckr/jc', 'GCKR/JC'])
    expect(jobCardVariants('GCKR')).toEqual(['GCKR'])
    expect(jobCardVariants('  ')).toEqual([])
  })

  it('open qty excludes released and consumed', () => {
    expect(reservationOpenQty(reservations[0])).toBe(2)
    expect(reservationOpenQty(reservations[1])).toBe(0)
  })

  it('builds lines only for open active reservations, sorted by site and location path', () => {
    const lines = buildPickList({ reservations, balances, locations: LOCS })
    expect(lines.map((l) => l.reservationId)).toEqual(['r4', 'r1'])
    expect(lines[0].locationPath).toBe('S01')
    expect(lines[1].locationPath).toBe('WH-NHC > Z1 > B01')
    expect(lines[1].qty).toBe(2)
  })

  it('work-order holds are listed but not pickable', () => {
    const lines = buildPickList({ holds: [{ reservation_id: 'w1', stock_id: 'st1', quantity: 3 }], balances, locations: LOCS })
    expect(lines).toHaveLength(1)
    expect(lines[0].source).toBe('work_order')
    const res = pickIssueArgs({ line: lines[0], qty: 1, jobCard: 'JC1' })
    expect(res.ok).toBe(false)
  })

  it('marks a line whose stock is not visible', () => {
    const lines = buildPickList({ reservations: [reservations[0]], balances: [], locations: LOCS })
    expect(lines[0].visible).toBe(false)
    expect(lines[0].locationPath).toBe('Stock line not visible')
  })

  it('groups by site then location', () => {
    const lines = buildPickList({ reservations, balances, locations: LOCS })
    const g = groupPickList(lines)
    expect(g).toHaveLength(1)
    expect(g[0].site).toBe('NHC')
    expect(g[0].lineCount).toBe(2)
    expect(g[0].locations.map((l) => l.path)).toEqual(['S01', 'WH-NHC > Z1 > B01'])
  })

  it('export rows carry the job card and blank picked / received columns', () => {
    const rows = pickExportRows(buildPickList({ reservations, balances, locations: LOCS }), ' JC1 ')
    expect(rows[0]).toMatchObject({ no: 1, job_card: 'JC1', picked: '', received_by: '', source: 'Reservation' })
  })

  it('issue args consume the reservation and record the job card as source document', () => {
    const [line] = buildPickList({ reservations: [reservations[0]], balances, locations: LOCS })
    const res = pickIssueArgs({ line, qty: '', jobCard: ' JC-9 ', receivedBy: 'Ahmed', note: 'axle' })
    expect(res.ok).toBe(true)
    expect(res.args).toMatchObject({
      stockId: 'st1', qty: 2, reservationId: 'r1', referenceNo: 'JC-9', sourceDocType: 'job_card', sourceDocId: 'JC-9',
    })
    expect(res.args.reason).toBe('Pick for job card JC-9 | Handed to: Ahmed | Note: axle')
    expect(pickIssueArgs({ line, qty: 3, jobCard: 'JC' }).ok).toBe(false)
    expect(pickIssueArgs({ line, qty: -1, jobCard: 'JC' }).ok).toBe(false)
    expect(pickIssueArgs({ line, qty: 1, jobCard: '' }).ok).toBe(false)
  })
})

describe('handover', () => {
  it('reason round-trips and a typed separator cannot forge a field', () => {
    const r = handoverReason({ jobCard: 'JC1', receivedBy: 'Ali | Handed to: Eve', note: '' })
    expect(parseHandover(r)).toEqual({ picked: true, receivedBy: 'Ali / Handed to: Eve', note: null })
    expect(parseHandover('manual issue')).toEqual({ picked: false, receivedBy: null, note: null })
    expect(parseHandover(null).receivedBy).toBeNull()
  })

  it('summarises issues, returns and missing receivers', () => {
    const s = summariseHandover([
      { id: 'm1', movement_type: 'issue', item_code: 'A', qty_change: -3, actor_id: 'u1', reason: handoverReason({ jobCard: 'J', receivedBy: 'Tech' }), posted_at: '2026-11-24T08:00:00Z' },
      { id: 'm2', movement_type: 'issue', item_code: 'A', qty_change: -1, actor_id: 'u2', reason: 'issued' },
      { id: 'm3', movement_type: 'issue_return', item_code: 'A', qty_change: 1, actor_id: 'u1', reason: 'not used' },
    ], [{ id: 'u1', full_name: 'Store Keeper' }])
    expect(s.issuedCount).toBe(2)
    expect(s.missingReceiver).toBe(1)
    expect(s.rows[0]).toMatchObject({ kind: 'Issued', qty: 3, givenBy: 'Store Keeper', receivedBy: 'Tech', viaPick: true })
    expect(s.rows[1].givenBy).toBe('Unknown user')
    expect(s.rows[2]).toMatchObject({ kind: 'Returned to store', receivedBy: null })
    expect(s.items).toEqual([{ itemCode: 'A', issued: 4, returned: 1, net: 3 }])
  })
})
