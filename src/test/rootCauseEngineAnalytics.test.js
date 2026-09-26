import { describe, it, expect } from 'vitest'
import {
  ROOT_CAUSES, classifyRootCauses, presetCutoff, resolveCurrency, filterRecords, classifyAll,
  computeCauseStats, sortCauses, summarize, buildHeatmap, heatBand, deepDive, worstVehicles,
  cpkOf, lineCost, kmLife, recordExportRows, causeSummaryRows, pct,
} from '../lib/rootCauseEngineAnalytics'

const NOW = new Date('2026-09-26T12:00:00Z')

const REC = [
  { id: 1, asset_no: 'TM1', site: 'NHC', country: 'KSA', brand: 'A', findings: 'low pressure flat', risk_level: 'Critical', cost_per_tyre: 1000, km_at_fitment: 0, km_at_removal: 50000, issue_date: '2026-09-20' },
  { id: 2, asset_no: 'TM1', site: 'NHC', country: 'KSA', brand: 'A', findings: 'nail puncture', risk_level: 'High', cost_per_tyre: 800, qty: 2, km_at_fitment: 1000, km_at_removal: 21000, issue_date: '2026-08-01' },
  { id: 3, asset_no: 'TM2', site: 'JED', country: 'KSA', brand: 'B', findings: 'all good', risk_level: 'Low', cost_per_tyre: null, issue_date: '2025-01-01' },
  { id: 4, asset_no: 'TM3', site: 'JED', country: 'KSA', brand: 'B', findings: 'sidewall bulge warranty', risk_level: 'Medium', cost_per_tyre: '', issue_date: null },
]

describe('classification', () => {
  it('matches pressure, road and defect rules', () => {
    expect(classifyRootCauses(REC[0])).toContain('Under Inflation')
    expect(classifyRootCauses(REC[1])).toContain('Road Conditions')
    expect(classifyRootCauses(REC[2])).toEqual([])
    expect(classifyRootCauses(REC[3])).toContain('Manufacturing Defects')
  })
  it('uses numeric pressure readings', () => {
    expect(classifyRootCauses({ pressure_reading: '140' })).toContain('Over Inflation')
    expect(classifyRootCauses({ pressure_reading: '60' })).toContain('Under Inflation')
    expect(classifyRootCauses({ pressure_reading: '' })).toEqual([])
  })
  it('keeps a stable catalogue of 14 causes', () => {
    expect(ROOT_CAUSES).toHaveLength(14)
  })
})

describe('scope helpers', () => {
  it('computes preset cutoffs from an injected clock', () => {
    expect(presetCutoff('Last 30d', NOW)).toBe('2026-08-27')
    expect(presetCutoff('All Time', NOW)).toBeNull()
    expect(presetCutoff('nope', NOW)).toBeNull()
  })
  it('never defaults a currency and refuses to blend countries', () => {
    expect(resolveCurrency(REC, 'KSA', 'SAR')).toBe('SAR')
    expect(resolveCurrency([], 'UAE', null)).toBe('AED')
    expect(resolveCurrency(REC, 'All', 'SAR')).toBe('SAR')
    expect(resolveCurrency([...REC, { country: 'UAE' }], 'All', 'SAR')).toBeNull()
    expect(resolveCurrency([{ country: 'Mars' }], 'All', 'SAR')).toBeNull()
    expect(resolveCurrency([], 'All', 'SAR')).toBeNull()
    expect(resolveCurrency([], 'Atlantis', null)).toBeNull()
  })
  it('filters by date, site, risk and search while keeping undated rows', () => {
    expect(filterRecords(REC, { cutoff: '2026-01-01' }).map(r => r.id)).toEqual([1, 2, 4])
    expect(filterRecords(REC, { site: 'JED' }).map(r => r.id)).toEqual([3, 4])
    expect(filterRecords(REC, { risk: 'High' }).map(r => r.id)).toEqual([2])
    expect(filterRecords(REC, { search: 'bulge' }).map(r => r.id)).toEqual([4])
  })
})

describe('aggregates', () => {
  const classified = classifyAll(REC)
  const stats = computeCauseStats(classified)
  const sorted = sortCauses(stats, 1)

  it('reads line cost with qty and km life honestly', () => {
    expect(lineCost(REC[1])).toBe(1600)
    expect(lineCost(REC[2])).toBeNull()
    expect(kmLife(REC[0])).toBe(50000)
    expect(kmLife(REC[2])).toBeNull()
  })
  it('returns null cost for a cause with no priced record', () => {
    expect(stats['Manufacturing Defects'].count).toBe(1)
    expect(stats['Manufacturing Defects'].totalCost).toBeNull()
    expect(stats['Under Inflation'].totalCost).toBe(1000)
  })
  it('computes CPK only over priced records with a km life', () => {
    expect(cpkOf([REC[0], REC[1]])).toBeCloseTo(2600 / 70000)
    expect(cpkOf([REC[2], REC[3]])).toBeNull()
  })
  it('summarises coverage and returns N/A on empty input', () => {
    const s = summarize(classified, sorted)
    expect(s.total).toBe(4)
    expect(s.classified).toBe(3)
    expect(s.unclassified).toBe(1)
    expect(s.coveragePct).toBe(75)
    expect(s.critical).toBe(1)
    const empty = summarize([], [])
    expect(empty.coveragePct).toBeNull()
    expect(empty.classifiedCost).toBeNull()
    expect(empty.avgCausesPerRecord).toBeNull()
  })
  it('sorts causes by count and applies the threshold', () => {
    expect(sorted.every((c, i, a) => i === 0 || a[i - 1].count >= c.count)).toBe(true)
    expect(sortCauses(stats, 50)).toEqual([])
  })
  it('builds a heat map that drops sites with no match', () => {
    const h = buildHeatmap(classified, sorted, 8)
    expect(h.rows.map(r => r.site).sort()).toEqual(['JED', 'NHC'])
    expect(h.maxVal).toBeGreaterThan(0)
    expect(heatBand(0, 5)).toBe(0)
    expect(heatBand(5, 5)).toBe(4)
    expect(heatBand(1, 10)).toBe(1)
  })
  it('deep dive and worst vehicles', () => {
    const d = deepDive(stats['Road Conditions'], REC.length)
    expect(d.count).toBe(1)
    expect(d.pct).toBe(25)
    expect(d.topAssets[0]).toEqual({ name: 'TM1', count: 1 })
    expect(deepDive(undefined, 0).pct).toBeNull()
    const w = worstVehicles(classified, 15)
    expect(w[0].asset_no).toBe('TM1')
    expect(w[0].records).toBe(2)
    expect(w.find(v => v.asset_no === 'TM3').totalCost).toBeNull()
  })
  it('export rows never fabricate a cost', () => {
    const rows = recordExportRows(classified)
    expect(rows.find(r => r.asset_no === 'TM2').root_causes).toBe('Unclassified')
    expect(rows.find(r => r.asset_no === 'TM2').cost).toBe('')
    const sum = causeSummaryRows(sorted, 4)
    expect(sum.find(r => r.cause === 'Manufacturing Defects').total_cost).toBe('N/A')
    expect(pct(1, 0)).toBeNull()
  })
})
