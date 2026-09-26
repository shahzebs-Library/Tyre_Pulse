import { describe, it, expect } from 'vitest'
import {
  fmtCurrency, fmtNum, fmtPct, fmtRatio, fmtCpk, withUnit,
  statusLabel, cpkStatus, pctStatus, lowerIsBetter, higherIsBetter,
  periodBounds, siteOptions, filterBySite, ALL_SITES,
  classifyRootCause, computeRootCauses, topCostVehicles, costByDimension,
  periodBudget, projectAnnual, monthOverMonth, savingsOpportunity,
  riskCounts, riskScore, riskBand, buildRiskMatrix, topHighRisk, riskTrend,
  honestKpis, kpiExportRows, actionPhaseOf,
} from '../lib/executiveReportAnalytics'

const rec = (o) => ({ cost_per_tyre: 100, qty: 1, ...o })

describe('formatters are honest about unknowns', () => {
  it('renders N/A for null / NaN instead of a fabricated zero', () => {
    expect(fmtCurrency(null, 'SAR')).toBe('N/A')
    expect(fmtCurrency(0, 'SAR')).toBe('SAR 0')
    expect(fmtCurrency(1234.6, 'SAR')).toBe('SAR 1,235')
    expect(fmtNum(null)).toBe('N/A')
    expect(fmtNum(12345.678, 1)).toBe('12,345.7')
    expect(fmtPct(undefined)).toBe('N/A')
    expect(fmtPct(12.345)).toBe('12.3%')
    expect(fmtRatio(0.25)).toBe('25.0%')
    expect(fmtRatio(null)).toBe('N/A')
  })
  it('treats a zero or missing CPK as not measured', () => {
    expect(fmtCpk(0, 'SAR')).toBe('N/A')
    expect(fmtCpk(null, 'SAR')).toBe('N/A')
    expect(fmtCpk(0.01234, 'SAR')).toBe('SAR 0.0123')
    expect(cpkStatus(0)).toBe('neutral')
    expect(cpkStatus(0.004)).toBe('green')
    expect(cpkStatus(0.02)).toBe('red')
  })
  it('never leaves a dangling unit on N/A', () => {
    expect(withUnit('N/A', 'km')).toBe('N/A')
    expect(withUnit('5', 'km')).toBe('5 km')
  })
})

describe('status helpers', () => {
  it('always carries a text label so colour is not the only signal', () => {
    expect(statusLabel('green')).toBe('On target')
    expect(statusLabel('red')).toBe('Off target')
    expect(statusLabel(undefined)).toBe('Not measured')
  })
  it('an unknown value is neutral, never green or red', () => {
    expect(pctStatus(null)).toBe('neutral')
    expect(lowerIsBetter(null, 0.1, 0.2)).toBe('neutral')
    expect(higherIsBetter(0, 60000, 40000)).toBe('neutral')
    expect(pctStatus(90)).toBe('green')
    expect(lowerIsBetter(0.3, 0.1, 0.25)).toBe('red')
    expect(higherIsBetter(50000, 60000, 40000)).toBe('amber')
  })
})

describe('periodBounds', () => {
  it('maps year and custom windows to inclusive-exclusive bounds', () => {
    expect(periodBounds({ mode: 'all' })).toBeNull()
    expect(periodBounds({ mode: 'year', year: 2025 })).toEqual({ from: '2025-01-01', toExclusive: '2026-01-01' })
    expect(periodBounds({ mode: 'custom', from: '2025-03-01', to: '2025-03-31' }))
      .toEqual({ from: '2025-03-01', toExclusive: '2025-04-01' })
    expect(periodBounds({ mode: 'custom' })).toBeNull()
  })
})

