import { describe, it, expect } from 'vitest'
import { bayPricedRows, bayLifetimeIndex, bayLifetimeFor, cpk, groupTyresByPosition, STINT_CPK_KIND } from '../lib/tyreBay'

const r = (o) => ({ serial_no: 'YMA55312', country: 'KSA', status: 'Removed', position: 'LHF1', ...o })
const three = [
  r({ id: 1, asset_no: 'TM1', issue_date: '2025-01-01', removal_date: '2025-03-01', km_at_fitment: 10000, km_at_removal: 30000, cost_per_tyre: 1000 }),
  r({ id: 2, asset_no: 'TM2', issue_date: '2025-03-05', removal_date: '2025-06-01', km_at_fitment: 50000, km_at_removal: 60000, cost_per_tyre: 1000 }),
  r({ id: 3, asset_no: 'TM3', issue_date: '2025-06-05', removal_date: '2025-09-01', km_at_fitment: 5000, km_at_removal: 35000, cost_per_tyre: 1000 }),
]

describe('tyreBay lifetime beside per-fitment stints', () => {
  it('one tyre on 3 vehicles: lifetime km summed, price once', () => {
    const idx = bayLifetimeIndex(three)
    expect(idx.size).toBe(1)
    const lt = bayLifetimeFor(idx, three[0], three)
    expect(lt.lifetimeKm).toBe(60000)
    expect(lt.purchaseCost).toBe(1000)
    expect(lt.lifetimeCpk).toBeCloseTo(1000 / 60000, 9)
    expect(lt.vehicles).toBe(3)
  })
  it('a refit on the same vehicle carries no purchase: stint CPK null on the refit', () => {
    const refit = [three[0], { ...three[1], asset_no: 'TM1' }]
    const priced = bayPricedRows(refit)
    expect(cpk(priced[0])).toBeCloseTo(0.05, 4)
    expect(cpk(priced[1])).toBeNull()
    expect(STINT_CPK_KIND).toBe('per_fitment')
  })
  it('history stays per fitment', () => {
    const g = groupTyresByPosition(three)
    expect(g.LHF1.history).toHaveLength(3)
  })
})
