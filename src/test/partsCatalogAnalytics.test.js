import { describe, it, expect } from 'vitest'
import { buildPartsAnalytics, abcClassByPart } from '../lib/partsCatalog'
import {
  filterParts, partTableRows, PART_SORT_ACCESSORS, sortRows, partsKpis, abcTableRows, abcShare,
  partExportRows, PART_EXPORT_COLS, reorderExportRows, distinctValues, stockCounts,
} from '../lib/partsCatalogAnalytics'

const PARTS = [
  { id: 1, part_no: 'FLT-1', name: 'Oil filter', category: 'filters', unit_cost: 20, on_hand_qty: 0, reorder_level: 5, supplier: 'Acme', status: 'active', uom: 'pcs' },
  { id: 2, part_no: 'BRK-2', name: 'Brake pad', category: 'brakes', unit_cost: 100, on_hand_qty: 50, reorder_level: 10, supplier: 'Beta', status: 'active', uom: 'set' },
  { id: 3, part_no: 'ENG-3', name: 'Belt', category: 'engine', unit_cost: null, on_hand_qty: 3, reorder_level: 4, supplier: 'Acme', status: 'active' },
  { id: 4, part_no: 'OLD-4', name: 'Legacy', category: 'engine', unit_cost: 5, on_hand_qty: 2, reorder_level: null, supplier: '', status: 'discontinued' },
]

describe('partsCatalogAnalytics - filterParts', () => {
  it('filters by search across part no, name, supplier and category', () => {
    expect(filterParts(PARTS, { search: 'brake' }).map((p) => p.id)).toEqual([2])
    expect(filterParts(PARTS, { search: 'acme' }).map((p) => p.id)).toEqual([1, 3])
  })
  it('filters by category, status, supplier and derived stock status', () => {
    expect(filterParts(PARTS, { category: 'engine' }).map((p) => p.id)).toEqual([3, 4])
    expect(filterParts(PARTS, { status: 'discontinued' }).map((p) => p.id)).toEqual([4])
    expect(filterParts(PARTS, { supplier: 'Beta' }).map((p) => p.id)).toEqual([2])
    expect(filterParts(PARTS, { stock: 'out' }).map((p) => p.id)).toEqual([1])
    expect(filterParts(PARTS, { stock: 'below_reorder' }).map((p) => p.id)).toEqual([3])
  })
  it('returns everything with no criteria and ignores malformed rows', () => {
    expect(filterParts([...PARTS, null, 'x'])).toHaveLength(4)
  })
})

describe('partsCatalogAnalytics - table rows and sorting', () => {
  const rows = partTableRows(PARTS, abcClassByPart(PARTS))
  it('derives stock status, line value (null when uncosted) and ABC class', () => {
    const belt = rows.find((r) => r.id === 3)
    expect(belt._stock).toBe('below_reorder')
    expect(belt._lineValue).toBeNull()
    expect(rows.find((r) => r.id === 2)._lineValue).toBe(5000)
    expect(rows.find((r) => r.id === 2)._abc).toBe('A')
  })
  it('sorts the full set with unmeasurable values last in either direction', () => {
    const desc = sortRows(rows, { key: 'line_value', dir: 'desc' }, PART_SORT_ACCESSORS).map((r) => r.id)
    const asc = sortRows(rows, { key: 'line_value', dir: 'asc' }, PART_SORT_ACCESSORS).map((r) => r.id)
    expect(desc[0]).toBe(2)
    expect(desc[desc.length - 1]).toBe(3)
    expect(asc[asc.length - 1]).toBe(3)
  })
  it('orders stock status by urgency', () => {
    expect(sortRows(rows, { key: 'stock', dir: 'asc' }, PART_SORT_ACCESSORS)[0].id).toBe(1)
  })
})

describe('partsCatalogAnalytics - KPIs', () => {
  it('reports reorder spend only from costed lines and counts the uncosted ones', () => {
    const k = partsKpis(buildPartsAnalytics(PARTS))
    expect(k.totalSkus).toBe(4)
    expect(k.discontinued).toBe(1)
    expect(k.outOfStock).toBe(1)
    expect(k.reorderLines).toBe(2)
    expect(k.reorderUncosted).toBe(1)
    expect(k.reorderSpend).toBe(200) // FLT-1: suggest 10 x 20
  })
  it('returns N/A-able nulls rather than zero when nothing is measurable', () => {
    const k = partsKpis(buildPartsAnalytics([{ id: 9, part_no: 'X', on_hand_qty: 1 }]))
    expect(k.reorderSpend).toBeNull()
    expect(k.inventoryValue).toBeNull()
  })
  it('counts every stock status key', () => {
    expect(stockCounts(PARTS)).toEqual({ out: 1, below_reorder: 1, low: 0, ok: 2, unknown: 0 })
  })
})

describe('partsCatalogAnalytics - ABC table and exports', () => {
  it('states the cap when the costed Pareto is truncated', () => {
    const items = Array.from({ length: 35 }, (_, i) => ({ id: i, value: 100 - i }))
    const t = abcTableRows(items, 30)
    expect(t.rows).toHaveLength(30)
    expect(t.truncated).toBe(true)
    expect(t.costed).toBe(35)
    expect(abcTableRows([{ id: 1, value: 0 }]).costed).toBe(0)
  })
  it('abcShare is null with no valued stock', () => {
    expect(abcShare({ value: 50 }, 0)).toBeNull()
    expect(abcShare({ value: 50 }, 200)).toBe(25)
  })
  it('export rows carry every export column and blank unknown values', () => {
    const out = partExportRows(partTableRows(PARTS, abcClassByPart(PARTS)))
    expect(Object.keys(out[0]).sort()).toEqual([...PART_EXPORT_COLS].sort())
    expect(out.find((r) => r.part_no === 'ENG-3').line_value).toBe('')
    const reorder = reorderExportRows(buildPartsAnalytics(PARTS).reorder)
    expect(reorder.find((r) => r.part_no === 'ENG-3').estimatedCost).toBe('N/A')
  })
  it('distinctValues drops blanks and sorts', () => {
    expect(distinctValues(PARTS, 'supplier')).toEqual(['Acme', 'Beta'])
  })
})
