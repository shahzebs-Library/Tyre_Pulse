/**
 * gatePassAnalytics - pure engine for the Gate Pass station page (/gate-pass).
 *
 * The gate station decides whether a vehicle may leave the site; this module
 * only SHAPES what the page shows: the local calendar day, the day's tally and
 * clearance rate, the per-site breakdown (kept exactly as the "Today by Site"
 * panel reads it), a per-hour arrival profile, the top denial reasons, the
 * searchable/filterable log, and the export shape.
 *
 * Rules:
 *   - Dates are LOCAL calendar days built from getFullYear/getMonth/getDate.
 *     toISOString() is UTC and rolls a GCC evening back to yesterday, which
 *     would stamp a pass on the wrong day and miss that day's inspection.
 *   - A clearance rate with no decided passes is null (N/A), never 0% or 100%.
 *   - `now` is injected; nothing here reads the clock.
 */

const str = (v) => (v == null ? '' : String(v))
const p2 = (n) => String(n).padStart(2, '0')

export const PASS_STATUSES = ['Cleared', 'Denied', 'Pending']

/** YYYY-MM-DD for the local calendar day of `now` shifted by `offsetDays`. */
export function localIsoDate(now = new Date(), offsetDays = 0) {
  const d = new Date(now instanceof Date ? now.getTime() : now)
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

/** HH:MM (24h) of a timestamp in local time, or '' when unparseable. */
export function passTime(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`
}

/** Tally of a day's passes. Clearance rate = cleared / (cleared + denied). */
export function passSummary(passes = []) {
  const list = Array.isArray(passes) ? passes : []
  const cleared = list.filter((p) => p?.status === 'Cleared').length
  const denied = list.filter((p) => p?.status === 'Denied').length
  const decided = cleared + denied
  return {
    total: list.length,
    cleared,
    denied,
    pending: list.length - decided,
    clearRate: decided > 0 ? Math.round((cleared / decided) * 100) : null,
  }
}

/**
 * Per-site cleared/denied counts for the day, busiest site first. A pass with
 * no site is bucketed as "(No Site)" so it is never silently dropped.
 */
export function siteBreakdown(passes = []) {
  const m = new Map()
  for (const p of Array.isArray(passes) ? passes : []) {
    const s = p?.site || '(No Site)'
    const row = m.get(s) || { site: s, cleared: 0, denied: 0, other: 0 }
    if (p?.status === 'Cleared') row.cleared += 1
    else if (p?.status === 'Denied') row.denied += 1
    else row.other += 1
    m.set(s, row)
  }
  return [...m.values()].sort((a, b) => (b.cleared + b.denied) - (a.cleared + a.denied) || a.site.localeCompare(b.site))
}

/** Passes per local hour of the day (0..23); null-time passes counted apart. */
export function hourlyProfile(passes = []) {
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${p2(h)}:00`, cleared: 0, denied: 0 }))
  let untimed = 0
  for (const p of Array.isArray(passes) ? passes : []) {
    const d = p?.created_at ? new Date(p.created_at) : null
    if (!d || Number.isNaN(d.getTime())) { untimed += 1; continue }
    const slot = hours[d.getHours()]
    if (p?.status === 'Cleared') slot.cleared += 1
    else if (p?.status === 'Denied') slot.denied += 1
  }
  return { hours, untimed }
}

/** Most common denial reasons (case/space-insensitive), blank reasons counted apart. */
export function denialReasons(passes = [], limit = 5) {
  const m = new Map()
  let unstated = 0
  for (const p of Array.isArray(passes) ? passes : []) {
    if (p?.status !== 'Denied') continue
    const raw = str(p?.denial_reason).trim()
    if (!raw) { unstated += 1; continue }
    const k = raw.toLowerCase().replace(/\s+/g, ' ')
    const row = m.get(k) || { reason: raw, count: 0 }
    row.count += 1
    m.set(k, row)
  }
  return { top: [...m.values()].sort((a, b) => b.count - a.count).slice(0, limit), unstated }
}

/** Log filter: free-text search plus an optional status. */
export function filterPasses(passes = [], { search = '', status = '' } = {}) {
  const q = str(search).trim().toLowerCase()
  return (Array.isArray(passes) ? passes : []).filter((p) => {
    if (status && p?.status !== status) return false
    if (!q) return true
    return [p?.asset_no, p?.site, p?.status, p?.denial_reason].some((v) => str(v).toLowerCase().includes(q))
  })
}

/** Register rows: parsed time for sorting and display. */
export function passRegisterRows(passes = []) {
  return (Array.isArray(passes) ? passes : []).map((p) => {
    const t = p?.created_at ? Date.parse(p.created_at) : NaN
    return { ...p, createdTime: Number.isFinite(t) ? t : null, timeLabel: passTime(p?.created_at) }
  })
}

export const PASS_EXPORT_COLUMNS = [
  { key: 'time', header: 'Time' },
  { key: 'asset_no', header: 'Asset No' },
  { key: 'site', header: 'Site' },
  { key: 'status', header: 'Status' },
  { key: 'pass_date', header: 'Pass Date' },
  { key: 'denial_reason', header: 'Denial Reason' },
]

export function passExportRows(passes = []) {
  return passRegisterRows(passes).map((p) => ({
    time: p.timeLabel,
    asset_no: p.asset_no || '',
    site: p.site || '',
    status: p.status || '',
    pass_date: p.pass_date || '',
    denial_reason: p.denial_reason || '',
  }))
}
