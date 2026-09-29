import { describe, it, expect } from 'vitest'
import {
  isValued, complianceIssues, disposalKpis, recoveryLabel, pipeline, topReasons,
  recoveryTrend, nextAction, applyViewFilters, valuationRequestRows, makeModel, ageOf,
} from '../lib/assetDisposalView'

const NOW = Date.parse('2026-09-29T12:00:00Z')

const rows = [
  { asset_no: 'A1', status: 'proposed', estimated_value: 0, condition: 'Dismantled', site: 'NHC', fleet_status: 'Active', tyres_active: 2, created_at: '2026-08-12T10:00:00Z', currency: 'SAR' },
  { asset_no: 'A2', status: 'proposed', estimated_value: 5000, condition: 'Dismantled', site: 'JED', created_at: '2026-08-12T10:00:00Z', currency: 'SAR' },
  { asset_no: 'A3', status: 'approved', estimated_value: null, condition: 'Running', site: 'NHC', tyres_active: 4, created_at: '2025-01-01T00:00:00Z' },
  { asset_no: 'A4', status: 'disposed', disposition: 'sell', sale_proceeds: 12000, disposed_at: '2026-09-02', currency: 'SAR', fleet_status: 'Inactive' },
  { asset_no: 'A5', status: 'disposed', disposition: 'scrap', sale_proceeds: 300, disposed_at: '2026-08-15', currency: 'AED', fleet_status: 'Active' },
  { asset_no: 'A6', status: 'rejected', fleet_status: 'Active', tyres_active: 3 },
]

describe('assetDisposalView', () => {
  it('reads zero or blank as not valued', () => {
    expect(isValued(rows[0])).toBe(false)
    expect(isValued(rows[1])).toBe(true)
    expect(isValued(rows[2])).toBe(false)
  })

  it('flags compliance only on machines not kept in service', () => {
    expect(complianceIssues(rows[0])).toEqual(['register_active', 'tyres_fitted'])
    expect(complianceIssues(rows[5])).toEqual([])
  })

  it('builds the six tiles and never blends currencies', () => {
    const k = disposalKpis(rows)
    expect(k.candidates).toBe(2)
    expect(k.approved).toBe(1)
    expect(k.pendingValuation).toBe(2) // A1 and A3; disposed/rejected are not pending
    expect(k.sold).toBe(1)
    expect(k.compliancePending).toBe(3) // A1, A3, A5
    expect(k.recovery).toEqual([{ currency: 'AED', total: 300 }, { currency: 'SAR', total: 12000 }])
    expect(recoveryLabel(k.recovery)).toBe('AED 300 | SAR 12,000')
    expect(recoveryLabel([])).toBeNull()
  })

  it('counts pipeline stages from recorded statuses only, by site', () => {
    const p = pipeline(rows)
    expect(Object.fromEntries(p.stages.map((s) => [s.key, s.count]))).toEqual({ identified: 1, valued: 1, approved: 1, disposed: 2, rejected: 1 })
    expect(pipeline(rows, { site: 'NHC' }).total).toBe(2)
  })

  it('groups reasons by condition with shares, windowed by date added', () => {
    const all = topReasons(rows, { now: NOW })
    expect(all.reasons[0]).toMatchObject({ label: 'Not recorded', count: 3 })
    const recent = topReasons(rows, { months: 6, now: NOW })
    expect(recent.total).toBe(2)
    expect(recent.reasons).toEqual([{ label: 'Dismantled', tone: 'danger', count: 2, pct: 100 }])
  })

  it('charts disposals by month per currency', () => {
    const t = recoveryTrend(rows, { months: 12, now: NOW })
    expect(t.series).toHaveLength(12)
    expect(t.disposed).toBe(2)
    expect(t.currencies).toEqual(['AED', 'SAR'])
    const sep = t.series.find((s) => s.key === '2026-09')
    expect(sep).toMatchObject({ count: 1, values: { SAR: 12000 } })
    expect(recoveryTrend([], { now: NOW }).hasValue).toBe(false)
  })

  it('names the next step from the data', () => {
    expect(nextAction(rows[0]).label).toBe('Record valuation')
    expect(nextAction(rows[1]).label).toBe('Committee decision')
    expect(nextAction(rows[2]).label).toBe('Recover tyres')
    expect(nextAction(rows[3]).label).toBe('Complete')
    expect(nextAction(rows[4]).label).toBe('Retire in fleet register')
    expect(nextAction(rows[5]).label).toBe('Kept in service')
  })

  it('applies the view filters', () => {
    expect(applyViewFilters(rows, { valuation: 'pending' }, NOW).map((r) => r.asset_no)).toEqual(['A1', 'A3'])
    expect(applyViewFilters(rows, { sold: true }, NOW).map((r) => r.asset_no)).toEqual(['A4'])
    expect(applyViewFilters(rows, { added: '90' }, NOW).map((r) => r.asset_no)).toEqual(['A1', 'A2'])
    expect(applyViewFilters(rows, { compliance: 'pending' }, NOW)).toHaveLength(3)
  })

  it('builds the valuation request from open unvalued machines', () => {
    const req = valuationRequestRows(rows)
    expect(req.map((r) => r.asset_no)).toEqual(['A1', 'A3'])
    expect(req[0].estimated_value).toBe('')
    expect(req[1].disposition).toBe('undecided')
  })

  it('reads make and age honestly', () => {
    expect(makeModel({ fleet_make: 'Sany', fleet_model: 'SY' })).toBe('Sany SY')
    expect(makeModel({ brand: 'Volvo' })).toBe('Volvo')
    expect(makeModel({})).toBeNull()
    expect(ageOf({ model_year: 2012 }, NOW)).toBe(14)
    expect(ageOf({}, NOW)).toBeNull()
  })
})
