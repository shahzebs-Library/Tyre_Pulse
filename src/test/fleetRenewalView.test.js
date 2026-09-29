import { describe, it, expect } from 'vitest'
import {
  ageFromModelYear, assessAsset, buildPlanningRows, filterPlanningRows, sortPlanningRows,
  ageDistribution, pipelineSegments, capexByQuarter, buildRenewalKpis, planningRules,
  presetCounts, remainingLifeLabel, isCurrentFleet, planningExportRows, PLANNING_LIFE_YEARS,
} from '../lib/fleetRenewalView'

const NOW = new Date(2026, 8, 29) // 29 Sep 2026

describe('ageFromModelYear', () => {
  it('computes whole years and rejects typos', () => {
    expect(ageFromModelYear(2016, NOW)).toBe(10)
    expect(ageFromModelYear('2026', NOW)).toBe(0)
    expect(ageFromModelYear(2027, NOW)).toBe(0)
    expect(ageFromModelYear(20222, NOW)).toBeNull()
    expect(ageFromModelYear(2202, NOW)).toBeNull()
    expect(ageFromModelYear(null, NOW)).toBeNull()
    expect(ageFromModelYear('', NOW)).toBeNull()
  })
})

describe('assessAsset', () => {
  it('is unknown with no age, unless marked for scrap', () => {
    expect(assessAsset({ age: null, openBreakdown: false }).priority).toBe('unknown')
    expect(assessAsset({ age: null, openBreakdown: false }).health).toBeNull()
    expect(assessAsset({ age: null, openBreakdown: false, opsStatus: 'planned_scrap' }).priority).toBe('critical')
  })
  it('applies the documented bands', () => {
    expect(assessAsset({ age: 10, openBreakdown: false }).priority).toBe('critical')
    expect(assessAsset({ age: 9, openBreakdown: false }).priority).toBe('critical')
    expect(assessAsset({ age: 8, openBreakdown: false }).priority).toBe('high')
    expect(assessAsset({ age: 7, openBreakdown: true }).priority).toBe('high')
    expect(assessAsset({ age: 6, openBreakdown: false }).priority).toBe('medium')
    expect(assessAsset({ age: 2, openBreakdown: false }).priority).toBe('low')
  })
  it('weights health 70/30 and drops reliability when breakdowns are unreadable', () => {
    expect(assessAsset({ age: 5, openBreakdown: false }).health).toBe(65)
    expect(assessAsset({ age: 5, openBreakdown: true }).health).toBe(35)
    expect(assessAsset({ age: 5, openBreakdown: null }).health).toBe(50)
    expect(assessAsset({ age: 15, openBreakdown: false }).health).toBe(30)
    expect(assessAsset({ age: 5, openBreakdown: false }).remainingYears).toBe(PLANNING_LIFE_YEARS - 5)
  })
})

describe('remainingLifeLabel', () => {
  it('labels honestly', () => {
    expect(remainingLifeLabel(null)).toBe('N/A')
    expect(remainingLifeLabel(-2)).toBe('Past planning life')
    expect(remainingLifeLabel(1)).toBe('1 year')
    expect(remainingLifeLabel(4)).toBe('4 years')
  })
})

const fleet = [
  { id: 'a', asset_no: 'TM 101', country: 'KSA', model_year: 2014, vehicle_type: 'TR-MIXER', site: 'NHC', make: 'Sany', model: 'X' },
  { id: 'b', asset_no: 'TM102', country: 'KSA', model_year: 2024, vehicle_type: 'TR-MIXER', site: 'NHC' },
  { id: 'c', asset_no: 'PL1', country: 'KSA', model_year: 20222, vehicle_type: 'PICKUP', site: 'JED' },
  { id: 'd', asset_no: 'OLD1', country: 'KSA', model_year: 2005, status: 'Inactive' },
  { id: 'e', asset_no: 'GN1', country: 'UAE', model_year: 2018, vehicle_type: 'GENERATOR', site: 'DXB', ops_status: 'planned_scrap' },
]
const plans = [
  { id: 'p1', asset_no: 'TM101', country: 'KSA', status: 'approved', est_cost: 300000, target_replace_date: '2026-12-15', created_at: '2026-09-01' },
  { id: 'p2', asset_no: 'ZZ9', country: 'KSA', status: 'planned', est_cost: 100000, target_replace_date: '2027-02-01', created_at: '2026-09-02' },
  { id: 'p3', asset_no: 'TM102', country: 'KSA', status: 'planned', est_cost: null, target_replace_date: '2030-01-01', created_at: '2026-09-03' },
]
const util = [
  { asset_no: 'TM101', utilization_pct: 40, captured_at: '2026-08-01' },
  { asset_no: 'TM101', utilization_pct: 60, captured_at: '2026-09-01' },
]
const breakdowns = [{ asset_no: 'TM101', returned_to_service: false }, { asset_no: 'TM102', returned_to_service: true }]

