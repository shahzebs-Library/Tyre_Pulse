import { describe, it, expect } from 'vitest'
import {
  treadScore, pressureScore, ageScore, kmScore, inspectionScore,
  compositeScore, riskLevel, riskColor, topRiskFactors, scoreTyre, scoreTyres,
  summarizeTyreRisk, rollupVehicles, inServiceYears, tyreKm, tyreCpk,
  isInService, isScrapped, serialOf, positionOf,
  W_TREAD, W_PRESSURE, W_AGE, W_KM, W_INSPECTION,
  TREAD_LEGAL_MIN_MM, TREAD_REPLACE_MM, TYRE_MAX_AGE_YEARS, KM_MAX_LIFECYCLE,
} from '../lib/fleetRisk'

// Fixed reference clock so in-service age is fully deterministic.
const NOW = new Date('2026-07-12T00:00:00Z').getTime()
const yearsAgo = (n) => new Date(NOW - n * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10)

describe('fleetRisk — weights', () => {
  it('sub-score weights sum to 100', () => {
    expect(W_TREAD + W_PRESSURE + W_AGE + W_KM + W_INSPECTION).toBe(100)
  })
})

describe('fleetRisk.treadScore (higher = safer)', () => {
  it('null → 50 (unknown, mid-risk)', () => {
    expect(treadScore(null)).toBe(50)
    expect(treadScore(undefined)).toBe(50)
  })
  it('0 at/below the legal minimum', () => {
    expect(treadScore(TREAD_LEGAL_MIN_MM)).toBe(0) // 1.6
    expect(treadScore(1.0)).toBe(0)
  })
  it('linear 0→50 through the warning zone (1.6→3.0)', () => {
    // midpoint 2.3mm → 50 * (2.3-1.6)/1.4 = 25
    expect(treadScore(2.3)).toBeCloseTo(25, 6)
    expect(treadScore(TREAD_REPLACE_MM)).toBeCloseTo(50, 6) // exactly 3.0 → 50
  })
  it('linear 50→100 from replace threshold up to new (10mm), capped', () => {
    // 3.0 + half of 7mm span = 6.5mm → 50 + 50*(3.5/7) = 75
    expect(treadScore(6.5)).toBeCloseTo(75, 6)
    expect(treadScore(10)).toBe(100)
    expect(treadScore(20)).toBe(100) // min(1, ...) caps at 100
  })
})

describe('fleetRisk.pressureScore', () => {
  it('null → 60 (unknown)', () => {
    expect(pressureScore(null)).toBe(60)
  })
  it('100 within ±10% of optimal (default 95)', () => {
    expect(pressureScore(95)).toBe(100)
    expect(pressureScore(104)).toBe(100) // within +10% (95→104.5)
    expect(pressureScore(95 * 1.10)).toBeCloseTo(100, 6) // exactly at tolerance (fp-safe)
    expect(pressureScore(95 * 0.90)).toBeCloseTo(100, 6)
  })
  it('drops 400 per unit-deviation past tolerance, floored at 0', () => {
    // dev = 0.20 → 100 - (0.20-0.10)*400 = 60
    expect(pressureScore(95 * 1.20)).toBeCloseTo(60, 6)
    // dev = 0.50 → 100 - 0.40*400 = -60 → clamped 0
    expect(pressureScore(95 * 1.50)).toBe(0)
  })
  it('honours a custom optimal PSI', () => {
    expect(pressureScore(120, 120)).toBe(100)
  })
})

describe('fleetRisk.ageScore (in-service years)', () => {
  it('null → 60 (no fitment anchor)', () => {
    expect(ageScore(null)).toBe(60)
  })
  it('0 at/over the 5-year limit', () => {
    expect(ageScore(TYRE_MAX_AGE_YEARS)).toBe(0)
    expect(ageScore(7)).toBe(0)
  })
  it('linear decay below the limit', () => {
    expect(ageScore(0)).toBe(100)
    expect(ageScore(2.5)).toBeCloseTo(50, 6)
    expect(ageScore(1)).toBeCloseTo(80, 6)
  })
})

