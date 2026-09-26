/**
 * dataReconciliationAnalytics - pure engine behind the Data Reconciliation hub.
 *
 * The reconciliation RPCs are delivered by a sibling service whose row shapes
 * have drifted over time (asset_no vs assetNo vs fleet_number, copies vs count).
 * Everything that reads those shapes, filters them for the page and summarises
 * them lives here, so the page only renders and the rules are tested once.
 *
 * Nothing here decides WHAT to fix. The guarded fix RPCs (backfill an orphan
 * asset, merge a byte-identical duplicate) keep their own server-side guards;
 * this file only reads and counts. No I/O. `now` is injectable.
 */

/** First non-empty value among `keys`, else `fallback`. */
export function pick(obj, keys, fallback = undefined) {
  for (const k of keys) {
    if (obj != null && obj[k] != null && obj[k] !== '') return obj[k]
  }
  return fallback
}

/** Numeric value among `keys`, else `fallback` (which may be null). */
export function num(obj, keys, fallback = 0) {
  const v = pick(obj, keys)
  if (v == null) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const ASSET_KEYS = ['asset_no', 'assetNo', 'fleet_number']
const SERIAL_KEYS = ['serial', 'serial_no', 'tyre_serial']
const DATE_KEYS = ['date', 'fitted_at', 'created_at', 'recorded_at', 'updated_at']

/** Orphan asset (has tyres, no fleet record). `tyres` null when not reported. */
export function normalizeOrphan(r, i = 0) {
  return {
    key: String(pick(r, ['id', 'asset_no', 'serial'], null) ?? `r${i}`),
    assetNo: pick(r, ASSET_KEYS, null),
    type: pick(r, ['type', 'asset_type', 'vehicle_type', 'category'], null),
    country: pick(r, ['country', 'country_code', 'location'], null),
    tyres: num(r, ['tyres', 'tyre_count', 'count'], null),
    raw: r,
  }
}

/** Exact duplicate group. `copies` defaults to 2 (a group implies at least one extra). */
export function normalizeDupe(r, i = 0) {
  let removeIds = pick(r, ['remove_ids', 'removeIds', 'duplicate_ids'], [])
  if (!Array.isArray(removeIds)) removeIds = removeIds ? [removeIds] : []
  const copies = num(r, ['copies', 'count', 'copy_count'], 2)
  return {
    key: String(pick(r, ['id', 'serial', 'serial_no'], null) ?? `d${i}`),
    serial: pick(r, SERIAL_KEYS, null),
    assetNo: pick(r, ASSET_KEYS, null),
    copies,
    removable: removeIds.length || Math.max(0, copies - 1),
    raw: r,
  }
}

/** A single placement of a moved tyre. */
export function normalizePlacement(v) {
  const date = pick(v, DATE_KEYS, null)
  return {
    assetNo: pick(v, [...ASSET_KEYS, 'vehicle'], null),
    status: pick(v, ['status', 'state', 'condition'], null),
    date,
    day: date ? String(date).slice(0, 10) : null,
  }
}

/** Serial seen on more than one vehicle (informational movement). */
export function normalizeMovement(r, i = 0) {
  const serial = pick(r, SERIAL_KEYS, null)
  let list = pick(r, ['vehicles', 'movements', 'rows', 'placements'], [])
  if (!Array.isArray(list)) list = []
  const placements = list.map(normalizePlacement)
  const days = placements.map((p) => p.day).filter(Boolean).sort()
  const vehicles = placements.length || num(r, ['count', 'vehicle_count', 'vehicles_count'], 0)
  return {
    key: String(pick(r, ['serial', 'serial_no', 'id'], null) ?? `m${i}`),
    serial,
    vehicles,
    distinctAssets: new Set(placements.map((p) => p.assetNo).filter(Boolean)).size || null,
    firstSeen: days[0] || null,
    lastSeen: days[days.length - 1] || null,
    placements,
    raw: r,
  }
}

const textOf = (row) => JSON.stringify(row?.raw ?? row ?? {}).toLowerCase()

/** Free-text search over the original record (every field the RPC returned). */
export function matchesQuery(row, q) {
  const needle = String(q || '').trim().toLowerCase()
  return !needle || textOf(row).includes(needle)
}

export function filterOrphans(rows, { q = '', country = '' } = {}) {
  return (rows || []).filter((r) => matchesQuery(r, q) && (!country || String(r.country ?? '') === country))
}

export function filterDupes(rows, { q = '' } = {}) {
  return (rows || []).filter((r) => matchesQuery(r, q))
}

/** A movement matches a date window when ANY placement falls inside it. */
export function filterMovements(rows, { q = '', from = '', to = '' } = {}) {
  return (rows || []).filter((r) => {
    if (!matchesQuery(r, q)) return false
    if (!from && !to) return true
    return r.placements.some((p) => p.day && (!from || p.day >= from) && (!to || p.day <= to))
  })
}

export function countriesOf(orphans) {
  return [...new Set((orphans || []).map((r) => String(r.country ?? '').trim()).filter(Boolean))].sort()
}

/**
 * Headline figures. A section whose read failed or is still loading reports
 * null, never 0 - "we could not look" is not "there is nothing".
 */
export function reconSummary({ orphans, dupes, movements }) {
  const ok = (s) => s && !s.loading && !s.error
  const sumOr = (rows, f) => {
    const vals = rows.map(f).filter((v) => v != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null
  }
  return {
    orphanAssets: ok(orphans) ? orphans.rows.length : null,
    orphanTyres: ok(orphans) ? sumOr(orphans.rows, (r) => r.tyres) : null,
    dupeGroups: ok(dupes) ? dupes.rows.length : null,
    removableCopies: ok(dupes) ? sumOr(dupes.rows, (r) => r.removable) : null,
    movedSerials: ok(movements) ? movements.rows.length : null,
    placements: ok(movements) ? movements.rows.reduce((s, r) => s + (r.vehicles || 0), 0) : null,
    complete: ok(orphans) && ok(dupes) && ok(movements),
  }
}

/** Whole days since `date`, or null. */
export function daysSince(date, now = new Date()) {
  if (!date) return null
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return null
  return Math.max(0, Math.floor((new Date(now) - d) / 86400000))
}
