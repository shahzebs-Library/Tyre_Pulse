import { describe, it, expect } from 'vitest'
import {
  parseTyreSize, sizeSearchPattern, brandTokens, stockLineCode, isDemoLine, exactCodeProposal, tyreSuggestions,
  buildUnmatchedReview, unmatchedExportRows, reconcileStock, foldLedger, reconcileExportRows, RECONCILE_CHECKS,
} from '../lib/inventory/stockReconcile'

const ORG = 'org-1'

describe('parseTyreSize', () => {
  it.each([
    ['315/80R22.5 Double coin', '315/80R22.5'],
    ['TIRE 315/80 R22.5 - RR99 DOUBLECOIN', '315/80R22.5'],
    ['TIRE 235-70R16 TL ROA', '235/70R16'],
    ['TIRE 215/70 R 16', '215/70R16'],
    ['23.5.R.25 Doublecoin', '23.5R25'],
    ['TIRE 23.5 R25 20PR TL RADIAL', '23.5R25'],
    ['TIRE 195 R 15C-6PR NEW MODEL 2007 TOYOTA', '195R15'],
    ['TIRE 11R22.5 TL 16PR', '11R22.5'],
    ['TIRE 7.00 R16 10PR R 230TT BRIDGESTONE', '7.00R16'],
    ['TIRE 9.00R20 HANK', '9.00R20'],
    ['TIRE 10-16.5/10 SKS-1 allainz', '10-16.5'],
  ])('%s -> %s', (text, size) => {
    expect(parseTyreSize(text)).toBe(size)
  })

  it('returns null when no size is present', () => {
    expect(parseTyreSize('OIL FILTER')).toBeNull()
    expect(parseTyreSize('')).toBeNull()
    expect(parseTyreSize(null)).toBeNull()
  })

  it('builds a loose search pattern from the numbers in order', () => {
    expect(sizeSearchPattern('315/80R22.5')).toBe('%315%80%22.5%')
    expect(sizeSearchPattern(null)).toBeNull()
  })
})

describe('brandTokens', () => {
  it('folds spacing and case', () => {
    expect(brandTokens('385/65R22.5 Double coin')).toEqual(['DOUBLE COIN'])
    expect(brandTokens('385/65R22.5 Doublecoin')).toEqual(['DOUBLE COIN'])
    expect(brandTokens('x', 'Eracle')).toEqual(['ERACLE'])
  })
  it('does not invent a brand from a loose fragment', () => {
    expect(brandTokens('TIRE 9.00R20 HANK')).toEqual([])
  })
})

describe('unmatched stock items', () => {
  const codeLine = { id: 's1', organisation_id: ORG, country: 'KSA', site: 'NHC', description: 'TIRE 315/80 R22.5 TECHKING', item_id: null, qty_on_hand: 73, custom_data: { stock_item: { code: '223758-o ' } } }
  const noCode = { id: 's2', organisation_id: ORG, country: 'KSA', site: 'NHC', description: '315/80R22.5 Double coin', item_id: null, qty_on_hand: 35, custom_data: null }
  const demo = { id: 's3', organisation_id: 'demo-org', country: 'KSA', site: 'DEMO YARD', description: '315/80R22.5 steer tyre', brand: 'Demo Brand A', item_id: null, qty_on_hand: 14 }
  const linked = { id: 's4', organisation_id: ORG, country: 'KSA', site: 'NHC', description: 'x', item_id: 'm9', qty_on_hand: 1 }

  const mm = [
    { id: 'm1', organisation_id: ORG, country: 'KSA', item_code: '223758-O', item_name: 'TIRE 315/80 R22.5 TECHKING' },
    { id: 'm2', organisation_id: ORG, country: 'UAE', item_code: '223758-O', item_name: 'something else' },
  ]
  const tyres = [
    { id: 'm5', organisation_id: ORG, country: 'KSA', item_code: '223707-O', item_name: 'TIRE 315/80 R22.5 - RR99 DOUBLECOIN', source: 'material_master' },
    { id: 'm6', organisation_id: ORG, country: 'KSA', item_code: '223758-O', item_name: 'TIRE 315/80 R22.5 TECHKING', source: 'material_master' },
    { id: 'm7', organisation_id: ORG, country: 'KSA', item_code: '221855-O', item_name: 'TIRE 385-65R22.5', source: 'material_master' },
    { id: 'm8', organisation_id: ORG, country: 'UAE', item_code: 'U1', item_name: 'TIRE 315/80R22.5 DOUBLECOIN', source: 'material_master' },
  ]

  it('reads the code from quick-entry metadata and spots demo lines', () => {
    expect(stockLineCode(codeLine)).toBe('223758-O')
    expect(stockLineCode(noCode)).toBe('')
    expect(isDemoLine(demo)).toBe(true)
    expect(isDemoLine(noCode)).toBe(false)
  })

  it('matches a code exactly within the same country only', () => {
    const p = exactCodeProposal(codeLine, mm)
    expect(p.kind).toBe('code_exact')
    expect(p.candidates.map((c) => c.id)).toEqual(['m1'])
    expect(exactCodeProposal({ ...codeLine, country: 'Egypt' }, mm).kind).toBe('code_missing')
  })

  it('suggests same-size items, brand first, never other sizes or countries', () => {
    const t = tyreSuggestions(noCode, tyres)
    expect(t.size).toBe('315/80R22.5')
    expect(t.brands).toEqual(['DOUBLE COIN'])
    expect(t.suggestions.map((s) => s.code)).toEqual(['223707-O', '223758-O'])
    expect(t.suggestions[0].reasons.join(' ')).toMatch(/Same brand/)
    expect(t.suggestions[1].score).toBeLessThan(t.suggestions[0].score)
  })

  it('builds the review, real lines before demo, and skips linked lines', () => {
    const { rows, summary } = buildUnmatchedReview([demo, noCode, codeLine, linked], { mmByCode: mm, tyreCandidates: tyres })
    expect(rows.map((r) => r.id)).toEqual(['s1', 's2', 's3'])
    expect(summary).toMatchObject({ total: 3, real: 2, demo: 1, withCode: 1, noCode: 2, code_exact: 1 })
    // The demo line belongs to another organisation: no suggestion crosses it.
    expect(rows.find((r) => r.id === 's3').kind).toBe('no_code_none')
    const exp = unmatchedExportRows(rows)
    expect(exp[1]).toMatchObject({ proposed_code: '223707-O', status: 'Proposal only, not applied' })
  })
})