describe('fleetRisk.kmScore', () => {
  it('falsy km → 80 (unknown/new)', () => {
    expect(kmScore(0)).toBe(80)
    expect(kmScore(null)).toBe(80)
    expect(kmScore(undefined)).toBe(80)
  })
  it('linear decay to 0 at the lifecycle limit', () => {
    expect(kmScore(KM_MAX_LIFECYCLE / 2)).toBeCloseTo(50, 6) // 40,000
    expect(kmScore(KM_MAX_LIFECYCLE)).toBe(0)
    expect(kmScore(KM_MAX_LIFECYCLE * 2)).toBe(0) // floored at 0
  })
})

describe('fleetRisk.inspectionScore', () => {
  it('null → 40 (no inspection-date source — honest default)', () => {
    expect(inspectionScore(null)).toBe(40)
  })
  it('100 when inspected within a week', () => {
    expect(inspectionScore(0)).toBe(100)
    expect(inspectionScore(7)).toBe(100)
  })
  it('decays 100→50 through the overdue window (7→30d)', () => {
    // day 18.5 ≈ midpoint → ~75
    expect(inspectionScore(18.5)).toBeCloseTo(75, 1)
    expect(inspectionScore(30)).toBeCloseTo(50, 6)
  })
  it('past overdue drops 1/day, floored at 0', () => {
    expect(inspectionScore(50)).toBeCloseTo(30, 6) // 50 - 20
    expect(inspectionScore(200)).toBe(0)
  })
})

describe('fleetRisk.compositeScore', () => {
  it('is the weighted mean, rounded to 1 dp', () => {
    // all-100 → 100
    expect(compositeScore(100, 100, 100, 100, 100)).toBe(100)
    // all-0 → 0
    expect(compositeScore(0, 0, 0, 0, 0)).toBe(0)
    // manual weighting check
    const raw = (80 * W_TREAD + 60 * W_PRESSURE + 40 * W_AGE + 20 * W_KM + 0 * W_INSPECTION) / 100
    expect(compositeScore(80, 60, 40, 20, 0)).toBe(Math.round(raw * 10) / 10)
  })
})

describe('fleetRisk.riskLevel + riskColor (safety bands)', () => {
  it('bands >=75 low, >=50 medium, >=25 high, <25 critical', () => {
    expect(riskLevel(90)).toBe('low')
    expect(riskLevel(75)).toBe('low')
    expect(riskLevel(74.9)).toBe('medium')
    expect(riskLevel(50)).toBe('medium')
    expect(riskLevel(49.9)).toBe('high')
    expect(riskLevel(25)).toBe('high')
    expect(riskLevel(24.9)).toBe('critical')
    expect(riskLevel(0)).toBe('critical')
  })
  it('unknown for null/non-finite', () => {
    expect(riskLevel(null)).toBe('unknown')
    expect(riskLevel(NaN)).toBe('unknown')
  })
  it('colour tracks the band', () => {
    expect(riskColor(90)).toBe('green')
    expect(riskColor(60)).toBe('amber')
    expect(riskColor(30)).toBe('orange')
    expect(riskColor(10)).toBe('red')
  })
})

describe('fleetRisk.topRiskFactors', () => {
  it('flags factors below cutoff (tread/km <50, pressure/age/insp <60), worst-first, top 3', () => {
    const raw = { tread: 10, pressure: 40, age: 55, km: 30, inspection: 40 }
    const out = topRiskFactors(raw, { treadMm: 1.5, actualPsi: 60, ageYears: 4.5, km: 60000, inspDays: null })
    expect(out).toHaveLength(3) // 5 qualify, capped at 3
    expect(out.map((f) => f.factor)).toEqual(['tread_depth', 'km_driven', 'pressure']) // 10,30,40…
    expect(out[0].score).toBeLessThanOrEqual(out[1].score)
  })
  it('returns none when every factor is healthy', () => {
    expect(topRiskFactors({ tread: 90, pressure: 90, age: 90, km: 90, inspection: 90 })).toEqual([])
  })
  it('uses honest details when inputs are missing', () => {
    const [f] = topRiskFactors({ tread: 100, pressure: 100, age: 100, km: 100, inspection: 40 }, { inspDays: null })
    expect(f.factor).toBe('inspection')
    expect(f.detail).toMatch(/no inspection/i)
  })
})

