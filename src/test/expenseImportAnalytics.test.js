import { describe, it, expect } from 'vitest'
import { classifyPreview, filterPreview, previewTotals, previewExportRows } from '../lib/expenseImportAnalytics'

const rows = [
  { item_description: 'TYRE 315/80 R22.5 BRIDGESTONE', value_amount: 1000, txn_date: '2026-05-01', work_order_no: 'WO1', item_code: '310001' },
  { item_description: 'ENGINE OIL 15W40', value_amount: 200, txn_date: '2026-06-01', work_order_no: 'WO2' },
  { item_description: 'BRAKE PAD', value_amount: 0, txn_date: '2026-07-01', asset_code: 'TM1' },
]

describe('expenseImportAnalytics', () => {
  const c = classifyPreview(rows)
  it('classifies through the shared rule and keeps the source index', () => {
    expect(c.map((s) => s.category)).toEqual(['tyre', 'oil', 'spare'])
    expect(c[2].sourceIndex).toBe(2)
  })
  it('filters by search, category and date window', () => {
    expect(filterPreview(c, { q: 'tm1' })).toHaveLength(1)
    expect(filterPreview(c, { category: 'tyre' })).toHaveLength(1)
    expect(filterPreview(c, { from: '2026-06-01', to: '2026-06-30' }).map((s) => s.r.work_order_no)).toEqual(['WO2'])
  })
  it('totals what is shown and exports it', () => {
    const t = previewTotals(c)
    expect(t).toMatchObject({ rows: 3, total: 1200, tyre: 1000, oil: 200, spare: 0, zeroCost: 1 })
    expect(previewExportRows(c)[0]).toMatchObject({ category: 'Tyres', amount: 1000, work_order_no: 'WO1' })
  })
})
