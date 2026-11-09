import { describe, it, expect } from 'vitest'
import { tyreMetrics } from '../lib/vehicle360Analytics'

const r = (o) => ({ serial_no: 'YMA55312', country: 'KSA', asset_no: 'TM1', status: 'Removed', ...o })

describe('vehicle360 tyreMetrics on physical tyres', () => {
  it('a tyre refitted on this vehicle is one tyre, price once, km summed', () => {
    const rows = [
      r({ id: 1, issue_date: '2025-01-01', removal_date: '2025-03-01', km_at_fitment: 10000, km_at_removal: 30000, cost_per_tyre: 1000, risk_level: 'High' }),
      r({ id: 2, issue_date: '2025-04-01', removal_date: '2025-06-01', km_at_fitment: 40000, km_at_removal: 60000, cost_per_tyre: 1000 }),
      r({ id: 3, issue_date: '2025-07-01', removal_date: '2025-09-01', km_at_fitment: 70000, km_at_removal: 90000, cost_per_tyre: 1200 }),
    ]
    const m = tyreMetrics(rows)
    expect(m.physicalTyres).toBe(1)
    expect(m.avgLifeKm).toBe(60000)
    expect(m.cpk).toBeCloseTo(1000 / 60000, 9)
    expect(m.priced).toBe(1)
    expect(m.cpkKind).toBe('fleet_aggregate')
    // refit rows do not change cost: same as the single first fitment price
    expect(tyreMetrics(rows.slice(0, 1)).cpk).toBeCloseTo(1000 / 20000, 9)
  })
  it('risk (an event per fitment) still counts fitments', () => {
    const m = tyreMetrics([r({ id: 1, risk_level: 'High' }), r({ id: 2, issue_date: '2025-05-01' })])
    expect(m.total).toBe(2)
    expect(m.fitments).toBe(2)
    expect(m.critical).toBe(1)
    expect(m.highRate).toBe(50)
  })
})
