/**
 * materialsAnalytics - pure presentation engine for the Materials Management
 * register (/materials). Stock status, reorder rules and category rollups stay
 * in `src/lib/materials.js`; this module owns what the PAGE derives: filters,
 * the priced-vs-unpriced value view, the KPI strip, the reorder worklist with
 * an estimated reorder spend, and the export shape. No I/O.
 *
 * Honesty rule: `stockValue` in materials.js returns 0 for an item with no
 * unit cost. On screen that reads "worth nothing", which is not what the data
 * says, so here an unpriced item has a NULL value (N/A) and the KPI strip
 * states how many items the stock value leaves out.
 */
import {
  toFiniteNumber, stockValue, stockStatus, needsReorder, byCategory,
} from './materials'

export const MATERIAL_CATEGORIES = Object.freeze([
  'oil', 'filter', 'valve', 'sealant', 'grease', 'coolant', 'cleaning', 'fastener', 'consumable', 'other',
])
export const CATEGORY_LABEL = Object.freeze({
  oil: 'Oil', filter: 'Filter', valve: 'Valve', sealant: 'Sealant', grease: 'Grease', coolant: 'Coolant',
  cleaning: 'Cleaning', fastener: 'Fastener', consumable: 'Consumable', other: 'Other', uncategorised: 'Uncategorised',
})
export const STOCK_LABEL = Object.freeze({ active: 'In stock', low: 'Low', out_of_stock: 'Out of stock' })

const text = (v) => (v == null ? '' : String(v).trim())

export function categoryLabel(c) {
  return CATEGORY_LABEL[c] || text(c) || 'Uncategorised'
}

/** True when the item carries a usable unit cost. */
export function isPriced(m) {
  const c = toFiniteNumber(m?.unit_cost)
  return c != null && c >= 0
}

/** On-hand value, or null when the item is unpriced or has no quantity recorded. */
export function materialValue(m) {
  if (!isPriced(m)) return null
  if (toFiniteNumber(m?.quantity_on_hand) == null) return null
  return stockValue(m)
}

export const MATERIAL_FILTERS = Object.freeze({ category: '', status: '', country: '', supplier: '', search: '' })

export function hasMaterialFilters(f = MATERIAL_FILTERS) {
  return ['category', 'status', 'country', 'supplier', 'search'].some((k) => !!text(f[k]))
}

export function materialOptions(rows = [], key) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => text(r?.[key])).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
}

export function filterMaterials(rows = [], f = MATERIAL_FILTERS) {
  const q = text(f.search).toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (text(f.category) && r?.category !== f.category) return false
    if (text(f.status) && stockStatus(r) !== f.status) return false
    if (text(f.country) && text(r?.country) !== text(f.country)) return false
    if (text(f.supplier) && text(r?.supplier) !== text(f.supplier)) return false
    if (q) {
      const hay = `${r?.name || ''} ${r?.sku || ''} ${r?.supplier || ''} ${r?.location || ''} ${r?.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Attach status, value (or null), quantity and labels for the table. */
export function materialTableRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    ...r,
    _status: stockStatus(r),
    _statusLabel: STOCK_LABEL[stockStatus(r)],
    _value: materialValue(r),
    _qty: toFiniteNumber(r?.quantity_on_hand),
    _reorderPoint: toFiniteNumber(r?.reorder_point),
    _unitCost: isPriced(r) ? toFiniteNumber(r.unit_cost) : null,
    _categoryLabel: categoryLabel(r?.category),
    _reorder: needsReorder(r),
  }))
}

/**
 * Reorder worklist: every item at or below its reorder point, with shortfall,
 * suggested order quantity (configured reorder_qty, else the shortfall) and
 * an estimated order cost (null when unpriced). Biggest shortfall first.
 */
export function reorderWorklist(rows = []) {
  const out = []
  for (const m of Array.isArray(rows) ? rows : []) {
    if (!needsReorder(m)) continue
    const qty = Math.max(0, toFiniteNumber(m?.quantity_on_hand) ?? 0)
    const rp = Math.max(0, toFiniteNumber(m?.reorder_point) ?? 0)
    const shortfall = Math.max(0, rp - qty)
    const configured = toFiniteNumber(m?.reorder_qty)
    const orderQty = configured != null && configured > 0 ? configured : shortfall
    const cost = isPriced(m) ? toFiniteNumber(m.unit_cost) * orderQty : null
    out.push({
      id: m?.id,
      name: text(m?.name) || text(m?.sku) || 'N/A',
      sku: text(m?.sku) || null,
      supplier: text(m?.supplier) || null,
      status: stockStatus(m),
      shortfall,
      orderQty,
      estCost: cost,
    })
  }
  return out.sort((a, b) => b.shortfall - a.shortfall || a.name.localeCompare(b.name))
}

/** KPI strip over a set of materials. */
export function materialKpis(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const priced = list.filter(isPriced)
  const reorder = reorderWorklist(list)
  const reorderPriced = reorder.filter((r) => r.estCost != null)
  let low = 0
  let out = 0
  for (const m of list) {
    const s = stockStatus(m)
    if (s === 'low') low += 1
    else if (s === 'out_of_stock') out += 1
  }
  const categories = new Set(list.map((m) => text(m?.category)).filter(Boolean))
  return {
    totalItems: list.length,
    stockValue: priced.length ? priced.reduce((s, m) => s + stockValue(m), 0) : null,
    pricedItems: priced.length,
    unpricedItems: list.length - priced.length,
    lowStock: low,
    outOfStock: out,
    reorderCount: reorder.length,
    reorderSpend: reorderPriced.length ? reorderPriced.reduce((s, r) => s + r.estCost, 0) : null,
    reorderUnpriced: reorder.length - reorderPriced.length,
    categories: categories.size,
    availabilityPct: list.length ? Math.round(((list.length - out) / list.length) * 1000) / 10 : null,
  }
}

/** Category value breakdown (labels resolved), reusing materials.byCategory. */
export function categoryBreakdown(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  return byCategory(list).map((c) => {
    const inCat = list.filter((m) => (text(m?.category) || 'uncategorised') === c.category)
    return { ...c, label: categoryLabel(c.category), unpriced: inCat.filter((m) => !isPriced(m)).length }
  })
}

export const MATERIAL_EXPORT_COLS = ['name', 'sku', 'category', 'unit', 'quantity_on_hand', 'reorder_point', 'reorder_qty', 'unit_cost', 'stock_value', 'stock_status', 'supplier', 'location']
export const MATERIAL_EXPORT_HEADERS = ['Material', 'SKU', 'Category', 'Unit', 'Qty on hand', 'Reorder point', 'Reorder qty', 'Unit cost', 'Stock value', 'Stock status', 'Supplier', 'Location']

export function materialExportRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const v = materialValue(r)
    return {
      name: r?.name || '', sku: r?.sku || '',
      category: categoryLabel(r?.category),
      unit: r?.unit || '', quantity_on_hand: r?.quantity_on_hand ?? '',
      reorder_point: r?.reorder_point ?? '', reorder_qty: r?.reorder_qty ?? '',
      unit_cost: isPriced(r) ? r.unit_cost : 'N/A',
      stock_value: v == null ? 'N/A' : Math.round(v * 100) / 100,
      stock_status: STOCK_LABEL[stockStatus(r)],
      supplier: r?.supplier || '', location: r?.location || '',
    }
  })
}
