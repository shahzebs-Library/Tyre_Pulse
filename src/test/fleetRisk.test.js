import { describe, it, expect } from 'vitest'
import {
  scoreVehicles, summarizeRisk, riskBand, isInService, tyreCpk,
  DEFAULT_WEIGHTS,
} from '../lib/fleetRisk'

// Fixed reference clock so age/failure-window logic is fully deterministic.
const NOW = new Date('2026-07-12T00:00:00Z').getTime()
const yearsAgo = (n) => new Date(NOW - n * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10)
const daysAgo = (n) => new Date(NOW - n * 24 * 3600 * 1000).toISOString().slice(0, 10)

// CLEAN vehicle: young tyres, healthy tread, inspected, no failures, cheap CPK.
const cleanTyres = [
  { id: 1, asset_no: 'CLEAN-1', site: 'Dubai', country: 'UAE', fitment_date: yearsAgo(1), tread_depth: 9, pressure_reading: 110, cost_per_tyre: 1000, total_km: 100000 },
  { id: 2, asset_no: 'CLEAN-1', site: 'Dubai', country: 'UAE', fitment_date: yearsAgo(1), tread_depth: 8.5, pressure_reading: 108, cost_per_tyre: 1000, total_km: 100000 },
]

// BAD vehicle: aged tyres, bald tread, a recent reasoned failure, no inspection,
// and an expensive CPK (high cost over tiny distance).
const badTyres = [
  { id: 10, asset_no: 'BAD-1', site: 'Riyadh', country: 'KSA', fitment_date: yearsAgo(7), tread_depth: 1.5, pressure_reading: 90, cost_per_tyre: 1200, total_km: 8000 },
  { id: 11, asset_no: 'BAD-1', site: 'Riyadh', country: 'KSA', fitment_date: yearsAgo(6), tread_depth: 2, cost_per_tyre: 1200, total_km: 8000 },
  // In-service tyre with NO tread/pressure reading → missing-inspection signal.
  { id: 12, asset_no: 'BAD-1', site: 'Riyadh', country: 'KSA', fitment_date: yearsAgo(6) },
  // Recently removed WITH a reason → recent-failure signal.
  { id: 13, asset_no: 'BAD-1', site: 'Riyadh', country: 'KSA', fitment_date: yearsAgo(6), removal_date: daysAgo(30), km_at_removal: 9000, reason_for_removal: 'Sidewall burst' },
]

const fixture = [...cleanTyres, ...badTyres]
const vehicles = [
  { id: 1, asset_no: 'CLEAN-1', make: 'Volvo', model: 'FH', vehicle_type: 'Truck', site: 'Dubai', country: 'UAE', status: 'active' },
  { id: 2, asset_no: 'BAD-1', make: 'Man', model: 'TGS', vehicle_type: 'Tipper', site: 'Riyadh', country: 'KSA', status: 'active' },
]

describe('fleetRisk.riskBand', () => {
  it('bands Low(<34)/Medium(34–66)/High(>66)', () => {
    expect(riskBand(0)).toBe('low')
    expect(riskBand(33)).toBe('low')
    expect(riskBand(34)).toBe('medium')
    expect(riskBand(66)).toBe('medium')
    expect(riskBand(67)).toBe('high')
    expect(riskBand(100)).toBe('high')
  })
})

describe('fleetRisk helpers', () => {
  it('isInService is true only without removal metadata', () => {
    expect(isInService({ fitment_date: yearsAgo(1) })).toBe(true)
    expect(isInService({ removal_date: daysAgo(1) })).toBe(false)
    expect(isInService({ km_at_removal: 5000 })).toBe(false)
  })
  it('tyreCpk = cost / km (null when not derivable)', () => {
    expect(tyreCpk({ cost_per_tyre: 1000, total_km: 100000 })).toBeCloseTo(0.01)
    expect(tyreCpk({ cost_per_tyre: 1000 })).toBeNull()
    expect(tyreCpk({ total_km: 100000 })).toBeNull()
  })
  it('weights sum to 1', () => {
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((s, w) => s + w, 0)
    expect(sum).toBeCloseTo(1, 6)
  })
})

