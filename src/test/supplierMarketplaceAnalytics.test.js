import { describe, it, expect } from 'vitest'
import {
  filterListings, filterRfqs, listingKpis, rfqKpis, savingsByCurrency, categoryPriceByCurrency,
  rfqFunnel, isOverdueRfq, rfqExportRows, NO_CURRENCY,
} from '../lib/supplierMarketplaceAnalytics'

const NOW = new Date('2026-09-27T12:00:00Z')
const listings = [
  { id: 1, supplier: 'S1', category: 'tyre', unit_price: 1000, currency: 'SAR', lead_time_days: 10, rating: 4, in_stock: true, status: 'active' },
  { id: 2, supplier: 'S2', category: 'tyre', unit_price: 900, currency: 'AED', lead_time_days: 20, in_stock: false, status: 'active' },
  { id: 3, supplier: 'S1', category: 'tyre', unit_price: 1200, currency: 'SAR', in_stock: true, status: 'archived' },
]
const rfqs = [
  { id: 'r1', status: 'open', target_price: 1000, best_quote: 900, currency: 'SAR', needed_by: '2026-09-20', responses_count: 2 },
  { id: 'r2', status: 'awarded', target_price: 500, best_quote: 450, currency: 'AED', needed_by: '2026-09-01' },
  { id: 'r3', status: 'cancelled', target_price: 100, best_quote: 150, currency: '', needed_by: '2026-12-01' },
]

describe('supplierMarketplaceAnalytics', () => {
  it('never blends currencies: savings and prices are grouped per currency', () => {
    expect(savingsByCurrency(rfqs)).toEqual([
      { currency: 'AED', saving: 50, rfqs: 1 },
      { currency: 'SAR', saving: 100, rfqs: 1 },
    ])
    const view = categoryPriceByCurrency(listings)
    expect(view).toContainEqual(expect.objectContaining({ category: 'tyre', currency: 'SAR', listings: 2, avgPrice: 1100, minPrice: 1000, maxPrice: 1200 }))
    expect(view).toContainEqual(expect.objectContaining({ category: 'tyre', currency: 'AED', avgPrice: 900 }))
  })

  it('reports a missing currency honestly instead of assuming SAR', () => {
    const view = categoryPriceByCurrency([{ category: 'parts', unit_price: 5 }])
    expect(view[0].currency).toBe(NO_CURRENCY)
  })

  it('listing KPIs with honest averages', () => {
    const k = listingKpis(listings)
    expect(k.avgLeadDays).toBe(15)
    expect(k.inStockRate).toBe(66.7)
    expect(k.currencies).toEqual(['AED', 'SAR'])
    expect(listingKpis([]).inStockRate).toBeNull()
    expect(listingKpis([]).avgLeadDays).toBeNull()
  })

  it('RFQ KPIs: overdue, award rate, avg responses null when unrecorded', () => {
    const k = rfqKpis(rfqs, { now: NOW })
    expect(k.overdueCount).toBe(1)
    expect(k.awardRate).toBe(50)
    expect(k.avgResponses).toBe(0.67)
    expect(rfqKpis([{ status: 'open' }], { now: NOW }).avgResponses).toBeNull()
    expect(rfqKpis([], { now: NOW }).awardRate).toBeNull()
  })

  it('filters and funnel', () => {
    expect(isOverdueRfq(rfqs[0], { now: NOW })).toBe(true)
    expect(isOverdueRfq(rfqs[1], { now: NOW })).toBe(false)
    expect(filterRfqs(rfqs, { overdueOnly: true, now: NOW }).map((r) => r.id)).toEqual(['r1'])
    expect(filterRfqs(rfqs, { currency: NO_CURRENCY }).map((r) => r.id)).toEqual(['r3'])
    expect(filterListings(listings, { stock: 'out' }).map((r) => r.id)).toEqual([2])
    expect(filterListings(listings, { currency: 'SAR', status: 'active' }).map((r) => r.id)).toEqual([1])
    expect(rfqFunnel(rfqs).map((f) => f.count)).toEqual([1, 0, 1, 0, 1])
    expect(rfqExportRows(rfqs, { now: NOW })[2].potential_saving).toBe('')
  })
})
