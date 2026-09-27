import { describe, it, expect } from 'vitest'
import {
  isPriced, materialValue, filterMaterials, hasMaterialFilters, materialOptions, materialTableRows,
  reorderWorklist, materialKpis, categoryBreakdown, materialExportRows, MATERIAL_FILTERS, categoryLabel,
} from '../lib/materialsAnalytics'

const items = [
  { id: 1, name: 'Engine oil', sku: 'OIL-1', category: 'oil', quantity_on_hand: 10, reorder_point: 20, reorder_qty: 50, unit_cost: 4, supplier: 'Gulf', country: 'KSA' },
  { id: 2, name: 'Air filter', category: 'filter', quantity_on_hand: 0, reorder_point: 5, unit_cost: null, supplier: 'Delta' },
  { id: 3, name: 'Grease', category: 'grease', quantity_on_hand: 40, reorder_point: 10, unit_cost: '2.5', location: 'Rack 3' },
  { id: 4, name: 'Rags', category: '', quantity_on_hand: 5, reorder_point: 0, unit_cost: '' },
]

describe('materialsAnalytics', () => {
  it('treats an unpriced item as unmeasured, never as worth zero', () => {
    expect(isPriced(items[1])).toBe(false)
    expect(materialValue(items[1])).toBeNull()
    expect(materialValue(items[0])).toBe(40)
    expect(materialValue({ unit_cost: 5 })).toBeNull()
  })

  it('filters by category, stock status, supplier, country and text', () => {
    expect(filterMaterials(items, { ...MATERIAL_FILTERS, status: 'out_of_stock' }).map((m) => m.id)).toEqual([2])
    expect(filterMaterials(items, { ...MATERIAL_FILTERS, status: 'low' }).map((m) => m.id)).toEqual([1])
    expect(filterMaterials(items, { ...MATERIAL_FILTERS, category: 'grease' }).map((m) => m.id)).toEqual([3])
    expect(filterMaterials(items, { ...MATERIAL_FILTERS, supplier: 'Gulf', country: 'KSA' }).map((m) => m.id)).toEqual([1])
    expect(filterMaterials(items, { ...MATERIAL_FILTERS, search: 'rack' }).map((m) => m.id)).toEqual([3])
    expect(hasMaterialFilters(MATERIAL_FILTERS)).toBe(false)
    expect(materialOptions(items, 'supplier')).toEqual(['Delta', 'Gulf'])
  })

  it('builds a reorder worklist with estimated spend (null when unpriced)', () => {
    const w = reorderWorklist(items)
    expect(w.map((r) => r.id)).toEqual([1, 2])
    expect(w[0]).toMatchObject({ shortfall: 10, orderQty: 50, estCost: 200 })
    expect(w[1]).toMatchObject({ shortfall: 5, orderQty: 5, estCost: null })
  })

  it('computes KPIs over priced items and states the unpriced gap', () => {
    const k = materialKpis(items)
    expect(k).toMatchObject({ totalItems: 4, pricedItems: 2, unpricedItems: 2, lowStock: 1, outOfStock: 1, reorderCount: 2, reorderSpend: 200, reorderUnpriced: 1, categories: 3 })
    expect(k.stockValue).toBe(140)
    expect(k.availabilityPct).toBe(75)
    const none = materialKpis([items[1]])
    expect(none.stockValue).toBeNull()
    expect(none.reorderSpend).toBeNull()
    expect(materialKpis([]).availabilityPct).toBeNull()
  })

  it('labels rows, categories and export with N/A for unpriced values', () => {
    const t = materialTableRows(items)
    expect(t[1]).toMatchObject({ _status: 'out_of_stock', _statusLabel: 'Out of stock', _value: null, _unitCost: null })
    const cats = categoryBreakdown(items)
    expect(cats.find((c) => c.category === 'filter')).toMatchObject({ label: 'Filter', unpriced: 1 })
    expect(cats.find((c) => c.category === 'uncategorised').label).toBe('Uncategorised')
    const out = materialExportRows(items)
    expect(out[1]).toMatchObject({ unit_cost: 'N/A', stock_value: 'N/A', stock_status: 'Out of stock' })
    expect(out[2].stock_value).toBe(100)
    expect(categoryLabel('')).toBe('Uncategorised')
  })
})
