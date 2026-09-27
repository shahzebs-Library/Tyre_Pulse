import { describe, it, expect } from 'vitest'
import {
  filterEmissionsTests, complianceSnapshot, passRate, renewalPipeline,
  pollutantAverages, costByCurrency, emissionsKpis,
} from '../lib/emissionsAnalytics'

const NOW = Date.parse('2026-09-27T12:00:00Z')
const rows = [
  { id: 1, asset_no: 'A', test_date: '2025-09-01', expiry_date: '2026-09-01', result: 'pass', co_pct: 0.5, cost: 100, currency: 'SAR' },
  { id: 2, asset_no: 'A', test_date: '2026-09-10', expiry_date: '2026-10-10', result: 'fail', co_pct: 1.5, cost: 100, currency: 'sar' },
  { id: 3, asset_no: 'B', test_date: '2026-01-01', expiry_date: '2026-09-01', result: 'pass', cost: 50, currency: 'AED' },
  { id: 4, asset_no: 'C', test_date: '2026-05-01', expiry_date: null, result: '' },
  { id: 5, asset_no: 'D', test_date: '2026-05-01', expiry_date: '2027-05-01', result: 'conditional' },
]

describe('emissionsAnalytics', () => {
  it('filters by result, no-result and expiry status', () => {
    expect(filterEmissionsTests(rows, { result: 'pass', nowMs: NOW })).toHaveLength(2)
    expect(filterEmissionsTests(rows, { result: 'none', nowMs: NOW }).map((r) => r.id)).toEqual([4])
    expect(filterEmissionsTests(rows, { expiry: 'expired', nowMs: NOW }).map((r) => r.id)).toEqual([1, 3])
  })

  it('snapshot uses the latest certificate, soonest expiry first', () => {
    const s = complianceSnapshot(rows, NOW)
    expect(s.map((r) => r.asset_no)).toEqual(['B', 'A', 'D', 'C'])
    expect(s.find((r) => r.asset_no === 'A').expiry_status).toBe('expiring_soon')
  })

  it('pass rate is null without decided results', () => {
    expect(passRate(rows).rate).toBe(66.7)
    expect(passRate([{ result: 'conditional' }]).rate).toBeNull()
  })

  it('buckets renewals', () => {
    expect(renewalPipeline(rows, NOW)).toEqual({ overdue: 1, d30: 1, d60: 0, d90: 0, later: 1, unknown: 1 })
  })

  it('averages pollutants honestly and splits cost by currency', () => {
    const p = pollutantAverages(rows)
    expect(p.find((x) => x.key === 'co_pct').average).toBe(1)
    expect(p.find((x) => x.key === 'nox_ppm').average).toBeNull()
    const c = costByCurrency(rows)
    expect(c).toEqual([{ currency: 'SAR', cost: 200, tests: 2 }, { currency: 'AED', cost: 50, tests: 1 }])
  })

  it('kpis', () => {
    const k = emissionsKpis(rows, NOW)
    expect(k.assets).toBe(4)
    expect(k.expired).toBe(1)
    expect(k.expiringSoon).toBe(1)
    expect(k.compliantShare).toBe(50)
    expect(emissionsKpis([], NOW).passRate).toBeNull()
    expect(emissionsKpis([], NOW).compliantShare).toBeNull()
  })
})
