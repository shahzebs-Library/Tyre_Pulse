import { describe, it, expect } from 'vitest'
import {
  humanizeKey, flagsOf, isFlagged, summarizeRows, filterReviewRows,
  reviewExportRows, summarizeBatches, capOverflow, matchRate,
} from '../lib/erpImportAnalytics'

describe('humanizeKey', () => {
  it('turns keys into headers', () => {
    expect(humanizeKey('asset_no')).toBe('Asset No')
    expect(humanizeKey('fix_km')).toBe('Fix KM')
    expect(humanizeKey('')).toBe('')
  })
})

const change = [
  { source_row: 2, asset_no: 'TM1', is_active: true, chain_ok: true, warnings: [] },
  { source_row: 3, asset_no: 'TM1', is_active: false, chain_ok: false, warnings: ['chain'] },
  { source_row: 4, asset_no: 'TM2', is_active: false, chain_ok: true, warnings: [] },
]

describe('flags + summary', () => {
  it('flags change rows', () => {
    expect(flagsOf(change[1], 'change')).toEqual(['Old', 'Chain break', '1 warning'])
    expect(isFlagged(change[0], 'change')).toBe(false)
    expect(isFlagged(change[1], 'change')).toBe(true)
  })
  it('flags expense rows without a fitment only when a change tab exists', () => {
    expect(isFlagged({ _hasChangeTab: true, serial_in_change: false }, 'expense')).toBe(true)
    expect(isFlagged({ _hasChangeTab: false, serial_in_change: false }, 'expense')).toBe(false)
  })
  it('summarises change rows', () => {
    expect(summarizeRows(change, 'change')).toEqual({ rows: 3, active: 1, old: 2, warned: 1, chainBreaks: 1, noFitment: null, flagged: 1, flaggedPct: 33.3 })
  })
  it('keeps active/old null outside the change log', () => {
    const s = summarizeRows([{ warnings: [] }], 'asset')
    expect(s.active).toBeNull()
    expect(s.old).toBeNull()
    expect(summarizeRows([], 'asset').flaggedPct).toBeNull()
  })
})

describe('filterReviewRows', () => {
  it('keeps the original change-log filters', () => {
    expect(filterReviewRows(change, { flag: 'active', datasetKey: 'change' }).map((r) => r.source_row)).toEqual([2])
    expect(filterReviewRows(change, { flag: 'old', datasetKey: 'change' }).map((r) => r.source_row)).toEqual([3, 4])
    expect(filterReviewRows(change, { flag: 'flagged', datasetKey: 'change' }).map((r) => r.source_row)).toEqual([3])
  })
  it('searches every field', () => {
    expect(filterReviewRows(change, { search: 'tm2', datasetKey: 'change' }).map((r) => r.source_row)).toEqual([4])
  })
})

describe('reviewExportRows', () => {
  it('matches the page export shape', () => {
    const { cols, headers, flat } = reviewExportRows(change.slice(0, 1), ['asset_no'], 'change')
    expect(cols).toEqual(['source_row', 'is_active', 'chain_ok', 'asset_no'])
    expect(headers).toEqual(['source_row', 'Active', 'Chain OK', 'asset_no'])
    expect(flat[0]).toEqual({ source_row: 2, is_active: 'Active', chain_ok: true, asset_no: 'TM1' })
  })
})

describe('batches + caps', () => {
  it('summarises batches with an injected now', () => {
    const now = new Date('2026-09-26T00:00:00Z')
    const s = summarizeBatches([
      { batch_id: 'a', count: 10, created_at: '2026-09-20T00:00:00Z', country: 'KSA' },
      { batch_id: 'b', count: 5, created_at: '2026-09-24T00:00:00Z', country: 'UAE' },
    ], now)
    expect(s).toMatchObject({ batches: 2, rows: 15, countries: ['KSA', 'UAE'], latestAgeDays: 2 })
    expect(summarizeBatches([], now).latestAgeDays).toBeNull()
  })
  it('reports cap overflow and match rate honestly', () => {
    expect(capOverflow(120000, 100000)).toBe(20000)
    expect(capOverflow(10, 100000)).toBe(0)
    expect(matchRate({ read: 200, keyed: 150 })).toBe(75)
    expect(matchRate({ read: 0, keyed: 0 })).toBeNull()
    expect(matchRate(null)).toBeNull()
  })
})
