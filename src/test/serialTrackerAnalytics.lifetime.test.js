import { describe, it, expect } from 'vitest'
import { serialPrice, serialStats, serialLifetime } from '../lib/serialTrackerAnalytics'

const three = [
  { id: 1, serial_no: 'YMA55312', country: 'KSA', asset_no: 'TM1', issue_date: '2025-01-01', removal_date: '2025-03-01', km_at_fitment: 10000, km_at_removal: 30000, cost_per_tyre: 1000, status: 'Removed' },
  { id: 2, serial_no: 'YMA55312', country: 'KSA', asset_no: 'TM2', issue_date: '2025-03-05', removal_date: '2025-06-01', km_at_fitment: 50000, km_at_removal: 60000, cost_per_tyre: 1000, status: 'Removed' },
  { id: 3, serial_no: 'YMA55312', country: 'KSA', asset_no: 'TM3', issue_date: '2025-06-05', removal_date: '2025-09-01', km_at_fitment: 5000, km_at_removal: 35000, cost_per_tyre: 1200, status: 'Removed' },
]

describe('serialTracker lifetime', () => {
  it('price is the FIRST priced fitment, not the latest (rule T1)', () => {
    expect(serialPrice(three)).toBe(1000)
    expect(serialPrice([...three].reverse())).toBe(1000)
  })
  it('one tyre on 3 vehicles: one physical tyre, km summed, price once', () => {
    const l = serialLifetime(three)
    expect(l.physicalTyres).toBe(1)
    expect(l.km).toBe(60000)
    expect(l.purchaseCpk).toBeCloseTo(1000 / 60000, 6)
    expect(l.priceReview).toBe('Priced on 3 fitments - needs review')
  })
  it('a refit on the same vehicle does not change price or CPK', () => {
    const one = [three[0]]
    const refit = [three[0], { ...three[1], asset_no: 'TM1', km_at_fitment: 30000, km_at_removal: 30000, removal_date: null, status: 'Active' }]
    expect(serialPrice(refit)).toBe(serialPrice(one))
    expect(serialLifetime(refit).purchaseCpk).toBeCloseTo(serialLifetime(one).purchaseCpk, 9)
  })
  it('events stay per fitment: record and asset counts', () => {
    const s = serialStats(three, { now: new Date('2026-01-01') })
    expect(s.records).toBe(3)
    expect(s.pricedRecords).toBe(3)
    expect(s.assets).toBe(3)
  })
})
