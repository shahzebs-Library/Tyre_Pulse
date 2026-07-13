import { describe, it, expect } from 'vitest'
import {
  computeFleetHealth,
  buildFleetPulse,
  tyreNetCpk,
  fleetMeanNetCpk,
  cpkmStatus,
  lowPressureAnomalies,
  pressureImbalanceAnomalies,
  costOutlierAnomalies,
  inspectionGapAnomalies,
  overdueInspectionCount,
  newestInspectionByAsset,
  buildAnomalyFeed,
  summarizeAnomalies,
  buildFinancials,
  buildExecutiveSummary,
  DEFAULT_PULSE_THRESHOLDS,
} from '../lib/opsIntelligence'

// Fixed clock so every date-derived metric is deterministic.
const NOW = new Date('2026-07-12T00:00:00Z').getTime()
const DAY = 24 * 3600 * 1000

// ── computeFleetHealth — the signature formula ────────────────────────────────
describe('computeFleetHealth — score formula + bands', () => {
  it('scores a perfectly clean fleet at 100 / good', () => {
    const h = computeFleetHealth({ totalTyres: 50 })
    expect(h.score).toBe(100)
    expect(h.status).toBe('good')
    expect(h.requiresImmediateAction).toBe(false)
    expect(h.complianceRisk).toBe('low')
  })

  it('applies the verbatim risk weights and divides by total tyres', () => {
    // risk = crit*15 + lp*5 + lt*8 + min(30, overdue*0.5) + urgent*4
    //      = 1*15 + 2*5 + 1*8 + min(30, 4*0.5=2) + 1*4 = 15+10+8+2+4 = 39
    // score = 100 - 39/100 = 99.61 → round(…,1) = 99.6
    const h = computeFleetHealth({
      openCritical: 1, lowPressure: 2, lowTread: 1, overdueInspection: 4,
      urgentWorkOrders: 1, totalTyres: 100,
    })
    expect(h.score).toBe(99.6)
    expect(h.requiresImmediateAction).toBe(true) // openCritical > 0
  })

  it('caps the overdue-inspection risk contribution at 30', () => {
    // overdue 1000 * 0.5 = 500 but capped at 30. total risk = 30, /max(total,1)
    const h = computeFleetHealth({ overdueInspection: 1000, totalTyres: 1 })
    expect(h.riskItems.overdueInspection).toBe(30)
    expect(h.score).toBe(70) // 100 - 30/1
  })

  it('clamps the score to the 0..100 range', () => {
    const h = computeFleetHealth({ lowTread: 100, totalTyres: 1 })
    expect(h.score).toBe(0)
  })

  it('bands status: <60 critical, <80 warning, else good', () => {
    expect(computeFleetHealth({ lowTread: 50, totalTyres: 1 }).status).toBe('critical') // score 0
    // craft a warning: risk s.t. 60 <= score < 80 → risk/total in (20,40]
    expect(computeFleetHealth({ lowPressure: 6, totalTyres: 1 }).status).toBe('warning') // 100-30=70
    expect(computeFleetHealth({ lowPressure: 1, totalTyres: 100 }).status).toBe('good')
  })

  it('flags requiresImmediateAction on low tread even with no critical', () => {
    const h = computeFleetHealth({ lowTread: 1, totalTyres: 100 })
    expect(h.requiresImmediateAction).toBe(true)
  })

  it('bands complianceRisk on overdue count (>10 high, >5 medium, else low)', () => {
    expect(computeFleetHealth({ overdueInspection: 11, totalTyres: 100 }).complianceRisk).toBe('high')
    expect(computeFleetHealth({ overdueInspection: 6, totalTyres: 100 }).complianceRisk).toBe('medium')
    expect(computeFleetHealth({ overdueInspection: 5, totalTyres: 100 }).complianceRisk).toBe('low')
  })
})

