import { describe, it, expect } from 'vitest'
import {
  num, secondsToHours, mean, sum, bandOf, idlePct, filterUtilization,
  summarizeUtilization, bandDistribution, byCountry, topBy,
} from '../lib/fleetUtilization'

const rows = [
  { id: 1, asset_no: 'TM461', country: 'KSA', make: 'Sany', model: 'Mixer', utilization_pct: 95.5, distance_km: 282.5, idle_pct: 7.4, working_seconds: 82480, idle_seconds: 6129, max_speed: 77, odo_end: 29261, current_km: 29261, linked_to_fleet: true },
  { id: 2, asset_no: 'MP107', country: 'KSA', utilization_pct: 99.9, distance_km: 112.6, idle_pct: 76.4, working_seconds: 86279, idle_seconds: 65897, max_speed: 83, odo_end: 72359, current_km: 72359, linked_to_fleet: true },
  { id: 3, asset_no: 'MP084', country: 'KSA', utilization_pct: 0, distance_km: 0, idle_pct: 0, working_seconds: 0, idle_seconds: 0, max_speed: 0, odo_end: null, current_km: null, linked_to_fleet: true },
  { id: 4, asset_no: 'WL049', country: 'UAE', utilization_pct: null, distance_km: 4755, idle_pct: null, working_seconds: null, max_speed: 60, odo_end: 4755, current_km: 4755, linked_to_fleet: false },
]

describe('fleetUtilization primitives', () => {
  it('num coerces honestly', () => {
    expect(num('')).toBeNull()
    expect(num(null)).toBeNull()
    expect(num('x')).toBeNull()
    expect(num('12.5')).toBe(12.5)
    expect(num(0)).toBe(0)
  })
  it('secondsToHours rounds to 1dp, null-safe', () => {
    expect(secondsToHours(3600)).toBe(1)
    expect(secondsToHours(5400)).toBe(1.5)
    expect(secondsToHours(null)).toBeNull()
  })
  it('mean ignores non-numbers and returns null when none measurable', () => {
    expect(mean([1, 2, 3])).toBe(2)
    expect(mean([null, '', 'x'])).toBeNull()
    expect(mean([])).toBeNull()
  })
  it('sum treats a total of nothing as 0', () => {
    expect(sum([null, '', 'x'])).toBe(0)
    expect(sum([1, 2, '3'])).toBe(6)
  })
})

describe('bands + idle', () => {
  it('bandOf classifies by utilization %', () => {
    expect(bandOf({ utilization_pct: 95 })).toBe('High')
    expect(bandOf({ utilization_pct: 50 })).toBe('Medium')
    expect(bandOf({ utilization_pct: 10 })).toBe('Low')
    expect(bandOf({ utilization_pct: null })).toBe('Unknown')
  })
  it('idlePct prefers reported, derives from seconds otherwise', () => {
    expect(idlePct({ idle_pct: 12.3 })).toBe(12.3)
    expect(idlePct({ idle_seconds: 3600, working_seconds: 7200 })).toBe(50)
    expect(idlePct({})).toBeNull()
  })
})

describe('filterUtilization', () => {
  it('filters by country, band, linked, idle and search', () => {
    expect(filterUtilization(rows, { country: 'UAE' })).toHaveLength(1)
    expect(filterUtilization(rows, { band: 'High' }).map((r) => r.id)).toEqual([1, 2])
    expect(filterUtilization(rows, { linkedOnly: true })).toHaveLength(3)
    expect(filterUtilization(rows, { minIdle: 50 }).map((r) => r.id)).toEqual([2])
    expect(filterUtilization(rows, { search: 'mixer' }).map((r) => r.id)).toEqual([1])
    expect(filterUtilization(rows, { country: 'All' })).toHaveLength(4)
  })
})

describe('summaries', () => {
  it('summarizeUtilization reports honest nulls and counts', () => {
    const s = summarizeUtilization(rows)
    expect(s.assets).toBe(4)
    expect(s.linked).toBe(3)
    expect(s.unlinked).toBe(1)
    // avg utilization over the 3 rows that HAVE a value (95.5, 99.9, 0)
    expect(Math.round(s.avgUtilization * 10) / 10).toBe(65.1)
    expect(s.totalDistanceKm).toBe(282.5 + 112.6 + 0 + 4755)
    expect(s.withCurrentKm).toBe(3)
    expect(s.highIdle).toBe(1)
  })
  it('avgUtilization is null when nothing measurable', () => {
    expect(summarizeUtilization([{ utilization_pct: null }]).avgUtilization).toBeNull()
  })
  it('bandDistribution covers every band', () => {
    const d = bandDistribution(rows)
    expect(d.find((b) => b.band === 'High').count).toBe(2)
    expect(d.find((b) => b.band === 'Unknown').count).toBe(1)
  })
  it('byCountry rolls up and sorts by asset count', () => {
    const c = byCountry(rows)
    expect(c[0].country).toBe('KSA')
    expect(c[0].assets).toBe(3)
    expect(c.find((x) => x.country === 'UAE').distance).toBe(4755)
  })
  it('topBy idleHours ranks descending and drops unmeasurable', () => {
    const t = topBy(rows, 'idleHours', 5)
    expect(t[0].id).toBe(2) // most idle seconds
    expect(t.every((r) => r._v != null)).toBe(true)
  })
})