describe('fleetRisk.scoreVehicles', () => {
  const rows = scoreVehicles({ tyres: fixture, vehicles }, { now: NOW })
  const byAsset = Object.fromEntries(rows.map((r) => [r.asset_no, r]))

  it('scores every asset present in the tyre data', () => {
    expect(rows.length).toBe(2)
    expect(byAsset['CLEAN-1']).toBeDefined()
    expect(byAsset['BAD-1']).toBeDefined()
  })

  it('scores are within 0–100 and bounded', () => {
    for (const r of rows) {
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(100)
    }
  })

  it('the clearly-bad vehicle scores higher than the clean one', () => {
    expect(byAsset['BAD-1'].score).toBeGreaterThan(byAsset['CLEAN-1'].score)
    expect(byAsset['BAD-1'].band).toBe('high')
    expect(byAsset['CLEAN-1'].band).toBe('low')
    expect(byAsset['CLEAN-1'].score).toBe(0)
  })

  it('surfaces the concrete signals that drove the bad score', () => {
    const s = byAsset['BAD-1'].signals
    expect(s.agedCount).toBeGreaterThanOrEqual(2)
    expect(s.lowTreadCount).toBe(2)
    expect(s.recentFailures).toBe(1)
    expect(s.noInspectionCount).toBe(1)
  })

  it('enriches rows with vehicle master data', () => {
    expect(byAsset['CLEAN-1'].make).toBe('Volvo')
    expect(byAsset['BAD-1'].vehicle_type).toBe('Tipper')
  })

  it('ignores unassigned (pool) tyres with no asset_no', () => {
    const withPool = scoreVehicles(
      { tyres: [...fixture, { id: 99, asset_no: null, tread_depth: 1 }], vehicles },
      { now: NOW },
    )
    expect(withPool.length).toBe(2)
  })

  it('is deterministic for a fixed now', () => {
    const a = scoreVehicles({ tyres: fixture, vehicles }, { now: NOW })
    const b = scoreVehicles({ tyres: fixture, vehicles }, { now: NOW })
    expect(a).toEqual(b)
  })

  it('an old removal outside the failure window is not counted as a recent failure', () => {
    const oldFail = [
      { id: 20, asset_no: 'OLD-1', fitment_date: yearsAgo(1), tread_depth: 9, pressure_reading: 100, cost_per_tyre: 1000, total_km: 100000 },
      { id: 21, asset_no: 'OLD-1', fitment_date: yearsAgo(3), removal_date: daysAgo(500), km_at_removal: 90000, reason_for_removal: 'Wear' },
    ]
    const [row] = scoreVehicles({ tyres: oldFail }, { now: NOW })
    expect(row.signals.recentFailures).toBe(0)
  })
})

describe('fleetRisk.summarizeRisk', () => {
  const rows = scoreVehicles({ tyres: fixture, vehicles }, { now: NOW })
  const summary = summarizeRisk(rows)

  it('counts total and per-band', () => {
    expect(summary.counts.total).toBe(2)
    expect(summary.counts.high).toBe(1)
    expect(summary.counts.low).toBe(1)
  })
  it('reports an average score and a top-risk list ordered high→low', () => {
    expect(summary.avgScore).toBe(Math.round((rows[0].score + rows[1].score) / 2))
    expect(summary.topRisk[0].score).toBeGreaterThanOrEqual(summary.topRisk[summary.topRisk.length - 1].score)
  })
  it('is empty-safe', () => {
    const empty = summarizeRisk([])
    expect(empty.counts.total).toBe(0)
    expect(empty.avgScore).toBeNull()
    expect(empty.topRisk).toEqual([])
  })
})
