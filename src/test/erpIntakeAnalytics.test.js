import { describe, it, expect } from 'vitest'
import {
  resultCounts, resultSummary, reconcile, previewTotals, resultTotals, importReportRows,
} from '../lib/erpIntakeAnalytics'

describe('erpIntakeAnalytics', () => {
  it('counts merge outcomes without inventing rows', () => {
    const r = { sourceRows: 10, inserted: 4, updated: 3, failed: 1, target: 'work_orders' }
    expect(resultCounts(r)).toEqual({ source: 10, inserted: 4, updated: 3, failed: 1, notAdded: 2, processed: 9 })
    expect(resultSummary(r)).toBe('9 rows processed, 4 new, 3 refreshed, 2 exact duplicate(s) dropped, 1 failed')
    expect(resultSummary({ sourceRows: 2, inserted: 2, target: 'open_work_orders' })).toBe('2 rows processed, 2 new, list replaced')
  })

  it('reconciles every row below the header', () => {
    const d = [
      { accounting: { read: 12, mapped: 9, noKey: 1, footer: 1, blank: 1 } },
      { accounting: { read: 3, mapped: 3 } },
    ]
    expect(reconcile(d)).toEqual({ read: 15, mapped: 12, noKey: 1, footer: 1, blank: 1 })
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
    expect(resultTotals(results)).toMatchObject({ processed: 7, inserted: 7, failed: 0 })
    const rows = importReportRows(results, 'KSA')
    expect(rows[0]).toMatchObject({ report: 'Grid', country: 'KSA', duplicates: 0, tyres: 'N/A' })
    expect(rows[1]).toMatchObject({ updated: 'List replaced', duplicates: 'N/A' })
  })
})
