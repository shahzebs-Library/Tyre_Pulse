/**
 * dispatchAnalytics - pure view-model engine for the Dispatch Planning page
 * (/dispatch). Reuses the status vocabulary + counts from `src/lib/dispatch.js`
 * and adds search/filters, overdue detection against an injected clock, the
 * KPI strip, busiest routes and the export shape.
 *
 * No I/O, no Date.now(). Unmeasurable figures are null (rendered N/A).
 */
import { summarizeDispatch, loadStatusMeta, LOAD_STATUSES } from './dispatch'
import { searchRows, sortRows, buildExport } from './consoleTable'

const OPEN = new Set(['planned', 'dispatched'])
const ACTIVE = new Set(['planned', 'dispatched', 'in_transit'])

function num(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}
function ms(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}
function refMs(now) {
  const t = now instanceof Date ? now.getTime() : Number(now)
  return Number.isFinite(t) ? t : null
}

/** A load is overdue when its scheduled time has passed and it has not left yet. */
export function isOverdue(row, now) {
  const at = ms(row?.scheduled_at)
  const ref = refMs(now)
  return at != null && ref != null && OPEN.has(row?.status) && at < ref
}

export function routeLabel(r) {
  const o = (r?.origin || '').trim()
  const d = (r?.destination || '').trim()
  if (!o && !d) return 'N/A'
  return `${o || 'N/A'} to ${d || 'N/A'}`
}

export function enrichLoads(rows = [], now) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    ...r,
    _overdue: isOverdue(r, now),
    _weight: num(r.weight_kg),
    _route: routeLabel(r),
  }))
}

export function optionList(rows = [], key) {
  return [...new Set(rows.map((r) => (r?.[key] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/**
 * Filter + search. `status` may be a load status, 'active' or 'overdue'.
 * Default order: scheduled soonest first; unscheduled last.
 */
export function filterLoads(enriched = [], { status = 'all', asset = '', site = '', search = '' } = {}) {
  const narrowed = enriched.filter((r) => {
    if (status === 'overdue') { if (!r._overdue) return false }
    else if (status === 'active') { if (!ACTIVE.has(r.status)) return false }
    else if (status !== 'all' && r.status !== status) return false
    if (asset && r.asset_no !== asset) return false
    if (site && (r.site || '').trim() !== site) return false
    return true
  })
  const searched = searchRows(narrowed, search, ['load_no', 'asset_no', 'driver_name', 'origin', 'destination', 'cargo', 'site'])
  return sortRows(searched, { key: 'scheduled_at', dir: 'asc' })
}

export function dispatchKpis(rows = [], now) {
  const list = Array.isArray(rows) ? rows : []
  const s = summarizeDispatch(list)
  const enriched = enrichLoads(list, now)
  const weighed = enriched.filter((r) => r._weight != null)
  const weightKg = weighed.reduce((a, r) => a + r._weight, 0)
  const closed = s.delivered + s.byStatus.cancelled
  const ref = refMs(now)
  const dayStart = ref == null ? null : new Date(new Date(ref).setHours(0, 0, 0, 0)).getTime()
  const dayEnd = dayStart == null ? null : dayStart + 86400000
  const today = enriched.filter((r) => {
    const t = ms(r.scheduled_at)
    return t != null && dayStart != null && t >= dayStart && t < dayEnd
  }).length
  return {
    total: s.total,
    byStatus: s.byStatus,
    active: s.active,
    inTransit: s.inTransit,
    delivered: s.delivered,
    cancelled: s.byStatus.cancelled,
    overdue: enriched.filter((r) => r._overdue).length,
    scheduledToday: today,
    // Delivery rate over CLOSED loads only; null when nothing has closed.
    deliveryRatePct: closed ? Math.round((s.delivered / closed) * 1000) / 10 : null,
    // Payload only over loads that recorded a weight; null when none did.
    totalWeightTonnes: weighed.length ? Math.round((weightKg / 1000) * 100) / 100 : null,
    weightCoveragePct: s.total ? Math.round((weighed.length / s.total) * 1000) / 10 : null,
    drivers: optionList(list, 'driver_name').length,
  }
}

/** Status share rows for the pipeline bars (percent null when no loads). */
export function statusShares(kpis) {
  return LOAD_STATUSES.map((st) => {
    const n = kpis.byStatus?.[st] || 0
    return { status: st, label: loadStatusMeta[st]?.label || st, count: n, pct: kpis.total ? Math.round((n / kpis.total) * 100) : null }
  })
}

/** Busiest origin to destination lanes. */
export function topRoutes(enriched = [], limit = 5) {
  const m = new Map()
  for (const r of enriched) {
    if (r._route === 'N/A') continue
    const cur = m.get(r._route) || { route: r._route, loads: 0, weightKg: 0, weighed: 0 }
    cur.loads += 1
    if (r._weight != null) { cur.weightKg += r._weight; cur.weighed += 1 }
    m.set(r._route, cur)
  }
  return [...m.values()]
    .sort((a, b) => b.loads - a.loads || a.route.localeCompare(b.route))
    .slice(0, limit)
    .map((x) => ({ ...x, weightTonnes: x.weighed ? Math.round((x.weightKg / 1000) * 100) / 100 : null }))
}

export const LOAD_EXPORT_COLUMNS = [
  { key: 'load_no', header: 'Load no' },
  { key: 'asset_no', header: 'Asset' },
  { key: 'driver_name', header: 'Driver' },
  { key: 'origin', header: 'Origin' },
  { key: 'destination', header: 'Destination' },
  { key: 'cargo', header: 'Cargo' },
  { key: 'weight_kg', header: 'Weight (kg)', value: (r) => (r._weight == null ? 'N/A' : r._weight) },
  { key: 'scheduled_at', header: 'Scheduled' },
  { key: 'status', header: 'Status', value: (r) => loadStatusMeta[r.status]?.label || r.status },
  { key: 'overdue', header: 'Overdue', value: (r) => (r._overdue ? 'Yes' : 'No') },
  { key: 'site', header: 'Site' },
]

export function loadExport(filtered = []) {
  return buildExport(filtered, LOAD_EXPORT_COLUMNS)
}

export { LOAD_STATUSES, loadStatusMeta }
