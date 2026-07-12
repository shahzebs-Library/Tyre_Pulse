/**
 * Materials Management — pure, dependency-free domain logic for the Materials
 * module (/materials). Turns a set of workshop consumable/material stock rows
 * (oils, filters, valves, sealants, greases, coolants, cleaning agents,
 * fasteners and other shop consumables) into inventory intelligence: on-hand
 * stock value, reorder needs, per-category value breakdowns and a fleet-level
 * KPI summary.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/materials.js`) and page
 * (`src/pages/Materials.jsx`) both build on these primitives so the roll-up
 * logic lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Non-negative on-hand quantity for a material (null / negative → 0). */
function quantityOf(m) {
  const q = toFiniteNumber(m?.quantity_on_hand)
  return q != null && q > 0 ? q : 0
}

/** Reorder threshold for a material (null / negative → 0). */
function reorderPointOf(m) {
  const rp = toFiniteNumber(m?.reorder_point)
  return rp != null && rp > 0 ? rp : 0
}

/**
 * Monetary value of the on-hand stock for a single material:
 *   quantity_on_hand × unit_cost. Returns 0 when either input is missing or
 *   non-numeric, and never returns a negative value (negative quantities or
 *   costs are treated as 0 — dirty data must not deflate fleet inventory value).
 *
 * @param {object} m
 * @returns {number}
 */
export function stockValue(m) {
  const qty = toFiniteNumber(m?.quantity_on_hand)
  const cost = toFiniteNumber(m?.unit_cost)
  if (qty == null || cost == null) return 0
  const value = qty * cost
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * True when a material has fallen to or below its reorder point (i.e. it needs
 * replenishing). A reorder point of 0 with stock on hand is not a reorder
 * trigger; an item at exactly the reorder point IS (<=), matching classic
 * min/max inventory policy.
 *
 * @param {object} m
 * @returns {boolean}
 */
export function needsReorder(m) {
  const qty = quantityOf(m)
  const rp = reorderPointOf(m)
  if (qty <= 0) return true
  return qty <= rp
}

/**
 * Derived stock status for a material, independent of any stored `status`:
 *   • 'out_of_stock' — quantity_on_hand <= 0
 *   • 'low'          — quantity_on_hand <= reorder_point (but > 0)
 *   • 'active'       — quantity_on_hand > reorder_point
 *
 * @param {object} m
 * @returns {'out_of_stock'|'low'|'active'}
 */
export function stockStatus(m) {
  const qty = quantityOf(m)
  if (qty <= 0) return 'out_of_stock'
  const rp = reorderPointOf(m)
  if (qty <= rp) return 'low'
  return 'active'
}

/**
 * Fleet-level KPI summary across a set of materials:
 *   • totalItems          — number of rows
 *   • totalStockValue      — Σ stockValue(row)
 *   • lowStockCount        — rows with derived status 'low'
 *   • outOfStockCount      — rows with derived status 'out_of_stock'
 *   • distinctCategories   — count of distinct non-empty categories
 *   • reorderCount         — rows where needsReorder(row) is true
 *
 * @param {Array<object>} rows
 * @returns {{ totalItems:number, totalStockValue:number, lowStockCount:number,
 *             outOfStockCount:number, distinctCategories:number, reorderCount:number }}
 */
export function summariseMaterials(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const categories = new Set()
  let totalStockValue = 0
  let lowStockCount = 0
  let outOfStockCount = 0
  let reorderCount = 0

  for (const m of list) {
    totalStockValue += stockValue(m)
    const status = stockStatus(m)
    if (status === 'low') lowStockCount += 1
    else if (status === 'out_of_stock') outOfStockCount += 1
    if (needsReorder(m)) reorderCount += 1
    const cat = m?.category != null ? String(m.category).trim() : ''
    if (cat) categories.add(cat)
  }

  return {
    totalItems: list.length,
    totalStockValue,
    lowStockCount,
    outOfStockCount,
    distinctCategories: categories.size,
    reorderCount,
  }
}

/**
 * Aggregate on-hand value by category. Rows without a category are grouped
 * under 'uncategorised'. Returns an array of { category, items, stockValue }
 * sorted by stockValue descending (ties broken by item count desc, then name).
 *
 * @param {Array<object>} rows
 * @returns {Array<{ category:string, items:number, stockValue:number }>}
 */
export function byCategory(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const groups = new Map()

  for (const m of list) {
    const cat = m?.category != null && String(m.category).trim()
      ? String(m.category).trim()
      : 'uncategorised'
    const g = groups.get(cat) || { category: cat, items: 0, stockValue: 0 }
    g.items += 1
    g.stockValue += stockValue(m)
    groups.set(cat, g)
  }

  return [...groups.values()].sort(
    (a, b) =>
      b.stockValue - a.stockValue ||
      b.items - a.items ||
      a.category.localeCompare(b.category),
  )
}

/**
 * Build the replenishment worklist. For every material that needs reordering
 * (needsReorder), emit a suggestion:
 *   • name        — material name (falls back to sku, then '—')
 *   • sku         — stock-keeping unit (or null)
 *   • shortfall   — reorder_point − quantity_on_hand (never negative)
 *   • reorder_qty — suggested purchase quantity; falls back to the shortfall
 *                   when no explicit reorder_qty is configured
 *
 * Sorted by shortfall descending (largest gap first) so procurement acts on the
 * most depleted items first; ties broken by name for stable output.
 *
 * @param {Array<object>} rows
 * @returns {Array<{ name:string, sku:string|null, shortfall:number, reorder_qty:number }>}
 */
export function reorderList(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const out = []

  for (const m of list) {
    if (!needsReorder(m)) continue
    const qty = quantityOf(m)
    const rp = reorderPointOf(m)
    const shortfall = Math.max(0, rp - qty)
    const configuredQty = toFiniteNumber(m?.reorder_qty)
    const reorder_qty =
      configuredQty != null && configuredQty > 0 ? configuredQty : shortfall
    const name = m?.name != null && String(m.name).trim()
      ? String(m.name).trim()
      : (m?.sku != null && String(m.sku).trim() ? String(m.sku).trim() : '—')
    const sku = m?.sku != null && String(m.sku).trim() ? String(m.sku).trim() : null
    out.push({ name, sku, shortfall, reorder_qty })
  }

  return out.sort(
    (a, b) => b.shortfall - a.shortfall || a.name.localeCompare(b.name),
  )
}