describe('site scoping', () => {
  it('lists distinct sites and filters to one', () => {
    const rows = [{ site: 'NHC' }, { site: ' JED ' }, { site: 'NHC' }, { site: null }]
    expect(siteOptions(rows, [{ site: 'AMAALA' }])).toEqual(['AMAALA', 'JED', 'NHC'])
    expect(filterBySite(rows, ALL_SITES)).toHaveLength(4)
    expect(filterBySite(rows, 'NHC')).toHaveLength(2)
    expect(filterBySite(rows, 'JED')).toHaveLength(1)
  })
})

describe('root causes', () => {
  it('classifies by keyword and ranks by frequency', () => {
    expect(classifyRootCause({ findings: 'Under-inflation damage' })).toBe('inflation')
    expect(classifyRootCause({ findings: 'nothing notable' })).toBe('other')
    const out = computeRootCauses([
      rec({ findings: 'low pressure' }), rec({ findings: 'pressure loss' }), rec({ findings: 'sidewall defect' }),
    ])
    expect(out[0].key).toBe('inflation')
    expect(out[0].count).toBe(2)
    expect(Math.round(out[0].pct)).toBe(67)
    expect(out[0].cost).toBe(200)
  })
})

describe('cost breakdowns', () => {
  const rows = [
    rec({ asset_no: 'TM1', site: 'NHC', brand: 'A', cost_per_tyre: 500 }),
    rec({ asset_no: 'TM1', site: 'NHC', brand: 'B', cost_per_tyre: 300 }),
    rec({ asset_no: 'TM2', site: 'JED', brand: 'A', cost_per_tyre: 100, qty: 2 }),
  ]
  it('ranks vehicles by cost', () => {
    const top = topCostVehicles(rows, 5)
    expect(top[0]).toMatchObject({ asset_no: 'TM1', cost: 800, count: 2 })
    expect(top[1]).toMatchObject({ asset_no: 'TM2', cost: 200 })
  })
  it('groups cost by a dimension', () => {
    expect(costByDimension(rows, 'brand')).toEqual([{ brand: 'A', cost: 700 }, { brand: 'B', cost: 300 }])
  })
  it('returns null budget / projection when there is nothing to base them on', () => {
    expect(periodBudget([{ monthly_tyre_budget: 0 }], rows)).toBeNull()
    expect(periodBudget([{ monthly_tyre_budget: 1000 }], [])).toBe(1000)
    expect(projectAnnual(0)).toBeNull()
    expect(projectAnnual(100)).toBe(1200)
  })
  it('month over month needs two months and a non-zero base', () => {
    expect(monthOverMonth([{ totalCost: 100 }])).toBeNull()
    expect(monthOverMonth([{ totalCost: 0 }, { totalCost: 50 }])).toBeNull()
    expect(monthOverMonth([{ totalCost: 100 }, { totalCost: 150 }])).toBe(50)
  })
  it('savings is null without a CPK spread or distance', () => {
    expect(savingsOpportunity({ fleetAvgCpk: null, p10Cpk: null }, rows)).toBeNull()
    expect(savingsOpportunity({ fleetAvgCpk: 0.02, p10Cpk: 0.01 }, rows)).toBeNull()
    const withKm = [rec({ km_at_fitment: 0, km_at_removal: 10000, issue_date: '2025-01-01' })]
    expect(savingsOpportunity({ fleetAvgCpk: 0.02, p10Cpk: 0.01 }, withKm)).toBeGreaterThan(0)
  })
})

