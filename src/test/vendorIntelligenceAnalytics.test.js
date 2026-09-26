import { describe, it, expect } from 'vitest'
import {
  filterVendorRecords, uniqueSites, rankByScore, enrichVendors, actionsBySite,
  measuredKm, buildExecSummary, buildRecommendations, vendorKpis, radarSeries,
} from '../lib/vendorIntelligenceAnalytics'

const REC = [
  { site: 'NHC', position: 'LHF1', km_at_fitment: 0, km_at_removal: 10000, cost_per_tyre: 1000 },
  { site: 'NHC', position: 'RHRI', km_at_fitment: 5000, km_at_removal: 3000, cost_per_tyre: null },
  { site: 'JED', position: 'LHF2', km_at_fitment: null, km_at_removal: 9000 },
]
const pos = (p) => (String(p).includes('F') ? 'Steer' : 'Drive')

describe('vendorIntelligenceAnalytics', () => {
  it('filters by site and position group, and lists sites', () => {
    expect(filterVendorRecords(REC, { site: 'NHC' }, pos)).toHaveLength(2)
    expect(filterVendorRecords(REC, { position: 'Steer' }, pos)).toHaveLength(2)
    expect(filterVendorRecords(REC, {}, pos)).toHaveLength(3)
    expect(uniqueSites([...REC, { site: '' }])).toEqual(['JED', 'NHC'])
  })

  it('ranks above the volume floor and scales display score to the best', () => {
    const r = rankByScore([{ brand: 'A', count: 10, score: 80 }, { brand: 'B', count: 2, score: 90 }, { brand: 'C', count: 5, score: 40 }], 3)
    expect(r.map((v) => v.brand)).toEqual(['A', 'C'])
    expect(r[0]).toMatchObject({ rank: 1, displayScore: 100 })
    expect(r[1].displayScore).toBe(50)
    expect(rankByScore([{ site: 'X', recordCount: 4, score: 0 }], 1, 'recordCount')[0].displayScore).toBe(0)
  })

  it('enriches with CPK spread and life, null when unknown', () => {
    const [v] = enrichVendors([{ brand: 'A' }], [{ brand: 'A', medianCpk: 0.5, minCpk: 0.1, maxCpk: 1 }], { byBrand: [] })
    expect(v).toMatchObject({ medianCpk: 0.5, minCpk: 0.1, maxCpk: 1, avgLifeKm: null })
  })

  it('counts actions per site and measures only forward km runs', () => {
    expect(actionsBySite([{ site: 'A' }, { site: 'A' }, { site: null }]).get('A')).toBe(2)
    expect(measuredKm(REC)).toBe(10000)
  })

  it('never sums cost_per_tyre for the fleet total and returns null saving when unmeasurable', () => {
    const vendors = [{ brand: 'A', count: 12, avgCpk: 0.5 }, { brand: 'B', count: 12, avgCpk: 1.5 }, { brand: 'C', count: 12, avgCpk: null }]
    const ex = buildExecSummary({ vendors, workshops: [], records: REC, fleetTyreCost: null })
    expect(ex.fleetTyreCost).toBeNull()
    expect(ex.bestBrand.brand).toBe('A')
    expect(ex.worstBrand.brand).toBe('B')
    expect(ex.estAnnualSaving).toBe(10000)
    expect(ex.pricedRecords).toBe(1)
    const noKm = buildExecSummary({ vendors, records: [], fleetTyreCost: 5000 })
    expect(noKm.estAnnualSaving).toBeNull()
    expect(noKm.fleetTyreCost).toBe(5000)
    const none = buildExecSummary({ vendors: [{ brand: 'Z', count: 3, avgCpk: null }] })
    expect(none.bestBrand).toBeNull()
    expect(none.worstBrand).toBeNull()
  })

  it('emits recommendation descriptors with raw vars', () => {
    const recs = buildRecommendations(
      [{ brand: 'A', count: 9, avgCpk: 0.8, failureRate: 0.3, scrapRate: 0.3, avgLifeKm: 90000 }, { brand: 'C', count: 1, avgCpk: 1 }, { brand: 'B', count: 9, avgCpk: 2.5, avgLifeKm: 1 }],
      [{ site: 'S', highRiskPct: 40, actionCloseRate: 0, recordCount: 9 }],
    )
    const keys = recs.map((r) => r.key)
    expect(keys).toEqual(expect.arrayContaining(['highestCpk', 'bestValue', 'highFailure', 'highScrap', 'worstSiteRisk', 'zeroCloseRate', 'longestLife']))
    expect(recs.find((r) => r.key === 'highestCpk').vars.cpk).toBe(2.5)
    expect(buildRecommendations([], [])).toEqual([])
  })

  it('computes KPI values with a validCount-weighted CPK, null when none', () => {
    const k = vendorKpis({ records: REC, vendors: [{ avgCpk: 1, validCount: 1 }, { avgCpk: 2, validCount: 3 }], workshops: [{}], exec: { fleetTyreCost: null, estAnnualSaving: null } })
    expect(k.weightedCpk).toBeCloseTo(1.75)
    expect(k.fleetTyreCost).toBeNull()
    expect(vendorKpis({ vendors: [{ avgCpk: null }] }).weightedCpk).toBeNull()
  })

  it('shapes radar axes on a 0-100 scale for up to five brands', () => {
    const r = radarSeries([{ brand: 'A', avgCpk: 1, failureRate: 0.1, avgLifeKm: 100, scrapRate: 0, count: 10 }, { brand: 'B', avgCpk: 2, avgLifeKm: 50, count: 5 }])
    expect(r).toHaveLength(2)
    expect(r[0].values.every((x) => x >= 0 && x <= 100)).toBe(true)
    expect(r[1].values[0]).toBe(0)
    expect(radarSeries([])).toEqual([])
  })
})
