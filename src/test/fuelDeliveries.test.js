import { describe, it, expect } from 'vitest'
import { summarizeDeliveries } from '../lib/fuelDeliveries'

describe('summarizeDeliveries', () => {
  it('returns zeroed KPIs for empty / invalid input', () => {
    expect(summarizeDeliveries([])).toEqual({
      totalDeliveries: 0, totalLitres: 0, totalCost: 0, avgPricePerLitre: 0,
    })
    expect(summarizeDeliveries()).toEqual({
      totalDeliveries: 0, totalLitres: 0, totalCost: 0, avgPricePerLitre: 0,
    })
    expect(summarizeDeliveries(null)).toEqual({
      totalDeliveries: 0, totalLitres: 0, totalCost: 0, avgPricePerLitre: 0,
    })
  })

  it('sums litres and cost and computes blended avg price per litre', () => {
    const rows = [
      { litres: 1000, unit_price: 2.85, total_cost: 2850, status: 'delivered' },
      { litres: 500, unit_price: 3.0, total_cost: 1500, status: 'delivered' },
    ]
    const s = summarizeDeliveries(rows)
    expect(s.totalDeliveries).toBe(2)
    expect(s.totalLitres).toBe(1500)
    expect(s.totalCost).toBe(4350)
    // 4350 / 1500 = 2.9
    expect(s.avgPricePerLitre).toBe(2.9)
  })

  it('coerces string / null numeric fields', () => {
    const rows = [
      { litres: '1,000', total_cost: 'AED 2,850', status: 'delivered' },
      { litres: null, total_cost: null, status: 'delivered' },
    ]
    const s = summarizeDeliveries(rows)
    expect(s.totalLitres).toBe(1000)
    expect(s.totalCost).toBe(2850)
    expect(s.avgPricePerLitre).toBe(2.85)
    expect(s.totalDeliveries).toBe(2)
  })

  it('excludes cancelled deliveries from litres/cost but still counts them', () => {
    const rows = [
      { litres: 1000, total_cost: 2850, status: 'delivered' },
      { litres: 9999, total_cost: 99999, status: 'cancelled' },
    ]
    const s = summarizeDeliveries(rows)
    expect(s.totalDeliveries).toBe(2)
    expect(s.totalLitres).toBe(1000)
    expect(s.totalCost).toBe(2850)
  })

  it('avoids divide-by-zero when there are no litres', () => {
    const rows = [{ litres: 0, total_cost: 0, status: 'ordered' }]
    const s = summarizeDeliveries(rows)
    expect(s.avgPricePerLitre).toBe(0)
    expect(s.totalDeliveries).toBe(1)
  })
})
