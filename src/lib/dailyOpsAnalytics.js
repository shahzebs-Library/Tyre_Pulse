/**
 * Daily Operations page analytics: the pure calculations behind the daily
 * briefing (week windows, spend, fleet status, priority queue, upcoming work,
 * operational-work filters and the printable briefing document).
 *
 * No I/O, no React, no clock read inside the maths: dates are ISO day strings
 * ('YYYY-MM-DD') passed in by the caller, and `now` is injected where a
 * current instant matters. Reuses `dailyOpsPriority` for the work-order
 * lifecycle rules rather than re-deciding what "overdue" or "closed" means.
 *
 * Honesty rules: an unmeasurable figure is `null` (rendered N/A), never 0.
 * A week-on-week change from a zero base has no percentage; a daily budget
 * that was never set is null, not 0.
 */
import { isOverdueWorkOrder, isTerminalWorkOrderStatus } from './dailyOpsPriority'

export const SEVERITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 }
export const INACTIVITY_DAYS = 14
export const DORMANT_DAYS = 30
export const UPCOMING_DAYS = 7

function pad(n) { return String(n).padStart(2, '0') }

/** Local calendar day of a Date as 'YYYY-MM-DD' (never toISOString, which is UTC). */
export function toIsoDay(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function parseDay(iso) {
  return new Date(`${iso}T00:00:00`)
}

export function addDays(iso, n) {
  const d = parseDay(iso)
  d.setDate(d.getDate() + n)
  return toIsoDay(d)
}

/** Monday-to-Sunday week containing the given day. */
export function weekRange(iso) {
  const d = parseDay(iso)
  const mon = new Date(d)
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  return { start: toIsoDay(mon), end: toIsoDay(sun) }
}

export function prevWeek(iso) {
  return weekRange(addDays(iso, -7))
}

export function daysBetween(fromIso, toIso) {
  return Math.round((parseDay(toIso) - parseDay(fromIso)) / 86_400_000)
}

/** Rows whose date field (a day string or a timestamp) falls inside [start, end]. */
export function inDayRange(rows, field, start, end) {
  return (rows || []).filter((r) => {
    const v = String(r?.[field] ?? '').slice(0, 10)
    return v !== '' && v >= start && v <= end
  })
}

export function onDay(rows, field, iso) {
  return inDayRange(rows, field, iso, iso)
}

/**
 * Tyre spend = cost_per_tyre x qty (qty defaults to 1). Returns the spend plus
 * how many rows actually carried a price, so an unpriced day reads as unknown
 * rather than as zero spend.
 */
export function tyreSpend(rows) {
  let total = 0
  let priced = 0
  for (const r of rows || []) {
    const c = Number(r?.cost_per_tyre)
    if (Number.isFinite(c) && r.cost_per_tyre !== null && r.cost_per_tyre !== '') {
      total += c * (Number(r.qty) || 1)
      priced += 1
    }
  }
  const count = (rows || []).length
  return { total: priced > 0 ? total : count === 0 ? 0 : null, priced, count }
}

/**
 * Week-on-week change. `pct` is null when there is no prior-week base, since a
 * percentage of zero is undefined rather than "+100%".
 */
export function weekDelta(curr, prev) {
  const c = Number(curr) || 0
  const p = Number(prev) || 0
  if (p === 0) return { val: c, pct: c === 0 ? 0 : null }
  return { val: c - p, pct: Math.round(((c - p) / p) * 100) }
}

/** Annual budget target (from KPI targets) spread per day, or null when unset. */
export function dailyBudgetFromTargets(targets) {
  const annual = Number.parseFloat(targets?.annual_budget)
  return Number.isFinite(annual) && annual > 0 ? annual / 365 : null
}

/** Fitments per site, busiest first. */
export function siteActivity(rows) {
  const map = new Map()
  for (const r of rows || []) {
    const s = r?.site || 'Unknown'
    map.set(s, (map.get(s) || 0) + 1)
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

/**
 * Fleet status for the selected day: vehicles active today, vehicles fitted
 * with a critical-risk tyre today, and vehicles seen in the 30-day fitment
 * window with no tyre record in the last 30 days (dormant).
 */
export function fleetStatus({ todayRecs = [], todayIns = [], tyreRecords = [], allTyres30 = [], selectedDate }) {
  const active = new Set([...todayRecs, ...todayIns].map((r) => r.asset_no).filter(Boolean))
  const critical = new Set(todayRecs.filter((r) => r.risk_level === 'Critical').map((r) => r.asset_no).filter(Boolean))
  const known = new Set(allTyres30.map((r) => r.asset_no).filter(Boolean))
  const recent = new Set(inDayRange(tyreRecords, 'issue_date', addDays(selectedDate, -DORMANT_DAYS), selectedDate).map((r) => r.asset_no))
  const dormant = [...known].filter((a) => !recent.has(a)).length
  return { active: active.size, critical: critical.size, dormant }
}

/** Open work orders scheduled in the next seven days, soonest first. */
export function upcomingWorkOrders(workOrders, selectedDate, days = UPCOMING_DAYS) {
  const end = addDays(selectedDate, days)
  return (workOrders || [])
    .filter((r) => {
      const d = String(r?.scheduled_date || '').slice(0, 10)
      return d && d > selectedDate && d <= end && !isTerminalWorkOrderStatus(r.status)
    })
    .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)))
}

