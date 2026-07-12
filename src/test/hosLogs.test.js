import { describe, it, expect } from 'vitest'
import {
  driverDaySummary, summariseHos, toFiniteNumber,
  DAILY_DRIVE_LIMIT_MIN, DAILY_DUTY_LIMIT_MIN,
} from '../lib/hosLogs'

describe('hosLogs — constants', () => {
  it('models the FMCSA 11h driving / 14h on-duty limits in minutes', () => {
    expect(DAILY_DRIVE_LIMIT_MIN).toBe(660)
    expect(DAILY_DUTY_LIMIT_MIN).toBe(840)
  })
})

describe('hosLogs — driverDaySummary', () => {
  it('returns [] for empty / non-array input', () => {
    expect(driverDaySummary([])).toEqual([])
    expect(driverDaySummary()).toEqual([])
    expect(driverDaySummary(null)).toEqual([])
  })

  it('accumulates driving and on-duty-window minutes per driver-day', () => {
    const rows = [
      { driver_name: 'J. Rivera', log_date: '2026-07-01', duty_status: 'driving', duration_min: 300 },
      { driver_name: 'J. Rivera', log_date: '2026-07-01', duty_status: 'on_duty', duration_min: 120 },
      { driver_name: 'J. Rivera', log_date: '2026-07-01', duty_status: 'off_duty', duration_min: 600 },
    ]
    const out = driverDaySummary(rows)
    expect(out).toHaveLength(1)
    expect(out[0].driver_name).toBe('J. Rivera')
    expect(out[0].log_date).toBe('2026-07-01')
    expect(out[0].drivingMin).toBe(300)
    // On-duty window = driving (300) + on_duty (120); off_duty excluded.
    expect(out[0].onDutyMin).toBe(420)
    expect(out[0].overHours).toBe(false)
  })

  it('groups separately by driver and by date', () => {
    const rows = [
      { driver_name: 'A', log_date: '2026-07-01', duty_status: 'driving', duration_min: 60 },
      { driver_name: 'A', log_date: '2026-07-02', duty_status: 'driving', duration_min: 90 },
      { driver_name: 'B', log_date: '2026-07-01', duty_status: 'driving', duration_min: 120 },
    ]
    const out = driverDaySummary(rows)
    expect(out).toHaveLength(3)
  })

  it('flags over-hours when driving exceeds the 11h limit', () => {
    const rows = [
      { driver_name: 'A', log_date: '2026-07-01', duty_status: 'driving', duration_min: DAILY_DRIVE_LIMIT_MIN + 1 },
    ]
    expect(driverDaySummary(rows)[0].overHours).toBe(true)
  })

  it('flags over-hours when the on-duty window exceeds the 14h limit even if driving is legal', () => {
    const rows = [
      { driver_name: 'A', log_date: '2026-07-01', duty_status: 'driving', duration_min: 600 },
      { driver_name: 'A', log_date: '2026-07-01', duty_status: 'on_duty', duration_min: 300 },
    ]
    const out = driverDaySummary(rows)
    expect(out[0].drivingMin).toBe(600) // under 660
    expect(out[0].onDutyMin).toBe(900) // over 840
    expect(out[0].overHours).toBe(true)
  })

  it('does not flag exactly at the limit (strict greater-than)', () => {
    const rows = [
      { driver_name: 'A', log_date: '2026-07-01', duty_status: 'driving', duration_min: DAILY_DRIVE_LIMIT_MIN },
    ]
    expect(driverDaySummary(rows)[0].overHours).toBe(false)
  })

  it('ignores rows without a driver name or resolvable date', () => {
    const rows = [
      { driver_name: '', log_date: '2026-07-01', duty_status: 'driving', duration_min: 100 },
      { driver_name: 'A', duty_status: 'driving', duration_min: 100 },
      { driver_name: 'A', log_date: '2026-07-01', duty_status: 'driving', duration_min: 100 },
    ]
    const out = driverDaySummary(rows)
    expect(out).toHaveLength(1)
    expect(out[0].driver_name).toBe('A')
  })

  it('coerces string durations and tolerates non-positive values', () => {
    const rows = [
      { driver_name: 'A', log_date: '2026-07-01', duty_status: 'driving', duration_min: '1,200' },
      { driver_name: 'A', log_date: '2026-07-01', duty_status: 'driving', duration_min: -50 },
    ]
    expect(driverDaySummary(rows)[0].drivingMin).toBe(1200)
  })

  it('falls back to created_at when log_date is absent for grouping', () => {
    const rows = [
      { driver_name: 'A', created_at: '2026-07-01T08:00:00Z', duty_status: 'driving', duration_min: 60 },
    ]
    const out = driverDaySummary(rows)
    expect(out).toHaveLength(1)
    expect(out[0].log_date).toBe('2026-07-01')
  })
})

describe('hosLogs — summariseHos', () => {
  it('returns zeroes for empty / non-array input', () => {
    expect(summariseHos([])).toEqual({
      totalLogs: 0, distinctDrivers: 0, drivingHours: 0, violationsCount: 0, overHoursDays: 0,
    })
    expect(summariseHos()).toEqual({
      totalLogs: 0, distinctDrivers: 0, drivingHours: 0, violationsCount: 0, overHoursDays: 0,
    })
  })

  it('counts logs, distinct drivers, driving hours, violations and over-hours days', () => {
    const rows = [
      { driver_name: 'A', log_date: '2026-07-01', duty_status: 'driving', duration_min: 720, violation: true },
      { driver_name: 'A', log_date: '2026-07-01', duty_status: 'on_duty', duration_min: 60 },
      { driver_name: 'B', log_date: '2026-07-01', duty_status: 'driving', duration_min: 300, violation: false },
    ]
    const s = summariseHos(rows)
    expect(s.totalLogs).toBe(3)
    expect(s.distinctDrivers).toBe(2)
    // Driving minutes = 720 + 300 = 1020 → 17 hours.
    expect(s.drivingHours).toBe(17)
    expect(s.violationsCount).toBe(1)
    // Driver A drove 720 (> 660) on 2026-07-01 → one over-hours day.
    expect(s.overHoursDays).toBe(1)
  })

  it('only counts violation === true (ignores truthy strings/non-boolean)', () => {
    const rows = [
      { driver_name: 'A', log_date: '2026-07-01', duty_status: 'driving', duration_min: 60, violation: 'yes' },
      { driver_name: 'B', log_date: '2026-07-01', duty_status: 'driving', duration_min: 60, violation: true },
    ]
    expect(summariseHos(rows).violationsCount).toBe(1)
  })
})

describe('hosLogs — toFiniteNumber', () => {
  it('parses numbers, numeric strings, and rejects junk', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('1,200')).toBe(1200)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})
