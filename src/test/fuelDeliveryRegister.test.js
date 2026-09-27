import { describe, it, expect } from 'vitest'
import { costBasis, countriesIn, statusBreakdown, deliveryRegisterRows, deliveryExportRows } from '../lib/fuelDeliveryAnalytics'

const ROWS = [
  { id: 1, litres: 1000, total_cost: 2800, unit_price: 2.8, status: 'delivered', country: 'KSA', delivered_at: '2026-07-01' },
  { id: 2, litres: 1000, status: 'delivered', country: 'KSA', delivered_at: '2026-07-02' },
  { id: 3, litres: 500, total_cost: 1500, status: 'cancelled', country: 'KSA' },
]

describe('fuelDelivery register helpers', () => {
  it('does not treat an uncosted delivery as costing 0 in the blended price', () => {
    const m = costBasis(ROWS)
    expect(m.totalCost).toBe(2800)
    expect(m.blendedPrice).toBe(2.8)
    expect(m.costedCount).toBe(1)
    expect(m.uncostedCount).toBe(1)
  })

  it('returns null money when nothing is costed or countries are mixed', () => {
    expect(costBasis([{ litres: 10, status: 'delivered' }]).totalCost).toBeNull()
    const mixed = costBasis([...ROWS, { litres: 1, total_cost: 5, status: 'delivered', country: 'UAE' }])
    expect(mixed.mixedCurrency).toBe(true)
    expect(mixed.totalCost).toBeNull()
    expect(mixed.blendedPrice).toBeNull()
    expect(countriesIn(ROWS)).toEqual(['KSA'])
  })

  it('tallies status and shapes register + export rows', () => {
    expect(statusBreakdown(ROWS)).toEqual([{ key: 'ordered', count: 0 }, { key: 'delivered', count: 2 }, { key: 'cancelled', count: 1 }])
    const reg = deliveryRegisterRows(ROWS)
    expect(reg[0].pplValue).toBe(2.8)
    expect(reg[1].costValue).toBeNull()
    const x = deliveryExportRows(ROWS)
    expect(x[1]).toMatchObject({ total_cost: '', status: 'Delivered', delivered_at: '2026-07-02' })
    expect(x[2].status).toBe('Cancelled')
  })
})
