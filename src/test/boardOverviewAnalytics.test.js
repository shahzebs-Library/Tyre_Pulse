import { describe, it, expect } from 'vitest'
import {
  SECTION_DEFAULTS, SECTION_KEYS, mergeSections, visibleSectionCount, inDateRange,
  applyBoardDateRange, cpkTypeRows, tileExportRows,
} from '../lib/boardOverviewAnalytics'

describe('boardOverviewAnalytics', () => {
  it('keeps every section on by default and merges only valid persisted toggles', () => {
    expect(SECTION_KEYS.every((k) => SECTION_DEFAULTS[k] === true)).toBe(true)
    expect(mergeSections(null)).toEqual(SECTION_DEFAULTS)
    const m = mergeSections({ trends: false, bogus: false, kpis: 'no' })
    expect(m.trends).toBe(false)
    expect(m.kpis).toBe(true)
    expect(m).not.toHaveProperty('bogus')
    expect(visibleSectionCount(m)).toBe(SECTION_KEYS.length - 1)
  })

  it('tests dates by string prefix and excludes undated rows only when a range is active', () => {
    expect(inDateRange('2026-06-15T10:00:00Z', '2026-06-01', '2026-06-30')).toBe(true)
    expect(inDateRange('2026-07-01', '2026-06-01', '2026-06-30')).toBe(false)
    expect(inDateRange('', '', '')).toBe(true)
    expect(inDateRange(null, '2026-06-01', '')).toBe(false)
  })

  it('passes rows through untouched without a range and filters each table by its own date', () => {
    const raw = {
      tyres: [{ issue_date: '2026-05-01' }, { issue_date: '2026-06-10' }],
      accidents: [{ incident_date: '2026-06-02' }],
      inspections: [{ scheduled_date: '2026-06-05' }, { completed_date: '2026-04-01', scheduled_date: '2026-06-05' }],
      workOrders: [{ created_at: '2026-06-09T00:00:00Z' }, { completed_at: '2026-01-01', created_at: '2026-06-01' }],
    }
    const none = applyBoardDateRange(raw, '', '')
    expect(none.active).toBe(false)
    expect(none.tyres).toBe(raw.tyres)
    const june = applyBoardDateRange(raw, '2026-06-01', '2026-06-30')
    expect(june.tyres).toHaveLength(1)
    expect(june.accidents).toHaveLength(1)
    expect(june.inspections).toHaveLength(1) // completed_date wins over scheduled_date
    expect(june.workOrders).toHaveLength(1) // completed_at wins over created_at
    expect(applyBoardDateRange(null, '', '')).toBeNull()
  })

  it('shapes CPK type rows without inventing a CPK or a distance', () => {
    const rows = cpkTypeRows([
      { vehicle_type: 'TR-MIXER', country: 'KSA', currency: 'SAR', unit: 'km', distance_or_hours: 1200, cpk_total: 0.42 },
      { vehicle_type: null, country: 'UAE', unit: 'engine_hours', distance_or_hours: null, cpk_total: null },
    ])
    expect(rows[0]).toMatchObject({ vehicle_type: 'TR-MIXER', currency: 'SAR', distance: 1200, cpk: 0.42, rank: 1 })
    expect(rows[1]).toMatchObject({ vehicle_type: 'Unspecified', currency: 'UAE', distance: null, cpk: null, rank: 2 })
    expect(new Set(rows.map((r) => r.id)).size).toBe(2)
  })

  it('turns headline tiles into export rows with N/A for blanks', () => {
    expect(tileExportRows([['Fleet vehicles', '9'], ['Fleet avg CPK', null]], 'KSA')).toEqual([
      { metric: 'Fleet vehicles', value: '9', scope: 'KSA' },
      { metric: 'Fleet avg CPK', value: 'N/A', scope: 'KSA' },
    ])
  })
})