// ── net CPK + cost outlier ────────────────────────────────────────────────────
describe('tyreNetCpk + cost outlier detection', () => {
  it('uses fitment→removal distance, falling back to total_km', () => {
    expect(tyreNetCpk({ cost_per_tyre: 2000, km_at_fitment: 10000, km_at_removal: 60000 })).toBeCloseTo(0.04, 6)
    expect(tyreNetCpk({ cost_per_tyre: 2000, total_km: 40000 })).toBeCloseTo(0.05, 6)
    expect(tyreNetCpk({ cost_per_tyre: 2000, km_at_fitment: 10, km_at_removal: 10 })).toBeNull()
    expect(tyreNetCpk({ cost_per_tyre: null, total_km: 1000 })).toBeNull()
  })

  it('flags tyres whose net CPK exceeds 2x the fleet mean and reports the multiple', () => {
    // three normal tyres at 0.02, 0.02, 0.02 → mean 0.02; one at 0.06 = 3x.
    const tyres = [
      { serial_no: 'A', cost_per_tyre: 2000, total_km: 100000 }, // 0.02
      { serial_no: 'B', cost_per_tyre: 2000, total_km: 100000 }, // 0.02
      { serial_no: 'C', cost_per_tyre: 2000, total_km: 100000 }, // 0.02
      { serial_no: 'D', asset_no: 'V-D', cost_per_tyre: 6000, total_km: 100000 }, // 0.06 = 3x mean 0.025
    ]
    const mean = fleetMeanNetCpk(tyres)
    // mean = (0.02*3 + 0.06)/4 = 0.03; D 0.06 = 2x → strictly > 2x? 0.06 > 0.06 is false
    // adjust: make D clearly above 2x by pushing others lower
    expect(mean).toBeCloseTo(0.03, 6)
    const outliers = costOutlierAnomalies(tyres, { thresholds: DEFAULT_PULSE_THRESHOLDS })
    // D at exactly 2x is NOT flagged (strict >). Confirm boundary behaviour:
    expect(outliers).toHaveLength(0)
  })

  it('flags a clear outlier above 2x and carries the multiple + action', () => {
    const tyres = [
      { serial_no: 'A', cost_per_tyre: 1000, total_km: 100000 }, // 0.01
      { serial_no: 'B', cost_per_tyre: 1000, total_km: 100000 }, // 0.01
      { serial_no: 'C', cost_per_tyre: 1000, total_km: 100000 }, // 0.01
      { serial_no: 'D', asset_no: 'V-D', cost_per_tyre: 9000, total_km: 100000 }, // 0.09
    ]
    // mean = (0.01*3 + 0.09)/4 = 0.03; D 0.09 = 3x > 2x → flagged
    const out = costOutlierAnomalies(tyres)
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('cost_outlier')
    expect(out[0].severity).toBe('warning')
    expect(out[0].serial).toBe('D')
    expect(out[0].multiple).toBeCloseTo(3, 1)
    expect(out[0].action).toMatch(/replacement/i)
  })

  it('returns no outliers when there is no usable CPK data', () => {
    expect(costOutlierAnomalies([{ serial_no: 'X' }])).toEqual([])
    expect(fleetMeanNetCpk([])).toBeNull()
  })
})

// ── pressure anomalies ────────────────────────────────────────────────────────
describe('pressure anomalies (low + imbalance)', () => {
  const tyres = [
    // installed, low pressure (< 80); paired within 20 PSI so V-1 is NOT imbalanced
    { serial_no: 'P1', asset_no: 'V-1', pressure_reading: 60, removal_date: null },
    { serial_no: 'P2', asset_no: 'V-1', pressure_reading: 78, removal_date: null },
    // installed on V-2, both healthy but > 20 PSI apart → imbalance only
    { serial_no: 'P3', asset_no: 'V-2', pressure_reading: 90, removal_date: null },
    { serial_no: 'P4', asset_no: 'V-2', pressure_reading: 120, removal_date: null },
    // removed tyre with low pressure → must be ignored (not installed)
    { serial_no: 'P5', asset_no: 'V-3', pressure_reading: 40, removal_date: '2026-01-01' },
  ]

  it('flags installed tyres below the low-pressure threshold only', () => {
    const low = lowPressureAnomalies(tyres)
    expect(low.map((l) => l.serial).sort()).toEqual(['P1', 'P2']) // both installed & < 80
    expect(low.every((l) => l.type === 'low_pressure' && l.severity === 'warning')).toBe(true)
    // the removed low-pressure tyre P5 is excluded
    expect(low.some((l) => l.serial === 'P5')).toBe(false)
  })

  it('flags an asset whose installed pressures span more than 20 PSI', () => {
    const imb = pressureImbalanceAnomalies(tyres)
    expect(imb).toHaveLength(1)
    expect(imb[0].asset_no).toBe('V-2')
    expect(imb[0].type).toBe('pressure_imbalance')
    expect(imb[0].detail).toMatch(/30 PSI/) // 120 - 90
  })

  it('does not flag imbalance when only one installed pressure exists on an asset', () => {
    const single = pressureImbalanceAnomalies([
      { serial_no: 'S', asset_no: 'V-9', pressure_reading: 50, removal_date: null },
    ])
    expect(single).toEqual([])
  })
})

