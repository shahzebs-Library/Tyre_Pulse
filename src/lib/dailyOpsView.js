/**
 * dailyOpsView - pure shaping for the Daily Ops board (/daily-ops), rebuilt on
 * the Command Center kit to the owner's mockup.
 *
 * Every figure here comes from rows the page already read (tyre_records,
 * inspections, work_orders, alerts, accidents, action_items). Nothing is
 * invented: a value that cannot be measured is null (rendered N/A), and a trend
 * is returned only when the previous day carries a real, non-zero base.
 *
 * The mockup's trip / GPS features (live map, trips in progress, ETA, distance
 * remaining, driver contact) have no source in this database: trips and
 * gps_positions hold no rows. The page states that instead of drawing them.
 *
 * No I/O, no React. `now` is injected wherever the clock matters.
 */
import { normalizeWoStatus, isClosedWoStatus } from './workOrderStatus'
import { addDays } from './dailyOpsAnalytics'

export const dayOf = (v) => String(v || '').slice(0, 10)
const lc = (v) => String(v ?? '').trim().toLowerCase()
const toMs = (v) => {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/** Whole-number % change; null when either side is missing or the base is 0. */
export function pctChange(curr, prev) {
  if (curr == null || prev == null) return null
  const c = Number(curr); const p = Number(prev)
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null
  return Math.round(((c - p) / p) * 100)
}

/** Distinct asset numbers with a tyre record or inspection on `iso`. */
export function activeAssetsOn({ tyreRecords = [], inspections = [] }, iso) {
  const set = new Set()
  for (const r of tyreRecords) if (dayOf(r.issue_date) === iso && r.asset_no) set.add(r.asset_no)
  for (const r of inspections) if (dayOf(r.inspection_date) === iso && r.asset_no) set.add(r.asset_no)
  return set
}

/** Open work order whose target completion day is before `iso`. */
export function isWoDelayed(wo, iso) {
  if (!wo || isClosedWoStatus(wo.status)) return false
  const target = dayOf(wo.scheduled_date)
  return Boolean(target) && target < iso
}

/** Days a delayed job is past its target, else 0. */
export function delayDays(wo, iso) {
  if (!isWoDelayed(wo, iso)) return 0
  const a = new Date(`${dayOf(wo.scheduled_date)}T00:00:00Z`).getTime()
  const b = new Date(`${iso}T00:00:00Z`).getTime()
  return Math.max(0, Math.round((b - a) / 86400000))
}

const countOn = (rows, field, iso) => rows.filter((r) => dayOf(r?.[field]) === iso).length

/**
 * The five headline tiles. Trends compare against the previous day and are
 * null whenever the previous day has nothing to compare with.
 */
export function headlineKpis({ tyreRecords = [], inspections = [], workOrders = [], accidents = [], selectedDate }) {
  const prev = addDays(selectedDate, -1)
  const activeNow = activeAssetsOn({ tyreRecords, inspections }, selectedDate).size
  const activePrev = activeAssetsOn({ tyreRecords, inspections }, prev).size
  const woNow = countOn(workOrders, 'created_at', selectedDate)
  const woPrev = countOn(workOrders, 'created_at', prev)
  const incNow = countOn(accidents, 'incident_date', selectedDate)
  const incPrev = countOn(accidents, 'incident_date', prev)
  const delayed = workOrders.filter((w) => dayOf(w.created_at) <= selectedDate && isWoDelayed(w, selectedDate)).length

  // On-time completion: completed jobs (in the loaded 30-day window) that carry
  // both a target and a completion date. Null when none can be judged.
  let judged = 0; let onTime = 0
  for (const w of workOrders) {
    const done = dayOf(w.completed_at)
    const target = dayOf(w.scheduled_date)
    if (!done || !target || done > selectedDate) continue
    if (!isClosedWoStatus(w.status) || normalizeWoStatus(w.status) === 'Cancelled') continue
    judged += 1
    if (done <= target) onTime += 1
  }
  return {
    activeVehicles: { value: activeNow, trend: pctChange(activeNow, activePrev) },
    workOrdersOpened: { value: woNow, trend: pctChange(woNow, woPrev) },
    delayedJobs: { value: delayed },
    incidents: { value: incNow, trend: pctChange(incNow, incPrev) },
    onTime: { value: judged ? Math.round((onTime / judged) * 100) : null, judged },
  }
}

const PROGRESS_BUCKET = {
  Completed: 'completed',
  'In Progress': 'inProgress',
  'Quality Inspection': 'inProgress',
  Cancelled: 'cancelled',
}

/** Today's work orders split into completed / in progress / pending / cancelled. */
export function shiftProgress(todayWO = []) {
  const out = { completed: 0, inProgress: 0, pending: 0, cancelled: 0, total: todayWO.length }
  for (const w of todayWO) out[PROGRESS_BUCKET[normalizeWoStatus(w.status)] || 'pending'] += 1
  const base = out.total - out.cancelled
  out.pct = base > 0 ? Math.round((out.completed / base) * 100) : null
  return out
}

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 }
export const priorityKey = (p) => {
  const k = lc(p)
  return k in PRIORITY_RANK ? k : 'unset'
}

