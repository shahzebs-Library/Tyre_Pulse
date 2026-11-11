import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildImportPreview, committableRows, gridRowsToAudit, monthsInRows, manualTyreCostWarning, needsAttention,
} from '../lib/importCostPreview'
import { COST_PENDING_LABEL } from '../lib/tyreCostAudit'

const h = vi.hoisted(() => {
  const state = { calls: [], rows: [] }
  function from(table) {
    const call = { table, filters: [], orders: [] }
    state.calls.push(call)
    const b = {
      select(cols) { call.cols = cols; return b },
      eq(c, v) { call.filters.push(['eq', c, v]); return b },
      gt(c, v) { call.filters.push(['gt', c, v]); return b },
      gte(c, v) { call.filters.push(['gte', c, v]); return b },
      lt(c, v) { call.filters.push(['lt', c, v]); return b },
      order(c) { call.orders.push(c); return b },
      range() { return Promise.resolve({ data: state.rows, error: null }) },
    }
    return b
  }
  return { state, supabase: { from } }
})
vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const grid = (o = {}) => ({
  source_row: '', issue_number: 'I1', work_order_no: 'GCKR/JC/1', txn_date: '10-03-2026',
  item_code: '310100-O', qty: '2', item_description: 'TYRE 315/80R22.5 TRIANGLE', value_amount: '1800', ...o,
})

describe('expense grid preview', () => {
  it('maps grid rows with a parsed date and the ERP line number in the duplicate key', () => {
    const [a] = gridRowsToAudit([grid({ source_row: '7' })])
    expect(a).toMatchObject({ line: '7', date: '2026-03-10', qty: 2, value: 1800, serial: '#7' })
    expect(monthsInRows(gridRowsToAudit([grid(), grid({ txn_date: '02-04-2026' })]))).toEqual(['2026-03', '2026-04'])
  })

  it('holds back exact duplicates and invalid rows; everything else imports', () => {
    const rows = [grid(), grid(), grid({ item_code: '', value_amount: '50' }), grid({ item_description: 'INNER TUBE 1200-20', value_amount: '40', qty: '1' })]
    const p = buildImportPreview('grid', rows, { country: 'KSA' })
    expect(p.counts.duplicate).toBe(1)
    expect(p.counts.invalid).toBe(1)
    expect(p.excludedCount).toBe(2)
    expect(p.excludedValue).toBe(1850)
    expect(committableRows(rows, p)).toEqual([rows[0], rows[3]])
  })

  it('never treats genuine repeated lines with different ERP line numbers as duplicates', () => {
    const p = buildImportPreview('grid', [grid({ source_row: '1' }), grid({ source_row: '2' })], { country: 'KSA' })
    expect(p.counts.duplicate || 0).toBe(0)
    expect(p.excludedCount).toBe(0)
  })

  it('proposes a same-month same-item price from stored lines or the file, never writing it', () => {
    const rows = [grid({ value_amount: '0', qty: '1' })]
    const dbLines = [{ id: 'db1', country: 'KSA', itemCode: '310100-O', date: '2026-03-02', description: 'TYRE 315/80R22.5', value: 950, qty: 1 }]
    const p = buildImportPreview('grid', rows, { country: 'KSA', dbLines })
    expect(p.rows[0]).toMatchObject({ result: 'price_proposed', proposed: 950 })
    expect(rows[0].value_amount).toBe('0') // uploaded value untouched
    // Same price from another line in the SAME file
    const p2 = buildImportPreview('grid', [grid({ source_row: '1', value_amount: '0', qty: '1' }), grid({ source_row: '2', value_amount: '900', qty: '1' })], { country: 'KSA' })
    expect(p2.rows[0]).toMatchObject({ result: 'price_proposed', proposed: 900 })
    // Different month: no cross-month substitution
    const p3 = buildImportPreview('grid', rows, { country: 'KSA', dbLines: [{ ...dbLines[0], date: '2026-02-02' }] })
    expect(p3.rows[0].result).toBe('cost_pending')
  })

  it('reconciles the tyre/spare/service/repair split to the file total', () => {
    const p = buildImportPreview('grid', [
      grid({ source_row: '1' }),
      grid({ source_row: '2', item_description: 'INNER TUBE 1200-20', value_amount: '40', qty: '1' }),
      grid({ source_row: '3', item_description: 'TYRE FITTING CHARGES', value_amount: '60', qty: '1' }),
      grid({ source_row: '4', item_description: 'Repair TIRE 315/80R22.5', value_amount: '25', qty: '1' }),
    ], { country: 'KSA' })
    expect(p.reconciliation.reconciles).toBe(true)
    expect(p.reconciliation.fileTotal).toBe(1925)
    expect(p.reconciliation.totals).toMatchObject({ tyre: 1800, spare: 40, service: 60, repair: 25 })
  })
})