describe('risk over rated rows only', () => {
  const rows = [
    { site: 'NHC', risk_level: 'Critical' }, { site: 'NHC', risk_level: 'Low' },
    { site: 'NHC', risk_level: null }, { site: 'JED', risk_level: null },
  ]
  it('counts rated and unrated separately', () => {
    expect(riskCounts(rows)).toMatchObject({ Critical: 1, Low: 1, rated: 2, unrated: 2 })
  })
  it('scores over rated rows and is null when nothing is rated', () => {
    expect(riskScore(rows)).toBe(2.5)
    expect(riskScore([{ risk_level: null }])).toBeNull()
    expect(riskBand(null)).toEqual({ key: 'neutral', label: 'Not rated' })
    expect(riskBand(3.2).key).toBe('red')
  })
  it('builds a matrix with unrated sites last and a null score', () => {
    const m = buildRiskMatrix(rows)
    expect(m[0]).toMatchObject({ site: 'NHC', rated: 2, total: 3, score: 2.5 })
    expect(m[1]).toMatchObject({ site: 'JED', score: null })
  })
  it('orders Critical before High', () => {
    const t = topHighRisk([{ risk_level: 'High', id: 1 }, { risk_level: 'Critical', id: 2 }, { risk_level: 'Low', id: 3 }])
    expect(t.map(r => r.id)).toEqual([2, 1])
  })
  it('trend is anchored to an injected now and leaves empty months null', () => {
    const now = new Date(2026, 5, 15)
    const trend = riskTrend([{ issue_date: '2026-06-02', risk_level: 'High' }], { months: 3, now })
    expect(trend.map(t => t.month)).toEqual(['2026-04', '2026-05', '2026-06'])
    expect(trend[0].score).toBeNull()
    expect(trend[2].score).toBe(3)
  })
})

describe('honestKpis', () => {
  it('nulls KPIs the engine reports as 0 or 100 with nothing measured', () => {
    const kpis = {
      cpk: { fleetAvgCpk: null, medianCpk: null, p10Cpk: null },
      avgTyreLife: { avgKm: 0, validCount: 0 },
      inspectionCompliance: { compliancePct: 0, totalScheduled: 0 },
      scrapRate: { scrapRate: 0, totalCount: 0 },
      fleetAvailability: { availabilityPct: 100 },
      failureRate: { failureRate: null, criticalRate: null },
      pressureCompliance: { compliancePct: null },
      replacementRate: { avgPerVehiclePerMonth: 0 },
      downtimeImpact: { totalDowntimeHours: 0 },
    }
    const h = honestKpis(kpis, [])
    expect(h.avgTyreLifeKm).toBeNull()
    expect(h.inspectionPct).toBeNull()
    expect(h.scrapRate).toBeNull()
    expect(h.availabilityPct).toBeNull()
    expect(h.downtimeHours).toBeNull()
    expect(h.replacementPerVehicleMonth).toBeNull()
  })
  it('keeps real measurements', () => {
    const h = honestKpis({
      avgTyreLife: { avgKm: 55000, validCount: 3 },
      inspectionCompliance: { compliancePct: 80, totalScheduled: 10 },
      fleetAvailability: { availabilityPct: 97 },
    }, [{ risk_level: 'Low' }])
    expect(h.avgTyreLifeKm).toBe(55000)
    expect(h.inspectionPct).toBe(80)
    expect(h.availabilityPct).toBe(97)
  })
  it('exports N/A text and no unit for unmeasured KPIs', () => {
    const rows = kpiExportRows({ fleetAvgCpk: null, failureRate: 0.12 }, { currency: 'SAR', totalSpend: null, projectedAnnual: 1200 })
    const byKpi = Object.fromEntries(rows.map(r => [r.KPI, r]))
    expect(byKpi['Fleet Avg CPK']).toMatchObject({ Value: 'N/A', Unit: '' })
    expect(byKpi['Failure Rate']).toMatchObject({ Value: '12.0', Unit: '%' })
    expect(byKpi['Total Spend']).toMatchObject({ Value: 'N/A', Unit: '' })
    expect(byKpi['Projected Annual Spend']).toMatchObject({ Value: 1200, Unit: 'SAR' })
  })
})

describe('action plan phases', () => {
  it('maps the flat plan index onto 30/60/90 day phases', () => {
    expect([0, 3, 4, 6, 7, 9].map(actionPhaseOf)).toEqual([
      '0-30 days', '0-30 days', '30-60 days', '30-60 days', '60-90 days', '60-90 days',
    ])
  })
})
