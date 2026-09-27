import { describe, it, expect } from 'vitest'
import {
  enrichAssets, sortAssets, typeCounts, siteRiskBreakdown, summarizeByType,
  healthBand, healthBands, healthMatrix, lowHealthAssets,
} from '../lib/assetManagementAnalytics'

const NOW = new Date('2026-09-27T00:00:00Z')
const assets = [
  { asset_no: 'TM1', vehicle_type: 'Mixer', site: 'NHC', active: true, year: 2020 },
  { asset_no: 'TM2', vehicle_type: 'Mixer', site: 'JED', active: true, year: null },
  { asset_no: 'PL1', vehicle_type: null, site: 'NHC', active: false, year: 2018 },
]
const overview = [
  { asset_no: 'TM1', worst_risk: 'High', ytd_cost: '1000', health_score: 45, latest_date: '2026-09-20', active_tyres: 10, total_tyres: 12 },
  { asset_no: 'PL1', worst_risk: 'Low', ytd_cost: 0, health_score: 90, latest_date: '2026-01-01' },
]

describe('enrichAssets', () => {
  const rows = enrichAssets(assets, overview, { now: NOW })
  it('carries honest nulls for assets with no tyre data', () => {
    const tm2 = rows.find((r) => r.asset_no === 'TM2')
    expect(tm2._hasTyreData).toBe(false)
    expect(tm2._healthScore).toBeNull()
    expect(tm2._noRecentRecord).toBe(true)
  })
  it('flags no recent record over 60 days', () => {
    expect(rows.find((r) => r.asset_no === 'TM1')._noRecentRecord).toBe(false)
    expect(rows.find((r) => r.asset_no === 'PL1')._noRecentRecord).toBe(true)
  })
})

describe('sortAssets', () => {
  const rows = enrichAssets(assets, overview, { now: NOW })
  it('puts blanks last in both directions', () => {
    expect(sortAssets(rows, 'year', 'asc').map((r) => r.asset_no)).toEqual(['PL1', 'TM1', 'TM2'])
    expect(sortAssets(rows, 'year', 'desc').map((r) => r.asset_no)).toEqual(['TM1', 'PL1', 'TM2'])
    expect(sortAssets(rows, '_healthScore', 'asc').at(-1).asset_no).toBe('TM2')
  })
  it('sorts risk by severity', () => {
    expect(sortAssets(rows, '_worstRisk', 'desc')[0].asset_no).toBe('TM1')
  })
})

describe('breakdowns', () => {
  const rows = enrichAssets(assets, overview, { now: NOW })
  it('type counts + site risk', () => {
    expect(typeCounts(rows)[0]).toEqual({ label: 'Mixer', count: 2 })
    const b = siteRiskBreakdown(rows)
    expect(b.sites).toEqual(['JED', 'NHC'])
    expect(b.series.High).toEqual([0, 1])
  })
  it('by-type averages rest on measured assets only', () => {
    const mixer = summarizeByType(rows).find((r) => r.type === 'Mixer')
    expect(mixer.avgHealth).toBe(45)
    expect(mixer.scored).toBe(1)
    expect(mixer.avgCost).toBe(1000)
    const unknown = summarizeByType([{ asset_no: 'X', vehicle_type: 'Van', _hasTyreData: false, _healthScore: null }])[0]
    expect(unknown.avgHealth).toBeNull()
    expect(unknown.avgCost).toBeNull()
  })
  it('health bands and lists', () => {
    expect(healthBand(null)).toBe('none')
    expect(healthBand(85)).toBe('good')
    expect(healthBands(rows)).toMatchObject({ poor: 1, none: 1 })
    expect(healthMatrix(rows).map((r) => r.asset_no)).toEqual(['TM1', 'TM2'])
    expect(lowHealthAssets(rows).map((r) => r.asset_no)).toEqual(['TM1'])
  })
})
