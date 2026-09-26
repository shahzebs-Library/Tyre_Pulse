/**
 * partsCatalogAnalytics - pure presentation engine for the Parts Catalog page
 * (/parts-catalog). The inventory maths (stock status, valuation, reorder list,
 * ABC Pareto, data quality) stays in `src/lib/partsCatalog.js`; this module only
 * shapes those results for the register: filtering, sorting, KPI strip, table
 * rows and export rows. No I/O, no clock, never throws on malformed rows.
 *
 * Honest nulls: a figure that cannot be measured (no costed reorder line, no
 * costed stock) is null and renders N/A, never a fabricated 0.
 */
import {
  partStockStatus, partLineValue, STOCK_STATUS_META, STOCK_STATUS_KEYS,
} from './partsCatalog'
import { sortRows } from './consoleTableSort'

export { sortRows }

const toNum = (v) => {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Rows shown in the ABC table before it states a cap. */
export const ABC_TABLE_ROWS = 30

/** Distinct, sorted non-empty values of a field. */
export function distinctValues(rows = [], field) {
  return [...new Set((rows || []).map((r) => r?.[field]).filter((v) => typeof v === 'string' && v.trim()))].sort()
}

/**
 * Filter the catalog. Every criterion is optional; 'all'/'' means no filter.
 * `stock` filters on the derived stock status (out, below_reorder, low, ok, unknown).
 */
export function filterParts(rows = [], { search = '', category = 'all', status = 'all', stock = 'all', supplier = 'all' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (rows || []).filter((r) => {
    if (!r || typeof r !== 'object') return false
    if (category !== 'all' && category && r.category !== category) return false
    if (status !== 'all' && status && (r.status || 'active') !== status) return false
    if (supplier !== 'all' && supplier && (r.supplier || '') !== supplier) return false
    if (stock !== 'all' && stock && partStockStatus(r) !== stock) return false
    if (q) {
      const hay = `${r.part_no || ''} ${r.name || ''} ${r.supplier || ''} ${r.category || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Register row: the raw part plus its derived stock status, line value and ABC class. */
export function partTableRows(rows = [], abcMap = new Map()) {
  return (rows || []).filter((r) => r && typeof r === 'object').map((r) => {
    const stock = partStockStatus(r)
    return {
      ...r,
      _stock: stock,
      _stockLabel: STOCK_STATUS_META[stock].label,
      _stockOrder: STOCK_STATUS_META[stock].order,
      _lineValue: partLineValue(r),
      _abc: abcMap.get(r.id) || null,
      _unitCost: toNum(r.unit_cost),
      _onHand: toNum(r.on_hand_qty),
      _reorder: toNum(r.reorder_level),
    }
  })
}

/** Sort accessors for the register columns. */
export const PART_SORT_ACCESSORS = {
  part_no: (r) => r.part_no || null,
  name: (r) => r.name || null,
  category: (r) => r.category || null,
  unit_cost: (r) => r._unitCost,
  on_hand: (r) => r._onHand,
  reorder: (r) => r._reorder,
  stock: (r) => r._stockOrder,
  line_value: (r) => r._lineValue,
  abc: (r) => r._abc,
  supplier: (r) => r.supplier || null,
  status: (r) => r.status || 'active',
}

/** Count per stock status over a row set, zero-filled for every key. */
export function stockCounts(rows = []) {
  const out = Object.fromEntries(STOCK_STATUS_KEYS.map((k) => [k, 0]))
  for (const r of rows || []) out[partStockStatus(r)] += 1
  return out
}

/**
 * KPI strip over the whole catalog (analytics = buildPartsAnalytics(rows)).
 * reorderSpend is null when no reorder line carries a unit cost (unmeasurable).
 */
export function partsKpis(analytics) {
  const a = analytics || {}
  const reorder = Array.isArray(a.reorder) ? a.reorder : []
  const costed = reorder.filter((r) => r.estimatedCost != null)
  const reorderSpend = costed.length ? Math.round(costed.reduce((s, r) => s + r.estimatedCost, 0) * 100) / 100 : null
  const summary = a.summary || {}
  const valued = (a.abc?.items || []).filter((i) => i.value > 0).length
  return {
    totalSkus: a.kpis?.totalSkus ?? 0,
    active: summary.active ?? 0,
    discontinued: summary.discontinued ?? 0,
    inventoryValue: valued > 0 ? (a.kpis?.inventoryValue ?? null) : null,
    valuedSkus: valued,
    outOfStock: a.kpis?.outOfStock ?? 0,
    belowReorder: a.kpis?.belowReorder ?? 0,
    reorderLines: reorder.length,
    reorderSpend,
    reorderUncosted: reorder.length - costed.length,
    dataIssues: a.dataQuality?.totalIssues ?? 0,
  }
}

/**
 * ABC table rows: costed parts only, capped at `limit`, with the cap stated so a
 * truncated Pareto is never read as the whole catalogue.
 */
export function abcTableRows(items = [], limit = ABC_TABLE_ROWS) {
  const costed = (items || []).filter((i) => i && i.value > 0)
  return { rows: costed.slice(0, limit), costed: costed.length, truncated: costed.length > limit }
}

/** Share (0..100 integer) of an ABC class in total value, or null when nothing is valued. */
export function abcShare(summary, total) {
  if (!summary || !(total > 0)) return null
  return Math.round((summary.value / total) * 100)
}

export const PART_EXPORT_COLS = ['part_no', 'name', 'category', 'unit_cost', 'on_hand_qty', 'reorder_level', 'stock_status', 'line_value', 'abc_class', 'supplier', 'uom', 'status']
export const PART_EXPORT_HEADERS = ['Part No', 'Name', 'Category', 'Unit Cost', 'On Hand', 'Reorder Lvl', 'Stock Status', 'Line Value', 'ABC', 'Supplier', 'UoM', 'Status']

/** Export rows for the FULL filtered + sorted register (never the visible page). */
export function partExportRows(tableRows = []) {
  return (tableRows || []).map((r) => ({
    part_no: r.part_no || '', name: r.name || '', category: r.category || '',
    unit_cost: r.unit_cost ?? '', on_hand_qty: r.on_hand_qty ?? '',
    reorder_level: r.reorder_level ?? '',
    stock_status: r._stockLabel || STOCK_STATUS_META[partStockStatus(r)].label,
    line_value: r._lineValue == null ? '' : r._lineValue,
    abc_class: r._abc || '',
    supplier: r.supplier || '', uom: r.uom || '', status: r.status || '',
  }))
}

export const REORDER_EXPORT_COLS = ['part_no', 'name', 'status', 'on_hand_qty', 'reorder_level', 'suggestedQty', 'uom', 'estimatedCost', 'supplier']
export const REORDER_EXPORT_HEADERS = ['Part No', 'Name', 'Stock Status', 'On Hand', 'Reorder Lvl', 'Suggested Qty', 'UoM', 'Est. Cost', 'Supplier']

/** Purchase list export rows (the reorder list, most urgent first). */
export function reorderExportRows(reorder = []) {
  return (reorder || []).map((r) => ({
    part_no: r.part_no || '', name: r.name || '',
    status: STOCK_STATUS_META[r.status]?.label || r.status,
    on_hand_qty: r.on_hand_qty, reorder_level: r.reorder_level,
    suggestedQty: r.suggestedQty, uom: r.uom || '',
    estimatedCost: r.estimatedCost == null ? 'N/A' : r.estimatedCost,
    supplier: r.supplier || '',
  }))
}
