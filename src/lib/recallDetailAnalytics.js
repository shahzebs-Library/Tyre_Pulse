/**
 * Recall detail analytics - pure helpers (no I/O, deterministic).
 *
 * Matches fleet tyres against ONE recall and turns the affected set into an
 * exposure picture: how many are still fitted, which assets and sites carry
 * them, and how long they have been on the vehicle.
 *
 * Matching mirrors the RecallTracker registry: brand (case/space-insensitive),
 * size when the recall names sizes, and serial prefix when one is given.
 *
 * HONESTY NOTES
 * - A tyre is treated as "Removed" when it carries a km_at_removal reading,
 *   exactly as the registry does. The recall tyre projection carries no
 *   removal date, so a removed tyre's time on the vehicle is null (N/A).
 * - Serial is read from `serial_number`, falling back to `serial_no`. If the
 *   projection carries neither, a recall with a serial prefix cannot match and
 *   `serialCoverage` reports that honestly.
 *
 * Time-dependent functions take an injectable `now`.
 */

const MS_PER_DAY = 86400000

function norm(v) {
  return String(v ?? '').toLowerCase().trim()
}

function toMs(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v)
  const t = v instanceof Date ? v.getTime() : new Date(s.length === 10 ? `${s}T00:00:00Z` : s).getTime()
  return Number.isFinite(t) ? t : null
}

/** The tyre's serial, whichever column the projection filled. */
export function tyreSerial(t) {
  const s = t?.serial_number ?? t?.serial_no
  return s == null || String(s).trim() === '' ? null : String(s).trim()
}

/** True when the tyre has been taken off the vehicle. */
export function isRemoved(t) {
  return t?.km_at_removal != null && t.km_at_removal !== ''
}

/** Tyres matching a recall's brand / size / serial prefix criteria. */
export function matchRecallTyres(recall, tyres) {
  if (!recall) return []
  const brand = norm(recall.brand)
  const sizes = (Array.isArray(recall.affected_sizes) ? recall.affected_sizes : []).map(norm).filter(Boolean)
  const prefix = norm(recall.affected_serial_prefix)
  return (Array.isArray(tyres) ? tyres : []).filter((t) => {
    if (!brand || norm(t?.brand) !== brand) return false
    if (sizes.length && !sizes.includes(norm(t?.size))) return false
    if (prefix) {
      const s = tyreSerial(t)
      if (!s || !s.toLowerCase().startsWith(prefix)) return false
    }
    return true
  })
}

/** Days a still-fitted tyre has been on the vehicle, or null. */
export function daysFitted(t, now = Date.now()) {
  if (isRemoved(t)) return null
  const from = toMs(t?.issue_date)
  const n = toMs(now)
  if (from == null || n == null) return null
  return Math.max(0, Math.floor((n - from) / MS_PER_DAY))
}

/** Days the recall has been open (issue_date to closed_at, else to now). */
export function recallAgeDays(recall, now = Date.now()) {
  const from = toMs(recall?.issue_date) ?? toMs(recall?.created_at)
  const to = toMs(recall?.closed_at) ?? toMs(now)
  if (from == null || to == null) return null
  return Math.max(0, Math.floor((to - from) / MS_PER_DAY))
}

/** Table/export rows for the affected tyres. */
export function affectedRows(matched, now = Date.now()) {
  return (Array.isArray(matched) ? matched : []).map((t) => ({
    id: t.id,
    serial: tyreSerial(t),
    asset_no: t.asset_no || null,
    position: t.position || null,
    site: t.site || null,
    country: t.country || null,
    size: t.size || null,
    risk_level: t.risk_level || null,
    tread_depth: t.tread_depth == null || t.tread_depth === '' || !Number.isFinite(Number(t.tread_depth)) ? null : Number(t.tread_depth),
    state: isRemoved(t) ? 'Removed' : 'Fitted',
    issue_date: t.issue_date || null,
    days_fitted: daysFitted(t, now),
  }))
}

function countBy(rows, key) {
  const map = new Map()
  for (const r of rows) {
    const k = r[key] || 'Unrecorded'
    const e = map.get(k) || { value: k, total: 0, fitted: 0 }
    e.total += 1
    if (r.state === 'Fitted') e.fitted += 1
    map.set(k, e)
  }
  return [...map.values()].sort((a, b) => b.fitted - a.fitted || b.total - a.total || a.value.localeCompare(b.value))
}

