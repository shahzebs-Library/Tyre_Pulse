import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CPK_BENCHMARK, FAILURE_THRESHOLD,
  parseDay, toMonthKey, dataAnchorDate, last12Months,
  daysToExpiry, contractStatus, contractValue, filterContracts, summarizeContracts,
  supplierMetrics, autoRate, filterRecords, buildSupplierMetrics, filterSuppliers,
  supplierKpis, sortByCpk, vsBenchmark, radarScores, yoySpend, monthlySpend,
  recommendationFacts, supplierExportRows, contractExportRows,
  SUPPLIER_EXPORT_COLUMNS, CONTRACT_EXPORT_COLUMNS,
} from '../lib/supplierManagementAnalytics'
import { computeCpkFleet } from '../lib/kpiEngine'

const NOW = new Date(2026, 8, 26) // 26 Sep 2026, local

const tyre = (o) => ({ brand: 'A', site: 'NHC', country: 'KSA', size: '315/80R22.5', qty: 1, ...o })

const RECORDS = [
  tyre({ brand: 'A', cost_per_tyre: 1000, km_at_fitment: 1000, km_at_removal: 101000, issue_date: '2026-03-10', risk_level: 'Low' }),
  tyre({ brand: 'A', cost_per_tyre: 1200, km_at_fitment: 2000, km_at_removal: 82000, issue_date: '2025-05-02', risk_level: 'High' }),
  tyre({ brand: 'B', cost_per_tyre: 2000, km_at_fitment: 500, km_at_removal: 40500, issue_date: '2026-01-15', risk_level: 'Critical', site: 'DHAHBAN' }),
  tyre({ brand: 'B', cost_per_tyre: 900, issue_date: '2026-02-01', risk_level: 'Low', site: 'DHAHBAN' }), // no km
  tyre({ brand: 'C', cost_per_tyre: 800, issue_date: '2025-12-01', country: 'UAE' }), // no km at all
]

describe('dates', () => {
  it('parses a date-only string as local midnight', () => {
    const d = parseDay('2026-01-01')
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 0, 1])
    expect(parseDay('')).toBeNull()
    expect(parseDay('not a date')).toBeNull()
  })
  it('month keys come from the string for ISO values', () => {
    expect(toMonthKey('2026-03-01')).toBe('2026-03')
    expect(toMonthKey(null)).toBeNull()
  })
  it('anchors to the latest issue_date, else to the injected now', () => {
    expect(dataAnchorDate(RECORDS, NOW).getFullYear()).toBe(2026)
    expect(dataAnchorDate(RECORDS, NOW).getMonth()).toBe(2)
    expect(dataAnchorDate([], NOW).getTime()).toBe(NOW.getTime())
  })
  it('last12Months ends at the anchor month', () => {
    const m = last12Months(new Date(2026, 2, 10))
    expect(m).toHaveLength(12)
    expect(m[11]).toBe('2026-03')
    expect(m[0]).toBe('2025-04')
  })
})

