/**
 * Supplier Marketplace — pure domain-logic tests. Covers the deterministic
 * roll-ups the page and service depend on: listing value, listing/RFQ KPI
 * summaries, category grouping, supplier ranking, saving estimates, and the
 * numeric coercion primitive.
 */
import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber, listingValue, summariseListings, byCategory,
  topRatedSuppliers, summariseRfqs, potentialSaving,
} from '../lib/marketplace'

describe('toFiniteNumber', () => {
  it('parses plain numbers and numeric strings', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('1200')).toBe(1200)
    expect(toFiniteNumber('1,050.50')).toBe(1050.5)
  })
  it('returns null for empty/nullish/non-numeric input', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('listingValue', () => {
  it('multiplies unit_price by moq', () => {
    expect(listingValue({ unit_price: 100, moq: 10 })).toBe(1000)
    expect(listingValue({ unit_price: '99.99', moq: '2' })).toBe(199.98)
  })
  it('returns null when either side is missing or non-numeric', () => {
    expect(listingValue({ unit_price: 100 })).toBeNull()
    expect(listingValue({ moq: 10 })).toBeNull()
    expect(listingValue({ unit_price: 'x', moq: 10 })).toBeNull()
    expect(listingValue({})).toBeNull()
  })
})

describe('summariseListings', () => {
  const rows = [
    { supplier: 'A', category: 'tyre', status: 'active', in_stock: true, rating: 4 },
    { supplier: 'A', category: 'parts', status: 'archived', in_stock: false, rating: 2 },
    { supplier: 'B', category: 'tyre', status: 'active', in_stock: true, rating: null },
  ]
  it('counts totals, active, in-stock, distinct suppliers and categories', () => {
    const s = summariseListings(rows)
    expect(s.totalListings).toBe(3)
    expect(s.activeCount).toBe(2)
    expect(s.inStockCount).toBe(2)
    expect(s.distinctSuppliers).toBe(2)
    expect(s.distinctCategories).toBe(2)
  })
  it('averages only rated rows and rounds to 2 dp', () => {
    expect(summariseListings(rows).avgRating).toBe(3)
  })
  it('returns null avgRating when nothing is rated, and zeroes on empty', () => {
    expect(summariseListings([{ supplier: 'X' }]).avgRating).toBeNull()
    const empty = summariseListings([])
    expect(empty.totalListings).toBe(0)
    expect(empty.distinctSuppliers).toBe(0)
    expect(empty.avgRating).toBeNull()
  })
  it('treats string/1 truthy in_stock as in stock', () => {
    expect(summariseListings([{ supplier: 'A', in_stock: 'true' }, { supplier: 'B', in_stock: 1 }]).inStockCount).toBe(2)
  })
})

describe('byCategory', () => {
  const rows = [
    { category: 'tyre', unit_price: 100 },
    { category: 'tyre', unit_price: 200 },
    { category: 'parts', unit_price: 50 },
    { category: 'tyre', unit_price: null },
  ]
  it('groups, counts and averages price per category', () => {
    const out = byCategory(rows)
    const tyre = out.find((c) => c.category === 'tyre')
    expect(tyre.listings).toBe(3)
    expect(tyre.avgPrice).toBe(150) // only priced rows averaged
    expect(out.find((c) => c.category === 'parts').avgPrice).toBe(50)
  })
  it('sorts by listings count descending', () => {
    expect(byCategory(rows)[0].category).toBe('tyre')
  })
  it('buckets missing category as uncategorised and yields null avgPrice when unpriced', () => {
    const out = byCategory([{ unit_price: null }, {}])
    expect(out).toHaveLength(1)
    expect(out[0].category).toBe('uncategorised')
    expect(out[0].avgPrice).toBeNull()
  })
})

describe('topRatedSuppliers', () => {
  const rows = [
    { supplier: 'A', rating: 5 },
    { supplier: 'A', rating: 3 },
    { supplier: 'B', rating: 4.5 },
    { supplier: 'C', rating: null },
  ]
  it('ranks suppliers by average rating descending', () => {
    const out = topRatedSuppliers(rows)
    expect(out[0].supplier).toBe('B')
    expect(out[0].avgRating).toBe(4.5)
    expect(out[1].supplier).toBe('A')
    expect(out[1].avgRating).toBe(4)
  })
  it('excludes suppliers with no rated listings', () => {
    expect(topRatedSuppliers(rows).find((s) => s.supplier === 'C')).toBeUndefined()
  })
  it('counts all of a supplier’s listings even when some are unrated', () => {
    const out = topRatedSuppliers([{ supplier: 'A', rating: 4 }, { supplier: 'A', rating: null }])
    expect(out[0].listings).toBe(2)
  })
})

describe('summariseRfqs', () => {
  const rows = [
    { status: 'open', responses_count: 2 },
    { status: 'awarded', responses_count: 5 },
    { status: 'open', responses_count: null },
    { status: 'closed', responses_count: 1 },
  ]
  it('counts totals, open, awarded and sums responses', () => {
    const s = summariseRfqs(rows)
    expect(s.totalRfqs).toBe(4)
    expect(s.openCount).toBe(2)
    expect(s.awardedCount).toBe(1)
    expect(s.totalResponses).toBe(8)
  })
  it('averages responses across all rows and rounds', () => {
    expect(summariseRfqs(rows).avgResponses).toBe(2) // 8 / 4
  })
  it('returns zeroed summary on empty input', () => {
    const s = summariseRfqs([])
    expect(s.totalRfqs).toBe(0)
    expect(s.avgResponses).toBe(0)
    expect(s.totalResponses).toBe(0)
  })
})

describe('potentialSaving', () => {
  it('returns positive delta when best quote beats target', () => {
    expect(potentialSaving({ target_price: 1100, best_quote: 1000 })).toBe(100)
    expect(potentialSaving({ target_price: '1200.50', best_quote: '1200' })).toBe(0.5)
  })
  it('returns 0 when best quote meets or exceeds target', () => {
    expect(potentialSaving({ target_price: 1000, best_quote: 1000 })).toBe(0)
    expect(potentialSaving({ target_price: 1000, best_quote: 1200 })).toBe(0)
  })
  it('returns 0 when either value is missing', () => {
    expect(potentialSaving({ target_price: 1000 })).toBe(0)
    expect(potentialSaving({ best_quote: 900 })).toBe(0)
    expect(potentialSaving({})).toBe(0)
  })
})
