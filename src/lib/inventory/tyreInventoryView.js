/**
 * Tyre inventory view (pure).
 *
 * `tyre_items` holds ONE authoritative custody state per physical tyre
 * (contract correction 4). It is derived from `tyre_records` by reading only;
 * nothing here changes tyre history, cost or CPK maths. Stock holding period
 * is NOT tyre running life, so this view never prints km or life.
 *
 * Custody conflicts (the 7 scrapped-yet-active tyres and any new ones) are
 * presented with their evidence for an authorised decision. They are never
 * auto-corrected here.
 */

export const CUSTODY_STATES = [
  'new_stock', 'reserved', 'in_transit', 'fitted', 'removed_pending', 'reusable', 'under_repair',
  'warranty', 'quarantine', 'scrapped', 'returned_supplier', 'unknown',
]

/** States that count as "in our stores" for an inventory figure. */
export const IN_STOCK_STATES = new Set(['new_stock', 'reserved', 'reusable', 'quarantine', 'under_repair'])

export const CUSTODY_TONE = {
  new_stock: 'good', reserved: 'info', in_transit: 'info', fitted: 'muted', removed_pending: 'warning',
  reusable: 'good', under_repair: 'warning', warranty: 'info', quarantine: 'warning', scrapped: 'muted',
  returned_supplier: 'muted', unknown: 'bad',
}

/** counts: {state: number|null} -> ordered tiles + totals. A null count stays null. */
export function summarizeCustody(counts = {}) {
  const tiles = CUSTODY_STATES.map((s) => ({ state: s, count: counts[s] ?? null, tone: CUSTODY_TONE[s] }))
  const known = tiles.filter((t) => t.count !== null)
  const total = known.length ? known.reduce((a, t) => a + t.count, 0) : null
  const inStock = known.length ? known.filter((t) => IN_STOCK_STATES.has(t.state)).reduce((a, t) => a + t.count, 0) : null
  return { tiles, total, inStock, unknown: counts.unknown ?? null, complete: known.length === tiles.length }
}

/**
 * One conflict -> the evidence lines a reviewer reads. `evidence` may be a
 * jsonb object or array from the server; both are flattened to label/value.
 */
export function conflictEvidence(conflict) {
  const ev = conflict?.evidence
  if (!ev) return []
  if (Array.isArray(ev)) {
    return ev.map((e, i) => (typeof e === 'object' && e
      ? { label: String(e.label || e.source || `#${i + 1}`), value: String(e.value ?? e.detail ?? '') }
      : { label: `#${i + 1}`, value: String(e) }))
  }
  if (typeof ev === 'object') {
    return Object.entries(ev).map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: typeof v === 'object' ? JSON.stringify(v) : String(v ?? '') }))
  }
  return [{ label: 'note', value: String(ev) }]
}

export const CONFLICT_STATUSES = ['open', 'investigating', 'resolved', 'dismissed']
export const isOpenConflict = (c) => !c?.status || c.status === 'open' || c.status === 'investigating'