describe('contracts', () => {
  const C = [
    { id: 1, supplier_name: 'Alpha', contract_end: '2026-10-10', price_per_unit: 100, min_order: 10 },
    { id: 2, supplier_name: 'Beta', contract_end: '2026-09-01', price_per_unit: 50, min_order: 4 },
    { id: 3, supplier_name: 'Gamma', contract_end: null, price_per_unit: 20 },
    { id: 4, supplier_name: 'Delta', contract_end: '2027-06-01', price_per_unit: 10, min_order: 5 },
  ]
  it('status and days are measured against the injected now', () => {
    expect(daysToExpiry(C[0], NOW)).toBe(14)
    expect(contractStatus(C[0], NOW)).toBe('Expiring Soon')
    expect(contractStatus(C[1], NOW)).toBe('Expired')
    expect(contractStatus(C[3], NOW)).toBe('Active')
  })
  it('an open-ended contract is Active with no days to expiry (not 0)', () => {
    expect(daysToExpiry(C[2], NOW)).toBeNull()
    expect(contractStatus(C[2], NOW)).toBe('Active')
  })
  it('committed value needs both price and minimum order', () => {
    expect(contractValue(C[0])).toBe(1000)
    expect(contractValue(C[2])).toBeNull()
  })
  it('summary counts statuses and excludes expired contracts from committed value', () => {
    const s = summarizeContracts(C, NOW)
    expect(s).toMatchObject({ total: 4, active: 2, expiringSoon: 1, expired: 1, noEndDate: 1, committedValue: 1050, valuedCount: 2 })
    expect(s.expiring.map((c) => c.supplier_name)).toEqual(['Alpha'])
  })
  it('committed value is N/A (null), never 0, when nothing is valued', () => {
    expect(summarizeContracts([{ supplier_name: 'X' }], NOW).committedValue).toBeNull()
    expect(summarizeContracts([], NOW).committedValue).toBeNull()
  })
  it('filters by search and status', () => {
    expect(filterContracts(C, { search: 'alp' }, NOW).map((c) => c.id)).toEqual([1])
    expect(filterContracts(C, { status: 'Expired' }, NOW).map((c) => c.id)).toEqual([2])
    expect(filterContracts(C, {}, NOW)).toHaveLength(4)
  })
  it('export rows render missing values as N/A', () => {
    const rows = contractExportRows(C, NOW)
    expect(rows[2]).toMatchObject({ contract_end: 'N/A', days_to_expiry: 'N/A', min_order: 'N/A', committed_value: 'N/A', status: 'Active' })
    expect(Object.keys(rows[0]).sort()).toEqual(CONTRACT_EXPORT_COLUMNS.map((c) => c.key).sort())
  })
})

describe('supplier metrics', () => {
  it('CPK comes from kpiEngine, not a second implementation', () => {
    const m = supplierMetrics(RECORDS, 'A', 2026)
    expect(m.avgCpk).toBe(computeCpkFleet(RECORDS.filter((r) => r.brand === 'A')).fleetAvgCpk)
    expect(m.avgCpk).toBeCloseTo((0.01 + 0.015) / 2, 6)
  })
  it('life and CPK are null (N/A) when no tyre has measured km', () => {
    const m = supplierMetrics(RECORDS, 'C', 2026)
    expect(m.avgCpk).toBeNull()
    expect(m.avgLife).toBeNull()
    expect(m.failureRate).toBe(0)
  })
  it('failure rate counts High and Critical', () => {
    expect(supplierMetrics(RECORDS, 'B', 2026).failureRate).toBe(0.5)
  })
  it('spend for the anchor year and in total', () => {
    const m = supplierMetrics(RECORDS, 'A', 2026)
    expect(m.spendThisYear).toBe(1000)
    expect(m.totalSpend).toBe(2200)
  })
  it('autoRate bands', () => {
    expect(autoRate({ avgCpk: 0.5, failureRate: 0 })).toBe('Preferred')
    expect(autoRate({ avgCpk: null, failureRate: 0.3 })).toBe('Probation')
    expect(autoRate({ avgCpk: CPK_BENCHMARK * 1.5, failureRate: 0 })).toBe('Under Review')
    expect(autoRate({ avgCpk: null, failureRate: 0.05 })).toBe('Approved')
  })
  it('a stored rating wins over the automatic one', () => {
    const list = buildSupplierMetrics(RECORDS, { B: { label: 'Preferred' } }, NOW)
    const b = list.find((m) => m.brand === 'B')
    expect(b.rating).toBe('Preferred')
    expect(b.ratingSource).toBe('manual')
    expect(list.find((m) => m.brand === 'A').ratingSource).toBe('auto')
  })
  it('filters records and suppliers', () => {
    expect(filterRecords(RECORDS, { country: 'UAE' })).toHaveLength(1)
    expect(filterRecords(RECORDS, { site: 'DHAHBAN' })).toHaveLength(2)
    const list = buildSupplierMetrics(RECORDS, {}, NOW)
    expect(filterSuppliers(list, { search: 'b' }).map((m) => m.brand)).toEqual(['B'])
  })
})

