import { describe, it, expect } from 'vitest'
import {
  buildPassport, serialOfRecord, treadScore, pressureScore, ageScore, alertScore,
  historyScore, riskLevel, computeHealth, computeWear, HEALTH_WEIGHTS,
} from '../lib/tyrePassport'

describe('buildPassport', () => {
  it('returns null with no records', () => {
    expect(buildPassport([])).toBeNull()
    expect(buildPassport(null)).toBeNull()
  })

  it('resolves the serial across the three serial columns', () => {
    expect(serialOfRecord({ tyre_serial: ' T-9 ' })).toBe('T-9')
    expect(serialOfRecord({ serial_number: 'S2' })).toBe('S2')
  })

  it('collapses multiple records into one lifecycle with totals + CPK', () => {
    const p = buildPassport([
      { id: 2, serial_no: 'AA1', brand: 'Bridgestone', size: '11R22.5', asset_no: 'TM517', position: 'Drive', fitment_date: '2024-06-01', removal_date: '2025-01-01', total_km: 40000, cost_per_tyre: 1600, reason_for_removal: 'Worn', status: 'removed' },
      { id: 1, serial_no: 'AA1', brand: 'Bridgestone', asset_no: 'MP078', position: 'Steer', fitment_date: '2023-01-01', total_km: 60000, cost_per_tyre: 0 },
    ])
    expect(p.serial).toBe('AA1')
    expect(p.brand).toBe('Bridgestone')
    // events are chronological (2023 fitment first)
    expect(p.events[0].asset_no).toBe('MP078')
    expect(p.events[1].asset_no).toBe('TM517')
    expect(p.assets).toEqual(expect.arrayContaining(['MP078', 'TM517']))
    expect(p.totals.km).toBe(100000)
    expect(p.totals.cost).toBe(1600)
    // CPK = 1600 / 100000 = 0.016
    expect(p.totals.cpk).toBe(0.016)
    expect(p.recordCount).toBe(2)
  })

  it('derives km from fitment/removal odometer when total_km is absent', () => {
    const p = buildPassport([
      { id: 1, serial_no: 'B2', km_at_fitment: 10000, km_at_removal: 55000, removal_date: '2025-03-01' },
    ])
    expect(p.events[0].km).toBe(45000)
    expect(p.totals.km).toBe(45000)
    expect(p.events[0].kmEarned).toBe(45000)
  })
})

describe('tyrePassport — health sub-scores (bucket boundaries)', () => {
  it('treadScore buckets on remaining %', () => {
    expect(treadScore(null)).toBe(70) // neutral when no signal
    expect(treadScore(90)).toBe(100)
    expect(treadScore(80)).toBe(100)
    expect(treadScore(60)).toBe(85)
    expect(treadScore(40)).toBe(65)
    expect(treadScore(20)).toBe(40)
    expect(treadScore(5)).toBe(15)
  })
  it('pressureScore on |delta%| (neutral when no target)', () => {
    expect(pressureScore(null)).toBe(70)
    expect(pressureScore(3)).toBe(100)
    expect(pressureScore(-8)).toBe(80)
    expect(pressureScore(30)).toBe(10)
  })
  it('ageScore in years, alertScore, historyScore', () => {
    expect(ageScore(null)).toBe(70)
    expect(ageScore(1)).toBe(100)
    expect(ageScore(7)).toBe(10)
    expect(alertScore(null)).toBe(70)
    expect(alertScore(0)).toBe(100)
    expect(alertScore(2)).toBe(35)
    expect(historyScore(0)).toBe(100)
    expect(historyScore(1)).toBe(75)
    expect(historyScore(5)).toBe(20)
  })
  it('riskLevel bands', () => {
    expect(riskLevel(null)).toBe('unknown')
    expect(riskLevel(30)).toBe('critical')
    expect(riskLevel(50)).toBe('high')
    expect(riskLevel(70)).toBe('medium')
    expect(riskLevel(90)).toBe('low')
  })
})

describe('tyrePassport — computeHealth', () => {
  it('weights components and flags missing data', () => {
    const h = computeHealth({ treadRemainingPct: 90, pressureDeltaPct: null, ageYears: null, openAlerts: null, repairCount: 0 })
    // tread=100*.35, pressure=70*.20, age=70*.15, alerts=70*.20, history=100*.10
    const expected = Math.round(100 * 0.35 + 70 * 0.20 + 70 * 0.15 + 70 * 0.20 + 100 * 0.10)
    expect(h.overall).toBe(expected)
    expect(h.components.tread.hasData).toBe(true)
    expect(h.components.pressure.hasData).toBe(false)
    expect(h.components.history.hasData).toBe(true)
    expect(Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  })
  it('clamps to 0–100 and sets risk band', () => {
    const h = computeHealth({ treadRemainingPct: 5, pressureDeltaPct: null, ageYears: null, openAlerts: 5, repairCount: 5 })
    expect(h.overall).toBeGreaterThanOrEqual(0)
    expect(h.overall).toBeLessThanOrEqual(100)
    expect(['critical', 'high', 'medium', 'low']).toContain(h.risk)
  })
})

describe('tyrePassport — computeWear', () => {
  it('computes remaining %, wear rate and projected life from readings', () => {
    // initial 16 → current 8 over 80,000 km: consumed 8mm
    const w = computeWear([{ date: '2023-01-01', tread: 16 }, { date: '2024-01-01', tread: 8 }], 80000)
    expect(w.currentTread).toBe(8)
    expect(w.initialTread).toBe(16)
    // remaining = (8-3)/(16-3)*100 = 38.5
    expect(w.treadRemainingPct).toBeCloseTo(38.5, 1)
    // rate = 8/80000*1000 = 0.1 mm/1000km
    expect(w.wearRatePer1000Km).toBeCloseTo(0.1, 3)
    // projected = (8-3)/0.1*1000 = 50000
    expect(w.projectedRemainingKm).toBe(50000)
  })
  it('degrades to nulls with no readings and guards low distance', () => {
    const none = computeWear([], 0)
    expect(none.currentTread).toBeNull()
    expect(none.treadRemainingPct).toBeNull()
    const lowKm = computeWear([{ date: '2023-01-01', tread: 10 }], 10)
    expect(lowKm.wearRatePer1000Km).toBeNull() // km below MIN_KM_FOR_RATE
  })
})

describe('buildPassport — deep engine wiring', () => {
  it('attaches health, wear, stats and wear curve', () => {
    const p = buildPassport([
      { id: 1, serial_no: 'C9', asset_no: 'A1', position: 'Steer', fitment_date: '2023-01-01', tread_depth: 16, total_km: 0 },
      { id: 2, serial_no: 'C9', asset_no: 'A1', position: 'Drive', fitment_date: '2024-01-01', tread_depth: 8, total_km: 80000, reason_for_removal: 'puncture repair' },
    ])
    expect(p.health.overall).toBeGreaterThan(0)
    expect(p.wear.currentTread).toBe(8)
    expect(p.wearCurve).toHaveLength(2)
    expect(p.stats.recordCount).toBe(2)
    expect(p.stats.positionsServed).toBe(2)
    expect(p.stats.repairCount).toBe(1) // "puncture repair" matched
  })
})
