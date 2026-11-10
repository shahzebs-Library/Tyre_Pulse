/**
 * Helpers moved onto the shared tyre rules in the golden-reconciliation pass:
 * per-fitment km now goes through fitmentKm (tyreKm.js, T7) and purchase money
 * through withOnePricePerTyre (T1). Each test fails on the old local rule.
 */
import { describe, it, expect } from 'vitest'
import { buildForecastModel } from '../lib/forecastingEngineAnalytics'
import { removalTrend } from '../lib/predictiveOverview'
import { lifeComparison, averageTyreCost } from '../lib/rotationScheduleAnalytics'
import { withOnePricePerTyre, compareFitments } from '../lib/tyreLifetime'

const NOW = new Date(2025, 11, 15)

describe('forecasting: a refit is not a second purchase', () => {
  it('spend counts the real serial once', () => {
    const rows = [
      { id: 'a', serial_no: 'YMA55312', country: 'KSA', site: 'NHC', brand: 'X', issue_date: '2025-06-01', cost_per_tyre: 1000, qty: 1 },
      { id: 'b', serial_no: 'YMA55312', country: 'KSA', site: 'NHC', brand: 'X', issue_date: '2025-09-01', cost_per_tyre: 1000, qty: 1 },
    ]
    const m = buildForecastModel({ records: rows, now: NOW })
    expect(m.monthlySpend.reduce((s, v) => s + (v || 0), 0)).toBe(1000)
    // Demand still counts both fitments (events).
    expect(m.monthlyDemand.reduce((s, v) => s + v, 0)).toBe(2)
  })
})

describe('early removals: a placeholder fitment odometer is not a life', () => {
  it('fit 1 / removal 230000 is unknown, so it is neither early nor known', () => {
    const rows = [
      { removal_date: '2025-11-10', km_at_fitment: 1, km_at_removal: 230000, total_km: 229999, vehicle_type: 'TR-MIXER' },
      { removal_date: '2025-11-12', km_at_fitment: 10000, km_at_removal: 20000, vehicle_type: 'TR-MIXER' },
    ]
    const t = removalTrend(rows, NOW, 2, 50000)
    expect(t.total).toBe(2)
    expect(t.early.reduce((s, v) => s + v, 0)).toBe(1)
  })
})

describe('rotation life comparison and price', () => {
  it('excludes placeholder and over-cap stints from life', () => {
    const rows = [
      { serial_no: 'S1', km_at_fitment: 10000, km_at_removal: 50000, vehicle_type: 'TR-MIXER' },
      { serial_no: 'S2', km_at_fitment: 1, km_at_removal: 230000, vehicle_type: 'TR-MIXER' },
      { serial_no: 'S3', km_at_fitment: 10000, km_at_removal: 110000, vehicle_type: 'TR-MIXER' },
    ]
    const l = lifeComparison(rows, {})
    expect(l.withoutSamples).toBe(1)
    expect(l.avgLifeWithout).toBe(40000)
  })
  it('average price counts a doubly priced real serial once', () => {
    const rows = [
      { id: 1, serial_no: 'YMA55312', country: 'KSA', issue_date: '2025-01-01', cost_per_tyre: 1000 },
      { id: 2, serial_no: 'YMA55312', country: 'KSA', issue_date: '2025-05-01', cost_per_tyre: 1400 },
      { id: 3, serial_no: 'YMB77001', country: 'KSA', issue_date: '2025-02-01', cost_per_tyre: 800 },
    ]
    expect(averageTyreCost(rows)).toBe(900)
  })
})

describe('first priced fitment: one order everywhere', () => {
  it('same date -> lower id wins, whatever the input order', () => {
    const a = { id: 'g7a', serial_no: 'DUP700001', country: 'KSA', issue_date: '2025-02-01', cost_per_tyre: 766 }
    const b = { id: 'g7b', serial_no: 'DUP700001', country: 'KSA', issue_date: '2025-02-01', cost_per_tyre: 950 }
    for (const list of [[a, b], [b, a]]) {
      const kept = withOnePricePerTyre(list).filter((r) => r.cost_per_tyre > 0)
      expect(kept.map((r) => r.id)).toEqual(['g7a'])
    }
    expect(compareFitments(a, b)).toBeLessThan(0)
    expect(compareFitments({ ...a, issue_date: '2025-03-01' }, b)).toBeGreaterThan(0)
  })
})