describe('kpis, ranking and comparison', () => {
  const list = buildSupplierMetrics(RECORDS, {}, NOW)
  it('kpis cover best, worst, spend, at-risk and CPK coverage', () => {
    const k = supplierKpis(list)
    expect(k.total).toBe(3)
    expect(k.best.brand).toBe('A')
    expect(k.worst.brand).toBe('B')
    expect(k.atRiskCount).toBe(2) // A and B both at 50%
    expect(k.totalSpend).toBe(2200 + 2900 + 800)
    expect(k.cpkCoverage).toBeCloseTo(2 / 3, 6)
  })
  it('kpis are null (N/A) on an empty set', () => {
    const k = supplierKpis([])
    expect(k.totalSpend).toBeNull()
    expect(k.cpkCoverage).toBeNull()
    expect(k.best).toBeNull()
  })
  it('sortByCpk puts unmeasured suppliers last', () => {
    expect(sortByCpk(list).map((m) => m.brand)).toEqual(['A', 'B', 'C'])
  })
  it('vsBenchmark is null when CPK is unmeasured', () => {
    expect(vsBenchmark(null)).toBeNull()
    expect(vsBenchmark(CPK_BENCHMARK)).toBe(0)
  })
  it('radar scores stay within 0..100', () => {
    for (const m of list) {
      for (const v of Object.values(radarScores(m, list))) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(100)
      }
    }
  })
  it('year on year spend returns null change when the prior year is empty', () => {
    const y = yoySpend(list, 2026)
    expect(y.find((r) => r.brand === 'B').change).toBeNull()
    expect(y.find((r) => r.brand === 'A')).toMatchObject({ thisYear: 1000, lastYear: 1200 })
  })
  it('monthly spend buckets by month key', () => {
    expect(monthlySpend(RECORDS, ['2026-01', '2026-02'])).toEqual([2000, 900])
  })
})

describe('recommendations', () => {
  it('flags high failure suppliers', () => {
    const list = buildSupplierMetrics(RECORDS, {}, NOW)
    const facts = recommendationFacts(list)
    expect(facts.some((f) => f.type === 'review' && f.brand === 'B' && f.rate > FAILURE_THRESHOLD)).toBe(true)
  })
  it('the saving estimate uses MEASURED km only, no invented distance', () => {
    // B has one measured tyre (40,000 km); the unmeasured one must add nothing.
    const list = buildSupplierMetrics(RECORDS, {}, NOW)
    const b = list.find((m) => m.brand === 'B')
    const a = list.find((m) => m.brand === 'A')
    const saving = recommendationFacts(list).find((f) => f.type === 'saving')
    expect(saving.amount).toBeCloseTo((b.avgCpk - a.avgCpk) * 40000, 4)
  })
  it('returns nothing for an empty set', () => {
    expect(recommendationFacts([])).toEqual([])
  })
})

describe('export shaping', () => {
  it('supplier rows carry N/A for unmeasured values and match the column list', () => {
    const rows = supplierExportRows(buildSupplierMetrics(RECORDS, {}, NOW))
    const c = rows.find((r) => r.brand === 'C')
    expect(c).toMatchObject({ avg_cpk: 'N/A', avg_life_km: 'N/A', vs_benchmark: 'N/A' })
    expect(Object.keys(c).sort()).toEqual(SUPPLIER_EXPORT_COLUMNS.map((x) => x.key).sort())
  })
})

describe('page wiring', () => {
  const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8').replace(/\r\n/g, '\n')
  it('SupplierManagement renders its grids through EnterpriseTable, not raw tables', () => {
    const src = read('src/pages/SupplierManagement.jsx')
    expect(src).not.toMatch(/<table[\s>]/)
    expect(src).toContain('EnterpriseTable')
    expect(src).toContain('supplierManagementAnalytics')
    // Exports follow the filtered supplier set on screen.
    expect(src).toContain('supplierExportRows(filteredSuppliers)')
  })
  it('TyreSpecifications renders its grids through EnterpriseTable with sorting off', () => {
    // The page was rebuilt on the kit; its table shell moved to tyreSpec/parts.
    const page = read('src/pages/TyreSpecifications.jsx')
    const parts = read('src/components/tyreSpec/parts.jsx')
    expect(page).not.toMatch(/<table[\s>]/)
    expect(parts).not.toMatch(/<table[\s>]/)
    expect(parts).toMatch(/function SpecTable[\s\S]*enableSorting=\{false\}/)
  })
})
