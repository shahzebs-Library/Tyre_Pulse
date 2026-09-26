import { describe, it, expect } from 'vitest'
import { batchFeedSummary, historyKpis, feedFreshness, freshnessBand, rejectSummary, filterBatches, batchExportRows, moduleLabel } from '../lib/erpSyncAnalytics'

const batches = [
  { id: 1, module: 'tyre', total_rows: 10, imported_rows: 10, error_rows: 0, created_at: '2026-09-20T00:00:00Z' },
  { id: 2, module: 'tyre', total_rows: 5, imported_rows: 0, import_status: 'staged', approval_status: 'draft', created_at: '2026-09-25T00:00:00Z' },
  { id: 3, module: 'fleet', total_rows: 4, imported_rows: 0, error_rows: 4, import_status: 'committed', created_at: '2026-09-21T00:00:00Z' },
]
describe('erpSyncAnalytics', () => {
  it('summarises per feed', () => {
    const f = batchFeedSummary(batches)
    expect(f[0].module).toBe('tyre')
    expect(f[0]).toMatchObject({ batches: 2, rows: 15, imported: 10, done: 1, unfinished: 1, lastAt: '2026-09-25T00:00:00Z' })
    expect(moduleLabel('workorder')).toBe('Work orders')
  })
  it('computes freshness bands from coverage', () => {
    const fr = feedFreshness({ countries: [{ country: 'KSA', sources: [
      { src: 'a', label: 'Job cards', days_since_last: 12, expect_daily: true, missing_count: 5, last_data_date: '2026-09-14' },
      { src: 'b', label: 'Expenses', days_since_last: 1 },
      { src: 'c', label: 'Tyres' },
    ] }] })
    expect(fr.map(f => f.band)).toEqual(['silent', 'never', 'fresh'])
    expect(fr[0].missingDays).toBe(5)
    expect(fr[1].missingDays).toBeNull()
    expect(freshnessBand(5)).toBe('stale')
    const k = historyKpis(batches, [{}], fr)
    expect(k).toMatchObject({ batches: 3, imported: 10, unfinished: 1, nothing: 1, rejects: 1, staleFeeds: 1 })
  })
  it('groups rejects without money totals', () => {
    const r = rejectSummary([{ uploaded_country: 'KSA', detected_country: 'UAE' }, { uploaded_country: 'KSA', detected_country: 'UAE', reject_reason: 'x' }])
    expect(r.byPair[0]).toEqual({ label: 'KSA upload, belongs to UAE', count: 2 })
    expect(r.byReason).toHaveLength(2)
    expect(r).not.toHaveProperty('value')
  })
  it('filters and exports batches', () => {
    expect(filterBatches(batches, { outcome: 'nothing' }).map(b => b.id)).toEqual([3])
    expect(filterBatches(batches, { module: 'fleet' })).toHaveLength(1)
    expect(batchExportRows(batches)[1].outcome).toBe('unfinished')
  })
})
