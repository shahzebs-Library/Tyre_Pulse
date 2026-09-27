import { describe, it, expect } from 'vitest'
import {
  filterHosLogs, dutyMix, driverScorecard, complianceRows, hosKpis,
  fmtHoursMinutes, windowStartMs,
} from '../lib/hoursOfServiceAnalytics'

const NOW = Date.parse('2026-09-27T12:00:00Z')
const rows = [
  { id: 1, driver_name: 'A', log_date: '2026-09-26', duty_status: 'driving', duration_min: 700, violation: true, violation_type: '11-hour' },
  { id: 2, driver_name: 'A', log_date: '2026-09-26', duty_status: 'on_duty', duration_min: 60 },
  { id: 3, driver_name: 'B', log_date: '2026-09-25', duty_status: 'driving', duration_min: 300, location: 'Riyadh' },
  { id: 4, driver_name: 'B', log_date: '2026-06-01', duty_status: 'off_duty', duration_min: 600 },
  { id: 5, driver_name: 'C', log_date: null, duty_status: 'sleeper', duration_min: null },
]

describe('hoursOfServiceAnalytics', () => {
  it('filters by window, driver, duty, violation and search', () => {
    expect(filterHosLogs(rows, { window: '7', now: NOW }).map((r) => r.id)).toEqual([1, 2, 3])
    expect(filterHosLogs(rows, { window: 'all', now: NOW })).toHaveLength(5)
    expect(filterHosLogs(rows, { driver: 'B' }).map((r) => r.id)).toEqual([3, 4])
    expect(filterHosLogs(rows, { duty: 'driving' })).toHaveLength(2)
    expect(filterHosLogs(rows, { violationsOnly: true }).map((r) => r.id)).toEqual([1])
    expect(filterHosLogs(rows, { search: 'riyadh' }).map((r) => r.id)).toEqual([3])
    expect(windowStartMs('all', NOW)).toBeNull()
  })

  it('duty mix shares add to one and are null with no minutes', () => {
    const mix = dutyMix(rows)
    const total = mix.reduce((a, m) => a + (m.share || 0), 0)
    expect(total).toBeCloseTo(1, 6)
    expect(mix.find((m) => m.status === 'driving').minutes).toBe(1000)
    expect(dutyMix([]).every((m) => m.share === null)).toBe(true)
  })

  it('scorecard ranks breaching drivers first with honest rates', () => {
    const sc = driverScorecard(rows)
    expect(sc[0].driver_name).toBe('A')
    expect(sc[0].breachDays).toBe(1)
    expect(sc[0].complianceRate).toBe(0)
    expect(sc[0].violations).toBe(1)
    const b = sc.find((d) => d.driver_name === 'B')
    expect(b.complianceRate).toBe(100)
    // C has no dated driver-day, so it never reaches the scorecard.
    expect(sc.find((d) => d.driver_name === 'C')).toBeUndefined()
  })

  it('compliance rows expose negative headroom on a breach', () => {
    const cr = complianceRows(rows)
    expect(cr[0].overHours).toBe(true)
    expect(cr[0].driveHeadroomMin).toBe(660 - 700)
  })

  it('kpis are null when nothing is measurable', () => {
    const k = hosKpis([])
    expect(k.complianceRate).toBeNull()
    expect(k.durationCoverage).toBeNull()
    const full = hosKpis(rows)
    expect(full.breachDays).toBe(1)
    expect(full.durationCoverage).toBe(80)
  })

  it('formats hours and minutes', () => {
    expect(fmtHoursMinutes(125)).toBe('2h 05m')
    expect(fmtHoursMinutes(-40)).toBe('-0h 40m')
    expect(fmtHoursMinutes(null)).toBe('N/A')
  })
})