/**
 * The priority queue: critical fitments today, overdue work orders (critical
 * past 7 days) and assets with no fitment or inspection in 14 days. `t` is the
 * caller's translator so the queue stays localised; it is only used for text.
 */
export function buildPriorityQueue({ todayRecs = [], workOrders = [], tyreRecords = [], inspections = [], allTyres30 = [], selectedDate }, t = (k) => k) {
  const na = t('dailyops.na')
  const items = []

  for (const r of todayRecs.filter((x) => x.risk_level === 'Critical')) {
    items.push({
      id: `crit-${r.id}`,
      severity: 'Critical',
      type: t('dailyops.priorityQueue.types.criticalTyreFitted'),
      description: t('dailyops.priorityQueue.descriptions.criticalFitted', { asset: r.asset_no }),
      asset: r.asset_no,
      detail: t('dailyops.priorityQueue.details.criticalFitted', {
        serial: r.serial_number || na, position: r.position || na, site: r.site || na,
      }),
      link: '/tyres',
    })
  }

  for (const r of workOrders.filter((x) => isOverdueWorkOrder(x, selectedDate))) {
    const daysPast = daysBetween(String(r.scheduled_date).slice(0, 10), selectedDate)
    items.push({
      id: `wo-${r.id}`,
      severity: daysPast > 7 ? 'Critical' : 'High',
      type: t('dailyops.priorityQueue.types.overdueWorkOrder'),
      description: t('dailyops.priorityQueue.descriptions.overdueWorkOrder', { wo: r.work_order_no || r.id, days: daysPast }),
      asset: r.asset_no,
      detail: t('dailyops.priorityQueue.details.overdueWorkOrder', {
        status: r.status, priority: r.priority || na, site: r.site || na,
      }),
      link: '/work-orders',
    })
  }

  const since = addDays(selectedDate, -INACTIVITY_DAYS)
  const recent = new Set([
    ...inDayRange(tyreRecords, 'issue_date', since, selectedDate).map((r) => r.asset_no),
    ...inDayRange(inspections, 'inspection_date', since, selectedDate).map((r) => r.asset_no),
  ])
  for (const asset of new Set(allTyres30.map((r) => r.asset_no).filter(Boolean))) {
    if (recent.has(asset)) continue
    items.push({
      id: `inactive-${asset}`,
      severity: 'Medium',
      type: t('dailyops.priorityQueue.types.noInspection'),
      description: t('dailyops.priorityQueue.descriptions.noInspection', { asset }),
      asset,
      detail: t('dailyops.priorityQueue.details.noInspection'),
      link: '/inspections',
    })
  }

  return items.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
}

/** Severity counts over the priority queue. */
export function queueCounts(queue) {
  const c = { Critical: 0, High: 0, Medium: 0, Low: 0 }
  for (const i of queue || []) if (i.severity in c) c[i.severity] += 1
  return c
}

export const CLOSED_ACTION_STATUSES = ['resolved', 'dismissed']

export function isActiveAction(item) {
  return !CLOSED_ACTION_STATUSES.includes(item?.status)
}

/**
 * Operational-work filter. `identity` = { userId, names[] } decides "My work":
 * a structured assignee id wins, otherwise the free-text assignee must match
 * one of the user's names.
 */