describe('stock reconciliation', () => {
  const rows = [
    { id: 'a', qty_on_hand: 10, stock_qty: 10, qty_reserved: 0, unvalued_qty: 0, item_id: 'i1' },
    { id: 'b', qty_on_hand: 5, stock_qty: 4, qty_reserved: 2, unvalued_qty: 5, item_id: 'i2' },
    { id: 'c', qty_on_hand: 3, stock_qty: 3, qty_reserved: 0, unvalued_qty: 0, item_id: null },
    { id: 'd', qty_on_hand: -1, stock_qty: -1, qty_reserved: 0, unvalued_qty: 0, item_id: 'i1' },
    { id: 'e', qty_on_hand: 0, stock_qty: 0, qty_reserved: 0, unvalued_qty: 0, item_id: 'i1' },
  ]
  const ledger = foldLedger([
    { stock_id: 'a', qty_change: 10, reserved_change: 0 },
    { stock_id: 'b', qty_change: 6, reserved_change: 2 },
    { stock_id: 'b', qty_change: -1, reserved_change: null },
    { stock_id: 'd', qty_change: -1 },
  ])

  it('folds the ledger per stock line', () => {
    expect(ledger.get('b')).toEqual({ qty: 5, count: 2, reserved: 2 })
  })

  it('counts every check', () => {
    const r = reconcileStock(rows, { ledger, catalogueItemIds: new Set(['i1']) })
    const by = Object.fromEntries(r.checks.map((c) => [c.key, c.count]))
    expect(r.total).toBe(5)
    expect(by).toEqual({
      ledger_drift: 1, // c: 3 on hand, no movements
      stock_qty_diff: 1, // b
      qty_no_ledger: 1, // c
      reserved_mismatch: 0,
      negative: 1, // d
      unvalued: 1, // b
      unlinked: 1, // c
      not_in_catalogue: 1, // b (i2)
    })
    expect(r.checks.map((c) => c.key)).toEqual(RECONCILE_CHECKS.map((c) => c.key))
  })

  it('flags reserved above on hand and reserved against the ledger', () => {
    const r = reconcileStock([{ id: 'x', qty_on_hand: 1, stock_qty: 1, qty_reserved: 3 }], { ledger: foldLedger([{ stock_id: 'x', qty_change: 1, reserved_change: 3 }]) })
    expect(r.checks.find((c) => c.key === 'reserved_mismatch').count).toBe(1)
    const r2 = reconcileStock([{ id: 'y', qty_on_hand: 5, stock_qty: 5, qty_reserved: 1 }], { ledger: foldLedger([{ stock_id: 'y', qty_change: 5 }]) })
    expect(r2.checks.find((c) => c.key === 'reserved_mismatch').rows[0].difference).toBe(1)
  })

  it('skips the catalogue check when links could not be read', () => {
    const r = reconcileStock(rows, { ledger, catalogueItemIds: null })
    const c = r.checks.find((x) => x.key === 'not_in_catalogue')
    expect(c.skipped).toBe(true)
    expect(c.count).toBe(0)
  })

  it('exports a drill-down', () => {
    const r = reconcileStock(rows, { ledger })
    const out = reconcileExportRows(r.checks.find((c) => c.key === 'ledger_drift'))
    expect(out).toEqual([expect.objectContaining({ stock_id: 'c', qty_on_hand: 3, ledger_qty: 0, difference: 3, demo: 'Real' })])
  })
})
