/**
 * Help Center analytics - pure engine behind the /help ticket views
 * (My tickets + Triage).
 *
 * Works over support_tickets rows (V127): status, category, severity,
 * admin_response, responded_at, resolved_at, created_at.
 *
 * Honesty rules:
 *  - Response time is measured only where BOTH created_at and responded_at
 *    exist; resolution time only where resolved_at exists. With nothing
 *    measurable the figure is null (N/A), never 0 hours.
 *  - A rate over zero tickets is null.
 * No I/O; `now` injectable.
 */
import { summarizeTickets } from './api/support'

const HOUR_MS = 3600000
const DAY_MS = 86400000

export const STATUS_LABELS = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' }
export const CATEGORY_LABELS = {
  bug: 'Bug / Error', question: 'Question', feature: 'Feature request',
  data: 'Data / Import', account: 'Account / Access', other: 'Other',
}
const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 }

function t(v) {
  if (!v) return null
  const n = new Date(v).getTime()
  return Number.isFinite(n) ? n : null
}

export function isUnresolved(row) {
  return row?.status === 'open' || row?.status === 'in_progress'
}

/** Hours from raise to first response, or null when unmeasurable. */
export function responseHours(row) {
  const a = t(row?.created_at)
  const b = t(row?.responded_at)
  if (a == null || b == null || b < a) return null
  return (b - a) / HOUR_MS
}

/** Hours from raise to resolution, or null. */
export function resolutionHours(row) {
  const a = t(row?.created_at)
  const b = t(row?.resolved_at)
  if (a == null || b == null || b < a) return null
  return (b - a) / HOUR_MS
}

/** Whole days an unresolved ticket has been waiting, null once resolved. */
export function ageDays(row, now = Date.now()) {
  if (!isUnresolved(row)) return null
  const a = t(row?.created_at)
  if (a == null) return null
  return Math.max(0, Math.floor((now - a) / DAY_MS))
}

function median(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

export function formatHours(h) {
  if (h == null) return 'N/A'
  if (h < 1) return `${Math.round(h * 60)} min`
  if (h < 48) return `${h.toFixed(1)} h`
  return `${(h / 24).toFixed(1)} days`
}

/** KPI strip + breakdowns. Builds on support.summarizeTickets for the status counts. */
export function ticketKpis(rows = [], { now = Date.now(), staleDays = 7 } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const s = summarizeTickets(list)
  const unresolved = list.filter(isUnresolved)
  const ages = unresolved.map((r) => ageDays(r, now)).filter((x) => x != null)
  const byCategory = {}
  for (const r of list) {
    const k = r.category || 'other'
    byCategory[k] = (byCategory[k] || 0) + 1
  }
  const responded = list.filter((r) => r.admin_response && String(r.admin_response).trim())
  return {
    ...s,
    resolvedRate: s.total ? Math.round(((s.resolved + s.closed) / s.total) * 100) : null,
    responseRate: s.total ? Math.round((responded.length / s.total) * 100) : null,
    medianResponseHours: median(list.map(responseHours)),
    medianResolutionHours: median(list.map(resolutionHours)),
    criticalOpen: unresolved.filter((r) => r.severity === 'critical' || r.severity === 'high').length,
    awaitingResponse: unresolved.filter((r) => !r.admin_response || !String(r.admin_response).trim()).length,
    oldestOpenDays: ages.length ? Math.max(...ages) : null,
    staleOpen: ages.filter((d) => d >= staleDays).length,
    byCategory: Object.entries(byCategory).map(([key, count]) => ({ key, label: CATEGORY_LABELS[key] || key, count }))
      .sort((a, b) => b.count - a.count),
  }
}

export function filterTickets(rows = [], {
  status = 'all', category = 'all', severity = 'all', search = '', awaiting = false,
} = {}) {
  const q = String(search || '').trim().toLowerCase()
  return rows.filter((r) => {
    if (status !== 'all' && r.status !== status) return false
    if (category !== 'all' && (r.category || 'other') !== category) return false
    if (severity !== 'all' && r.severity !== severity) return false
    if (awaiting && !(isUnresolved(r) && !String(r.admin_response || '').trim())) return false
    if (q && ![r.subject, r.message, r.created_by_name, r.admin_response].some((v) => String(v || '').toLowerCase().includes(q))) return false
    return true
  })
}

/** Worst first: unresolved, then severity, then oldest. */
export function sortTickets(rows = []) {
  return rows.slice().sort((a, b) => {
    const u = Number(isUnresolved(b)) - Number(isUnresolved(a))
    if (u) return u
    const s = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0)
    if (s) return s
    return (t(b.created_at) || 0) - (t(a.created_at) || 0)
  })
}

export const TICKET_EXPORT_COLUMNS = [
  { key: 'created', header: 'Raised' },
  { key: 'subject', header: 'Subject' },
  { key: 'category', header: 'Category' },
  { key: 'severity', header: 'Severity' },
  { key: 'status', header: 'Status' },
  { key: 'reporter', header: 'Reporter' },
  { key: 'responded', header: 'Responded' },
  { key: 'responseTime', header: 'Time to response' },
  { key: 'age', header: 'Open for (days)' },
]

export function ticketExportRows(rows = [], now = Date.now()) {
  return rows.map((r) => {
    const age = ageDays(r, now)
    return {
      created: r.created_at ? String(r.created_at).slice(0, 10) : 'N/A',
      subject: r.subject || 'N/A',
      category: CATEGORY_LABELS[r.category] || r.category || 'Other',
      severity: r.severity || 'N/A',
      status: STATUS_LABELS[r.status] || r.status || 'N/A',
      reporter: r.created_by_name || 'N/A',
      responded: r.responded_at ? String(r.responded_at).slice(0, 10) : 'N/A',
      responseTime: formatHours(responseHours(r)),
      age: age == null ? 'N/A' : age,
    }
  })
}
