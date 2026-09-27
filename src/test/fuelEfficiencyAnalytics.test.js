import { describe, it, expect } from 'vitest'
import {
  pressureDeviation, treadPenalty, tyreFuelPenalty, deriveMonthlyKm, baseMonthlyFuel,
  filterFuelRecords, fuelSites, enrichTyres, vehicleMetrics, siteMetrics, fuelKpis,
  complianceSavings, treadScatter, monthlyPenaltyTrend, environmentalImpact, fuelRecommendations,
} from '../lib/fuelEfficiencyAnalytics'

const NOW = Date.parse('2026-09-27T00:00:00Z')

const records = [
  { id: 1, asset_no: 'TM1', site: 'NHC', pressure_reading: 110, tread_depth: 10, issue_date: '2026-09-02', brand: 'Michelin' },
  { id: 2, asset_no: 'TM1', site: 'NHC', pressure_reading: 99, tread_depth: 3, issue_date: '2026-09-10' },
  { id: 3, asset_no: 'TM2', site: 'JED', pressure_reading: null, tread_depth: null, issue_date: '2026-08-01' },
  { id: 4, asset_no: 'TM2', site: 'JED', pressure_reading: null, tread_depth: 5.5, km_at_fitment: 1000, km_at_removal: 31000 },
  { id: 5, asset_no: null, site: 'JED', pressure_reading: 88 },
]

describe('fuelEfficiencyAnalytics', () => {
  it('pressure deviation is null without a reading and floored at zero', () => {
    expect(pressureDeviation(null)).toBeNull()
    expect(pressureDeviation(0)).toBeNull()
    expect(pressureDeviation(120)).toBe(0)
    expect(pressureDeviation(99)).toBeCloseTo(0.1)
  })

  it('tread penalty scales between worn and new, null when unmeasured', () => {
    expect(treadPenalty(null)).toBeNull()
    expect(treadPenalty(2)).toBe(0.03)
    expect(treadPenalty(9)).toBe(0)
    expect(treadPenalty(5.5)).toBeCloseTo(0.015)
  })

  it('an unmeasured tyre has a null penalty, never zero', () => {
    expect(tyreFuelPenalty({}).penalty).toBeNull()
    expect(tyreFuelPenalty({}).measured).toBe(false)
    const p = tyreFuelPenalty({ pressure_reading: 99, tread_depth: 3 })
    expect(p.penalty).toBeCloseTo(0.02 + 0.03)
  })

  it('derives monthly km only from real removed-tyre readings', () => {
    expect(deriveMonthlyKm([{ km_at_fitment: 1, km_at_removal: null }])).toEqual({ km: null, samples: 0 })
    expect(deriveMonthlyKm(records)).toEqual({ km: 10000, samples: 1 })
    expect(baseMonthlyFuel(35, null)).toBeNull()
    expect(baseMonthlyFuel(35, 10000)).toBe(3500)
  })

  it('filters by site and search and lists sites', () => {
    expect(fuelSites(records)).toEqual(['JED', 'NHC'])
    expect(filterFuelRecords(records, { site: 'NHC' })).toHaveLength(2)
    expect(filterFuelRecords(records, { search: 'michelin' })).toHaveLength(1)
  })

  it('vehicle impact averages its measured tyres; cost needs a price', () => {
    const enriched = enrichTyres(records)
    const noPrice = vehicleMetrics(enriched, { consumptionL100: 35, monthlyKm: 10000 })
    const tm1 = noPrice.find((v) => v.asset_no === 'TM1')
    expect(tm1.measuredTyres).toBe(2)
    expect(tm1.penaltyPct).toBeCloseTo(2.5)
    expect(tm1.extraLitresMonth).toBeCloseTo(87.5)
    expect(tm1.extraCostMonth).toBeNull()
    expect(tm1.compliancePct).toBe(50)
    const priced = vehicleMetrics(enriched, { consumptionL100: 35, monthlyKm: 10000, pricePerL: 2 })
    expect(priced.find((v) => v.asset_no === 'TM1').extraCostMonth).toBeCloseTo(175)
    const tm2 = priced.find((v) => v.asset_no === 'TM2')
    expect(tm2.compliancePct).toBeNull()
    expect(tm2.measuredTyres).toBe(1)
  })

  it('site compliance comes from tyre readings, null when none', () => {
    const enriched = enrichTyres(records)
    const vs = vehicleMetrics(enriched, {})
    const sites = siteMetrics(enriched, vs)
    expect(sites.find((s) => s.site === 'NHC').compliancePct).toBe(50)
    expect(sites.find((s) => s.site === 'JED').compliancePct).toBe(0)
    const onlyUnread = siteMetrics(enrichTyres([{ asset_no: 'A', site: 'X' }]), [])
    expect(onlyUnread[0].compliancePct).toBeNull()
  })

  it('fleet KPIs are null without readings or inputs', () => {
    const empty = fuelKpis(enrichTyres([{ asset_no: 'A' }]), [], {})
    expect(empty.compliancePct).toBeNull()
    expect(empty.avgDevPct).toBeNull()
    expect(empty.rrScore).toBeNull()
    expect(empty.extraCostMonth).toBeNull()
    const enriched = enrichTyres(records)
    const k = fuelKpis(enriched, vehicleMetrics(enriched, { consumptionL100: 35, monthlyKm: 10000, pricePerL: 2 }), {})
    expect(k.pressureReadings).toBe(3)
    expect(k.compliancePct).toBeCloseTo(33.3)
    expect(k.wornTyres).toBe(1)
    expect(k.extraCostMonth).toBeGreaterThan(0)
  })

  it('compliance savings needs every input and never goes negative', () => {
    expect(complianceSavings(null, 95, { fleetSize: 10, consumptionL100: 35, monthlyKm: 10000 }).monthlyLitres).toBeNull()
    const s = complianceSavings(75, 95, { fleetSize: 10, consumptionL100: 35, monthlyKm: 10000 })
    expect(s.monthlyLitres).toBe(140)
    expect(s.monthlyCost).toBeNull()
    expect(complianceSavings(99, 95, { fleetSize: 10, consumptionL100: 35, monthlyKm: 10000, pricePerL: 2 }).monthlyCost).toBe(0)
  })

  it('scatter and monthly trend are honest about missing data', () => {
    const enriched = enrichTyres(records)
    const sc = treadScatter(enriched)
    expect(sc.points).toBe(3)
    expect(sc.trend).toHaveLength(4)
    const trend = monthlyPenaltyTrend(enriched, NOW)
    expect(trend).toHaveLength(12)
    expect(trend[11].key).toBe('2026-09')
    expect(trend[11].measured).toBe(2)
    expect(trend[10].count).toBe(1)
    expect(trend[10].avgPenaltyPct).toBeNull()
  })

  it('environment and recommendations only speak to measured data', () => {
    expect(environmentalImpact({ extraLitresMonth: null }, 35)).toBeNull()
    expect(environmentalImpact({ extraLitresMonth: 100, co2TonnesMonth: 0.27 }, 35).equivalentKm).toBe(286)
    const enriched = enrichTyres(records)
    const vs = vehicleMetrics(enriched, {})
    const recs = fuelRecommendations({ kpis: fuelKpis(enriched, vs, {}), sites: siteMetrics(enriched, vs) })
    expect(recs.map((r) => r.key)).toEqual(expect.arrayContaining(['worn', 'site']))
    for (const r of recs) expect(r.text).not.toMatch(/[‐-―]/)
    expect(fuelRecommendations({ kpis: null })).toEqual([])
  })
})
