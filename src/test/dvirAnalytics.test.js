import { describe, it, expect } from 'vitest'
import { analyzeDvir, filterDvir, distinctValues } from '../lib/dvirAnalytics'

const NOW = new Date('2026-09-27T12:00:00Z')
const rows = [
  { id: 1, asset_no: 'TM1', driver_name: 'Ali', inspection_type: 'pre_trip', inspection_date: '2026-09-20', defects_found: true, safe_to_operate: false, status: 'open', site: 'NHC' },
  { id: 2, asset_no: 'TM1', inspection_type: 'post_trip', inspection_date: '2026-08-02', defects_found: true, safe_to_operate: true, status: 'resolved', site: 'NHC' },
  { id: 3, asset_no: 'TM2', inspection_type: 'pre_trip', inspection_date: '2026-09-25', defects_found: false, safe_to_operate: true, status: 'open', site: 'JED' },
]

describe('dvirAnalytics', () => {
  it('summarises defects, open age and repeat assets', () => {
    const { kpis, trend, repeatAssets } = analyzeDvir(rows, { now: NOW })
    expect(kpis.total).toBe(3)
    expect(kpis.withDefects).toBe(2)
    expect(kpis.defectRate).toBeCloseTo(66.7, 1)
    expect(kpis.unsafe).toBe(1)
    expect(kpis.openUnsafe).toBe(1)
    expect(kpis.oldestOpenDays).toBe(7)
    expect(kpis.distinctAssets).toBe(2)
    expect(repeatAssets).toEqual([{ asset_no: 'TM1', defects: 2 }])
    expect(trend).toHaveLength(12)
    expect(trend[11]).toMatchObject({ key: '2026-09', total: 2, defects: 1 })
  })

  it('is honest when empty', () => {
    const { kpis } = analyzeDvir([], { now: NOW })
    expect(kpis.defectRate).toBeNull()
    expect(kpis.oldestOpenDays).toBeNull()
  })

  it('filters by every control', () => {
    expect(filterDvir(rows, { defects: 'yes' }).map((r) => r.id)).toEqual([1, 2])
    expect(filterDvir(rows, { safe: 'no' }).map((r) => r.id)).toEqual([1])
    expect(filterDvir(rows, { site: 'JED' }).map((r) => r.id)).toEqual([3])
    expect(filterDvir(rows, { from: '2026-09-01', to: '2026-09-22' }).map((r) => r.id)).toEqual([1])
    expect(filterDvir(rows, { search: 'ali', status: 'all' }).map((r) => r.id)).toEqual([1])
    expect(distinctValues(rows, 'site')).toEqual(['JED', 'NHC'])
  })
})
