import { describe, it, expect } from 'vitest'
import {
  resultNumber, rowsHandled, fileSummary, qualityVerdict, summarizeQuality, filterQuality,
  rawPreviewRows, columnLetter, dupReviewRows, skipLogRows,
} from '../lib/uploadDataAnalytics'

describe('result counters', () => {
  it('rowsHandled mirrors the page contract', () => {
    expect(rowsHandled(null)).toBe(0)
    expect(rowsHandled({ pending: true, submitted: 7 })).toBe(7)
    expect(rowsHandled({ added: 5, skipped: 2, dupesSkipped: 3 })).toBe(10)
    expect(resultNumber(undefined)).toBe(0)
    expect(resultNumber('x')).toBe(0)
  })
})

describe('fileSummary', () => {
  const fields = [{ key: 'serial_no', required: true }, { key: 'asset_no', required: true }, { key: 'brand' }]
  it('counts mapping completeness and unmapped columns', () => {
    const s = fileSummary({ headers: ['Serial', 'Asset', 'Extra'], rows: [1, 2, 3], mapping: { serial_no: 'Serial' }, fields, skipCount: 1 })
    expect(s).toEqual({ rows: 3, columns: 3, mappedFields: 1, totalFields: 3, requiredMapped: 1, requiredTotal: 2, complete: false, unmapped: 2, toUpload: 2 })
  })
  it('is complete when every required field is mapped', () => {
    expect(fileSummary({ headers: ['a', 'b'], rows: [], mapping: { serial_no: 'a', asset_no: 'b' }, fields }).complete).toBe(true)
  })
})

describe('quality', () => {
  const q = [
    { key: 'a', label: 'Serial', required: true, fillPct: 100, invalid: 0, dupes: 0 },
    { key: 'b', label: 'Asset', required: true, fillPct: 40, invalid: 0, dupes: 0 },
    { key: 'c', label: 'Date', required: false, fillPct: 95, invalid: 2, dupes: 0 },
  ]
  it('grades fields', () => {
    expect(q.map(qualityVerdict)).toEqual(['good', 'poor', 'partial'])
  })
  it('summarises', () => {
    expect(summarizeQuality(q)).toEqual({ fields: 3, issues: 2, invalid: 2, dupes: 0, lowRequired: 1, avgFill: 78 })
    expect(summarizeQuality([]).avgFill).toBeNull()
  })
  it('filters by search and issues', () => {
    expect(filterQuality(q, { onlyIssues: true }).map((x) => x.key)).toEqual(['b', 'c'])
    expect(filterQuality(q, { search: 'ser' }).map((x) => x.key)).toEqual(['a'])
  })
})

describe('raw preview', () => {
  it('marks header / above / data rows and pads columns', () => {
    const { rows, width } = rawPreviewRows([['Title'], ['Serial', 'Asset'], ['S1', null]], 1)
    expect(width).toBe(2)
    expect(rows.map((r) => r._role)).toEqual(['above', 'header', 'data'])
    expect(rows[2]).toMatchObject({ _row: 3, c0: 'S1', c1: '' })
  })
  it('letters columns like a spreadsheet', () => {
    expect([0, 25, 26].map(columnLetter)).toEqual(['A', 'Z', 'AA'])
  })
})

describe('dup review + skip log', () => {
  it('flattens matches with their outcome', () => {
    const rows = dupReviewRows({
      exact: [{ idx: 0, row: { serial_no: 'S1', asset_no: 'A1', issue_date: '2026-01-01' }, existing: { asset_no: 'A1', issue_date: '2026-01-01' } }],
      changed: [{ idx: 4, row: { serial_no: 'S2' }, existing: {} }],
      conflicts: [],
    }, new Set([0]))
    expect(rows.map((r) => [r.fileRow, r.kind, r.action])).toEqual([[1, 'exact', 'drop'], [5, 'changed', 'import']])
    expect(dupReviewRows(null)).toEqual([])
  })
  it('normalises the skip log', () => {
    expect(skipLogRows([{ row: 3, serial_no: 'S', error: 'bad' }, {}])).toEqual([
      { id: 0, row: 3, serial: 'S', reason: 'bad' },
      { id: 1, row: null, serial: '', reason: 'Not recorded' },
    ])
  })
})
