/**
 * workshopTvAnalytics.js - pure shaping for the public /workshop-tv/:token board.
 *
 * The board is anonymous and PII-free: its ONLY input is the aggregate snapshot
 * returned by get_workshop_snapshot. This module turns that snapshot into what
 * the wallboard renders, with no I/O and an injectable `now`.
 *
 * HONESTY NOTES
 * - A KPI key that is missing or non-numeric in the snapshot is null and the
 *   board shows N/A. It is never rendered as 0 (0 open jobs and "the snapshot
 *   did not say" are opposite statements on a workshop wall).
 * - Utilization is null unless the snapshot carries a finite number, and is
 *   clamped to 0..100 only for the dial, never for the stated figure.
 * - "Off road for" is derived from the snapshot's own `since` timestamp; a VOR
 *   entry with no usable timestamp reads N/A.
 */

export const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 }
export const ALERT_RANK = { critical: 0, warning: 1, info: 2 }

const HOUR = 3_600_000

function toMs(v) {
  if (v == null || v === '') return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}
function nowMs(now) { return toMs(now ?? new Date()) ?? Date.now() }
const arr = (v) => (Array.isArray(v) ? v : [])

/** A finite number, or null. */
export function tvNumber(v) {
  if (v == null || v === '' || typeof v === 'boolean') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Priority bucket key from any free-text priority. */
export function priorityKey(p) {
  const k = String(p || '').toLowerCase()
  if (k.includes('crit')) return 'critical'
  if (k.includes('high')) return 'high'
  if (k.includes('med')) return 'medium'
  if (k.includes('low')) return 'low'
  return 'unknown'
}

/** Status family for colouring (colour is never the only signal: text is shown too). */
export function statusFamily(s) {
  const k = String(s || '').toLowerCase()
  if (k.includes('hold') || k.includes('pending') || k.includes('wait')) return 'waiting'
  if (k.includes('complete') || k.includes('closed') || k.includes('done') || k.includes('inspection')) return 'done'
  if (k.includes('progress') || k.includes('open') || k.includes('assigned') || k.includes('new')) return 'active'
  return 'other'
}

/** Hours off road (whole hours) or null when `since` cannot be read. */
export function hoursSince(iso, { now } = {}) {
  const t = toMs(iso)
  if (t == null) return null
  return Math.max(0, Math.round((nowMs(now) - t) / HOUR))
}

/** "5h" under a day, "3d" otherwise, "N/A" when unknown. */
export function sinceLabel(iso, { now } = {}) {
  const h = hoursSince(iso, { now })
  if (h == null) return 'N/A'
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`
}

/**
 * Shape a snapshot for the board.
 * @returns {{ kpis:Record<string, number|null>, utilization:number|null,
 *   jobsByStatus:Array<{label:string,value:number}>, openCards:Array<object>,
 *   vorList:Array<object>, alerts:Array<object>, counts:object }}
 */
export function shapeWorkshopSnapshot(snapshot, { now } = {}) {
  const raw = snapshot?.kpis && typeof snapshot.kpis === 'object' ? snapshot.kpis : {}
  const kpis = {}
  for (const [k, val] of Object.entries(raw)) kpis[k] = tvNumber(val)

  const jobsByStatus = arr(snapshot?.jobs_by_status)
    .map((x) => ({ label: String(x?.label ?? 'Unknown'), value: tvNumber(x?.value) }))
    .filter((x) => x.value != null && x.value > 0)

  const openCards = arr(snapshot?.open_job_cards)
    .map((c, i) => ({ ...c, _i: i, _priority: priorityKey(c?.priority), _family: statusFamily(c?.status) }))
    .sort((a, b) => (PRIORITY_RANK[a._priority] ?? 9) - (PRIORITY_RANK[b._priority] ?? 9) || a._i - b._i)

  const vorList = arr(snapshot?.vor_list)
    .map((v) => ({ ...v, hoursOff: hoursSince(v?.since, { now }), sinceText: sinceLabel(v?.since, { now }) }))
    .sort((a, b) => (b.hoursOff ?? -1) - (a.hoursOff ?? -1))

  const alerts = arr(snapshot?.safety_alerts)
    .map((a, i) => ({ ...a, _i: i, level: String(a?.level || 'info').toLowerCase() }))
    .sort((a, b) => (ALERT_RANK[a.level] ?? 3) - (ALERT_RANK[b.level] ?? 3) || a._i - b._i)

  return {
    kpis,
    utilization: tvNumber(raw.utilization),
    jobsByStatus,
    openCards,
    vorList,
    alerts,
    counts: {
      openCards: openCards.length,
      critical: openCards.filter((c) => c._priority === 'critical').length,
      vor: vorList.length,
      criticalAlerts: alerts.filter((a) => a.level === 'critical').length,
    },
  }
}

/** Next page index for the auto-advancing job list (wraps to the first page). */
export function nextPageIndex(page, totalPages) {
  const t = Math.max(1, Number(totalPages) || 1)
  const p = Number.isFinite(Number(page)) ? Number(page) : 0
  return (p + 1) % t
}
