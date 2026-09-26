import { describe, it, expect } from 'vitest'
import {
  comparableValue, isExactLiveMatch, mappingRows, mappingSummary, confidenceBand,
  dupLabel, issuesText, attachmentSummary, matchedByLabel, fileSizeLabel,
  recentImportsKpis, recentImportRows,
} from '../lib/dataIntakeCenterAnalytics'

const FIELDS = {
  tyre: [
    { key: 'serial_no', type: 'text' },
    { key: 'cost_per_tyre', type: 'currency' },
    { key: 'issue_date', type: 'date' },
  ],
}

describe('live copy comparison (moved verbatim from the page)', () => {
  it('normalises by type', () => {
    expect(comparableValue(' ABC ', 'text')).toBe('abc')
    expect(comparableValue('1,200.50', 'currency')).toBe('1200.5')
    expect(comparableValue('2025-03-01T10:00:00Z', 'date')).toBe('2025-03-01')
    expect(comparableValue(null, 'text')).toBe('')
  })
  it('matches only when every SUPPLIED field agrees', () => {
    const live = { serial_no: 'abc', cost_per_tyre: 1200.5, issue_date: '2025-03-01' }
    expect(isExactLiveMatch({ serial_no: 'ABC', cost_per_tyre: '1,200.50' }, live, 'tyre', FIELDS)).toBe(true)
    expect(isExactLiveMatch({ serial_no: 'ABC', cost_per_tyre: '999' }, live, 'tyre', FIELDS)).toBe(false)
    // an explicitly blank cell IS evidence
    expect(isExactLiveMatch({ serial_no: 'ABC', cost_per_tyre: '' }, live, 'tyre', FIELDS)).toBe(false)
    expect(isExactLiveMatch(null, live, 'tyre', FIELDS)).toBe(false)
  })
})

describe('mapping step', () => {
  const mapping = [
    { sourceHeader: 'Serial', target: 'serial_no', confidence: 95 },
    { sourceHeader: 'Cost', target: 'cost_per_tyre', confidence: 40 },
    { sourceHeader: 'Notes', target: null },
  ]
  const opts = [
    { key: 'serial_no', label: 'Serial', required: true },
    { key: 'asset_no', label: 'Asset', required: true },
    { key: 'cost_per_tyre', label: 'Cost' },
  ]
  it('attaches the first non-blank sample per column', () => {
    const rows = mappingRows(mapping, [{ Serial: '', Cost: 5 }, { Serial: 'S1' }])
    expect(rows[0]).toMatchObject({ id: 'Serial', sample: 'S1' })
    expect(rows[1].sample).toBe('5')
    expect(rows[2].sample).toBe('')
  })
  it('summarises coverage and names missing required fields', () => {
    const s = mappingSummary(mapping, opts)
    expect(s).toMatchObject({ columns: 3, mapped: 2, custom: 1, lowConfidence: 1, requiredTotal: 2 })
    expect(s.missingRequired).toEqual(['Asset'])
  })
  it('labels confidence with words, not colour alone', () => {
    expect(confidenceBand(mapping[0]).label).toBe('95% high')
    expect(confidenceBand(mapping[1]).tone).toBe('danger')
    expect(confidenceBand(mapping[2]).label).toBe('Custom')
  })
})

describe('validate step', () => {
  it('describes duplicates and issues in plain language', () => {
    expect(dupLabel({ liveDuplicate: true })).toBe('Exact live copy')
    expect(dupLabel({ dupStatus: 'conflict' })).toBe('Key conflict')
    expect(dupLabel({})).toBe('None')
    expect(issuesText({ issues: [{ message: 'a' }, { message: 'b' }] })).toBe('a; b')
    expect(issuesText({ issues: [] })).toBe('None')
  })
})

describe('evidence package', () => {
  it('counts uploaded / matched / failed', () => {
    expect(attachmentSummary([
      { status: 'uploaded', matchedBy: 'claim_no' }, { status: 'failed' }, { status: 'pending', matchedBy: 'asset_no' },
    ])).toEqual({ total: 3, uploaded: 1, matched: 2, failed: 1 })
    expect(matchedByLabel('police_report_no')).toBe('Police report')
    expect(matchedByLabel(null)).toBe('Unmatched')
  })
  it('sizes files honestly', () => {
    expect(fileSizeLabel(null)).toBe('N/A')
    expect(fileSizeLabel(2048)).toBe('2 KB')
    expect(fileSizeLabel(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})

describe('recent imports strip', () => {
  const batches = [
    { id: 1, module: 'tyre', import_status: 'committed', approval_status: 'approved', total_rows: 10, imported_rows: 8, created_at: '2026-09-20T10:00:00Z' },
    { id: 2, module: 'fleet', import_status: 'staged', approval_status: 'draft', total_rows: 5, imported_rows: 0, created_at: '2026-09-01T10:00:00Z' },
    { id: 3, module: 'tyre', import_status: 'committed', approval_status: 'approved', total_rows: 4, imported_rows: 0, created_at: '2026-09-21T10:00:00Z' },
  ]
  it('reuses the history outcome and never fabricates totals', () => {
    const k = recentImportsKpis(batches, [{ orphan: true }, { orphan: false }], { now: '2026-09-26T00:00:00Z' })
    expect(k).toMatchObject({ batches: 3, imported: 1, unfinished: 1, nothing: 1, rowsImported: 8, rowsRead: 19, orphanFiles: 1 })
    expect(k.lastImportAt).toBe('2026-09-21T10:00:00.000Z')
    expect(k.staleUnfinished).toBe(1)
  })
  it('is null-safe on an empty window', () => {
    const k = recentImportsKpis([], [])
    expect(k.batches).toBe(0)
    expect(k.rowsImported).toBeNull()
    expect(k.importRate).toBeNull()
    expect(k.lastImportAt).toBeNull()
  })
  it('labels each batch outcome', () => {
    const rows = recentImportRows(batches)
    expect(rows.map((r) => r.outcomeLabel)).toEqual(['Imported', 'Never approved', 'Nothing imported'])
  })
})
