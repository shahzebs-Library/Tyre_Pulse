import { describe, it, expect } from 'vitest'
import {
  splitRecords, retreadKpis, brandSummary, bestSize, cycleDistribution, monthlyFitments, successRate,
} from '../lib/retreadManagementAnalytics'
import { CPK_KIND } from '../lib/tyreLifetime'
import { threeVehicles, refitSameVehicle } from './lifetimeFixtures.groupB'

const NOW = new Date(2025, 11, 15)
const retread = (rows) => rows.map((r) => ({ ...r, category: 'Retread', brand: 'R', size: '315/80' }))

describe('retread engine on physical casings', () => {
  it('one retread casing on three vehicles is ONE casing, priced once, km summed', () => {
    const { retreads, newTyres } = splitRecords(retread(threeVehicles()), NOW)
    const k = retreadKpis(retreads, newTyres)
    expect(k.totalRetreads).toBe(1)
    expect(k.retreadFitments).toBe(3)
    expect(k.retreadCpk).toBeCloseTo(900 / 80000, 10)
    expect(k.cpkKind).toBe(CPK_KIND.FLEET_AGGREGATE)
    const [b] = brandSummary(retreads)
    expect(b.count).toBe(1)
    expect(b.avgLife).toBe(80000)
    expect(b.avgCpk).toBeCloseTo(900 / 80000, 10)
    expect(bestSize(retreads)).toBe('315/80')
    // Every row carries the casing lifetime alongside its own per-fitment figure.
    expect(retreads.every((r) => r.casing_km_life === 80000)).toBe(true)
    expect(retreads[0].cpk_kind).toBe(CPK_KIND.PER_FITMENT)
  })

  it('a refit in the same cycle is not a second purchase; a new cycle is', () => {
    const { retreads } = splitRecords(retread(refitSameVehicle()), NOW)
    expect(retreadKpis(retreads, []).retreadCpk).toBeCloseTo(800 / 40000, 10)
    expect(retreads[1].cpk).toBeNull() // refit row: no new price, per-fitment CPK N/A
    // Same casing, cycle 2: its own purchase, its own casing-cycle.
    const cycles = splitRecords([
      ...retread(refitSameVehicle()).slice(0, 1),
      { ...retread(refitSameVehicle())[1], category: 'Retread x2' },
    ], NOW).retreads
    const k2 = retreadKpis(cycles, [])
    expect(k2.totalRetreads).toBe(2)
    expect(k2.retreadCpk).toBeCloseTo(1600 / 40000, 10)
    expect(cycleDistribution(cycles)).toEqual([{ cycle: '1', count: 1 }, { cycle: '2', count: 1 }])
  })

  it('new-tyre baseline CPK is weighted over physical tyres', () => {
    const { retreads, newTyres } = splitRecords([...retread(refitSameVehicle()), ...threeVehicles()], NOW)
    expect(retreadKpis(retreads, newTyres).newCpk).toBeCloseTo(900 / 80000, 10)
  })

  it('fitment events stay per row (monthly fitments, success rate)', () => {
    const { retreads } = splitRecords(retread(threeVehicles()), NOW)
    expect(monthlyFitments(retreads, NOW).reduce((s, m) => s + m.count, 0)).toBe(3)
    expect(successRate(retreads)).toBe(100)
  })
})
