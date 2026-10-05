import { describe, it, expect } from 'vitest'
import {
  inPeriod, applyListingExtras, listingOptions, stockState, awardedValue, headlineTiles,
  moneyLines, sourcingFunnel, quotedCount, ageLabel, recentRfqs, compareListings, listingDetailFields,
  supplierProfile, samePriceBook, NOT_RECORDED,
} from '../lib/supplierMarketplaceView'

const NOW = new Date('2026-10-05T12:00:00Z')

const L = [
  { id: 1, supplier: 'Alpha', brand: 'Michelin', country: 'UAE', unit_price: 420, currency: 'AED', moq: 20, lead_time_days: 5, rating: 4.8, in_stock: true, status: 'active', size_spec: '315/80R22.5', created_at: '2026-10-01' },
  { id: 2, supplier: 'Beta', brand: 'Bridgestone', country: 'KSA', unit_price: 365, currency: 'SAR', moq: 40, lead_time_days: 7, rating: 3.6, in_stock: false, status: 'out_of_stock', size_spec: '315/80R22.5', created_at: '2025-01-01' },
  { id: 3, supplier: 'Alpha', brand: 'Michelin', country: 'UAE', unit_price: 400, currency: 'AED', moq: null, lead_time_days: 20, rating: null, in_stock: true, status: 'active', size_spec: '315/80R22.5' },
]
const R = [
  { id: 'a', rfq_no: 'RFQ-1', product_name: 'Drive tyres', quantity: 10, best_quote: 400, currency: 'SAR', responses_count: 3, status: 'awarded', created_at: '2026-10-04' },
  { id: 'b', rfq_no: 'RFQ-2', product_name: 'Retreads', quantity: 5, best_quote: 100, currency: 'AED', responses_count: 0, status: 'awarded', created_at: '2026-09-01' },
  { id: 'c', product_name: 'Steer', status: 'open', created_at: '2026-10-05T08:00:00Z' },
  { id: 'd', product_name: 'Rims', status: 'quoting', responses_count: 2, best_quote: 50, created_at: '2026-08-01' },
]

describe('supplierMarketplaceView', () => {
  it('filters by period on created_at and drops undated rows outside All time', () => {
    expect(inPeriod(L, 'all', NOW)).toHaveLength(3)
    expect(inPeriod(L, '30', NOW).map((r) => r.id)).toEqual([1])
  })

  it('applies brand, country, rating floor and lead bucket filters', () => {
    expect(applyListingExtras(L, { brand: 'michelin' }).map((r) => r.id)).toEqual([1, 3])
    expect(applyListingExtras(L, { minRating: '4' }).map((r) => r.id)).toEqual([1])
    expect(applyListingExtras(L, { lead: 'gt14' }).map((r) => r.id)).toEqual([3])
    expect(applyListingExtras(L, { country: 'KSA' }).map((r) => r.id)).toEqual([2])
    expect(listingOptions(L)).toEqual({ brands: ['Bridgestone', 'Michelin'], countries: ['KSA', 'UAE'] })
  })

  it('labels stock honestly', () => {
    expect(stockState(L[0]).label).toBe('In stock')
    expect(stockState(L[1]).tone).toBe('bad')
    expect(stockState({}).label).toBe(NOT_RECORDED)
  })

  it('keeps awarded value per currency and nulls unmeasurable figures', () => {
    expect(awardedValue(R[0])).toBe(4000)
    expect(awardedValue(R[2])).toBeNull()
    const t = headlineTiles(L, R)
    expect(t.activeListings).toBe(2)
    expect(t.openRfqs).toBe(2)
    expect(t.responses).toBe(5)
    expect(t.avgLeadDays).toBe(10.7)
    expect(t.awarded).toEqual([{ currency: 'AED', value: 500 }, { currency: 'SAR', value: 4000 }])
    expect(moneyLines(t.awarded)).toEqual(['AED 500', 'SAR 4,000'])
    const empty = headlineTiles([], [])
    expect(empty.responses).toBeNull()
    expect(empty.avgLeadDays).toBeNull()
    expect(empty.awarded).toEqual([])
  })

  it('builds the funnel only from recorded stages', () => {
    const f = sourcingFunnel(R)
    expect(f.map((s) => s.count)).toEqual([4, null, 2, null, 2])
    expect(f[2].pct).toBe(50)
    expect(f[1].recorded).toBe(false)
    expect(f[1].pct).toBeNull()
    expect(quotedCount(R)).toBe(3)
    expect(sourcingFunnel([])[0].pct).toBeNull()
  })

  it('formats ages and orders recent RFQs newest first', () => {
    expect(ageLabel('2026-10-05T01:00:00Z', NOW)).toBe('Today')
    expect(ageLabel('2026-10-04T11:00:00Z', NOW)).toBe('1 day ago')
    expect(ageLabel('2026-09-14T12:00:00Z', NOW)).toBe('3 weeks ago')
    expect(ageLabel(null, NOW)).toBe(NOT_RECORDED)
    const rec = recentRfqs(R, { limit: 2, now: NOW })
    expect(rec.map((r) => r.id)).toEqual(['c', 'a'])
    expect(rec[0].responses).toBe('Responses not recorded')
    expect(rec[1].title).toBe('Drive tyres (10 units)')
  })

  it('compares listings within a currency only', () => {
    const c = compareListings(L)
    expect(c.mixedCurrency).toBe(true)
    const byId = Object.fromEntries(c.rows.map((r) => [r.id, r]))
    expect(byId[3].cheapest).toBe(true)
    expect(byId[1].cheapest).toBe(false)
    expect(byId[2].cheapest).toBe(true)
    expect(byId[1].total).toBe(8400)
    expect(byId[3].total).toBeNull()
  })

  it('builds detail, supplier profile and same-item prices', () => {
    const f = listingDetailFields(L[2])
    expect(f.find((x) => x.label === 'MOQ').value).toBe(NOT_RECORDED)
    expect(f.find((x) => x.label === 'Price').value).toBe('AED 400 / unit')
    expect(supplierProfile(L, 'alpha')).toMatchObject({ listings: 2, inStock: 2, avgRating: 4.8 })
    expect(samePriceBook(L, L[0]).map((x) => x.id)).toEqual([3, 1, 2])
  })
})