/** Exposure KPIs + breakdowns over the affected rows. */
export function recallExposure(rows) {
  const list = Array.isArray(rows) ? rows : []
  const fitted = list.filter((r) => r.state === 'Fitted')
  const days = fitted.map((r) => r.days_fitted).filter((v) => v != null)
  const withSerial = list.filter((r) => r.serial).length
  return {
    affected: list.length,
    fitted: fitted.length,
    removed: list.length - fitted.length,
    fittedPct: list.length ? Math.round((fitted.length / list.length) * 1000) / 10 : null,
    assets: new Set(fitted.map((r) => r.asset_no).filter(Boolean)).size,
    sites: new Set(list.map((r) => r.site).filter(Boolean)).size,
    countries: new Set(list.map((r) => r.country).filter(Boolean)).size,
    avgDaysFitted: days.length ? Math.round(days.reduce((s, v) => s + v, 0) / days.length) : null,
    maxDaysFitted: days.length ? Math.max(...days) : null,
    serialCoverage: list.length ? Math.round((withSerial / list.length) * 1000) / 10 : null,
    bySite: countBy(list, 'site'),
    byAsset: countBy(list.filter((r) => r.state === 'Fitted'), 'asset_no'),
    byPosition: countBy(list, 'position'),
  }
}

/** Filter affected rows by state / site / free text. */
export function filterAffected(rows, { state = 'all', site = 'all', search = '' } = {}) {
  const q = norm(search)
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => state === 'all' || r.state === state)
    .filter((r) => site === 'all' || (r.site || 'Unrecorded') === site)
    .filter((r) => !q || `${r.serial || ''} ${r.asset_no || ''} ${r.site || ''} ${r.position || ''}`.toLowerCase().includes(q))
}

/** Order for review: fitted before removed, longest on the vehicle first, then serial. */
export function sortAffected(rows) {
  return (Array.isArray(rows) ? rows.slice() : []).sort((a, b) =>
    (a.state === b.state ? 0 : a.state === 'Fitted' ? -1 : 1)
    || ((b.days_fitted ?? -1) - (a.days_fitted ?? -1))
    || String(a.serial ?? '').localeCompare(String(b.serial ?? '')))
}

/** Recall-level recommendation: short, factual, derived only from the data. */
export function recallActions(recall, exposure) {
  const out = []
  if (!recall) return out
  const status = String(recall.status || '')
  if (exposure.fitted > 0 && status !== 'Closed') {
    out.push(`${exposure.fitted} affected ${exposure.fitted === 1 ? 'tyre is' : 'tyres are'} still fitted across ${exposure.assets} ${exposure.assets === 1 ? 'asset' : 'assets'}. Schedule removal or inspection.`)
  }
  if (exposure.fitted > 0 && status === 'Closed') {
    out.push(`This recall is closed but ${exposure.fitted} matching ${exposure.fitted === 1 ? 'tyre is' : 'tyres are'} still recorded as fitted. Confirm the records.`)
  }
  if (exposure.affected > 0 && exposure.fitted === 0 && status !== 'Closed') {
    out.push('Every matching tyre is recorded as removed. The recall can be reviewed for closure.')
  }
  if (recall.affected_serial_prefix && exposure.affected === 0) {
    out.push('This recall filters by serial prefix. No fleet tyre carried a readable serial that matches, so exposure may be understated.')
  }
  if (exposure.affected === 0 && !recall.affected_serial_prefix) {
    out.push('No fleet tyre matches this recall brand and size.')
  }
  return out
}

/** Export-ready rows (strings, N/A for gaps). */
export function affectedExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    serial: r.serial ?? 'N/A',
    asset_no: r.asset_no ?? 'N/A',
    position: r.position ?? 'N/A',
    site: r.site ?? 'N/A',
    country: r.country ?? 'N/A',
    size: r.size ?? 'N/A',
    state: r.state,
    issue_date: r.issue_date ?? 'N/A',
    days_fitted: r.days_fitted == null ? 'N/A' : r.days_fitted,
  }))
}
