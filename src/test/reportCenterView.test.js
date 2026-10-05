import { describe, it, expect } from 'vitest'
import {
  buildCatalog, categoryCounts, modeFor, lastDelivery, filterCatalog, deliverySuccess, upcomingSchedules, ON_DEMAND,
} from '../lib/reportCenterView'

const TYPES = [{ value: 'kpi', label: 'Tyre KPI / CPK' }, { value: 'fleet', label: 'Fleet Analytics' }]
const LAYOUTS = [{ value: 'builder:1', label: 'Monthly accidents', updated_at: '2026-10-01T08:00:00Z' }]
const NOW = Date.parse('2026-10-05T12:00:00Z')

describe('reportCenterView', () => {
  const catalog = buildCatalog(TYPES, LAYOUTS)

  it('builds the catalogue from real report sources', () => {
    expect(catalog).toHaveLength(ON_DEMAND.length + 3)
    expect(catalog.find((r) => r.id === 'type:kpi')).toMatchObject({ category: 'Tyre Management', reportType: 'kpi' })
    expect(catalog.find((r) => r.kind === 'layout')).toMatchObject({ category: 'Custom reports', reportType: 'builder:1' })
  })

  it('counts categories including empty ones', () => {
    const c = Object.fromEntries(categoryCounts(catalog).map((x) => [x.category, x.count]))
    expect(c['Tyre Management']).toBe(3)
    expect(c['Custom reports']).toBe(1)
    expect(c.Finance).toBe(0)
  })

  it('marks a report Scheduled only for an active schedule', () => {
    const kpi = catalog.find((r) => r.id === 'type:kpi')
    expect(modeFor(kpi, [{ active: false, report_type: 'kpi' }])).toBe('On demand')
    expect(modeFor(kpi, [{ active: true, report_type: 'kpi' }])).toBe('Scheduled')
    expect(modeFor(catalog[0], [{ active: true, report_type: 'kpi' }])).toBe('On demand')
  })

  it('finds the last delivery per report type', () => {
    const kpi = catalog.find((r) => r.id === 'type:kpi')
    const runs = [{ report_type: 'kpi', sent_at: '2026-10-01' }, { report_type: 'kpi', sent_at: '2026-10-03' }, { report_type: 'fleet', sent_at: '2026-10-04' }]
    expect(lastDelivery(kpi, runs).sent_at).toBe('2026-10-03')
    expect(lastDelivery(catalog[0], runs)).toBeNull()
  })

  it('filters the catalogue', () => {
    expect(filterCatalog(catalog, { category: 'Fleet and Assets' }).map((r) => r.id)).toEqual(['type:fleet'])
    expect(filterCatalog(catalog, { format: 'PPTX' }).map((r) => r.id)).toEqual(['pptx'])
    expect(filterCatalog(catalog, { search: 'monthly' }).map((r) => r.id)).toEqual(['layout:builder:1'])
    expect(filterCatalog(catalog, { mode: 'Scheduled' }, [{ active: true, report_type: 'fleet' }]).map((r) => r.id)).toEqual(['type:fleet'])
  })

  it('computes delivery success honestly', () => {
    expect(deliverySuccess([], NOW).pct).toBeNull()
    const r = deliverySuccess([
      { status: 'sent', sent_at: '2026-10-01T00:00:00Z' },
      { status: 'failed', sent_at: '2026-10-02T00:00:00Z' },
      { status: 'pending', sent_at: '2026-10-02T00:00:00Z' },
      { status: 'sent', sent_at: '2026-08-01T00:00:00Z' },
    ], NOW)
    expect(r).toEqual({ sent: 1, failed: 1, pct: 50 })
  })

  it('orders schedules active first then by next run', () => {
    const s = upcomingSchedules([
      { id: 1, active: false, next_run_at: '2026-10-06' },
      { id: 2, active: true, next_run_at: '2026-10-09' },
      { id: 3, active: true, next_run_at: '2026-10-07' },
    ])
    expect(s.map((x) => x.id)).toEqual([3, 2, 1])
  })
})
