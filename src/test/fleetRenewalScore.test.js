import { describe, it, expect } from 'vitest'
import {
  buildPlanningRows, budgetByYear, moneyText, planYear, planCurrency, percentileRank,
  filterPlanningRows, planExportRows,
} from '../lib/fleetRenewalView'

const now = new Date('2026-09-29T00:00:00Z')
const fleet = [
  { id: 'a', asset_no: 'TM1', country: 'KSA', model_year: 2016, current_km: 400000 },
  { id: 'b', asset_no: 'TM2', country: 'KSA', model_year: 2024, current_km: 50000 },
  { id: 'c', asset_no: 'GN1', country: 'UAE', model_year: 2020, current_km: null },
]
const signals = [
  { asset_key: 'TM1', country: 'KSA', repair_cost_12m: { SAR: 90000 }, repair_cost_all: { SAR: 200000 }, downtime_hours_12m: 400, job_cards_12m: 20, accidents_all: 2, accidents_12m: 1, last_hours: 9000, last_hours_at: '2026-09-01' },
  { asset_key: 'TM2', country: 'KSA', repair_cost_12m: { SAR: 1000 }, repair_cost_all: {}, downtime_hours_12m: null, job_cards_12m: 3, accidents_all: 0, accidents_12m: 0, last_hours: null },
  { asset_key: 'GN1', country: 'UAE', repair_cost_12m: { AED: 5000 }, repair_cost_all: { AED: 5000 }, downtime_hours_12m: 10, job_cards_12m: 1, accidents_all: 0, accidents_12m: 0, last_hours: 2000 },
]

describe('renewal score', () => {
  it('scores an old, costly, down asset above a new one', () => {
    const rows = buildPlanningRows({ fleet, signalRows: signals, now })
    const tm1 = rows.find((r) => r.asset_no === 'TM1')
    const tm2 = rows.find((r) => r.asset_no === 'TM2')
    expect(tm1.score).toBeGreaterThan(tm2.score)
    expect(tm1.repairCost12m).toEqual({ SAR: 90000 })
    expect(tm1.accidentsAll).toBe(2)
    expect(tm2.downtimeHours12m).toBeNull()
  })
  it('keeps signals N/A when they could not be read, never zero', () => {
    const rows = buildPlanningRows({ fleet, signalRows: null, now })
    const tm1 = rows.find((r) => r.asset_no === 'TM1')
    expect(tm1.signalsRead).toBe(false)
    expect(tm1.repairCost12m).toBeNull()
    expect(tm1.accidentsAll).toBeNull()
    expect(tm1.scoreParts.repair).toBeUndefined()
    expect(tm1.score).not.toBeNull()
  })
  it('does not match a signal from another country', () => {
    const rows = buildPlanningRows({ fleet: [{ id: 'x', asset_no: 'TM1', country: 'UAE', model_year: 2020 }], signalRows: signals, now })
    expect(rows[0].repairCost12m).toEqual({})
  })
  it('filters by minimum score', () => {
    const rows = buildPlanningRows({ fleet, signalRows: signals, now })
    const hi = filterPlanningRows(rows, { minScore: '75' }, now)
    expect(hi.every((r) => r.score >= 75)).toBe(true)
  })
  it('percentile rank', () => {
    expect(percentileRank([1, 2, 3], 3)).toBe(100)
    expect(percentileRank([1, 2, 3], 1)).toBe(0)
    expect(percentileRank([], 1)).toBeNull()
  })
})

describe('plan money and years', () => {
  const plans = [
    { asset_no: 'A', country: 'KSA', status: 'planned', est_cost: 100, planned_year: 2027 },
    { asset_no: 'B', country: 'UAE', status: 'approved', est_cost: 50, target_replace_date: '2027-05-01' },
    { asset_no: 'C', country: 'KSA', status: 'deferred', est_cost: 20, planned_year: 2027, currency: 'SAR' },
    { asset_no: 'D', country: 'KSA', status: 'planned', est_cost: null },
  ]
  it('reads planned year and currency with fallbacks', () => {
    expect(planYear(plans[1])).toBe(2027)
    expect(planCurrency(plans[1])).toBe('AED')
    expect(planYear(plans[3])).toBeNull()
  })
  it('groups budget by year and currency without blending', () => {
    const b = budgetByYear(plans)
    const y = b.years.find((e) => e.year === 2027)
    expect(y.open).toEqual({ SAR: 100, AED: 50 })
    expect(y.deferred).toEqual({ SAR: 20 })
    expect(b.years.find((e) => e.year == null).uncosted).toBe(1)
    expect(b.currencies).toEqual(['AED', 'SAR'])
  })
  it('money text never sums currencies', () => {
    expect(moneyText({ SAR: 1000, AED: 5 })).toBe('SAR 1,000 + AED 5')
    expect(moneyText({})).toBe('')
  })
  it('exports plans with year and currency', () => {
    const ex = planExportRows(plans)
    expect(ex[0].planned_year).toBe(2027)
    expect(ex.find((r) => r.asset_no === 'D').currency).toBe('')
  })
})
