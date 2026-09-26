import { describe, it, expect } from 'vitest'
import {
  worstRisk, activeTyresOf, tyreRecordCost, countOpenWorkOrders, workOrderSpend, workOrderStatusLabel,
  currentKmOf, monthlyTyreCost, tyreRecommendations, severityTone, inspectionDateOf, accidentCostOf,
  serviceMeterUnit, pmDueSummary, crossCountryRows,
} from '../lib/assetDetailAnalytics'

const NOW = new Date(2026, 8, 26, 12).getTime() // 26 Sep 2026, local

describe('tyres', () => {
  it('picks the worst risk and ignores unrated tyres', () => {
    expect(worstRisk([{ risk_level: 'Low' }, { risk_level: 'Critical' }, { risk_level: 'High' }])).toBe('Critical')
    expect(worstRisk([{}, { risk_level: null }])).toBeNull()
    expect(worstRisk(null)).toBeNull()
  })
  it('treats a tyre with no removal meter as fitted', () => {
    expect(activeTyresOf([{ km_at_removal: null }, { km_at_removal: 0 }, { km_at_removal: '' }, { km_at_removal: 5 }])).toHaveLength(2)
  })
  it('sums priced tyres and returns null, not zero, when none is priced', () => {
    expect(tyreRecordCost([{ cost_per_tyre: 100, qty: 2 }, { cost_per_tyre: '50' }, { cost_per_tyre: null }]))
      .toEqual({ total: 250, priced: 2, count: 3 })
    expect(tyreRecordCost([{ cost_per_tyre: null }]).total).toBeNull()
    expect(tyreRecordCost([]).total).toBeNull()
  })
  it('recommends from measured tread only', () => {
    const recs = tyreRecommendations([{ risk_level: 'Critical', tread_depth: null }, { risk_level: 'High', tread_depth: 2 }, { tread_depth: '' }])
    expect(recs.map(r => [r.key, r.count])).toEqual([['recCriticalRisk', 1], ['recHighRisk', 1], ['recLowTread', 1]])
    expect(tyreRecommendations([])[0].key).toBe('recNoActive')
    expect(tyreRecommendations([{ risk_level: 'Low', tread_depth: 8 }])[0].key).toBe('recAllGood')
  })
  it('buckets twelve months of tyre spend ending this month', () => {
    const { months, priced } = monthlyTyreCost([
      { issue_date: '2026-09-02', cost_per_tyre: 100, qty: 2 },
      { issue_date: '2026-09-10', cost_per_tyre: null },
      { issue_date: '2025-10-15', cost_per_tyre: 30 },
      { issue_date: '2025-09-15', cost_per_tyre: 999 }, // outside the window
      { issue_date: 'not a date' },
    ], NOW)
    expect(months).toHaveLength(12)
    expect(months[11]).toMatchObject({ year: 2026, month: 8, cost: 200, fitments: 2 })
    expect(months[0]).toMatchObject({ year: 2025, month: 9, cost: 30 })
    expect(priced).toBe(2)
  })
})

describe('work orders and meters', () => {
  it('counts open work orders through the canonical vocabulary', () => {
    expect(countOpenWorkOrders([{ status: 'Closed' }, { status: 'completed' }, { status: 'Open' }, { status: 'Cancelled' }, { status: null }])).toBe(2)
    expect(workOrderStatusLabel('closed')).toBe('Completed')
    expect(workOrderStatusLabel(null)).toBeNull()
  })
  it('reports work order spend as null when nothing is priced', () => {
    expect(workOrderSpend([{ total_cost: 10 }, { total_cost: null }, { total_cost: '5' }])).toEqual({ total: 15, priced: 2 })
    expect(workOrderSpend([{ total_cost: null }]).total).toBeNull()
  })
  it('prefers the synced km and falls back to the latest log, else null', () => {
    expect(currentKmOf({ current_km: 1200 }, { odometer: { odometer_km: 900 } })).toBe(1200)
    expect(currentKmOf({ current_km: '' }, { odometer: { odometer_km: 900 } })).toBe(900)
    expect(currentKmOf({}, {})).toBeNull()
  })
})

describe('registers', () => {
  it('maps severities to tones', () => {
    expect(severityTone('Severe')).toBe('danger')
    expect(severityTone('moderate')).toBe('warning')
    expect(severityTone('minor')).toBe('good')
    expect(severityTone('')).toBe('none')
  })
  it('picks the inspection date through the lifecycle columns', () => {
    expect(inspectionDateOf({ completed_date: '2026-01-02', created_at: 'x' })).toBe('2026-01-02')
    expect(inspectionDateOf({})).toBeNull()
  })
  it('never reads an unknown accident cost as zero', () => {
    expect(accidentCostOf({ repair_cost: 500, estimated_damage_cost: 900 })).toBe(500)
    expect(accidentCostOf({ repair_cost: 0, estimated_damage_cost: 900 })).toBe(900)
    expect(accidentCostOf({})).toBeNull()
  })
  it('labels PM meter units and counts due bands', () => {
    expect(serviceMeterUnit({ meter_type: 'engine_hours' })).toBe('h')
    expect(serviceMeterUnit({ meter_type: 'odometer' })).toBe('km')
    expect(serviceMeterUnit({})).toBe('')
    expect(pmDueSummary([{ due: { band: 'overdue' } }, { due: { band: 'due_soon' } }, { due: { band: 'none' } }]))
      .toEqual({ total: 3, overdue: 1, dueSoon: 1, scheduled: 0, undated: 1 })
  })
})

describe('crossCountryRows', () => {
  it('merges the rollup and ownership per country without summing currencies', () => {
    const rows = crossCountryRows(
      { by_country: [{ country: 'UAE', tyres: 4, work_orders: 2, tyre_expense: 800 }, { country: 'KSA', tyres: 10, work_orders: null, tyre_expense: 1200 }] },
      { owningCountry: 'KSA', countries: [{ country: 'KSA', cost: 5000, currency: 'SAR', isOwner: true }, { country: 'Egypt', cost: 100, isOwner: false }] },
      { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' },
    )
    expect(rows.map(r => r.country)).toEqual(['Egypt', 'KSA', 'UAE'])
    expect(rows[0]).toMatchObject({ role: 'bears', borne: 100, tyres: null, currency: 'EGP' })
    expect(rows[1]).toMatchObject({ role: 'owner', borne: 5000, workOrders: null, currency: 'SAR' })
    expect(rows[2]).toMatchObject({ role: null, borne: null, tyreExpense: 800, currency: 'AED' })
  })
  it('marks every country contested when no owner is named', () => {
    const rows = crossCountryRows(null, { owningCountry: null, countries: [{ country: 'KSA', cost: 1 }] })
    expect(rows[0].role).toBe('contested')
    expect(crossCountryRows(null, null)).toEqual([])
  })
})