describe('fleetRisk helpers', () => {
  it('isInService only without removal metadata', () => {
    expect(isInService({ fitment_date: yearsAgo(1) })).toBe(true)
    expect(isInService({ removal_date: '2025-01-01' })).toBe(false)
    expect(isInService({ km_at_removal: 5000 })).toBe(false)
  })
  it('isScrapped detects scrap/disposed status', () => {
    expect(isScrapped({ status: 'Scrapped' })).toBe(true)
    expect(isScrapped({ status: 'disposed' })).toBe(true)
    expect(isScrapped({ status: 'in_service' })).toBe(false)
  })
  it('inServiceYears from fitment/issue date (null when no anchor)', () => {
    expect(inServiceYears({ fitment_date: yearsAgo(3) }, NOW)).toBeCloseTo(3, 2)
    expect(inServiceYears({ issue_date: yearsAgo(2) }, NOW)).toBeCloseTo(2, 2)
    expect(inServiceYears({}, NOW)).toBeNull()
  })
  it('tyreKm + tyreCpk', () => {
    expect(tyreKm({ total_km: 50000 })).toBe(50000)
    expect(tyreKm({ km_at_fitment: 10000, km_at_removal: 55000 })).toBe(45000)
    expect(tyreCpk({ cost_per_tyre: 1000, total_km: 100000 })).toBeCloseTo(0.01)
    expect(tyreCpk({ cost_per_tyre: 1000 })).toBeNull()
  })
  it('serialOf + positionOf resolve alternate columns', () => {
    expect(serialOf({ tyre_serial: ' T-9 ' })).toBe('T-9')
    expect(serialOf({ serial_number: 'S2' })).toBe('S2')
    expect(positionOf({ tyre_position: 'Drive' })).toBe('Drive')
    expect(positionOf({ position: 'Steer' })).toBe('Steer')
  })
})

describe('fleetRisk.scoreTyre', () => {
  it('scores a healthy new tyre as low-risk (safe)', () => {
    const r = scoreTyre({
      id: 1, serial_no: 'NEW1', asset_no: 'A1', position: 'Steer', brand: 'Bridgestone',
      fitment_date: yearsAgo(0.5), tread_depth: 10, pressure_reading: 95, total_km: 10000,
    }, { now: NOW })
    expect(r.risk_level).toBe('low')
    expect(r.risk_score).toBeGreaterThanOrEqual(75)
    expect(r.component_scores.tread).toBe(100)
    expect(r.component_scores.pressure).toBe(100)
    expect(r.serial).toBe('NEW1')
    expect(r.top_risk_factors.length).toBeLessThanOrEqual(3)
  })
  it('scores a bald aged tyre as critical with the right factors', () => {
    const r = scoreTyre({
      id: 2, serial_no: 'BAD1', asset_no: 'A2', position: 'Drive',
      fitment_date: yearsAgo(7), tread_depth: 1.2, pressure_reading: 60, total_km: 90000,
    }, { now: NOW })
    expect(r.risk_level).toBe('critical')
    expect(r.component_scores.tread).toBe(0)
    expect(r.component_scores.age).toBe(0)
    expect(r.component_scores.km).toBe(0)
    const factors = r.top_risk_factors.map((f) => f.factor)
    expect(factors).toContain('tread_depth')
  })
  it('degrades gracefully with no measurements (uses documented defaults)', () => {
    const r = scoreTyre({ id: 3, serial_no: 'X', asset_no: 'A3' }, { now: NOW })
    // tread 50, pressure 60, age 60 (no fitment), km 80 (falsy), inspection 40
    expect(r.component_scores).toEqual({ tread: 50, pressure: 60, age: 60, km: 80, inspection: 40 })
    expect(r.risk_score).toBe(compositeScore(50, 60, 60, 80, 40))
    expect(r.age_years).toBeNull()
  })
  it('inspection always applies the no-data default (no fabricated date)', () => {
    const r = scoreTyre({ id: 4, serial_no: 'Y', asset_no: 'A4', fitment_date: yearsAgo(1) }, { now: NOW })
    expect(r.component_scores.inspection).toBe(40)
  })
})

