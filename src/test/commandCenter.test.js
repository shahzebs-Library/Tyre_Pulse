import { describe, it, expect } from 'vitest'
import {
  greeting, timeAgo, growthPct, fleetStats, tyreHealth, actionBuckets,
  workStatus, utilizationByMonth, monthLabel, changePct, compact,
} from '../lib/commandCenter'

const NOW = new Date('2026-09-28T10:00:00Z').getTime()

describe('commandCenter engine', () => {
  it('greets by hour', () => {
    expect(greeting(new Date(2026, 0, 1, 8))).toBe('Good morning')
    expect(greeting(new Date(2026, 0, 1, 14))).toBe('Good afternoon')
    expect(greeting(new Date(2026, 0, 1, 20))).toBe('Good evening')
  })

  it('formats relative time and rejects bad input', () => {
    expect(timeAgo(NOW - 5 * 60000, NOW)).toBe('5m ago')
    expect(timeAgo(NOW - 3 * 3600000, NOW)).toBe('3h ago')
    expect(timeAgo('nonsense', NOW)).toBeNull()
  })

  it('returns null growth when nothing existed 30 days ago', () => {
    expect(growthPct([{ created_at: new Date(NOW).toISOString() }], NOW)).toBeNull()
    const rows = [
      { created_at: '2026-01-01' }, { created_at: '2026-01-02' }, { created_at: new Date(NOW).toISOString() },
    ]
    expect(growthPct(rows, NOW)).toBe(50)
  })

  it('computes fleet totals, gaps and country split', () => {
    const s = fleetStats([
      { status: 'Active', make: 'A', model: 'B', site: 'X', country: 'KSA', vehicle_type: 'T', expected_km_per_tyre: 90000 },
      { status: 'Inactive', make: null, model: 'B', site: 'Y', country: 'UAE' },
    ], NOW)
    expect(s.total).toBe(2)
    expect(s.active).toBe(1)
    expect(s.missingSpecs).toBe(1)
    expect(s.noPolicy).toBe(1)
    expect(s.sites).toBe(2)
    expect(s.countries).toBe(2)
    expect(s.completenessPct).toBe(50)
  })

  it('reports null completeness for an empty fleet', () => {
    expect(fleetStats([], NOW).completenessPct).toBeNull()
  })

  it('leaves unmeasured tyres out of the health percentages', () => {
    const h = tyreHealth([
      { life_used_pct: 20, remaining_km: 70000 },
      { life_used_pct: null, remaining_km: null },
    ])
    expect(h.measured + h.unmeasured).toBe(2)
    expect(h.unmeasured).toBeGreaterThanOrEqual(1)
    expect(tyreHealth([]).goodPct).toBeNull()
  })

  it('buckets open action items and drops closed ones', () => {
    const b = actionBuckets([
      { status: 'Open', severity: 'Critical' },
      { status: 'Open', category: 'Maintenance' },
      { status: 'Open', category: 'Data' },
      { status: 'Closed', severity: 'Critical' },
    ])
    expect(b.all).toHaveLength(3)
    expect(b.critical).toHaveLength(1)
    expect(b.maintenance).toHaveLength(1)
    expect(b.info).toHaveLength(1)
  })

  it('maps work order status to pills', () => {
    expect(workStatus('Completed').label).toBe('Completed')
    expect(workStatus('Waiting for Parts').label).toBe('Waiting')
    expect(workStatus('In Progress').label).toBe('In Progress')
    expect(workStatus('New').label).toBe('Open')
  })

  it('averages utilisation per month and overall', () => {
    const u = utilizationByMonth([
      { utilization_pct: 80, captured_at: '2026-08-01' },
      { utilization_pct: 60, captured_at: '2026-08-15' },
      { utilization_pct: 90, captured_at: '2026-09-01' },
      { utilization_pct: null, captured_at: '2026-09-02' },
    ])
    expect(u.series).toEqual([{ month: '2026-08', value: 70 }, { month: '2026-09', value: 90 }])
    expect(u.average).toBeCloseTo(76.7, 1)
    expect(utilizationByMonth([]).average).toBeNull()
  })

  it('formats months, change and compact money honestly', () => {
    expect(monthLabel('2026-03')).toBe('Mar')
    expect(changePct(110, 100)).toBe(10)
    expect(changePct(110, 0)).toBeNull()
    expect(changePct(null, 100)).toBeNull()
    expect(compact(482310)).toBe('482.3K')
    expect(compact(null)).toBe('N/A')
  })
})
