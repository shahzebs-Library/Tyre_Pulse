import { describe, it, expect } from 'vitest'
import {
  legacyType, legacyStatusLabel, readyPct, intakeRows, legacyRows, splitLegacy, approvalKpis,
  distinctValues, filterQueue, activeFilterCount, stagedColumns, intakePreviewColumns,
  searchStaged, validationTally,
} from '../lib/uploadApprovalsAnalytics'

const INTAKE = [
  { id: 'b1', module: 'tyres', sheet: 'Sheet1', total_rows: 100, ready_rows: 80, warning_rows: 5, error_rows: 15, duplicate_rows: 0, country: 'KSA' },
  { id: 'b2', module: 'fleet', total_rows: 0, ready_rows: 0, country: 'UAE' },
]
const LEGACY = [
  { id: 'p1', status: 'pending', upload_type: 'stock', row_count: 10, file_name: 'stock.xlsx', uploader_name: 'Ali', country: 'KSA' },
  { id: 'p2', status: 'approved', upload_type: 'tyres', row_count: 5, file_name: 'tyres.xlsx', country: 'UAE' },
  { id: 'p3', status: 'rejected', upload_type: 'weird', row_count: 2, file_name: 'x.csv', country: 'KSA' },
]

describe('shaping', () => {
  it('folds legacy types and labels statuses', () => {
    expect(legacyType('stock')).toBe('stock')
    expect(legacyType('weird')).toBe('tyres')
    expect(legacyStatusLabel('pending')).toBe('Pending review')
    expect(legacyStatusLabel(null)).toBe('Unknown')
  })
  it('ready share is null for an empty batch', () => {
    expect(readyPct(INTAKE[0])).toBe(80)
    expect(readyPct(INTAKE[1])).toBeNull()
  })
  it('intake rows mark what can be committed', () => {
    const [a, b] = intakeRows(INTAKE)
    expect(a).toMatchObject({ moduleLabel: 'Tyres', total: 100, ready: 80, errors: 15, committable: true })
    expect(b.committable).toBe(false)
    expect(b.readyPct).toBeNull()
  })
  it('legacy rows and split', () => {
    const rows = legacyRows(LEGACY)
    expect(rows[2].type).toBe('tyres')
    expect(rows[0].rowCount).toBe(10)
    // The staged data array must survive shaping: the correction modal edits it.
    expect(legacyRows([{ id: 'x', rows: [{ a: 1 }], row_count: 1 }])[0].rows).toEqual([{ a: 1 }])
    const { pending, history } = splitLegacy(LEGACY)
    expect(pending.map((p) => p.id)).toEqual(['p1'])
    expect(history.map((p) => p.id)).toEqual(['p2', 'p3'])
  })
})

describe('approvalKpis', () => {
  it('counts both queues and a real approval rate', () => {
    const { pending, history } = splitLegacy(LEGACY)
    const k = approvalKpis({ intake: INTAKE, pending, history })
    expect(k).toMatchObject({ intakeBatches: 2, intakeRows: 100, intakeReady: 80, intakeErrors: 15, intakeReadyPct: 80, pendingBatches: 1, pendingRows: 10, approved: 1, rejected: 1, approvalRate: 50, awaiting: 3 })
  })
  it('returns null rates when nothing is measurable', () => {
    const k = approvalKpis()
    expect(k.approvalRate).toBeNull()
    expect(k.intakeReadyPct).toBeNull()
    expect(k.awaiting).toBe(0)
  })
})

describe('filters', () => {
  it('filters by country, type, status and search', () => {
    const rows = legacyRows(LEGACY)
    expect(filterQueue(rows, { country: 'KSA' }).map((r) => r.id)).toEqual(['p1', 'p3'])
    expect(filterQueue(rows, { type: 'stock' }).map((r) => r.id)).toEqual(['p1'])
    expect(filterQueue(rows, { status: 'approved' }).map((r) => r.id)).toEqual(['p2'])
    expect(filterQueue(rows, { search: 'ALI' }).map((r) => r.id)).toEqual(['p1'])
    expect(filterQueue(rows, { country: 'All', type: 'All' })).toHaveLength(3)
    expect(filterQueue(intakeRows(INTAKE), { search: 'sheet1' }).map((r) => r.id)).toEqual(['b1'])
  })
  it('counts active filters and lists distinct values', () => {
    expect(activeFilterCount({ search: 'x', country: 'All' })).toBe(0)
    expect(activeFilterCount({ country: 'KSA', type: 'stock' })).toBe(2)
    expect(distinctValues([...LEGACY, { country: '' }, {}], 'country')).toEqual(['KSA', 'UAE'])
  })
})

describe('staged rows', () => {
  it('prefers known columns, else the first 12', () => {
    expect(stagedColumns([{ serial_no: 1, asset_no: 2, junk: 3 }])).toEqual(['asset_no', 'serial_no'])
    expect(stagedColumns([{ a: 1, b: 2 }])).toEqual(['a', 'b'])
    expect(stagedColumns([])).toEqual([])
  })
  it('reads preview columns from the first transformed row', () => {
    expect(intakePreviewColumns([{ transformed_data: null }, { transformed_data: { x: 1, y: 2 } }])).toEqual(['x', 'y'])
    expect(intakePreviewColumns([])).toEqual([])
  })
  it('search keeps the original index so edits land on the right row', () => {
    const rows = [{ a: 'foo' }, { a: 'bar' }, { a: 'food' }]
    expect(searchStaged(rows, 'foo', ['a']).map((x) => x.idx)).toEqual([0, 2])
    expect(searchStaged(rows, '', ['a'])).toHaveLength(3)
  })
  it('tallies validation status', () => {
    expect(validationTally([{ validation_status: 'ready' }, { validation_status: 'error' }, { validation_status: 'warning' }, {}]))
      .toEqual({ ready: 1, warning: 1, error: 1, other: 1 })
  })
})