export function filterActionItems(items, { status = 'active', owner = 'All', site = 'All', shift = 'All', myWork = false, selectedDate, search = '' } = {}, identity = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (items || []).filter((item) => {
    const active = isActiveAction(item)
    if (status === 'active' && !active) return false
    if (status === 'overdue' && (!active || !item.due_date || item.due_date >= selectedDate)) return false
    if (status === 'resolved' && active) return false
    if (owner !== 'All' && item.assigned_to !== owner) return false
    if (site !== 'All' && item.site !== site) return false
    if (shift !== 'All' && item.shift_id !== shift) return false
    if (myWork && identity.userId) {
      if (item.assigned_user_id !== undefined && item.assigned_user_id !== null) {
        if (item.assigned_user_id !== identity.userId) return false
      } else if (!item.assigned_to || !(identity.names || []).filter(Boolean).includes(item.assigned_to)) return false
    }
    if (q && ![item.title, item.asset_no, item.assigned_to, item.site].some((v) => String(v ?? '').toLowerCase().includes(q))) return false
    return true
  })
}

/** SLA breached: a live item whose SLA instant is before `now`. */
export function isSlaBreached(item, now) {
  if (!item?.sla_due_at || !isActiveAction(item)) return false
  const due = new Date(item.sla_due_at).getTime()
  return Number.isFinite(due) && due < new Date(now).getTime()
}

/** KPI strip over the operational work list. */
export function actionKpis(items, selectedDate, now) {
  const active = (items || []).filter(isActiveAction)
  return {
    active: active.length,
    overdue: active.filter((i) => i.due_date && i.due_date < selectedDate).length,
    slaBreached: active.filter((i) => isSlaBreached(i, now)).length,
    pendingApproval: active.filter((i) => i.approval_status === 'pending').length,
    blocked: active.filter((i) => i.status === 'blocked').length,
  }
}

export function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort()
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

const SEV_CLASS = ['Critical', 'High', 'Medium', 'Low']

function htmlTable(headers, rows) {
  const head = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`
  const body = rows.map((cells) => `<tr>${cells.map((c) => {
    if (c && typeof c === 'object' && 'cls' in c) return `<td class="${c.cls}">${escapeHtml(c.text)}</td>`
    return `<td>${escapeHtml(c)}</td>`
  }).join('')}</tr>`).join('')
  return `<table>${head}${body}</table>`
}

/**
 * Printable daily briefing as a standalone HTML document. Every DB-sourced
 * value is escaped, so descriptions/asset/site cannot inject markup.
 */
export function buildBriefingHtml({ dateLabel, dateIso, summary = [], queue = [], sites = [], generatedAt }) {
  const queueRows = queue.slice(0, 20).map((i) => [
    { cls: `sev-${SEV_CLASS.includes(i.severity) ? i.severity : 'Low'}`, text: i.severity },
    i.type, i.asset || 'N/A', i.description,
  ])
  return `<!DOCTYPE html><html><head><title>Daily Ops - ${escapeHtml(dateIso)}</title>
<style>body{font-family:Arial,sans-serif;margin:0;padding:20px;background:#fff;color:#111}
h1{font-size:18px;color:#16a34a;margin-bottom:4px}p.sub{color:#666;font-size:12px;margin:0 0 16px}
table{border-collapse:collapse;width:100%;margin-bottom:20px}
th{background:#16a34a;color:#fff;padding:7px 10px;text-align:left;font-size:12px}
td{border:1px solid #e5e7eb;padding:6px 10px;font-size:12px}
tr:nth-child(even) td{background:#f9fafb}
h2{font-size:14px;color:#16a34a;margin:16px 0 6px}
.sev-Critical{color:#dc2626}.sev-High{color:#ea580c}.sev-Medium{color:#ca8a04}.sev-Low{color:#2563eb}
</style></head><body>
<h1>Tyre Pulse: Daily Operations Briefing</h1>
<p class="sub">${escapeHtml(dateLabel)}</p>
<h2>Today's Activity Summary</h2>
${htmlTable(summary.map(([k]) => k), [summary.map(([, v]) => v)])}
${queue.length > 0 ? `<h2>Priority Action Queue (${queue.length})</h2>${htmlTable(['Severity', 'Type', 'Asset', 'Description'], queueRows)}` : ''}
${sites.length > 0 ? `<h2>Site Activity</h2>${htmlTable(['Site', 'Events'], sites)}` : ''}
<p style="font-size:10px;color:#9ca3af;margin-top:20px">Generated by Tyre Pulse | ${escapeHtml(generatedAt)}</p>
</body></html>`
}
