import { describe, it, expect } from 'vitest'
import {
  partIsLowStock, summarizeParts, partStockStatus, partLineValue,
  inventoryValuation, stockStatusCounts, reorderList, abcAnalysis,
  abcClassByPart, countsByCategory, countsBySupplier, dataQualityFlags,
  buildPartsAnalytics, LOW_STOCK_BUFFER, REORDER_TARGET_MULTIPLE,
} from '../lib/partsCatalog'

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

describe('partsCatalog — partStockStatus', () => {
  it('classifies out / below_reorder / low / ok', () => {
    expect(partStockStatus({ on_hand_qty: 0, reorder_level: 5 })).toBe('out')
    expect(partStockStatus({ on_hand_qty: -2, reorder_level: 5 })).toBe('out')
    expect(partStockStatus({ on_hand_qty: 4, reorder_level: 5 })).toBe('below_reorder')
    expect(partStockStatus({ on_hand_qty: 5, reorder_level: 5 })).toBe('below_reorder')
    expect(partStockStatus({ on_hand_qty: 7, reorder_level: 5 })).toBe('low') // 5<7<=7.5
    expect(partStockStatus({ on_hand_qty: 20, reorder_level: 5 })).toBe('ok')
  })
  it('respects the LOW_STOCK_BUFFER boundary', () => {
    expect(partStockStatus({ on_hand_qty: 5 * LOW_STOCK_BUFFER, reorder_level: 5 })).toBe('low')
    expect(partStockStatus({ on_hand_qty: 5 * LOW_STOCK_BUFFER + 0.1, reorder_level: 5 })).toBe('ok')
  })
  it('with no reorder level: positive qty is ok, zero is out', () => {
    expect(partStockStatus({ on_hand_qty: 3 })).toBe('ok')
    expect(partStockStatus({ on_hand_qty: 0 })).toBe('out')
  })
  it('unknown when quantity missing or input invalid', () => {
    expect(partStockStatus({ reorder_level: 5 })).toBe('unknown')
    expect(partStockStatus(null)).toBe('unknown')
  })
})

describe('partsCatalog — partLineValue', () => {
  it('multiplies cost by quantity', () => {
    expect(partLineValue({ unit_cost: 12.5, on_hand_qty: 4 })).toBe(50)
  })
  it('is null when cost or qty unknown', () => {
    expect(partLineValue({ on_hand_qty: 4 })).toBeNull()
    expect(partLineValue({ unit_cost: 10 })).toBeNull()
    expect(partLineValue(null)).toBeNull()
  })
})

describe('partsCatalog — inventoryValuation', () => {
  const rows = [
    { category: 'engine', unit_cost: 100, on_hand_qty: 10 }, // 1000
    { category: 'engine', unit_cost: 50, on_hand_qty: 2 },   // 100
    { category: 'brakes', unit_cost: 20, on_hand_qty: 5 },   // 100
    { category: '', unit_cost: null, on_hand_qty: 3 },       // 0, uncategorized
  ]
  it('totals and breaks down by category, sorted by value', () => {
    const v = inventoryValuation(rows)
    expect(v.total).toBe(1200)
    expect(v.byCategory[0]).toMatchObject({ category: 'engine', value: 1100, count: 2 })
    expect(v.byCategory.find((c) => c.category === 'uncategorized').value).toBe(0)
  })
  it('shares sum to ~100 across non-zero categories', () => {
    const v = inventoryValuation(rows)
    const engine = v.byCategory.find((c) => c.category === 'engine')
    expect(engine.share).toBeCloseTo(91.67, 1)
  })
  it('is defensive against empty input', () => {
    expect(inventoryValuation([]).total).toBe(0)
    expect(inventoryValuation(null).byCategory).toEqual([])
  })
})

describe('partsCatalog — stockStatusCounts', () => {
  it('counts each class with all keys present', () => {
    const c = stockStatusCounts([
      { on_hand_qty: 0, reorder_level: 5 },
      { on_hand_qty: 4, reorder_level: 5 },
      { on_hand_qty: 20, reorder_level: 5 },
      { reorder_level: 5 },
    ])
    expect(c).toEqual({ out: 1, below_reorder: 1, low: 0, ok: 1, unknown: 1 })
  })
})

