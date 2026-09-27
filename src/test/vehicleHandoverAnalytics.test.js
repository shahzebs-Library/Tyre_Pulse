import { describe, it, expect } from 'vitest'
import {
  filterHandovers, handoverKpis, conditionMix, monthlyHandoverTrend, assetDamageLeaders,
  vehiclesStillOut, handoverExportRows, NOT_RATED,
} from '../lib/vehicleHandoverAnalytics'

const NOW = new Date('2026-09-27T12:00:00Z')
const rows = [
  { id: 1, asset_no: 'T1', handover_type: 'checkout', handover_at: '2026-09-20T08:00:00Z', condition_rating: 'good', fuel_level_pct: 80, from_driver: 'A', to_driver: 'B', country: 'KSA' },
  { id: 2, asset_no: 'T1', handover_type: 'checkin', handover_at: '2026-09-25T08:00:00Z', condition_rating: 'poor', damage_count: 2, from_driver: 'B', to_driver: 'A', country: 'KSA' },
  { id: 3, asset_no: 'T2', handover_type: 'checkout', handover_at: '2026-09-26T08:00:00Z', condition_rating: 'fair', damages: [{}], to_driver: 'C', country: 'UAE' },
  { id: 4, asset_no: 'T3', handover_type: 'checkout', handover_at: null, condition_rating: null },
]

describe('vehicleHandoverAnalytics', () => {
  it('returns null rates on an empty register, never 0', () => {
    const k = handoverKpis([], { now: NOW })
    expect(k.poorRate).toBeNull()
    expect(k.damageRate).toBeNull()
    expect(k.avgFuelPct).toBeNull()
    expect(k.totalReports).toBe(0)
  })

  it('computes rates over rated reports and counts vehicles still out', () => {
    const k = handoverKpis(rows, { now: NOW })
    expect(k.ratedReports).toBe(3)
    expect(k.poorRate).toBe(33.3)
    expect(k.belowGoodRate).toBe(66.7)
    expect(k.damagedReports).toBe(2)
    expect(k.damageRate).toBe(50)
    expect(k.avgFuelPct).toBe(80)
    expect(k.stillOut).toBe(1) // T2; T1 came back; T3 undated cannot be placed
    expect(k.last30Days).toBe(3)
    expect(k.distinctDrivers).toBe(3)
  })

  it('vehiclesStillOut uses the latest dated handover per asset', () => {
    expect(vehiclesStillOut(rows).map((r) => r.asset_no)).toEqual(['T2'])
  })

  it('filters by type, condition (incl. not rated), damage, date range and text', () => {
    expect(filterHandovers(rows, { type: 'checkout' })).toHaveLength(3)
    expect(filterHandovers(rows, { condition: NOT_RATED }).map((r) => r.id)).toEqual([4])
    expect(filterHandovers(rows, { damagedOnly: true }).map((r) => r.id)).toEqual([2, 3])
    expect(filterHandovers(rows, { from: '2026-09-25', to: '2026-09-25' }).map((r) => r.id)).toEqual([2])
    expect(filterHandovers(rows, { search: 'c' }).map((r) => r.id)).toContain(3)
    expect(filterHandovers(rows, { country: 'UAE' }).map((r) => r.id)).toEqual([3])
  })

  it('condition mix keeps ladder order and adds Not rated only when present', () => {
    const mix = conditionMix(rows)
    expect(mix.map((m) => m.key)).toEqual(['excellent', 'good', 'fair', 'poor', NOT_RATED])
    expect(conditionMix([{ condition_rating: 'good' }]).length).toBe(4)
  })

  it('monthly trend returns 12 contiguous months ending at now', () => {
    const t = monthlyHandoverTrend(rows, { now: NOW })
    expect(t).toHaveLength(12)
    expect(t[11]).toEqual({ month: '2026-09', checkouts: 2, checkins: 1, damages: 3 })
    expect(t[0].month).toBe('2025-10')
  })

  it('ranks damage leaders and exports blanks rather than zeros', () => {
    expect(assetDamageLeaders(rows)[0]).toMatchObject({ asset: 'T1', damages: 2, poor: 1 })
    const ex = handoverExportRows([rows[3]])[0]
    expect(ex.odometer_km).toBe('')
    expect(ex.fuel_level_pct).toBe('')
  })
})
