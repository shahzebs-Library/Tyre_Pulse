import { describe, it, expect } from 'vitest'
import {
  buildSupplierDetail, honestFailureRate, ratedCoverage, recordRows, filterRecordRows,
  supplierContractRows, breakdownBy, ratingsMap, ratingToNum, numToRating, recordExportRows, recordCpk,
} from '../lib/supplierDetailAnalytics'

const recs = [
  { id: 1, brand: 'ACME', size: '315/80R22.5', site: 'NHC', cost_per_tyre: 1000, qty: 1, km_at_fitment: 1000, km_at_removal: 101000, issue_date: '2026-05-01', serial_number: 'S1' },
  { id: 2, brand: 'ACME', size: '315/80R22.5', site: 'JED', cost_per_tyre: 900, issue_date: '2026-06-01', risk_level: 'High' },
  { id: 3, brand: 'OTHER', size: '385/65R22.5', site: 'NHC', cost_per_tyre: 800, km_at_fitment: 10, km_at_removal: 20010, issue_date: '2026-06-01' },
]

describe('failure rate honesty', () => {
  it('is null when no record is rated', () => {
    expect(honestFailureRate([{ risk_level: null }, {}])).toBeNull()
    expect(honestFailureRate(recs.filter((r) => r.brand === 'ACME'))).toBe(1)
    expect(ratedCoverage(recs.slice(0, 2))).toEqual({ rated: 1, total: 2, pct: 50 })
    expect(ratedCoverage([]).pct).toBeNull()
  })
})

describe('buildSupplierDetail', () => {
  it('returns null supplier for an unknown brand', () => {
    expect(buildSupplierDetail(recs, {}, 'NOPE').supplier).toBeNull()
  })
  it('builds breakdowns, a 12-month window and a CPK rank', () => {
    const d = buildSupplierDetail(recs, {}, 'ACME', new Date(2026, 8, 26))
    expect(d.supplier.count).toBe(2)
    expect(d.months).toHaveLength(12)
    expect(d.monthlySpend.reduce((s, v) => s + v, 0)).toBe(1900)
    expect(d.sizes[0]).toMatchObject({ name: '315/80R22.5', count: 2, sharePct: 100 })
    expect(d.cpkRank.of).toBe(2)
    expect(d.failureRate).toBe(1)
  })
  it('honours a stored rating', () => {
    const d = buildSupplierDetail(recs, ratingsMap([{ id: 'r', brand: 'ACME', rating: 1, notes: 'n' }]), 'ACME')
    expect(d.supplier.rating).toBe('Preferred')
    expect(d.supplier.notes).toBe('n')
  })
})

describe('rows', () => {
  it('record rows carry km run and cpk, null when unmeasurable', () => {
    const r = recordRows(recs)
    expect(r[0].kmRun).toBe(100000)
    expect(r[0].cpk).toBeCloseTo(0.01)
    expect(r[1].cpk).toBeNull()
    expect(recordCpk({})).toBeNull()
  })
  it('filters by risk, unrated, site and search', () => {
    const r = recordRows(recs)
    expect(filterRecordRows(r, { risk: 'High' })).toHaveLength(1)
    expect(filterRecordRows(r, { risk: 'unrated' })).toHaveLength(2)
    expect(filterRecordRows(r, { site: 'JED' })[0].id).toBe(2)
    expect(filterRecordRows(r, { search: 's1' })[0].id).toBe(1)
  })
  it('contract rows match case-insensitively and derive status', () => {
    const rows = supplierContractRows([{ id: 1, supplier_name: 'acme', contract_end: '2026-09-30', price_per_unit: 10, min_order: 5 }, { id: 2, supplier_name: 'x' }], 'ACME', new Date(2026, 8, 26))
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('Expiring Soon')
    expect(rows[0].value).toBe(50)
  })
  it('helpers', () => {
    expect(breakdownBy([], 'site')).toEqual([])
    expect(ratingToNum('Approved')).toBe(2)
    expect(numToRating(4)).toBe('Probation')
    expect(recordExportRows(recordRows(recs))[1].risk_level).toBe('High')
    expect(recordExportRows(recordRows(recs))[0].risk_level).toBe('Not rated')
  })
})