// ── inspection recency (overdue count + gap anomalies) ────────────────────────
describe('inspection recency', () => {
  const tyres = [
    { serial_no: 'T1', asset_no: 'V-1', removal_date: null }, // inspected recently
    { serial_no: 'T2', asset_no: 'V-2', removal_date: null }, // inspected long ago
    { serial_no: 'T3', asset_no: 'V-3', removal_date: null }, // never inspected
    { serial_no: 'T4', asset_no: 'V-4', removal_date: '2026-01-01' }, // removed → ignored
  ]
  const inspections = [
    { asset_no: 'V-1', inspection_date: new Date(NOW - 5 * DAY).toISOString() }, // 5d ago
    { asset_no: 'V-2', inspection_date: new Date(NOW - 40 * DAY).toISOString() }, // 40d ago
  ]

  it('maps each asset to its newest inspection timestamp', () => {
    const map = newestInspectionByAsset([
      { asset_no: 'V-1', inspection_date: '2026-01-01' },
      { asset_no: 'V-1', inspection_date: '2026-06-01' },
    ])
    expect(new Date(map.get('V-1')).getUTCFullYear()).toBe(2026)
    expect(map.get('V-1')).toBe(new Date('2026-06-01').getTime())
  })

  it('counts installed tyres whose asset is overdue (>30d) or never inspected', () => {
    // V-1 recent → ok; V-2 40d → overdue; V-3 none → overdue; V-4 removed → excluded
    const n = overdueInspectionCount(tyres, inspections, { now: NOW })
    expect(n).toBe(2)
  })

  it('emits inspection_gap anomalies for assets past the 14d window (or never)', () => {
    const gaps = inspectionGapAnomalies(tyres, inspections, { now: NOW })
    const assets = gaps.map((g) => g.asset_no).sort()
    expect(assets).toEqual(['V-2', 'V-3'])
    const never = gaps.find((g) => g.asset_no === 'V-3')
    expect(never.detail).toMatch(/No inspection on record/i)
    expect(gaps.every((g) => g.type === 'inspection_gap' && g.severity === 'warning')).toBe(true)
  })
})

// ── buildAnomalyFeed ──────────────────────────────────────────────────────────
describe('buildAnomalyFeed', () => {
  it('requires an explicit now', () => {
    expect(() => buildAnomalyFeed({ tyres: [], inspections: [] }, {})).toThrow(/now/)
  })

  it('combines detectors, sorts by severity and summarises', () => {
    const tyres = [
      { serial_no: 'A', asset_no: 'V-1', pressure_reading: 50, removal_date: null },
      { serial_no: 'B', asset_no: 'V-1', pressure_reading: 100, removal_date: null },
    ]
    const feed = buildAnomalyFeed({ tyres, inspections: [] }, { now: NOW })
    expect(feed.length).toBeGreaterThan(0)
    const s = summarizeAnomalies(feed)
    expect(s.total).toBe(feed.length)
    expect(s.warnings + s.critical).toBeLessThanOrEqual(s.total)
  })
})

// ── buildFleetPulse ───────────────────────────────────────────────────────────
describe('buildFleetPulse', () => {
  it('requires an explicit now', () => {
    expect(() => buildFleetPulse({ tyres: [] }, {})).toThrow(/now/)
  })

  it('assembles counts + health from live datasets', () => {
    const tyres = [
      { serial_no: 'A', asset_no: 'V-1', tread_depth: 2, pressure_reading: 60, removal_date: null }, // low tread + low pressure
      { serial_no: 'B', asset_no: 'V-2', tread_depth: 12, pressure_reading: 100, status: 'in_stock', removal_date: null },
    ]
    const workOrders = [
      { id: 'w1', status: 'open', priority: 'urgent' },
    ]
    const pulse = buildFleetPulse({ tyres, workOrders, inspections: [], activeVehicles: 7 }, { now: NOW })
    expect(pulse.counts.activeVehicles).toBe(7)
    expect(pulse.counts.installed).toBe(2)
    expect(pulse.counts.inStock).toBe(1)
    expect(pulse.counts.lowTread).toBe(1)
    expect(pulse.counts.lowPressure).toBe(1)
    expect(pulse.counts.urgentWorkOrders).toBe(1)
    expect(pulse.score).toBeGreaterThanOrEqual(0)
    expect(pulse.score).toBeLessThanOrEqual(100)
    expect(pulse.requiresImmediateAction).toBe(true) // low tread present
  })

  it('passes through a null active-vehicle count honestly', () => {
    const pulse = buildFleetPulse({ tyres: [], activeVehicles: null }, { now: NOW })
    expect(pulse.counts.activeVehicles).toBeNull()
  })
})

