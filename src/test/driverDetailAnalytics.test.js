import { describe, it, expect } from 'vitest'
import {
  canonRisk, calcCpk, tyreLife, aggregateDriver, computeFleetRank, buildDriverView,
  performanceBadge, enrichRecords, filterRecords, breakdown, recordExport, optionList,
} from '../lib/driverDetailAnalytics'

const fleet = [
  { id: 1, driver_name: 'Ali', cost_per_tyre: 1000, km_at_fitment: 0, km_at_removal: 50000, risk_level: 'high', brand: 'A', site: 'NHC', issue_date: '2026-01-10', removal_reason: 'Worn' },
  { id: 2, driver_name: 'Ali', cost_per_tyre: null, km_at_fitment: 100, km_at_removal: null, risk_level: null, brand: 'B', issue_date: '2026-03-01' },
  { id: 3, driver_name: 'Sara', cost_per_tyre: 800, km_at_fitment: 0, km_at_removal: 80000, risk_level: 'Low', brand: 'A', issue_date: '2026-02-01' },
  { id: 4, driver_name: '', cost_per_tyre: null },
]

describe('driverDetailAnalytics', () => {
  it('canonicalises risk and computes per-tyre maths', () => {
    expect(canonRisk('HIGH')).toBe('High')
    expect(canonRisk('')).toBeNull()
    expect(calcCpk(1000, 0, 50000)).toBe(0.02)
    expect(calcCpk(1000, 100, 50)).toBeNull()
    expect(tyreLife({ km_at_fitment: 10, km_at_removal: 5 })).toBeNull()
  })

  it('aggregates honestly: nulls when unmeasured', () => {
    const a = aggregateDriver('Ali', fleet.slice(0, 2))
    expect(a).toMatchObject({ totalTyres: 2, totalCost: 1000, pricedTyres: 1, cpkTyres: 1, ratedTyres: 1, failureRate: 100, highRiskCount: 1 })
    const none = aggregateDriver('X', [{ id: 9 }])
    expect(none.totalCost).toBeNull()
    expect(none.failureRate).toBeNull()
    expect(none.avgCpk).toBeNull()
  })

  it('ranks across the fleet and withholds a score with no evidence', () => {
    const r = computeFleetRank('Sara', fleet)
    expect(r.rank).toBe(1)
    expect(r.driverCount).toBe(3)
    const v = buildDriverView('Unassigned', fleet)
    expect(v.riskScore).toBeNull()
    expect(performanceBadge(v.riskScore).label).toBe('Not rated')
    expect(buildDriverView('Nobody', fleet)).toBeNull()
  })

  it('filters records and builds breakdowns and exports', () => {
    const e = enrichRecords(fleet.slice(0, 2))
    expect(filterRecords(e).map((r) => r.id)).toEqual([2, 1])
    expect(filterRecords(e, { risk: 'high' }).map((r) => r.id)).toEqual([1])
    expect(filterRecords(e, { risk: 'unrated' }).map((r) => r.id)).toEqual([2])
    expect(filterRecords(e, { from: '2026-02-01' }).map((r) => r.id)).toEqual([2])
    expect(filterRecords(e, { search: 'worn' }).map((r) => r.id)).toEqual([1])
    expect(optionList(e, 'brand')).toEqual(['A', 'B'])
    expect(breakdown(e, 'site')).toEqual([{ label: 'NHC', count: 1 }, { label: 'Not recorded', count: 1 }])
    const x = recordExport(e)
    expect(x.rows[1].cpk).toBe('N/A')
    expect(x.rows[1].risk).toBe('Not rated')
  })
})
