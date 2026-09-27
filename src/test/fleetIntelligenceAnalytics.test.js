import { describe, it, expect } from 'vitest'
import {
  buildVehicleMetrics, fleetAggregates, availabilityTimeline, costBySite, costTrend,
  attentionVehicles, cpkBenchmarks, filterRegister, registerExportRows, linearRegression,
  indexFleetMaster, monthsBetween,
} from '../lib/fleetIntelligenceAnalytics'

const NOW = new Date('2026-09-20T12:00:00Z')
const master = indexFleetMaster([
  { asset_no: 'A1', site: 'NHC', vehicle_type: 'MIXER' },
  { asset_no: 'A2', site: 'JED', vehicle_type: 'PUMP' },
])
const records = [
  { asset_no: 'A1', site: 'NHC', risk_level: 'Critical', issue_date: '2026-09-10', cost_per_tyre: 1000, km_at_fitment: 1000, km_at_removal: 11000 },
  { asset_no: 'A1', site: 'NHC', risk_level: 'Low', issue_date: '2026-07-10', cost_per_tyre: 1000, km_at_fitment: 0, km_at_removal: 5000 },
  { asset_no: 'A2', site: 'JED', risk_level: 'Low', issue_date: '2026-08-15', cost_per_tyre: 500, km_at_fitment: 100, km_at_removal: 10100 },
  { asset_no: 'A3', site: 'X', risk_level: 'High', issue_date: '2025-01-01', cost_per_tyre: 0 },
]

describe('fleetIntelligenceAnalytics', () => {
  const metrics = buildVehicleMetrics(records, master, { now: NOW })
  const by = Object.fromEntries(metrics.map((m) => [m.asset_no, m]))

  it('builds per-vehicle metrics with honest nulls', () => {
    expect(by.A1).toMatchObject({ total_tyre_changes: 2, total_tyre_cost: 2000, availability_status: 'Critical', vehicle_type: 'MIXER' })
    expect(by.A1.avg_cpk).toBeCloseTo(0.1) // only the fitment-km > 0 life is measurable
    expect(by.A3.avg_cpk).toBeNull()
    expect(by.A3.vehicle_type).toBeNull()
    expect(by.A3.availability_status).toBe('Available') // High but older than 30 days
  })

  it('aggregates the fleet and returns null ratios for an empty fleet', () => {
    const a = fleetAggregates(metrics, records)
    expect(a.fleet_size).toBe(3)
    expect(a.critical_count).toBe(1)
    expect(a.availability_pct).toBeCloseTo(66.67, 1)
    expect(a.fleetAvgCpk).toBeCloseTo(0.075)
    const empty = fleetAggregates([], [])
    expect(empty.availability_pct).toBeNull()
    expect(empty.avg_cost_per_vehicle).toBeNull()
    expect(empty.monthly_fleet_cost).toBeNull()
  })

  it('leaves months with no active assets as null availability', () => {
    const tl = availabilityTimeline(records, { now: NOW })
    expect(tl).toHaveLength(12)
    expect(tl[tl.length - 1]).toMatchObject({ month: '2026-09', pct: 0, assets: 1 })
    expect(tl[0].pct).toBeNull()
  })

  it('splits cost by site and trends it', () => {
    const cs = costBySite(records, master)
    expect(cs.sites[0]).toMatchObject({ site: 'NHC', total: 2000 })
    expect(cs.vtypes).toContain('Unknown')
    const tr = costTrend(records, { now: NOW })
    expect(tr.keys).toHaveLength(13)
    expect(tr.forecastKey).toBe('2026-10')
    expect(costTrend([], { now: NOW }).forecastCost).toBeNull()
  })

  it('lists attention vehicles only inside the 30 day window', () => {
    expect(attentionVehicles(records, { now: NOW }).map((v) => v.asset_no)).toEqual(['A1'])
  })

  it('estimates savings from measured km only, null without a fleet average', () => {
    const aggs = fleetAggregates(metrics, records)
    const b = cpkBenchmarks(metrics, aggs)
    expect(b.annualSavings).toBeGreaterThan(0)
    expect(cpkBenchmarks([], fleetAggregates([], [])).annualSavings).toBeNull()
  })

  it('filters the register and exports N/A for unmeasured values', () => {
    expect(filterRegister(metrics, { avail: 'Critical' }).map((v) => v.asset_no)).toEqual(['A1'])
    expect(filterRegister(metrics, { search: 'jed' }).map((v) => v.asset_no)).toEqual(['A2'])
    const row = registerExportRows([by.A3])[0]
    expect(row).toMatchObject({ avg_cpk: 'N/A', vehicle_type: 'N/A' })
  })

  it('has sane regression and month helpers', () => {
    expect(linearRegression([{ x: 0, y: 1 }, { x: 1, y: 3 }])).toEqual({ slope: 2, intercept: 1 })
    expect(monthsBetween(null, '2026-01-01')).toBeNull()
  })
})
