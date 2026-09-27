import { describe, it, expect } from 'vitest'
import {
  computeLocalRedFlags, computeMisuseScore, computeFleetPolicyFlags, windowRecords,
  groupByAsset, sitesOf, anomaliesForAsset, buildVehicleRows, scopeVehicleRows,
  filterVehicleRows, summarizeVehicles, misuseBand, timelineRows,
} from '../lib/vehicleHistoryAnalytics'
import { ANOMALY_TYPES } from '../lib/anomalyEngine'

const rec = (o) => ({ id: Math.random().toString(36).slice(2), asset_no: 'TM1', ...o })

describe('vehicleHistoryAnalytics', () => {
  it('flags low km usage and non-sequential odometers', () => {
    const r1 = rec({ id: 'a', issue_date: '2026-01-01', km_at_fitment: 1000, km_at_removal: 1200 })
    const r2 = rec({ id: 'b', issue_date: '2026-02-01', km_at_fitment: 900, km_at_removal: 50000 })
    const flags = computeLocalRedFlags([r2, r1])
    expect(flags.map(f => f.type)).toEqual(['LOW_KM_USAGE', 'INCONSISTENT_KM'])
    expect(flags[1].record_ids).toEqual(['a', 'b'])
  })

  it('ignores records with missing km (no fabricated flags)', () => {
    expect(computeLocalRedFlags([rec({ issue_date: '2026-01-01', km_at_fitment: null, km_at_removal: 300 })])).toEqual([])
  })

  it('scores misuse and caps at 100', () => {
    expect(computeMisuseScore([], 0, 0, 0)).toBe(0)
    const a = [{ type: ANOMALY_TYPES.SERIAL_REUSE }, { type: ANOMALY_TYPES.DUPLICATE_ENTRY }, { type: 'X' }]
    expect(computeMisuseScore(a, 9, 10, 1)).toBe(100)
    expect(computeMisuseScore([], 6, 10, 24)).toBe(20)
  })

  it('raises budget and policy flags only with a fleet record', () => {
    const rows = [
      rec({ issue_date: '2026-03-02', cost_per_tyre: 800, qty: 2, km_at_fitment: 0, km_at_removal: 1000 }),
    ]
    expect(computeFleetPolicyFlags(rows, null)).toEqual([])
    const flags = computeFleetPolicyFlags(rows, { monthly_tyre_budget: 1000, expected_km_per_tyre: 10000 })
    expect(flags.map(f => f.type).sort()).toEqual(['BUDGET_BREACH', 'LOW_KM_VS_POLICY'])
  })

  it('windows by issue date and drops undated rows only when a range is set', () => {
    const rows = [rec({ issue_date: '2026-01-05' }), rec({ issue_date: '2026-03-05' }), rec({ issue_date: null })]
    expect(windowRecords(rows)).toHaveLength(3)
    expect(windowRecords(rows, '2026-02-01', '')).toHaveLength(1)
    expect(windowRecords(rows, '', '2026-01-31')).toHaveLength(1)
  })

  it('groups, lists sites and matches serial-reuse anomalies across assets', () => {
    const rows = [rec({ site: 'NHC' }), rec({ asset_no: 'TM2', site: 'JED' }), rec({ site: 'NHC' })]
    expect(Object.keys(groupByAsset(rows))).toEqual(['TM1', 'TM2'])
    expect(sitesOf(rows)).toEqual(['JED', 'NHC'])
    const an = [{ type: ANOMALY_TYPES.SERIAL_REUSE, assets: ['TM1', 'TM2'] }, { type: 'X', asset_no: 'TM2' }]
    expect(anomaliesForAsset(an, 'TM1')).toHaveLength(1)
    expect(anomaliesForAsset(an, 'TM2')).toHaveLength(2)
  })

  const metrics = [
    { assetNo: 'TM1', count: 4, highRiskCount: 0, spanMonths: 12, totalCost: 100, sites: ['NHC'], records: [], lastSeen: '2026-01-01' },
    { assetNo: 'TM2', count: 1, highRiskCount: 1, spanMonths: 0, totalCost: 50, sites: ['JED'], records: [], lastSeen: '2026-05-01' },
  ]

  it('builds rows with grid cost unless a range is active', () => {
    const grid = { map: new Map([['TM1', 999]]) }
    const rows = buildVehicleRows({ assetMetrics: metrics, gridByAsset: grid })
    expect(rows[0].totalCost).toBe(999)
    expect(rows[0].avgDays).toBe(90)
    expect(rows[1].avgDays).toBeNull()
    expect(buildVehicleRows({ assetMetrics: metrics, gridByAsset: grid, rangeActive: true })[0].totalCost).toBe(100)
  })

  it('scopes, filters and sorts rows', () => {
    const rows = buildVehicleRows({ assetMetrics: metrics, anomalies: [{ type: 'X', asset_no: 'TM2' }] })
    expect(scopeVehicleRows(rows, { search: 'tm2' }).map(r => r.assetNo)).toEqual(['TM2'])
    expect(scopeVehicleRows(rows, { site: 'NHC' }).map(r => r.assetNo)).toEqual(['TM1'])
    expect(filterVehicleRows(rows, { anomaly: 'has' }).map(r => r.assetNo)).toEqual(['TM2'])
    expect(filterVehicleRows(rows, { anomaly: 'clean' }).map(r => r.assetNo)).toEqual(['TM1'])
    expect(filterVehicleRows(rows, { sortBy: 'date' })[0].assetNo).toBe('TM2')
    expect(filterVehicleRows(rows, { sortBy: 'cost' })[0].assetNo).toBe('TM1')
  })

  it('summarises with grid total only for the unscoped fleet, N/A when nothing is costed', () => {
    const rows = buildVehicleRows({ assetMetrics: metrics })
    expect(summarizeVehicles(rows, { costTotal: 5000 })).toMatchObject({ vehicles: 2, totalCost: 5000, costBasis: 'grid' })
    expect(summarizeVehicles(rows, { costTotal: 5000, scopeActive: true }).totalCost).toBe(150)
    expect(summarizeVehicles([], {}).totalCost).toBeNull()
  })

  it('bands the misuse score', () => {
    expect(misuseBand(10).key).toBe('low')
    expect(misuseBand(60).key).toBe('elevated')
    expect(misuseBand(100).key).toBe('high')
    expect(misuseBand(null)).toBeNull()
  })

  it('builds timeline rows with honest nulls', () => {
    const rows = timelineRows([
      rec({ id: 'b', issue_date: '2026-02-01', cost_per_tyre: null }),
      rec({ id: 'a', issue_date: '2026-01-01', cost_per_tyre: 100, qty: 2, km_at_fitment: 10, km_at_removal: 60 }),
    ], new Set(['a']))
    expect(rows.map(r => r.id)).toEqual(['a', 'b'])
    expect(rows[0]).toMatchObject({ cost: 200, km_run: 50, flagged: true })
    expect(rows[1]).toMatchObject({ cost: null, km_run: null, flagged: false })
  })
})
