import { describe, it, expect } from 'vitest'
import {
  filterScenarios, enrichScenarios, moneyByCurrency, utilisationBands, recommendationMatrix,
  buildOptimizerKpis, buildOptimizerInsights, optimizerExportRows, isMismatch, recLabel,
} from '../lib/fleetOptimizerAnalytics'

const ROWS = [
  { id: 1, asset_no: 'A1', utilization_pct: 20, age_years: 9, recommendation: 'dispose', projected_saving: 1000, currency: 'SAR', annual_cost: 5000, annual_km: 1000 },
  { id: 2, asset_no: 'A2', utilization_pct: 90, age_years: 2, recommendation: 'replace', projected_saving: 500, currency: 'SAR' },
  { id: 3, asset_no: 'A3', utilization_pct: 35, age_years: 3, recommendation: 'redeploy', confidence: 'high' },
  { id: 4, asset_no: 'A4' },
]

describe('fleetOptimizerAnalytics', () => {
  it('flags recorded decisions that disagree with the model', () => {
    expect(isMismatch(ROWS[0])).toBe(false)
    expect(isMismatch(ROWS[1])).toBe(true)
    expect(isMismatch(ROWS[3])).toBe(false)
    expect(filterScenarios(ROWS, { mismatchOnly: true }).map((r) => r.id)).toEqual([2])
  })

  it('filters by band, confidence and search', () => {
    expect(filterScenarios(ROWS, { band: 'idle' }).map((r) => r.id)).toEqual([1, 3])
    expect(filterScenarios(ROWS, { band: 'unknown' }).map((r) => r.id)).toEqual([4])
    expect(filterScenarios(ROWS, { confidence: 'high' }).map((r) => r.id)).toEqual([3])
    expect(filterScenarios(ROWS, { search: 'a2' }).map((r) => r.id)).toEqual([2])
  })

  it('keeps average utilisation null when nothing records it', () => {
    expect(buildOptimizerKpis([{ asset_no: 'X' }]).avgUtilization).toBeNull()
    const k = buildOptimizerKpis(ROWS, 'SAR')
    expect(k.avgUtilization).toBeCloseTo(145 / 3)
    expect(k.counts).toMatchObject({ dispose: 1, replace: 1, redeploy: 1, review: 1 })
    expect(k.idle).toBe(2)
    expect(k.mismatches).toBe(1)
  })

  it('never totals savings across currencies', () => {
    expect(moneyByCurrency(ROWS, 'projected_saving', 'SAR').total).toBe(1500)
    const mixed = moneyByCurrency([...ROWS, { projected_saving: 10, currency: 'AED' }], 'projected_saving', 'SAR')
    expect(mixed.total).toBeNull()
    expect(mixed.mixed).toBe(true)
  })

  it('bands utilisation and compares recorded vs suggested', () => {
    const b = utilisationBands(ROWS)
    expect(b.unknown).toBe(1)
    expect(b.bands.find((x) => x.key === 'idle').count).toBe(2)
    const m = recommendationMatrix(ROWS)
    expect(m.find((x) => x.key === 'review')).toMatchObject({ recorded: 1, suggested: 1 })
  })

  it('enriches and exports with cost per km and labels', () => {
    const e = enrichScenarios(ROWS, 'SAR')
    expect(e[0].cpk).toBe(5)
    expect(e[2].cur).toBe('SAR')
    const x = optimizerExportRows(ROWS, 'SAR')
    expect(x[0]).toMatchObject({ cost_per_km: 5, recommendation: 'Dispose', suggested: 'Dispose' })
    expect(x[3]).toMatchObject({ utilization_pct: '', projected_saving: '', suggested: 'Review' })
    expect(recLabel('keep')).toBe('Keep')
    expect(buildOptimizerInsights(ROWS, 'SAR').length).toBeGreaterThan(0)
    expect(buildOptimizerInsights([])).toEqual([])
  })
})
