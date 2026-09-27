import { describe, it, expect } from 'vitest'
import {
  aggregateDrivers, driverKpis, orderDrivers, filterDriverRecords, calcCpk,
  performanceBand, applyDatePreset,
} from '../lib/driverManagementAnalytics'

const rec = (o) => ({ site: 'NHC', country: 'KSA', issue_date: '2026-05-01', ...o })
const records = [
  rec({ driver_name: 'Ali', cost_per_tyre: 1000, km_at_fitment: 0, km_at_removal: 10000, risk_level: 'Low' }),
  rec({ driver_name: 'Ali', cost_per_tyre: 1000, km_at_fitment: 0, km_at_removal: 10000, risk_level: 'High' }),
  rec({ driver_name: 'Omar', cost_per_tyre: 1000, km_at_fitment: 0, km_at_removal: 2000, site: 'JED' }),
  rec({ driver_name: '', cost_per_tyre: null }),
]

describe('driverManagementAnalytics', () => {
  it('computes CPK only on a positive distance', () => {
    expect(calcCpk(100, 0, 1000)).toBe(0.1)
    expect(calcCpk(100, 1000, 1000)).toBeNull()
    expect(calcCpk(null, 0, 10)).toBeNull()
  })

  it('rates failure over RATED records only, null when none rated', () => {
    const d = aggregateDrivers(records)
    const ali = d.find((x) => x.name === 'Ali')
    const omar = d.find((x) => x.name === 'Omar')
    const un = d.find((x) => x.name === 'Unassigned')
    expect(ali.failureRate).toBe(50)
    expect(omar.failureRate).toBeNull()
    expect(un.totalCost).toBeNull()
    expect(un.riskScore).toBeNull()
    expect(un.rank).toBeNull()
    expect(performanceBand(un.riskScore).label).toBe('Not rated')
    // Ali cheaper CPK ranks first
    expect(d[0].name).toBe('Ali')
  })

  it('summarises KPIs honestly', () => {
    const d = aggregateDrivers(records)
    const k = driverKpis(d, records.length)
    expect(k.totalDrivers).toBe(3)
    expect(k.fleetFailureRate).toBe(50)
    expect(k.totalCost).toBe(3000)
    expect(k.bestPerformer.name).toBe('Ali')
    expect(k.highestCost.name).toBe('Omar')
    expect(k.unratedDrivers).toBe(1)
    expect(driverKpis([], 0).fleetAvgCpk).toBeNull()
  })

  it('orders with nulls last and filters records', () => {
    const d = aggregateDrivers(records)
    expect(orderDrivers(d, { sort: 'failureRate', dir: 'desc' })[0].name).toBe('Ali')
    expect(orderDrivers(d, { search: 'om' }).map((x) => x.name)).toEqual(['Omar'])
    expect(filterDriverRecords(records, { site: 'JED' })).toHaveLength(1)
    expect(filterDriverRecords(records, { from: '2026-06-01' })).toHaveLength(0)
    expect(applyDatePreset(null)).toEqual({ from: '', to: '' })
    expect(applyDatePreset(90, new Date('2026-09-27T00:00:00Z')).to).toBe('2026-09-27')
  })
})
