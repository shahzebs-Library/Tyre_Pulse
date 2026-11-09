import { describe, it, expect } from 'vitest'
import { averageLife, cpkOf, recordLifeKm } from '../lib/tyreRecordsView'

const three = [
  { id: 1, serial_no: 'YMA55312', country: 'KSA', asset_no: 'TM1', issue_date: '2025-01-01', removal_date: '2025-03-01', km_at_fitment: 10000, km_at_removal: 30000, cost_per_tyre: 1000, status: 'Removed' },
  { id: 2, serial_no: 'YMA55312', country: 'KSA', asset_no: 'TM2', issue_date: '2025-03-05', removal_date: '2025-06-01', km_at_fitment: 50000, km_at_removal: 60000, cost_per_tyre: 1000, status: 'Removed' },
  { id: 3, serial_no: 'YMA55312', country: 'KSA', asset_no: 'TM3', issue_date: '2025-06-05', removal_date: '2025-09-01', km_at_fitment: 5000, km_at_removal: 35000, cost_per_tyre: 1000, status: 'Removed' },
]

describe('tyreRecordsView lifetime', () => {
  it('rows given: one tyre on 3 vehicles averages as ONE tyre of 60,000 km', () => {
    expect(averageLife(three)).toEqual({ avg: 60000, n: 1, basis: 'tyre' })
  })
  it('numbers given: still a per-fitment average, labelled as such', () => {
    expect(averageLife(three.map(recordLifeKm))).toMatchObject({ avg: 20000, n: 3, basis: 'fitment' })
  })
  it('a refit is not a second purchase: its per-fitment CPK is null when siblings are passed', () => {
    const refit = { ...three[1], asset_no: 'TM1' }
    expect(cpkOf(three[0], [three[0], refit])).toBeCloseTo(0.05, 6)
    expect(cpkOf(refit, [three[0], refit])).toBeNull()
    // without siblings it is the bare stint (legacy behaviour kept)
    expect(cpkOf(refit)).toBeCloseTo(0.1, 6)
  })
})