describe('buildPlanningRows', () => {
  const rows = buildPlanningRows({ fleet, plans, utilRows: util, breakdownRows: breakdowns, now: NOW })
  const by = Object.fromEntries(rows.map((r) => [r.asset_no, r]))
  it('drops history assets and keeps plans whose asset is missing', () => {
    expect(isCurrentFleet(fleet[3])).toBe(false)
    expect(by.OLD1).toBeUndefined()
    expect(by.ZZ9.inRegister).toBe(false)
    expect(rows).toHaveLength(5)
  })
  it('joins plan, latest utilisation and breakdown by normalised asset key', () => {
    expect(by['TM 101'].plan.id).toBe('p1')
    expect(by['TM 101'].utilization).toBe(60)
    expect(by['TM 101'].openBreakdown).toBe(true)
    expect(by['TM 101'].budget).toBe(300000)
    expect(by['TM 101'].currency).toBe('SAR')
    expect(by.TM102.openBreakdown).toBe(false)
    expect(by.TM102.utilization).toBeNull()
  })
  it('treats a rejected model year as unknown and a scrap mark as critical', () => {
    expect(by.PL1.age).toBeNull()
    expect(by.PL1.priority).toBe('unknown')
    expect(by.GN1.priority).toBe('critical')
    expect(by.GN1.planStatus).toBe('none')
  })
  it('keeps unreadable signals null', () => {
    const r = buildPlanningRows({ fleet, plans: [], utilRows: null, breakdownRows: null, now: NOW })
    expect(r[0].utilization).toBeNull()
    expect(r[0].openBreakdown).toBeNull()
  })
  it('sorts by priority then age and filters', () => {
    const s = sortPlanningRows(rows)
    expect(s[0].priority).toBe('critical')
    expect(filterPlanningRows(rows, { q: 'sany' }, NOW).map((r) => r.asset_no)).toEqual(['TM 101'])
    expect(filterPlanningRows(rows, { status: 'none' }, NOW).map((r) => r.asset_no).sort()).toEqual(['GN1', 'PL1'])
    expect(filterPlanningRows(rows, { preset: 'next12' }, NOW).map((r) => r.asset_no).sort()).toEqual(['TM 101', 'ZZ9'])
    expect(filterPlanningRows(rows, { preset: 'noplan' }, NOW).map((r) => r.asset_no)).toEqual(['GN1'])
  })
  it('counts presets and rules', () => {
    const p = Object.fromEntries(presetCounts(rows, NOW).map((x) => [x.key, x.count]))
    expect(p.due).toBe(2)
    expect(p.next12).toBe(2)
    const keys = planningRules(rows, NOW).map((r) => r.key)
    expect(keys).toContain('scrap')
    expect(keys).toContain('noage')
  })
  it('exports N/A as blanks and marks rows with no plan', () => {
    const ex = planningExportRows(rows)
    expect(ex.find((r) => r.asset_no === 'GN1').status).toBe('No plan')
    expect(ex.find((r) => r.asset_no === 'PL1').age).toBe('')
  })
})

describe('ageDistribution', () => {
  it('bands register assets and counts unknown ages', () => {
    const rows = buildPlanningRows({ fleet, plans, now: NOW })
    const d = ageDistribution(rows)
    expect(d.total).toBe(4)
    expect(d.unknown).toBe(1)
    expect(d.bands.find((b) => b.key === '0-2').count).toBe(1)
    expect(d.bands.find((b) => b.key === '6-8').count).toBe(1)
    expect(d.bands.find((b) => b.key === '10+').count).toBe(1)
    expect(ageDistribution(rows, 'PICKUP').total).toBe(1)
  })
})

describe('pipeline, capex and kpis', () => {
  it('splits plans by status and target window', () => {
    const seg = Object.fromEntries(pipelineSegments(plans, NOW).map((s) => [s.key, s.count]))
    expect(seg).toEqual({ approved: 1, next12: 1, beyond: 1, deferred: 0, completed: 0 })
  })
  it('sums capex by quarter in one currency', () => {
    const c = capexByQuarter(plans, NOW)
    expect(c.quarters.map((q) => q.label)).toEqual(['Q3 2026', 'Q4 2026', 'Q1 2027', 'Q2 2027'])
    expect(c.quarters[1].amount).toBe(300000)
    expect(c.quarters[2].amount).toBe(100000)
    expect(c.currency).toBe('SAR')
    expect(c.hasData).toBe(true)
  })
  it('refuses to blend currencies', () => {
    const mixed = [...plans, { id: 'x', asset_no: 'U', country: 'UAE', status: 'planned', est_cost: 5, target_replace_date: '2026-11-01' }]
    const c = capexByQuarter(mixed, NOW)
    expect(c.mixed).toBe(true)
    expect(c.quarters.every((q) => q.amount == null)).toBe(true)
    const k = buildRenewalKpis([], mixed, NOW)
    expect(k.capex.amount).toBeNull()
    expect(k.capex.mixed).toBe(true)
  })
  it('reports empty capex honestly', () => {
    expect(capexByQuarter([], NOW).hasData).toBe(false)
    expect(buildRenewalKpis([], [], NOW).capex.amount).toBeNull()
  })
  it('builds kpis', () => {
    const rows = buildPlanningRows({ fleet, plans, now: NOW })
    const k = buildRenewalKpis(rows, plans, NOW)
    expect(k.assets).toBe(4)
    expect(k.due).toBe(2)
    expect(k.aging).toBe(2)
    expect(k.approved).toBe(1)
    expect(k.capex.amount).toBe(400000)
  })
})
