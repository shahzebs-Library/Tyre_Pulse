/**
 * tyreScanAnalytics - pure engine over the scan history kept on THIS device.
 *
 * Scans are not stored server-side (there is no scan log table), so the page
 * states plainly that the history is local to this browser. Everything here is
 * derived from those local entries only.
 */

const RISK_ORDER = ['Critical', 'High', 'Medium', 'Low']

/** Coerce anything read from storage into a clean list of entries. */
export function normaliseHistory(raw) {
  if (!Array.isArray(raw)) return []
  return raw.filter(e => e && typeof e.serial === 'string' && e.serial.trim() && e.scannedAt)
    .map(e => ({
      serial: e.serial.trim(),
      brand: e.brand && e.brand !== '-' ? e.brand : null,
      asset: e.asset && e.asset !== '-' ? e.asset : null,
      site: e.site && e.site !== '-' ? e.site : null,
      risk: RISK_ORDER.includes(e.risk) ? e.risk : null,
      status: e.status || null,
      tread: e.tread || null,
      found: e.found === true,
      scannedAt: e.scannedAt,
    }))
}

/** Headline figures. foundRate is null when there are no scans. */
export function scanKpis(entries = []) {
  const total = entries.length
  const found = entries.filter(e => e.found).length
  const notFound = total - found
  const atRisk = entries.filter(e => e.found && (e.risk === 'Critical' || e.risk === 'High')).length
  const assets = new Set(entries.filter(e => e.asset).map(e => e.asset)).size
  return { total, found, notFound, foundRate: total ? Math.round((found / total) * 1000) / 10 : null, atRisk, assets }
}

/** Counts by risk band for the found scans, plus an 'Unrated' bucket. */
export function riskBreakdown(entries = []) {
  const out = Object.fromEntries([...RISK_ORDER, 'Unrated'].map(k => [k, 0]))
  for (const e of entries) if (e.found) out[e.risk || 'Unrated'] += 1
  return out
}

/** Scans per day (YYYY-MM-DD), oldest first. */
export function scansByDay(entries = []) {
  const map = new Map()
  for (const e of entries) {
    const d = String(e.scannedAt).slice(0, 10)
    const row = map.get(d) || { day: d, found: 0, notFound: 0 }
    if (e.found) row.found += 1; else row.notFound += 1
    map.set(d, row)
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day))
}

export function filterScans(entries = [], { outcome = 'all', risk = 'all', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return entries.filter(e => {
    if (outcome === 'found' && !e.found) return false
    if (outcome === 'not_found' && e.found) return false
    if (risk !== 'all' && (e.risk || 'Unrated') !== risk) return false
    if (!q) return true
    return [e.serial, e.brand, e.asset, e.site].filter(Boolean).join(' ').toLowerCase().includes(q)
  })
}

export function sortScans(entries = [], key = 'newest') {
  const out = [...entries]
  if (key === 'oldest') return out.sort((a, b) => String(a.scannedAt).localeCompare(String(b.scannedAt)))
  if (key === 'serial') return out.sort((a, b) => a.serial.localeCompare(b.serial))
  if (key === 'risk') {
    const rank = r => (r ? RISK_ORDER.indexOf(r) : RISK_ORDER.length)
    return out.sort((a, b) => rank(a.risk) - rank(b.risk) || String(b.scannedAt).localeCompare(String(a.scannedAt)))
  }
  return out.sort((a, b) => String(b.scannedAt).localeCompare(String(a.scannedAt)))
}

/** Path to the tyre passport for a serial. */
export function passportPath(serial) {
  return `/tyre-passport/${encodeURIComponent(String(serial || '').trim())}`
}

export function scanExportRows(entries = []) {
  return entries.map(e => ({
    serial: e.serial,
    outcome: e.found ? 'Found' : 'Not found',
    brand: e.brand || 'N/A',
    asset: e.asset || 'N/A',
    site: e.site || 'N/A',
    risk: e.risk || 'N/A',
    tread: e.tread || 'N/A',
    scanned_at: String(e.scannedAt).replace('T', ' ').slice(0, 16),
  }))
}