/** Open work orders (opened up to `iso`) by priority. */
export function jobBacklog(workOrders = [], iso) {
  const out = { critical: 0, high: 0, medium: 0, low: 0, unset: 0, total: 0 }
  for (const w of workOrders) {
    if (dayOf(w.created_at) > iso || isClosedWoStatus(w.status)) continue
    out[priorityKey(w.priority)] += 1
    out.total += 1
  }
  return out
}

/** Average opened-to-completed hours for jobs completed on `iso`; null when none. */
export function turnaroundOn(workOrders = [], iso) {
  const hours = []
  for (const w of workOrders) {
    if (dayOf(w.completed_at) !== iso) continue
    const a = toMs(w.opened_at || w.created_at); const b = toMs(w.completed_at)
    if (a == null || b == null || b < a) continue
    hours.push((b - a) / 3600000)
  }
  if (!hours.length) return { hours: null, n: 0 }
  return { hours: Math.round((hours.reduce((s, h) => s + h, 0) / hours.length) * 10) / 10, n: hours.length }
}

export function turnaround(workOrders, iso) {
  const now = turnaroundOn(workOrders, iso)
  const prev = turnaroundOn(workOrders, addDays(iso, -1))
  return { ...now, trend: pctChange(now.hours, prev.hours) }
}

/**
 * Assets active on `iso` as a share of the assets seen with a fitment in the
 * last 30 days. Null when nothing was seen in 30 days.
 */
export function activityShare({ activeCount, allTyres30 = [] }) {
  const known = new Set(allTyres30.map((r) => r.asset_no).filter(Boolean)).size
  if (!known) return { pct: null, known: 0 }
  return { pct: Math.min(100, Math.round((activeCount / known) * 100)), known }
}

/** Per-site activity today across tyres, inspections and work orders. */
export function siteBoard({ todayRecs = [], todayIns = [], todayWO = [] }) {
  const map = new Map()
  const bump = (site, key) => {
    const s = String(site || '').trim() || 'No site'
    const row = map.get(s) || { site: s, tyres: 0, inspections: 0, workOrders: 0, total: 0 }
    row[key] += 1; row.total += 1
    map.set(s, row)
  }
  todayRecs.forEach((r) => bump(r.site, 'tyres'))
  todayIns.forEach((r) => bump(r.site, 'inspections'))
  todayWO.forEach((r) => bump(r.site, 'workOrders'))
  return [...map.values()].sort((a, b) => b.total - a.total || a.site.localeCompare(b.site))
}

export const STATUS_TONE = {
  Completed: 'good', 'In Progress': 'info', 'Quality Inspection': 'info', Cancelled: 'muted',
  'Waiting for Parts': 'warn', 'Waiting for Approval': 'warn', 'On Hold': 'warn', Overdue: 'bad',
}
export const PRIORITY_TONE = { critical: 'bad', high: 'orange', medium: 'warn', low: 'info', unset: 'muted' }

/**
 * Dispatch board rows: every job open as of `iso` plus every job opened on
 * `iso`, with its delay against target. Filtered and sorted (delayed first,
 * then priority, then newest).
 */
export function dispatchRows(workOrders = [], iso, { search = '', status = '', priority = '', site = '' } = {}) {
  const q = lc(search)
  return workOrders
    .filter((w) => dayOf(w.created_at) <= iso && (!isClosedWoStatus(w.status) || dayOf(w.created_at) === iso))
    .map((w) => {
      const st = normalizeWoStatus(w.status) || 'New'
      const delayed = isWoDelayed(w, iso)
      return {
        id: w.id,
        ref: w.work_order_no || String(w.id || '').slice(0, 8),
        asset: w.asset_no || null,
        site: w.site || null,
        status: st,
        delayed,
        delayDays: delayDays(w, iso),
        priority: priorityKey(w.priority),
        priorityLabel: w.priority || 'Not set',
        workType: w.work_type || null,
        opened: w.opened_at || w.created_at || null,
        target: dayOf(w.scheduled_date) || null,
        completed: w.completed_at || null,
        raw: w,
      }
    })
    .filter((r) => (!status || (status === 'delayed' ? r.delayed : r.status === status)))
    .filter((r) => !priority || r.priority === priority)
    .filter((r) => !site || r.site === site)
    .filter((r) => !q || [r.ref, r.asset, r.site, r.status, r.workType].map(lc).join(' ').includes(q))
    .sort((a, b) => (Number(b.delayed) - Number(a.delayed))
      || (b.delayDays - a.delayDays)
      || ((PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9))
      || String(b.opened || '').localeCompare(String(a.opened || '')))
}