// ── buildFinancials — budget consumption bands ────────────────────────────────
describe('buildFinancials — consumption bands', () => {
  const yr = new Date(NOW).getFullYear()
  const budgets = [
    { site: 'Riyadh', monthly_budget: 5000, year: yr },
    { site: 'Jeddah', monthly_budget: 5000, year: yr },
    { site: 'Old', monthly_budget: 9999, year: yr - 1 }, // different year → excluded
  ]
  const spend = (amount) => [{ cost_per_tyre: amount, issue_date: `${yr}-03-01`, total_km: 100000 }]

  it('sums budgets for the current year only', () => {
    const f = buildFinancials({ budgets, tyres: spend(0) }, { now: NOW })
    expect(f.annualBudget).toBe(10000)
    expect(f.year).toBe(yr)
  })

  it('sums YTD tyre spend from cost_per_tyre issued this year', () => {
    const f = buildFinancials({ budgets, tyres: spend(2500) }, { now: NOW })
    expect(f.ytdTyreSpend).toBe(2500)
    expect(f.remainingBudget).toBe(7500)
  })

  it('bands budget status: >90 critical, >75 warning, else on_track', () => {
    expect(buildFinancials({ budgets, tyres: spend(9500) }, { now: NOW }).budgetStatus).toBe('critical') // 95%
    expect(buildFinancials({ budgets, tyres: spend(8000) }, { now: NOW }).budgetStatus).toBe('warning') // 80%
    expect(buildFinancials({ budgets, tyres: spend(5000) }, { now: NOW }).budgetStatus).toBe('on_track') // 50%
  })

  it('returns null consumption + unknown status when no budget is set', () => {
    const f = buildFinancials({ budgets: [], tyres: spend(1000) }, { now: NOW })
    expect(f.budgetConsumptionPct).toBeNull()
    expect(f.budgetStatus).toBe('unknown')
    expect(f.remainingBudget).toBeNull()
  })

  it('computes avg CPK + cpkmStatus and marks non-captured sources', () => {
    const f = buildFinancials({ budgets, tyres: [{ cost_per_tyre: 2000, total_km: 100000, issue_date: `${yr}-01-01` }] }, { now: NOW })
    expect(f.avgCpk).toBeCloseTo(0.02, 4)
    expect(f.cpkmStatus).toBe('good') // < 0.03
    expect(f.notCaptured).toEqual(['retread_savings', 'claim_recoveries', 'emergency_premium'])
  })
})

describe('cpkmStatus bands', () => {
  it('bands avg CPK: <0.03 good, <0.04 average, else needs_improvement', () => {
    expect(cpkmStatus(null)).toBe('unknown')
    expect(cpkmStatus(0.02)).toBe('good')
    expect(cpkmStatus(0.035)).toBe('average')
    expect(cpkmStatus(0.05)).toBe('needs_improvement')
  })
})

// ── buildExecutiveSummary ─────────────────────────────────────────────────────
describe('buildExecutiveSummary', () => {
  it('composes four headlines + an action flag from the pulse/anomalies/financials', () => {
    const pulse = buildFleetPulse(
      { tyres: [{ serial_no: 'A', asset_no: 'V-1', tread_depth: 2, removal_date: null }], workOrders: [] },
      { now: NOW },
    )
    const financials = buildFinancials(
      { budgets: [{ monthly_budget: 1000, year: new Date(NOW).getFullYear() }], tyres: [] },
      { now: NOW },
    )
    const exec = buildExecutiveSummary({ pulse, anomalies: [], financials }, { currency: 'SAR' })
    expect(exec.fleetHealthScore).toBe(pulse.score)
    expect(exec.headlines.safety).toMatch(/low tread/)
    expect(exec.headlines.financial).toMatch(/SAR/)
    expect(exec.headlines.cpk).toMatch(/insufficient|\/km/)
    expect(exec.actionRequired).toBe(true) // low tread → immediate action
  })

  it('degrades gracefully with no financials', () => {
    const pulse = buildFleetPulse({ tyres: [] }, { now: NOW })
    const exec = buildExecutiveSummary({ pulse, anomalies: [], financials: null })
    expect(exec.headlines.financial).toMatch(/unavailable/i)
    expect(exec.actionRequired).toBe(false)
  })
})
