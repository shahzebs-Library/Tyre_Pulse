import { describe, it, expect } from 'vitest'
import { partIsLowStock, summarizeParts } from '../lib/partsCatalog'

describe('partsCatalog — partIsLowStock', () => {
  it('flags low stock when on-hand is at or below reorder level', () => {
    expect(partIsLowStock({ on_hand_qty: 5, reorder_level: 5 })).toBe(true)
    expect(partIsLowStock({ on_hand_qty: 2, reorder_level: 5 })).toBe(true)
    expect(partIsLowStock({ on_hand_qty: 0, reorder_level: 1 })).toBe(true)
  })

  it('is not low stock when on-hand is above reorder level', () => {
    expect(partIsLowStock({ on_hand_qty: 10, reorder_level: 5 })).toBe(false)
  })

  it('coerces numeric strings before comparing', () => {
    expect(partIsLowStock({ on_hand_qty: '3', reorder_level: '5' })).toBe(true)
    expect(partIsLowStock({ on_hand_qty: '9', reorder_level: '5' })).toBe(false)
  })

  it('returns false when either value is missing (no reorder signal)', () => {
    expect(partIsLowStock({ on_hand_qty: 2 })).toBe(false)
    expect(partIsLowStock({ reorder_level: 5 })).toBe(false)
    expect(partIsLowStock({})).toBe(false)
  })

  it('is defensive against non-object input', () => {
    expect(partIsLowStock(null)).toBe(false)
    expect(partIsLowStock(undefined)).toBe(false)
    expect(partIsLowStock('nope')).toBe(false)
  })
})

describe('partsCatalog — summarizeParts', () => {
  const rows = [
    { part_no: 'A1', category: 'engine', status: 'active', unit_cost: 100, on_hand_qty: 10, reorder_level: 5 },
    { part_no: 'B2', category: 'brakes', status: 'active', unit_cost: 50, on_hand_qty: 2, reorder_level: 5 }, // low
    { part_no: 'C3', category: 'engine', status: 'discontinued', unit_cost: 20, on_hand_qty: 0, reorder_level: 3 }, // low
    { part_no: 'D4', category: '', status: 'active', unit_cost: null, on_hand_qty: 4 }, // no cost, no reorder
  ]

  it('counts totals and status split', () => {
    const s = summarizeParts(rows)
    expect(s.total).toBe(4)
    expect(s.active).toBe(3)
    expect(s.discontinued).toBe(1)
  })

  it('counts low-stock parts', () => {
    expect(summarizeParts(rows).lowStock).toBe(2)
  })

  it('computes total inventory value as sum of unit_cost * on_hand_qty', () => {
    // 100*10 + 50*2 + 20*0 + (null skipped) = 1100
    expect(summarizeParts(rows).inventoryValue).toBe(1100)
  })

  it('returns distinct, sorted, non-empty categories', () => {
    const s = summarizeParts(rows)
    expect(s.categories).toEqual(['brakes', 'engine'])
    expect(s.categoryCount).toBe(2)
  })

  it('is defensive against empty / invalid input', () => {
    const s = summarizeParts([])
    expect(s).toMatchObject({ total: 0, active: 0, discontinued: 0, lowStock: 0, inventoryValue: 0, categoryCount: 0 })
    expect(summarizeParts(null).total).toBe(0)
    expect(summarizeParts(undefined).categories).toEqual([])
  })
})
