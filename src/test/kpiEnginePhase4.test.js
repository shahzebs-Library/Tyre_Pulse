import { describe, it, expect } from 'vitest'
import { computeScrapRate, computeFleetAvailability, computeRemovalRate } from '../lib/kpiEngine'

// Phase 4a KPI audit fixes (docs/tyre/KPI_DEFINITIONS.md).

describe('computeScrapRate reads the scrap action, per physical tyre', () => {
  const base = { country: 'KSA', site: 'NHC', km_at_fitment: 0, km_at_removal: 40000 }
  it('counts status Scrapped (what the scrap action writes), not only category', () => {
    const rows = [
      { ...base, id: 1, serial_no: 'YMA55312', status: 'Scrapped' },
      { ...base, id: 2, serial_no: 'YMA55313', status: 'Removed' },
      { ...base, id: 3, serial_no: 'YMA55314', status: 'Active' },
      { ...base, id: 4, serial_no: 'YMA55315', status: 'Active' },
    ]
    const k = computeScrapRate(rows)
    expect(k.scrapCount).toBe(1)
    expect(k.totalCount).toBe(4)
    expect(k.scrapRate).toBe(0.25)
  })

  it('a refitted tyre whose every row is stamped Scrapped counts once', () => {
    const rows = [
      { ...base, id: 1, serial_no: 'YMA55312', status: 'Scrapped', issue_date: '2026-01-01' },
      { ...base, id: 2, serial_no: 'YMA55312', status: 'Scrapped', issue_date: '2026-03-01' },
      { ...base, id: 3, serial_no: 'YMA55399', status: 'Active' },
    ]
    const k = computeScrapRate(rows)
    expect(k.scrapCount).toBe(1)
    expect(k.totalCount).toBe(2)
    expect(k.scrapRows).toBe(2)
    expect(k.bySite[0]).toMatchObject({ site: 'NHC', scrapCount: 1, count: 2 })
  })

  it('unreadable serials are each their own tyre', () => {
    const rows = [
      { ...base, id: 1, serial_no: 'DOT', status: 'Scrapped' },
      { ...base, id: 2, serial_no: 'DOT', status: 'Scrapped' },
    ]
    expect(computeScrapRate(rows).scrapCount).toBe(2)
  })
})

describe('computeFleetAvailability is not measured without risk ratings', () => {
  it('null (not 100%) when no tyre carries a risk rating', () => {
    const r = computeFleetAvailability([{ asset_no: 'TM1', issue_date: '2026-11-01' }], 10)
    expect(r.availabilityPct).toBeNull()
    expect(r.measured).toBe(false)
    expect(r.ratedCount).toBe(0)
  })
  it('measured when ratings exist', () => {
    const today = new Date().toISOString().slice(0, 10)
    const r = computeFleetAvailability([
      { asset_no: 'TM1', issue_date: today, risk_level: 'Critical' },
      { asset_no: 'TM2', issue_date: today, risk_level: 'Low' },
    ], 10)
    expect(r.availabilityPct).toBe(90)
    expect(r.measured).toBe(true)
  })
})

describe('computeRemovalRate', () => {
  it('no measured distance gives null, never 0 per 1,000 km', () => {
    const r = computeRemovalRate([{ km_at_fitment: null, km_at_removal: null }])
    expect(r.estimatedFleetKm).toBe(0)
    expect(r.removalPer1000Km).toBeNull()
  })
})