const ago = (ts, now) => {
  const t = toMs(ts); const n = toMs(now)
  if (t == null || n == null) return 'N/A'
  const min = Math.max(0, Math.round((n - t) / 60000))
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

/**
 * Exception queues: delayed jobs, open breakdowns (Emergency work type), actions
 * past their SLA, and unresolved high or critical alerts.
 */
export function exceptionQueues({ workOrders = [], alerts = [], actionItems = [], iso, now }) {
  const nowMs = toMs(now)
  const delays = workOrders
    .filter((w) => dayOf(w.created_at) <= iso && isWoDelayed(w, iso))
    .sort((a, b) => delayDays(b, iso) - delayDays(a, iso))
    .map((w) => ({ id: `d-${w.id}`, ref: w.work_order_no || w.asset_no || 'Job', title: `${delayDays(w, iso)} day${delayDays(w, iso) === 1 ? '' : 's'} past target`, detail: [w.asset_no, w.site].filter(Boolean).join(' | ') || 'No asset or site', when: `Target ${dayOf(w.scheduled_date)}`, tone: 'bad' }))
  const breakdowns = workOrders
    .filter((w) => dayOf(w.created_at) <= iso && !isClosedWoStatus(w.status) && lc(w.work_type) === 'emergency')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map((w) => ({ id: `b-${w.id}`, ref: w.work_order_no || w.asset_no || 'Job', title: 'Open breakdown', detail: [w.asset_no, w.site].filter(Boolean).join(' | ') || 'No asset or site', when: ago(w.created_at, now), tone: 'orange' }))
  const sla = actionItems
    .filter((a) => !['resolved', 'dismissed'].includes(a?.status) && a?.sla_due_at && nowMs != null && toMs(a.sla_due_at) != null && toMs(a.sla_due_at) < nowMs)
    .sort((a, b) => toMs(a.sla_due_at) - toMs(b.sla_due_at))
    .map((a) => ({ id: `s-${a.id}`, ref: a.asset_no || a.title || 'Action', title: a.title || 'Action past SLA', detail: [a.assigned_to || 'Unassigned', a.site].filter(Boolean).join(' | '), when: `SLA ${ago(a.sla_due_at, now)}`, tone: 'bad' }))
  const alertRows = alerts
    .filter((a) => a?.resolved !== true && ['critical', 'high'].includes(lc(a?.severity)) && dayOf(a.created_at) <= iso)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map((a) => ({ id: `a-${a.id}`, ref: a.asset_no || 'Fleet', title: a.message || a.alert_type || 'Alert raised', detail: `${a.severity} alert`, when: ago(a.created_at, now), tone: lc(a.severity) === 'critical' ? 'bad' : 'warn' }))
  return { delays, breakdowns, sla, alerts: alertRows }
}

/** Timeline of one job: opened, target, completed, with the delay against target. */
export function jobTimeline(row, iso) {
  if (!row) return []
  const out = []
  if (row.opened) out.push({ key: 'opened', at: row.opened, label: 'Job opened', tone: 'good', note: row.workType || '' })
  if (row.target) out.push({ key: 'target', at: row.target, label: 'Target completion', tone: row.delayed ? 'bad' : 'info', note: row.delayed ? `${row.delayDays} day${row.delayDays === 1 ? '' : 's'} late` : 'On schedule' })
  if (row.completed) out.push({ key: 'done', at: row.completed, label: 'Completed', tone: 'good', note: row.target ? (dayOf(row.completed) <= row.target ? 'On time' : 'After target') : '' })
  else out.push({ key: 'open', at: null, label: 'Not completed yet', tone: 'muted', note: `As of ${iso}` })
  return out
}

export function fmtHours(h) {
  if (h == null) return 'N/A'
  if (h < 1) return `${Math.round(h * 60)} min`
  return `${h.toLocaleString('en-US', { maximumFractionDigits: 1 })} hours`
}
