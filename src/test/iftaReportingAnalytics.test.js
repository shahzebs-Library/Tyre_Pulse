import { describe, it, expect } from 'vitest'
import {
  filterIftaRecords, recordGaps, costByCurrency, quarterRollup, jurisdictionTax, iftaKpis,
} from '../lib/iftaReportingAnalytics'

const rows = [
  { id: 1, asset_no: 'T1', jurisdiction: 'TX', quarter: '2026-Q1', distance_km: 1000, fuel_litres: 250, fuel_cost: 300, currency: 'usd', tax_rate: 0.2, taxable_km: 1000 },
  { id: 2, asset_no: 'T1', jurisdiction: 'OK', quarter: '2026-Q1', distance_km: 1000, fuel_litres: 250, fuel_cost: 400, currency: 'CAD', tax_rate: 0.1, taxable_km: 1000 },
  { id: 3, asset_no: 'T2', jurisdiction: 'TX', quarter: '2026-Q2', distance_km: 500, fuel_litres: 100, fuel_cost: 120, currency: 'USD', tax_rate: 0.25, taxable_km: 500 },
  { id: 4, asset_no: 'T3', jurisdiction: '', quarter: '', distance_km: null, fuel_litres: null, fuel_cost: 50, currency: '' },
]

describe('iftaReportingAnalytics', () => {
  it('filters', () => {
    expect(filterIftaRecords(rows, { jurisdiction: 'TX' })).toHaveLength(2)
    expect(filterIftaRecords(rows, { quarter: '2026-Q1' })).toHaveLength(2)
    expect(filterIftaRecords(rows, { incompleteOnly: true }).map((r) => r.id)).toEqual([4])
  })

  it('names filing gaps', () => {
    expect(recordGaps(rows[0])).toEqual([])
    expect(recordGaps(rows[3])).toEqual(['jurisdiction', 'quarter', 'distance', 'fuel', 'currency'])
  })

  it('never blends currencies', () => {
    const c = costByCurrency(rows)
    expect(c.map((x) => x.currency).sort()).toEqual(['CAD', 'USD', 'Unspecified'])
    expect(c.find((x) => x.currency === 'USD').cost).toBe(420)
    expect(iftaKpis(rows).singleCurrencyCost).toBeNull()
    expect(iftaKpis([rows[0]]).singleCurrencyCost.cost).toBe(300)
  })

  it('rolls up quarters oldest first with Unspecified last', () => {
    expect(quarterRollup(rows).map((q) => q.quarter)).toEqual(['2026-Q1', '2026-Q2', 'Unspecified'])
  })

  it('computes IFTA net tax and refuses on a rate conflict', () => {
    const j = jurisdictionTax(rows)
    const ok = j.find((x) => x.jurisdiction === 'OK')
    // fleet km/L = 2500 / 600; taxable fuel = 1000 / (2500/600) = 240 L; (240 - 250) * 0.1 = -1
    expect(ok.netTax).toBeCloseTo(-1, 2)
    expect(ok.position).toBe('credit')
    const tx = j.find((x) => x.jurisdiction === 'TX')
    expect(tx.rateConflict).toBe(true)
    expect(tx.netTax).toBeNull()
  })

  it('kpis are null on empty input', () => {
    const k = iftaKpis([])
    expect(k.avgKmPerL).toBeNull()
    expect(k.completeness).toBeNull()
  })
})
