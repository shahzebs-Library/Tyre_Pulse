import { describe, it, expect } from 'vitest'
import {
  monthKeys, loadSince, consumptionRates, avgUnitCosts, computeUrgency, buildMatrix, filterMatrix,
  plannedQty, summarizeMatrix, consumptionBySize, trendForSize, allSizes, consumptionGrid,
  seasonalVariance, orderTotals, matrixExportRows, MATRIX_EXPORT_COLS, MATRIX_EXPORT_HEADERS,
} from '../lib/stockReplenishmentAnalytics'

const NOW = new Date(2026, 8, 26, 9, 0, 0) // local 26 Sep 2026

const TYRES = [
  { site: 'NHC', brand: 'A', size: '315', issue_date: '2026-09-20', cost_per_tyre: 1000, qty: 1 },
  { site: 'NHC', brand: 'A', size: '315', issue_date: '2026-09-01', cost_per_tyre: 1200, qty: 2 },
  { site: 'NHC', brand: 'A', size: '315', issue_date: '2026-08-15', cost_per_tyre: null },
  { site: 'JED', brand: 'B', size: '385', issue_date: '2026-07-10', cost_per_tyre: 900 },
  { site: 'JED', brand: 'B', size: '385', issue_date: '2026-04-01', cost_per_tyre: 900 }, // outside 90d
]
const STOCK = [
  { id: 1, site: 'NHC', brand: 'A', size: '315', quantity: 1, unit_cost: null, country: 'KSA' },
  { id: 2, site: 'JED', brand: 'B', size: '385', quantity: '12', unit_cost: 950, country: 'KSA' },
  { id: 3, site: 'RUH', brand: 'C', size: '295', quantity: 8, unit_cost: null, country: null },
  { id: 4, site: 'RUH', brand: 'C', size: '11R', quantity: 0, unit_cost: null, country: 'KSA' },
]

describe('windows', () => {
  it('builds local month keys and the load bound', () => {
    expect(monthKeys(NOW, 3)).toEqual(['2026-07', '2026-08', '2026-09'])
    expect(loadSince(NOW)).toBe('2026-03-27')
  })
})

describe('rates, costs, urgency', () => {
  const rates = consumptionRates(TYRES, NOW)
  it('counts qty over the trailing 90 days as a monthly rate', () => {
    expect(rates['NHC||A||315']).toBeCloseTo(4 / 3)
    expect(rates['JED||B||385']).toBeCloseTo(1 / 3)
  })
  it('weights the unit cost by quantity and skips unpriced rows', () => {
    const c = avgUnitCosts(TYRES)
    expect(c['A||315']).toBeCloseTo((1000 + 2400) / 3)
    expect(c['B||385']).toBe(900)
  })
  it('never invents cover for items with no usage', () => {
    expect(computeUrgency(null, 7, 8)).toBe('Idle')
    expect(computeUrgency(null, 7, 0)).toBe('Critical')
    expect(computeUrgency(0, 7)).toBe('Critical')
    expect(computeUrgency(20, 7)).toBe('Critical')
    expect(computeUrgency(45, 7)).toBe('Low')
    expect(computeUrgency(100, 7)).toBe('Normal')
    expect(computeUrgency(200, 7)).toBe('Overstocked')
    expect(computeUrgency(40, 45)).toBe('Critical')
  })
})

describe('matrix and KPIs', () => {
  const rows = buildMatrix(STOCK, consumptionRates(TYRES, NOW), avgUnitCosts(TYRES), 7)
  const by = Object.fromEntries(rows.map(r => [r.id, r]))
  it('enriches rows honestly', () => {
    expect(by[1].daysRemaining).toBe(23)
    expect(by[1].urgency).toBe('Critical')
    expect(by[1].suggestedQty).toBe(2)
    expect(by[1].unitCostSource).toBe('issues')
    expect(by[2].unitCost).toBe(950)
    expect(by[2].unitCostSource).toBe('stock')
    expect(by[3].daysRemaining).toBeNull()
    expect(by[3].urgency).toBe('Idle')
    expect(by[3].unitCost).toBeNull()
    expect(by[3].estimatedCost).toBeNull()
    expect(by[4].daysRemaining).toBe(0)
  })
  it('filters without dropping null-country rows', () => {
    expect(filterMatrix(rows, { activeCountry: 'KSA' })).toHaveLength(4)
    expect(filterMatrix(rows, { activeCountry: 'UAE' }).map(r => r.id)).toEqual([3])
    expect(filterMatrix(rows, { urgency: 'Idle' }).map(r => r.id)).toEqual([3])
    expect(filterMatrix(rows, { search: '385' }).map(r => r.id)).toEqual([2])
  })
  it('summarises with overrides and never fabricates a value', () => {
    const k = summarizeMatrix(rows, { [by[1]._key]: 5 })
    expect(plannedQty(by[1], { [by[1]._key]: 5 })).toBe(5)
    expect(k.needsReorder).toBe(2)
    expect(k.stockouts).toBe(1)
    expect(k.idle).toBe(1)
    expect(k.reorderValue).toBeCloseTo(5 * (3400 / 3))
    expect(summarizeMatrix([]).avgDays).toBeNull()
    expect(summarizeMatrix([]).reorderValue).toBe(0)
    const unvalued = summarizeMatrix([{ ...by[3], suggestedQty: 3, unitCost: null }])
    expect(unvalued.reorderValue).toBeNull()
    expect(unvalued.unvaluedLines).toBe(1)
  })
  it('exports with N/A when money is withheld', () => {
    const out = matrixExportRows(rows, {}, false)
    expect(MATRIX_EXPORT_COLS).toHaveLength(MATRIX_EXPORT_HEADERS.length)
    expect(out.every(r => r.est_cost === 'N/A')).toBe(true)
    expect(matrixExportRows(rows, {}, true).find(r => r.site === 'RUH' && r.size === '295').days_left).toBe('N/A')
  })
})

describe('consumption analysis', () => {
  it('ranks sizes and counts per month', () => {
    const s = consumptionBySize(TYRES, NOW, 6, 5)
    expect(s.months).toHaveLength(6)
    expect(s.series[0].size).toBe('315')
    expect(s.series[0].data.slice(-2)).toEqual([1, 3])
    expect(trendForSize(TYRES, '385', NOW, 6).data.reduce((a, b) => a + b, 0)).toBe(2)
    expect(allSizes(TYRES)).toEqual(['315', '385'])
  })
  it('builds a 30 day size by site grid', () => {
    const g = consumptionGrid(TYRES, NOW, 30)
    expect(g.sites).toEqual(['NHC'])
    expect(g.rows).toEqual([{ size: '315', total: 3, NHC: 3 }])
  })
  it('seasonal variance is null without volume', () => {
    expect(seasonalVariance([], NOW)).toBeNull()
    expect(seasonalVariance(TYRES, NOW)).toBeGreaterThan(20)
  })
})

describe('order totals', () => {
  it('counts gaps that block a clean PO', () => {
    const t = orderTotals([
      { qty: 2, unitCost: 100, totalCost: 200, site: 'NHC', supplier: 'X' },
      { qty: '3', unitCost: 0, totalCost: 0, site: '', supplier: ' ' },
    ])
    expect(t).toEqual({ lines: 2, units: 5, total: 200, sites: 1, unpriced: 1, missingSupplier: 1 })
  })
})
