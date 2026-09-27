/**
 * tyrePoolAnalytics - page-level analytics for the Tyre Pool page (/tyre-pool).
 *
 * The pool maths (poolStats, byLocation, replenishment, summarizePool) live in
 * `./tyrePool`; this module wraps them honestly for the page:
 *   - manager KPIs are computed over the WHOLE pool, never over the rows a
 *     status filter happens to show, so "Total in pool" cannot shrink when a
 *     filter is picked and replenishment is never judged on a filtered subset
 *   - utilisation is null (N/A) for an empty pool, not 0%
 *   - replenishment is null when the active-vehicle count could not be read,
 *     instead of recommending against a fleet of zero
 *   - pool value is money: null on a mixed-currency scope or when no spare
 *     carries a price
 *
 * No I/O, no React.
 */
import { poolStats, byLocation, replenishment, poolSerialOf, POOL_REASONS, POOL_ENTRY_STATUSES } from './tyrePool'

export { POOL_REASONS, POOL_ENTRY_STATUSES, poolSerialOf }

const lc = (v) => String(v ?? '').trim().toLowerCase()
export const reasonLabel = (r) => (r ? String(r).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'N/A')
export const positionOf = (r) => r?.position || r?.tyre_position || null

/** Manager view over the whole pool. `activeVehicles` null = unknown. */
export function managerSummary(entries = [], activeVehicles = null) {
  const list = Array.isArray(entries) ? entries : []
  const s = poolStats(list)
  const vehiclesKnown = Number.isFinite(activeVehicles) && activeVehicles >= 0
  return {
    ...s,
    utilisationPct: s.total > 0 ? s.utilisationPct : null,
    locations: byLocation(list),
    replen: vehiclesKnown ? replenishment(activeVehicles, s.available) : null,
    activeVehicles: vehiclesKnown ? activeVehicles : null,
  }
}

/** Filter managed entries for the register. */
export function filterEntries(entries = [], f = {}) {
  const q = lc(f.search)
  return (Array.isArray(entries) ? entries : []).filter((e) => {
    if (f.status && e.status !== f.status) return false
    if (f.location && (e.pool_location || 'Unassigned') !== f.location) return false
    if (f.reason && e.reason !== f.reason) return false
    if (q) {
      const hay = [e.tyre_serial, e.pool_location, e.assigned_to, e.notes, reasonLabel(e.reason)].map(lc).join(' ')
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Entries per reason, most common first. */
export function reasonMix(entries = []) {
  const m = new Map()
  for (const e of entries || []) {
    const k = reasonLabel(e.reason)
    m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
}

/** Filter the tyre_records-derived pool candidates. */
export function filterCandidates(pool = [], f = {}) {
  const q = lc(f.search)
  return (Array.isArray(pool) ? pool : []).filter((r) => {
    if (f.brand && r.brand !== f.brand) return false
    if (f.size && r.size !== f.size) return false
    if (f.site && r.site !== f.site) return false
    if (q) {
      const hay = [poolSerialOf(r), r.asset_no, r.brand, r.size, r.site].map(lc).join(' ')
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Value of a set of spares; null when money is not comparable or nothing is priced. */
export function candidateValue(rows = [], { money = true } = {}) {
  let priced = 0
  let value = 0
  for (const r of rows || []) {
    const n = Number(r.cost_per_tyre)
    if (r.cost_per_tyre == null || r.cost_per_tyre === '' || !Number.isFinite(n)) continue
    priced += 1
    value += n
  }
  return { priced, unpriced: (rows || []).length - priced, value: money && priced > 0 ? Math.round(value * 100) / 100 : null }
}

export const ENTRY_EXPORT_COLS = ['tyre_serial', 'pool_location', 'reason', 'status', 'assigned_to', 'min_qty', 'notes']
export const ENTRY_EXPORT_HEADERS = ['Serial', 'Location', 'Reason', 'Status', 'Deployed to', 'Min qty', 'Notes']

export function entryExportRows(entries = []) {
  return (entries || []).map((e) => ({
    tyre_serial: e.tyre_serial || 'N/A',
    pool_location: e.pool_location || 'Unassigned',
    reason: reasonLabel(e.reason),
    status: e.status ? reasonLabel(e.status) : 'N/A',
    assigned_to: e.assigned_to || 'N/A',
    min_qty: e.min_qty ?? 'N/A',
    notes: e.notes || '',
  }))
}

export const CANDIDATE_EXPORT_COLS = ['serial', 'brand', 'size', 'site', 'position', 'tread_depth', 'status', 'cost']
export const CANDIDATE_EXPORT_HEADERS = ['Serial', 'Brand', 'Size', 'Site', 'Position', 'Tread (mm)', 'Status', 'Cost']

export function candidateExportRows(rows = [], { money = true } = {}) {
  return (rows || []).map((r) => ({
    serial: poolSerialOf(r) || 'N/A',
    brand: r.brand || 'N/A',
    size: r.size || 'N/A',
    site: r.site || 'N/A',
    position: positionOf(r) || 'N/A',
    tread_depth: r.tread_depth == null || r.tread_depth === '' ? 'N/A' : r.tread_depth,
    status: r.status || 'N/A',
    cost: money && r.cost_per_tyre != null && r.cost_per_tyre !== '' ? r.cost_per_tyre : 'N/A',
  }))
}