describe('fleetRisk.scoreTyres + summarizeTyreRisk', () => {
  const tyres = [
    { id: 1, serial_no: 'S1', asset_no: 'A1', fitment_date: yearsAgo(0.3), tread_depth: 9, pressure_reading: 95, total_km: 5000 },
    { id: 2, serial_no: 'S2', asset_no: 'A1', fitment_date: yearsAgo(7), tread_depth: 1.2, pressure_reading: 60, total_km: 90000 },
    // removed tyre — excluded from live scoring
    { id: 3, serial_no: 'S3', asset_no: 'A2', fitment_date: yearsAgo(4), removal_date: yearsAgo(0.1), km_at_removal: 70000, tread_depth: 2 },
    // scrapped — excluded
    { id: 4, serial_no: 'S4', asset_no: 'A2', fitment_date: yearsAgo(4), status: 'scrapped', tread_depth: 2 },
  ]
  const rows = scoreTyres({ tyres }, { now: NOW })

  it('scores only live (in-service, non-scrapped) tyres', () => {
    expect(rows.map((r) => r.serial).sort()).toEqual(['S1', 'S2'])
  })
  it('orders worst-first (lowest safety score)', () => {
    expect(rows[0].serial).toBe('S2')
    expect(rows[0].risk_score).toBeLessThan(rows[1].risk_score)
  })
  it('is deterministic for a fixed now', () => {
    expect(scoreTyres({ tyres }, { now: NOW })).toEqual(scoreTyres({ tyres }, { now: NOW }))
  })
  it('summary reports fleet average, band counts and total', () => {
    const s = summarizeTyreRisk(rows)
    expect(s.total_scored).toBe(2)
    expect(s.by_risk_level.critical).toBe(1)
    expect(s.by_risk_level.low).toBe(1)
    expect(s.fleet_average_score).toBe(Math.round(((rows[0].risk_score + rows[1].risk_score) / 2) * 10) / 10)
    expect(s.fleet_risk_level).toBe(riskLevel(s.fleet_average_score))
  })
  it('summary is empty-safe', () => {
    const s = summarizeTyreRisk([])
    expect(s.total_scored).toBe(0)
    expect(s.fleet_average_score).toBe(0)
    expect(s.fleet_risk_level).toBe('unknown')
    expect(s.by_risk_level).toEqual({ critical: 0, high: 0, medium: 0, low: 0 })
  })
})

describe('fleetRisk.rollupVehicles (secondary view)', () => {
  const tyres = [
    { id: 1, serial_no: 'S1', asset_no: 'A1', site: 'Dubai', fitment_date: yearsAgo(0.3), tread_depth: 9, pressure_reading: 95, total_km: 5000 },
    { id: 2, serial_no: 'S2', asset_no: 'A1', site: 'Dubai', fitment_date: yearsAgo(7), tread_depth: 1.2, pressure_reading: 60, total_km: 90000 },
    { id: 5, serial_no: 'S5', asset_no: 'A9', site: 'Riyadh', fitment_date: yearsAgo(1), tread_depth: 8, pressure_reading: 95, total_km: 20000 },
  ]
  const rows = scoreTyres({ tyres }, { now: NOW })
  const veh = rollupVehicles(rows)
  const byAsset = Object.fromEntries(veh.map((v) => [v.asset_no, v]))

  it('groups by asset with worst-tyre band per vehicle', () => {
    expect(veh.length).toBe(2)
    expect(byAsset.A1.tyre_count).toBe(2)
    expect(byAsset.A1.worst_score).toBe(Math.min(...rows.filter((r) => r.asset_no === 'A1').map((r) => r.risk_score)))
    expect(byAsset.A1.vehicle_risk_level).toBe(riskLevel(byAsset.A1.worst_score))
    expect(byAsset.A1.worst_tyre.serial).toBe('S2')
  })
  it('worst vehicles sort first and pool tyres (no asset) are skipped', () => {
    expect(veh[0].worst_score).toBeLessThanOrEqual(veh[veh.length - 1].worst_score)
    const withPool = rollupVehicles(scoreTyres({ tyres: [...tyres, { id: 99, serial_no: 'P', asset_no: null, tread_depth: 1 }] }, { now: NOW }))
    expect(withPool.length).toBe(2)
  })
})
