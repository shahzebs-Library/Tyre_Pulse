import { describe, it, expect } from 'vitest'
import {
  pmAttentionItems, filterExceptions, exceptionSites, exceptionHotspots,
  highSeveritySharePct, exceptionExportRows,
} from '../lib/opsIntelligenceAnalytics'

const ex = [
  { id: 1, severity: 'high', category: 'low_tread', title: 'Low tread', asset_no: 'TM1', site: 'NHC', detail: 'x' },
  { id: 2, severity: 'medium', category: 'aged_tyre', title: 'Aged', asset_no: 'TM1', site: 'NHC', detail: 'y' },
  { id: 3, severity: 'low', category: 'open_work_order', title: 'WO', asset_no: 'TM2', site: 'JED', detail: 'z' },
  { id: 4, severity: 'high', category: 'high_cpk', title: 'CPK', asset_no: null, site: null, detail: 'w' },
]

describe('opsIntelligenceAnalytics', () => {
  it('emits PM items only when plans are due', () => {
    expect(pmAttentionItems(null)).toEqual([])
    expect(pmAttentionItems({ overdue: 0, dueSoon: 0 })).toEqual([])
    const items = pmAttentionItems({ overdue: 1, dueSoon: 3 })
    expect(items.map((i) => i.type)).toEqual(['pm_overdue', 'pm_due_soon'])
    expect(items[0].title).toBe('1 preventive maintenance plan overdue')
  })

  it('filters the exception register', () => {
    expect(filterExceptions(ex, { severity: 'high' })).toHaveLength(2)
    expect(filterExceptions(ex, { site: 'JED' }).map((e) => e.id)).toEqual([3])
    expect(filterExceptions(ex, { q: 'aged' }).map((e) => e.id)).toEqual([2])
    expect(exceptionSites(ex)).toEqual(['JED', 'NHC'])
  })

  it('ranks hotspots and skips rows without the key', () => {
    const sites = exceptionHotspots(ex, 'site')
    expect(sites.map((s) => s.key)).toEqual(['NHC', 'JED'])
    expect(sites[0]).toMatchObject({ total: 2, high: 1, medium: 1, worst: 'high' })
    expect(exceptionHotspots(ex, 'asset_no').map((s) => s.key)).toEqual(['TM1', 'TM2'])
  })

  it('reports a null share with no exceptions', () => {
    expect(highSeveritySharePct({ total: 0, bySeverity: {} })).toBeNull()
    expect(highSeveritySharePct({ total: 4, bySeverity: { high: 2 } })).toBe(50)
  })

  it('exports every row with labels', () => {
    const out = exceptionExportRows(ex)
    expect(out).toHaveLength(4)
    expect(out[3].asset_no).toBe('')
  })
})
