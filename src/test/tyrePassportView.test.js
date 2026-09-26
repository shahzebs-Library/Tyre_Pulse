import { describe, it, expect } from 'vitest'
import { passportKpiValues, journeyWithDays, journeySummary } from '../lib/tyrePassport'

describe('tyrePassport view helpers', () => {
  it('passportKpiValues returns null for unmeasured figures, never 0', () => {
    expect(passportKpiValues(null)).toBeNull()
    const k = passportKpiValues({ totals: { km: 0, cpk: null }, costBreakdown: { lifetime: null }, distinctVehicles: 0, retreadCount: 1, recordCount: 3 })
    expect(k).toEqual({ lifetimeKm: null, lifetimeCost: null, cpk: null, vehicles: null, retreads: 1, records: 3 })
    expect(passportKpiValues({ totals: { km: 5000, cpk: 0.12 }, costBreakdown: { lifetime: 600 }, distinctVehicles: 2 }).lifetimeKm).toBe(5000)
  })

  it('journeyWithDays counts stint days, open stints to injected now, unknown to null', () => {
    const now = new Date('2026-01-11T00:00:00Z')
    const out = journeyWithDays([
      { fitted: '2026-01-01', removed: '2026-01-06' },
      { fitted: '2026-01-06', removed: null },
      { fitted: null, removed: '2026-01-06' },
      { fitted: 'garbage', removed: null },
    ], now)
    expect(out[0]).toMatchObject({ days: 5, current: false })
    expect(out[1]).toMatchObject({ days: 5, current: true })
    expect(out[2].days).toBeNull()
    expect(out[3].days).toBeNull()
  })

  it('journeySummary averages only measured stints', () => {
    const s = journeySummary([
      { asset_no: 'A', km_run: 1000, reason: 'Wear' },
      { asset_no: 'B', km_run: 3000, reason: 'Wear' },
      { asset_no: 'C', km_run: null },
    ])
    expect(s).toEqual({
      stints: 3, measuredStints: 2, avgKmPerStint: 2000,
      longestStint: { asset_no: 'B', km_run: 3000 }, removalReasons: ['Wear'],
    })
    expect(journeySummary([]).avgKmPerStint).toBeNull()
  })
})
