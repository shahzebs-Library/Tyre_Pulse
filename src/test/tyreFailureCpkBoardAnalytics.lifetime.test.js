import { describe, it, expect } from 'vitest'
import { removedRegister } from '../lib/tyreFailureCpkBoardAnalytics'
import { lifeDistribution, removedRows } from '../lib/tyreFailureView'

const three = [
  { id: 1, serial_no: 'YMA55312', country: 'KSA', asset_no: 'TM1', issue_date: '2025-01-01', removal_date: '2025-03-01', km_at_fitment: 10000, km_at_removal: 30000, cost_per_tyre: 1000, status: 'Removed' },
  { id: 2, serial_no: 'YMA55312', country: 'KSA', asset_no: 'TM2', issue_date: '2025-03-05', removal_date: '2025-06-01', km_at_fitment: 50000, km_at_removal: 60000, cost_per_tyre: 1000, status: 'Removed' },
  { id: 3, serial_no: 'YMA55312', country: 'KSA', asset_no: 'TM3', issue_date: '2025-06-05', removal_date: '2025-09-01', km_at_fitment: 5000, km_at_removal: 35000, cost_per_tyre: 1000, status: 'Removed' },
]

describe('removed register and life distribution on the lifetime layer', () => {
  it('one tyre on 3 vehicles: lifetime km summed, lifetime CPK price once', () => {
    const reg = removedRegister(three)
    expect(reg.every((r) => r.lifetimeKm === 60000)).toBe(true)
    expect(reg[0].lifetimeCpk).toBeCloseTo(1000 / 60000, 9)
    expect(reg[0].fitments).toBe(3)
    const d = lifeDistribution(three)
    expect(d).toMatchObject({ measured: 1, total: 1, fitments: 3 })
    expect(d.bands.find((b) => b.key === '50_70').count).toBe(1)
  })
  it('a refit is not a second purchase: per-fitment CPK and purchase cost null on the refit', () => {
    const reg = removedRegister(three)
    expect(reg[0].cpk).toBeCloseTo(0.05, 9)
    expect(reg[1].cpk).toBeNull()
    expect(reg[1].cpkKind).toBe('per_fitment')
    const rows = removedRows(three)
    expect(rows.filter((r) => r.purchaseCost != null)).toHaveLength(1)
  })
  it('the register stays one row per removal event (fitment)', () => {
    expect(removedRegister(three)).toHaveLength(3)
    expect(removedRegister(three).map((r) => r.lifeKm)).toEqual([20000, 10000, 30000])
  })
})