describe('monthly tyre preview', () => {
  const tr = (o = {}) => ({ serial_no: 'S1', asset_no: 'TM1', position: 'LHF1', size: '315/80R22.5', issue_date: '2026-03-01', job_card: 'JC1', ...o })
  it('previews a complete fitment as Valid, never Cost Pending, and never prices by size', () => {
    // Cost for the Monthly Tyres file comes from the separate expense grid, so a
    // priceless-but-complete tyre row must read Valid, not pending. It is still
    // never priced from the index (even when a same-size grid price exists).
    const p = buildImportPreview('monthly_tyres', [tr(), tr({ serial_no: 'S2', position: 'RHF1' })], { country: 'KSA', dbLines: [{ id: 'x', country: 'KSA', itemCode: '315/80R22.5', date: '2026-03-01', description: 'TYRE 315/80R22.5', value: 900, qty: 1 }] })
    expect(p.rows.map((r) => r.result)).toEqual(['valid', 'valid'])
    expect(p.counts.cost_pending ?? 0).toBe(0)
    expect(p.rows.every((r) => r.label === 'Valid')).toBe(true)
    expect(p.rows.every((r) => r.proposed == null)).toBe(true)
    expect(p.reconciliation).toBeNull()
  })
  it('a repeated tyre row is a duplicate; a row with no date is invalid; a clean row is valid', () => {
    const rows = [tr(), tr(), tr({ serial_no: 'S3', issue_date: null, removal_date: null })]
    const p = buildImportPreview('monthly_tyres', rows, { country: 'KSA' })
    expect(p.rows.map((r) => r.result)).toEqual(['valid', 'duplicate', 'invalid'])
    expect(committableRows(rows, p)).toEqual([rows[0]])
  })
})

describe('data intake tyre preview is advisory', () => {
  it('flags zero / missing cost as pending and marks itself advisory', () => {
    const p = buildImportPreview('intake_tyre', [
      { serial_no: 'A', asset_no: 'T1', size: '315/80R22.5', issue_date: '2026-03-01', cost_per_tyre: 0, qty: 1 },
      { serial_no: 'B', asset_no: 'T1', size: '315/80R22.5', issue_date: '2026-03-01', cost_per_tyre: 1200, qty: 2 },
    ], { country: 'KSA' })
    expect(p.advisory).toBe(true)
    expect(p.rows.map((r) => r.result)).toEqual(['cost_pending', 'valid'])
    expect(needsAttention(p.rows[1])).toBe(false)
  })
  it('returns null for kinds without a cost preview', () => {
    expect(buildImportPreview('complaints', [{}])).toBeNull()
  })
})

describe('manual tyre entry cost warning', () => {
  it('warns on blank and zero cost for a non-warranty tyre, never on a real price', () => {
    expect(manualTyreCostWarning({ cost: '' })).toMatch(COST_PENDING_LABEL)
    expect(manualTyreCostWarning({ cost: 0 })).toMatch(/Cost is 0/)
    expect(manualTyreCostWarning({ cost: '1200' })).toBeNull()
  })
  it('stays silent for a warranty tyre', () => {
    expect(manualTyreCostWarning({ cost: 0, remarks: 'Warranty replacement' })).toBeNull()
    expect(manualTyreCostWarning({ cost: '', warranty: true })).toBeNull()
  })
})

describe('loadPriceIndex', () => {
  beforeEach(() => { h.state.calls = []; h.state.rows = [] })
  it('reads tyre lines per month, bounded, ordered with an id tiebreak, and builds the index', async () => {
    h.state.rows = [{ id: 'p1', country: 'KSA', item_code: '310100-O', event_date: '2026-03-05', item_description: 'TYRE 315/80R22.5', line_cost: 1800, qty_n: 2 }]
    const { loadPriceIndex } = await import('../lib/api/tyreCostAudit')
    const res = await loadPriceIndex({ country: 'KSA', months: ['2026-03', 'bad', '2026-03'] })
    expect(h.state.calls).toHaveLength(1)
    const c = h.state.calls[0]
    expect(c.table).toBe('parts_consumption')
    expect(c.filters).toEqual(expect.arrayContaining([
      ['eq', 'country', 'KSA'], ['eq', 'cost_category', 'tyre'], ['gt', 'line_cost', 0], ['gt', 'qty_n', 0],
      ['gte', 'event_date', '2026-03-01'], ['lt', 'event_date', '2026-04-01'],
    ]))
    expect(c.orders).toEqual(['event_date', 'id'])
    expect(res.lines).toHaveLength(1)
    expect(res.index.get('KSA|310100-O|2026-03').prices.has(900)).toBe(true)
  })
  it('does not read anything without a country or months', async () => {
    const { loadPriceIndex } = await import('../lib/api/tyreCostAudit')
    const res = await loadPriceIndex({ country: null, months: ['2026-03'] })
    expect(h.state.calls).toHaveLength(0)
    expect(res.lines).toEqual([])
  })
})

describe('tyre cost cells show Cost Pending Verification, never 0 / blank', () => {
  const src = (f) => readFileSync(resolve(__dirname, '..', 'pages', f), 'utf8')
  it('TyreRecords, Tyre Passport and Serial Tracker render tyre prices through costDisplay', () => {
    expect(src('TyreRecords.jsx')).toMatch(/costDisplay\(detailRecord\.cost_per_tyre/)
    expect(src('TyreRecords.jsx')).toMatch(/KV k="Purchase price" v=\{costDisplay\(record\.cost_per_tyre/)
    expect(src('TyrePassport.jsx')).toMatch(/costDisplay\(v,/)
    expect(src('TyrePassport.jsx')).toMatch(/\['Purchase cost', tyreCost\(/)
    expect(src('SerialTracker.jsx')).toMatch(/tyrePriceFor = \(n, country\) => costDisplay\(/)
    expect(src('SerialTracker.jsx')).toMatch(/Price per tyre">\{tyrePriceFor\(/)
  })
  it('the manual tyre form shows the cost warning without blocking save', () => {
    expect(src('TyreRecords.jsx')).toMatch(/data-testid="tyre-cost-warning"/)
  })
})
