import { describe, it, expect } from 'vitest'
import {
  turnaroundDays, daysAtVendor, jobCpk, pipelineCounts, vendorPerformance, jobsWithoutVendor,
  filterJobs, jobSummary, lifecycleSteps, singleCurrency,
} from '../lib/retreadView'
import { retreadJobPayload } from '../lib/api/retreadJobs'

const J = (o) => ({ status: 'eligible', outcome: 'pending', ...o })

describe('retreadView', () => {
  it('turnaround needs both dates, in order', () => {
    expect(turnaroundDays(J({ sent_at: '2026-01-01', returned_at: '2026-01-06' }))).toBe(5)
    expect(turnaroundDays(J({ sent_at: '2026-01-01' }))).toBeNull()
    expect(turnaroundDays(J({ sent_at: '2026-01-06', returned_at: '2026-01-01' }))).toBeNull()
  })

  it('days at vendor only for open jobs with a sent date', () => {
    const now = new Date('2026-01-11T09:00:00Z')
    expect(daysAtVendor(J({ status: 'at_vendor', sent_at: '2026-01-01' }), now)).toBe(10)
    expect(daysAtVendor(J({ status: 'returned', sent_at: '2026-01-01', returned_at: '2026-01-04' }), now)).toBeNull()
    expect(daysAtVendor(J({ status: 'at_vendor' }), now)).toBeNull()
  })

  it('job CPK is null without a recorded life', () => {
    expect(jobCpk(J({ cost: 400, life_km: 40000 }))).toBeCloseTo(0.01)
    expect(jobCpk(J({ cost: 400 }))).toBeNull()
    expect(jobCpk(J({ cost: 400, life_km: 0 }))).toBeNull()
  })

  it('pipeline splits eligible by inspection and ignores cancelled', () => {
    const p = Object.fromEntries(pipelineCounts([
      J({}), J({ inspected_at: '2026-01-01' }), J({ status: 'at_vendor' }), J({ status: 'at_vendor' }),
      J({ status: 'cancelled' }), J({ status: 'rejected' }),
    ]).map((s) => [s.key, s.count]))
    expect(p).toEqual({ awaiting: 1, eligible: 1, at_vendor: 2, qa: 0, returned: 0, rejected: 1 })
  })

  it('vendor performance: success over decided jobs, money only in one currency', () => {
    const rows = vendorPerformance([
      J({ vendor_name: 'V1', outcome: 'pass', sent_at: '2026-01-01', returned_at: '2026-01-05', cost: 400, currency: 'SAR', life_km: 40000 }),
      J({ vendor_name: 'V1', outcome: 'fail', cost: 300, currency: 'SAR' }),
      J({ vendor_name: 'V1' }),
      J({ vendor_name: 'V2', cost: 100, currency: 'SAR' }),
      J({ vendor_name: 'V2', cost: 100, currency: 'AED' }),
      J({ vendor_name: '' }),
    ])
    const v1 = rows.find((r) => r.vendor === 'V1')
    expect(v1).toMatchObject({ jobs: 3, decided: 2, successRate: 50, avgTat: 4, currency: 'SAR' })
    expect(v1.cpk).toBeCloseTo(0.01)
    const v2 = rows.find((r) => r.vendor === 'V2')
    expect(v2.successRate).toBeNull()
    expect(v2.currency).toBeNull()
    expect(v2.avgCost).toBeNull()
    expect(jobsWithoutVendor([J({ vendor_name: '' }), J({ vendor_name: 'x' })])).toBe(1)
    expect(singleCurrency([J({})])).toBeNull()
  })

  it('filters by search, vendor and status', () => {
    const rows = [J({ casing_serial: 'CS-1', vendor_name: 'A' }), J({ casing_serial: 'CS-2', vendor_name: 'B', status: 'qa' })]
    expect(filterJobs(rows, { search: 'cs-2' })).toHaveLength(1)
    expect(filterJobs(rows, { vendor: 'A' })).toHaveLength(1)
    expect(filterJobs(rows, { status: 'qa' })[0].casing_serial).toBe('CS-2')
  })

  it('summary is null where nothing is measurable', () => {
    expect(jobSummary([])).toEqual({ total: 0, open: 0, successRate: null, avgTat: null })
  })

  it('lifecycle lists only recorded steps', () => {
    expect(lifecycleSteps(null)).toEqual([])
    const s = lifecycleSteps(J({ first_life_km: 86600, last_asset_no: 'PM-001', grade: 'A', sent_at: '2026-01-01', vendor_name: 'RetreadCo' }))
    expect(s).toEqual(['86,600 km first life', 'Removed from PM-001', 'Casing grade A', 'Sent to RetreadCo 2026-01-01'])
  })

  it('payload validation: serial required, cost needs a currency, dates ordered', () => {
    expect(() => retreadJobPayload({})).toThrow(/casing serial/)
    expect(() => retreadJobPayload({ casing_serial: 'x', cost: 10 })).toThrow(/currency/)
    expect(() => retreadJobPayload({ casing_serial: 'x', sent_at: '2026-02-01', returned_at: '2026-01-01' })).toThrow(/return date/)
    const p = retreadJobPayload({ casing_serial: ' cs-9 ', cost: '450', currency: 'SAR', cycle: 9, status: 'bogus' })
    expect(p).toMatchObject({ casing_serial: 'CS-9', cost: 450, currency: 'SAR', cycle: 6, status: 'eligible', outcome: 'pending' })
  })
})
