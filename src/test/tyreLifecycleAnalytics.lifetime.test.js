import { describe, it, expect } from 'vitest'
import { lifecycleKpis, brandLife, kmBandCounts, costByCategory, lifecycleRows, stageFunnel } from '../lib/tyreLifecycleAnalytics'

const three = [
  { id: 1, serial_number: 'YMA55312', country: 'KSA', brand: 'X', asset_no: 'TM1', issue_date: '2025-01-01', removal_date: '2025-03-01', km_at_fitment: 10000, km_at_removal: 30000, cost_per_tyre: 1000, status: 'Removed' },
  { id: 2, serial_number: 'YMA55312', country: 'KSA', brand: 'X', asset_no: 'TM2', issue_date: '2025-03-05', removal_date: '2025-06-01', km_at_fitment: 50000, km_at_removal: 60000, cost_per_tyre: 1000, status: 'Removed' },
  { id: 3, serial_number: 'YMA55312', country: 'KSA', brand: 'X', asset_no: 'TM3', issue_date: '2025-06-05', removal_date: '2025-09-01', km_at_fitment: 5000, km_at_removal: 35000, cost_per_tyre: 1000, status: 'Removed' },
]

describe('tyreLifecycleAnalytics on physical tyres', () => {
  it('one tyre on 3 vehicles counts as one tyre with km summed and price once', () => {
    const k = lifecycleKpis(three)
    expect(k.tyres).toBe(1)
    expect(k.avgLifeKm).toBe(60000)
    expect(k.measuredLife).toBe(1)
    expect(k.avgCpk).toBeCloseTo(1000 / 60000, 9)
    expect(k.cpkKind).toBe('fleet_aggregate')
    expect(brandLife(three)[0]).toMatchObject({ brand: 'X', totalAvg: 60000, samples: 1 })
    expect(kmBandCounts(three).find((b) => b.label === '60-80k').count).toBe(1)
    expect(costByCategory(three).total).toBe(1000)
  })
  it('a refit on the same vehicle is not a second purchase', () => {
    const refit = [three[0], { ...three[1], asset_no: 'TM1' }]
    expect(costByCategory(refit).total).toBe(1000)
    const rows = lifecycleRows(refit)
    expect(rows[1]._cpk).toBeNull()
    expect(rows[1]._cpkKind).toBe('per_fitment')
  })
  it('stage counts and records stay per fitment', () => {
    expect(lifecycleKpis(three).records).toBe(3)
    expect(lifecycleKpis(three).removed).toBe(3)
    expect(stageFunnel(three).find((s) => s.stage === 'Removed').count).toBe(3)
  })
})
