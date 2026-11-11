import { describe, it, expect } from 'vitest'
import {
  resultCounts, resultSummary, reconcile, previewTotals, resultTotals, importReportRows,
} from '../lib/erpIntakeAnalytics'

describe('erpIntakeAnalytics', () => {
  it('counts merge outcomes without inventing rows', () => {
    const r = { sourceRows: 10, inserted: 4, updated: 3, failed: 1, target: 'work_orders' }
    expect(resultCounts(r)).toEqual({
      source: 10, inserted: 4, updated: 3, failed: 1,
      excludedByValidation: 0, heldForReview: 0, notAdded: 2, processed: 9,
    })
    expect(resultSummary(r)).toBe('9 rows processed, 4 new, 3 refreshed, 2 exact duplicate(s) dropped, 1 failed')
    expect(resultSummary({ sourceRows: 2, inserted: 2, target: 'open_work_orders' })).toBe('2 rows processed, 2 new, list replaced')
  })

  it('carves excluded-by-validation and held-for-review out of exact duplicates', () => {
    // 20 rows: 8 new, 2 refreshed, 3 excluded by the cost check, 4 held for the
    // replacement review, 1 failed -> notAdded (exact duplicates) is the residual 2.
    const r = {
      sourceRows: 20, inserted: 8, updated: 2, failed: 1,
      excludedByValidation: 3, heldForReview: 4, target: 'tyre_records',
    }
    const c = resultCounts(r)
    expect(c).toMatchObject({ notAdded: 2, excludedByValidation: 3, heldForReview: 4, processed: 19 })
    // All five buckets + failed appear in the one-line summary.
    expect(resultSummary(r)).toBe(
      '19 rows processed, 8 new, 2 refreshed, 2 exact duplicate(s) dropped, 3 excluded by validation, 4 held for review, 1 failed',
    )
    // notAdded can never go negative when the carve-outs exceed the residual.
    expect(resultCounts({ sourceRows: 5, inserted: 2, excludedByValidation: 2, heldForReview: 2 }).notAdded).toBe(0)
  })

  it('reads heldForReview from the replacement summary when not set explicitly', () => {
    const c = resultCounts({ sourceRows: 6, inserted: 4, replacement: { review: 2 } })
    expect(c.heldForReview).toBe(2)
    expect(c.notAdded).toBe(0)
  })

  it('reconciles every row below the header', () => {
    const d = [
      { accounting: { read: 12, mapped: 9, noKey: 1, footer: 1, blank: 1, unparsedDates: 2 } },
      { accounting: { read: 3, mapped: 3 } },
    ]
    expect(reconcile(d)).toEqual({ read: 15, mapped: 12, noKey: 1, footer: 1, blank: 1, unparsedDates: 2 })
  })

  it('reports fresh/existing only when every sheet was checked', () => {
    const known = previewTotals([{ rows: [1, 2], dropped: 1, dup: { keyed: true, fresh: 1, existing: 1 } }])
    expect(known).toMatchObject({ reports: 1, rows: 2, dropped: 1, fresh: 1, existing: 1 })
    const unknown = previewTotals([{ rows: [1], dup: null }])
    expect(unknown.fresh).toBeNull()
    expect(unknown.existing).toBeNull()
  })

  it('totals results and builds the import report', () => {
    const results = [
      { label: 'Grid', sheetName: 'S1', targetLabel: 'Parts', target: 'parts_consumption', sourceRows: 5, inserted: 5 },
      { label: 'Open', sheetName: 'S2', targetLabel: 'Open WO', target: 'open_work_orders', sourceRows: 2, inserted: 2, tyresSourceRows: 0 },
    ]
    expect(resultTotals(results)).toMatchObject({ processed: 7, inserted: 7, failed: 0, excludedByValidation: 0, heldForReview: 0 })
    const rows = importReportRows(results, 'KSA')
    expect(rows[0]).toMatchObject({ report: 'Grid', country: 'KSA', duplicates: 0, excluded: 0, heldForReview: 0, tyres: 'N/A' })
    // The snapshot target reads N/A for every per-row merge bucket.
    expect(rows[1]).toMatchObject({ updated: 'List replaced', duplicates: 'N/A', excluded: 'N/A', heldForReview: 'N/A' })
  })
})