describe('partsCatalog — reorderList', () => {
  const rows = [
    { id: 1, part_no: 'A', reorder_level: 5, on_hand_qty: 0, unit_cost: 10, supplier: 'S1' }, // out
    { id: 2, part_no: 'B', reorder_level: 5, on_hand_qty: 4, unit_cost: 10 }, // below
    { id: 3, part_no: 'C', reorder_level: 5, on_hand_qty: 20 }, // ok - excluded
    { id: 4, part_no: 'D', reorder_level: 5, on_hand_qty: 1, status: 'discontinued' }, // excluded
    { id: 5, part_no: 'E', on_hand_qty: 0 }, // no reorder - excluded
  ]
  it('returns only parts at/below reorder, out first', () => {
    const list = reorderList(rows)
    expect(list.map((r) => r.part_no)).toEqual(['A', 'B'])
    expect(list[0].status).toBe('out')
  })
  it('suggests order qty up to target multiple and estimates cost', () => {
    const list = reorderList(rows)
    // target = 5*2=10; A qty 0 -> 10 ; est = 10*10 = 100
    expect(list[0].suggestedQty).toBe(10)
    expect(list[0].estimatedCost).toBe(100)
    // B qty 4 -> 6 ; est = 6*10 = 60
    expect(list[1].suggestedQty).toBe(6)
    expect(list[1].estimatedCost).toBe(60)
  })
  it('estimated cost is null only when unit cost is missing', () => {
    const l = reorderList([{ id: 9, part_no: 'X', reorder_level: 5, on_hand_qty: 1 }])
    expect(l[0].estimatedCost).toBeNull()
  })
  it('uses REORDER_TARGET_MULTIPLE', () => {
    expect(REORDER_TARGET_MULTIPLE).toBe(2)
  })
})

describe('partsCatalog — abcAnalysis', () => {
  const rows = [
    { id: 1, part_no: 'A', unit_cost: 100, on_hand_qty: 80 }, // 8000
    { id: 2, part_no: 'B', unit_cost: 100, on_hand_qty: 15 }, // 1500
    { id: 3, part_no: 'C', unit_cost: 100, on_hand_qty: 4 },  // 400
    { id: 4, part_no: 'D', unit_cost: 100, on_hand_qty: 1 },  // 100
    { id: 5, part_no: 'E', unit_cost: null, on_hand_qty: 5 }, // 0
  ]
  it('classifies by cumulative value contribution', () => {
    const { items, total } = abcAnalysis(rows)
    expect(total).toBe(10000)
    const cls = Object.fromEntries(items.map((i) => [i.part_no, i.abcClass]))
    expect(cls.A).toBe('A') // 80% of value
    expect(cls.E).toBe('C') // zero value falls to C
  })
  it('summary counts and value per class', () => {
    const { summary } = abcAnalysis(rows)
    expect(summary.A.count + summary.B.count + summary.C.count).toBe(5)
  })
  it('abcClassByPart maps id -> class', () => {
    const m = abcClassByPart(rows)
    expect(m.get(1)).toBe('A')
  })
  it('is defensive against empty input', () => {
    expect(abcAnalysis([]).items).toEqual([])
    expect(abcAnalysis(null).total).toBe(0)
  })
})

describe('partsCatalog — counts + data quality', () => {
  const rows = [
    { id: 1, part_no: 'A', category: 'engine', supplier: 'S1', unit_cost: 10, reorder_level: 5, on_hand_qty: 2 },
    { id: 2, part_no: 'B', category: 'engine', supplier: '', unit_cost: null, on_hand_qty: -1 },
    { id: 3, part_no: 'C', category: '', supplier: 'S1', unit_cost: 5 },
  ]
  it('counts by category and supplier', () => {
    expect(countsByCategory(rows)[0]).toMatchObject({ category: 'engine', count: 2 })
    expect(countsBySupplier(rows).find((s) => s.supplier === 'unassigned').count).toBe(1)
  })
  it('flags missing cost, missing reorder, negative qty, missing category', () => {
    const dq = dataQualityFlags(rows)
    expect(dq.counts.missingCost).toBe(1)
    expect(dq.counts.negativeQty).toBe(1)
    expect(dq.counts.missingCategory).toBe(1)
    expect(dq.counts.missingReorder).toBe(2)
    expect(dq.totalIssues).toBeGreaterThan(0)
  })
})

describe('partsCatalog — buildPartsAnalytics', () => {
  it('composes the full bundle and is safe on empty', () => {
    const b = buildPartsAnalytics([])
    expect(b.kpis).toMatchObject({ totalSkus: 0, inventoryValue: 0, outOfStock: 0, belowReorder: 0 })
    expect(b.reorder).toEqual([])
    expect(b.abc.items).toEqual([])
  })
  it('derives KPIs from real rows', () => {
    const b = buildPartsAnalytics([
      { id: 1, part_no: 'A', unit_cost: 10, on_hand_qty: 0, reorder_level: 5 },
      { id: 2, part_no: 'B', unit_cost: 10, on_hand_qty: 3, reorder_level: 5 },
      { id: 3, part_no: 'C', unit_cost: 10, on_hand_qty: 50, reorder_level: 5 },
    ])
    expect(b.kpis.totalSkus).toBe(3)
    expect(b.kpis.outOfStock).toBe(1)
    expect(b.kpis.belowReorder).toBe(2) // out + below
    expect(b.kpis.inventoryValue).toBe(530)
  })
})
