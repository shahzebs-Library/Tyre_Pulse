import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber, stockValue, needsReorder, stockStatus,
  summariseMaterials, byCategory, reorderList,
} from '../lib/materials'

describe('materials — toFiniteNumber', () => {
  it('parses numbers and numeric strings', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('42')).toBe(42)
    expect(toFiniteNumber('1,200.50')).toBe(1200.5)
    expect(toFiniteNumber('-5')).toBe(-5)
  })
  it('returns null for empty / non-numeric input', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('materials — stockValue', () => {
  it('multiplies quantity by unit cost', () => {
    expect(stockValue({ quantity_on_hand: 10, unit_cost: 25 })).toBe(250)
  })
  it('handles numeric strings', () => {
    expect(stockValue({ quantity_on_hand: '4', unit_cost: '12.5' })).toBe(50)
  })
  it('returns 0 when quantity or cost is missing/non-numeric', () => {
    expect(stockValue({ quantity_on_hand: 10 })).toBe(0)
    expect(stockValue({ unit_cost: 5 })).toBe(0)
    expect(stockValue({ quantity_on_hand: 'x', unit_cost: 5 })).toBe(0)
    expect(stockValue({})).toBe(0)
    expect(stockValue(null)).toBe(0)
  })
  it('never returns a negative value from dirty data', () => {
    expect(stockValue({ quantity_on_hand: -10, unit_cost: 5 })).toBe(0)
    expect(stockValue({ quantity_on_hand: 10, unit_cost: -5 })).toBe(0)
  })
})

describe('materials — needsReorder', () => {
  it('is true when quantity is at or below the reorder point', () => {
    expect(needsReorder({ quantity_on_hand: 5, reorder_point: 10 })).toBe(true)
    expect(needsReorder({ quantity_on_hand: 10, reorder_point: 10 })).toBe(true)
  })
  it('is false when quantity is above the reorder point', () => {
    expect(needsReorder({ quantity_on_hand: 20, reorder_point: 10 })).toBe(false)
  })
  it('is true when out of stock', () => {
    expect(needsReorder({ quantity_on_hand: 0, reorder_point: 0 })).toBe(true)
    expect(needsReorder({ quantity_on_hand: -3, reorder_point: 0 })).toBe(true)
  })
  it('is false with stock on hand and a zero reorder point', () => {
    expect(needsReorder({ quantity_on_hand: 5, reorder_point: 0 })).toBe(false)
  })
})

describe('materials — stockStatus', () => {
  it('returns out_of_stock when quantity <= 0', () => {
    expect(stockStatus({ quantity_on_hand: 0, reorder_point: 5 })).toBe('out_of_stock')
    expect(stockStatus({ quantity_on_hand: -2, reorder_point: 5 })).toBe('out_of_stock')
    expect(stockStatus({})).toBe('out_of_stock')
  })
  it('returns low when quantity is at/below reorder point but positive', () => {
    expect(stockStatus({ quantity_on_hand: 3, reorder_point: 5 })).toBe('low')
    expect(stockStatus({ quantity_on_hand: 5, reorder_point: 5 })).toBe('low')
  })
  it('returns active when quantity is above reorder point', () => {
    expect(stockStatus({ quantity_on_hand: 10, reorder_point: 5 })).toBe('active')
    expect(stockStatus({ quantity_on_hand: 1, reorder_point: 0 })).toBe('active')
  })
})

describe('materials — summariseMaterials', () => {
  const rows = [
    { name: 'Oil A', category: 'oil', quantity_on_hand: 10, reorder_point: 4, unit_cost: 20 },   // active, value 200
    { name: 'Filter B', category: 'filter', quantity_on_hand: 2, reorder_point: 5, unit_cost: 15 }, // low + reorder, value 30
    { name: 'Valve C', category: 'valve', quantity_on_hand: 0, reorder_point: 3, unit_cost: 8 },   // out + reorder, value 0
    { name: 'Grease D', category: 'oil', quantity_on_hand: 6, reorder_point: 6, unit_cost: 10 },   // low + reorder, value 60
  ]
  const s = summariseMaterials(rows)

  it('counts total items', () => { expect(s.totalItems).toBe(4) })
  it('sums total stock value', () => { expect(s.totalStockValue).toBe(290) })
  it('counts low and out-of-stock items', () => {
    expect(s.lowStockCount).toBe(2)
    expect(s.outOfStockCount).toBe(1)
  })
  it('counts distinct categories', () => { expect(s.distinctCategories).toBe(3) })
  it('counts items needing reorder', () => { expect(s.reorderCount).toBe(3) })
  it('handles empty / non-array input', () => {
    const e = summariseMaterials([])
    expect(e.totalItems).toBe(0)
    expect(e.totalStockValue).toBe(0)
    expect(summariseMaterials(null).totalItems).toBe(0)
  })
})

describe('materials — byCategory', () => {
  const rows = [
    { category: 'oil', quantity_on_hand: 10, unit_cost: 20 },   // 200
    { category: 'oil', quantity_on_hand: 5, unit_cost: 10 },    // 50
    { category: 'filter', quantity_on_hand: 4, unit_cost: 100 }, // 400
    { category: '', quantity_on_hand: 2, unit_cost: 5 },        // uncategorised 10
  ]
  const g = byCategory(rows)

  it('groups and sorts by stock value descending', () => {
    expect(g[0].category).toBe('filter')
    expect(g[0].stockValue).toBe(400)
    expect(g[1].category).toBe('oil')
    expect(g[1].stockValue).toBe(250)
    expect(g[1].items).toBe(2)
  })
  it('buckets missing category as uncategorised', () => {
    const u = g.find((x) => x.category === 'uncategorised')
    expect(u).toBeTruthy()
    expect(u.stockValue).toBe(10)
    expect(u.items).toBe(1)
  })
  it('returns [] for empty input', () => {
    expect(byCategory([])).toEqual([])
    expect(byCategory(null)).toEqual([])
  })
})

describe('materials — reorderList', () => {
  const rows = [
    { name: 'Oil A', sku: 'OIL-A', quantity_on_hand: 8, reorder_point: 4 },       // ok, excluded
    { name: 'Filter B', sku: 'FIL-B', quantity_on_hand: 1, reorder_point: 5, reorder_qty: 20 }, // shortfall 4
    { name: 'Valve C', sku: 'VAL-C', quantity_on_hand: 0, reorder_point: 10 },    // shortfall 10, no reorder_qty
  ]
  const list = reorderList(rows)

  it('excludes items above their reorder point', () => {
    expect(list.some((x) => x.sku === 'OIL-A')).toBe(false)
    expect(list).toHaveLength(2)
  })
  it('sorts by shortfall descending', () => {
    expect(list[0].sku).toBe('VAL-C')
    expect(list[0].shortfall).toBe(10)
    expect(list[1].sku).toBe('FIL-B')
    expect(list[1].shortfall).toBe(4)
  })
  it('uses configured reorder_qty, falling back to the shortfall', () => {
    expect(list.find((x) => x.sku === 'FIL-B').reorder_qty).toBe(20)
    expect(list.find((x) => x.sku === 'VAL-C').reorder_qty).toBe(10)
  })
  it('falls back to sku for name and returns null sku when absent', () => {
    const r = reorderList([{ sku: 'ONLY-SKU', quantity_on_hand: 0, reorder_point: 2 }])
    expect(r[0].name).toBe('ONLY-SKU')
    const r2 = reorderList([{ name: 'No SKU', quantity_on_hand: 0, reorder_point: 2 }])
    expect(r2[0].sku).toBeNull()
  })
  it('returns [] for empty input', () => {
    expect(reorderList([])).toEqual([])
    expect(reorderList(null)).toEqual([])
  })
})
