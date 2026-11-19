/**
 * Stock balance helpers for the hub (pure).
 *
 * A balance row is one `stock_records` line: item x location x condition x
 * ownership. Quantities in different units of measure are never added into one
 * "units" figure; the hub counts LINES and ITEMS instead.
 *
 * This is NOT a reorder engine: suggested order quantities stay in
 * `stockReplenishmentAnalytics.js` (Stock Replenishment). Here we only flag a
 * line that sits at or below the reorder point its owner configured.
 */

const n = (v) => {
  if (v === null || v === undefined || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

export const onHand = (r) => n(r?.qty_on_hand ?? r?.stock_qty)
export const reserved = (r) => n(r?.qty_reserved) ?? 0

/** Available = on hand - reserved, floored at 0 (reservations never exceed on hand by CHECK). */
export function available(r) {
  const q = onHand(r)
  if (q === null) return null
  return Math.max(0, q - reserved(r))
}

/** Reorder point if set, else min level. NULL when the owner set neither. */
export function reorderPoint(r) {
  return n(r?.reorder_point) ?? n(r?.min_qty) ?? n(r?.min_level)
}

export function belowReorder(r) {
  const rp = reorderPoint(r)
  const a = available(r)
  if (rp === null || a === null) return false
  return a <= rp
}

export function summarizeBalances(rows) {
  const list = rows || []
  const items = new Set(list.map((r) => r.item_id || r.item_code || r.description).filter(Boolean))
  return {
    lines: list.length,
    items: items.size,
    zero: list.filter((r) => onHand(r) === 0).length,
    belowReorder: list.filter(belowReorder).length,
    noReorderPoint: list.filter((r) => reorderPoint(r) === null).length,
    reservedLines: list.filter((r) => reserved(r) > 0).length,
    consignmentLines: list.filter((r) => r.ownership && r.ownership !== 'owned').length,
  }
}

/** Lines at or below their reorder point, worst first (lowest cover). */
export function reorderSignals(rows) {
  return (rows || [])
    .filter(belowReorder)
    .map((r) => ({ ...r, available: available(r), reorder_point: reorderPoint(r), gap: reorderPoint(r) - available(r) }))
    .sort((a, b) => b.gap - a.gap)
}
