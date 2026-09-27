/**
 * incidentReportsAnalytics - pure presentation engine for the SAFETY Incident
 * Reports register (/incidents, the `incident_reports` table). This is NOT the
 * console platform-incident workflow (`src/lib/platformIncidents.js`); the two
 * share a word and nothing else.
 *
 * Builds on `src/lib/incidents.js` (status/severity rollup + incident age) and
 * owns only what the page derives: filters, KPI strip, the 12-month trend,
 * the per-site breakdown and the export shape. `now` is always injected.
 *
 * Honesty rules: an incident with no date has no age (null), a mean over zero
 * open incidents is null (N/A), and a resolution rate over zero incidents is
 * null, never 0% or 100%.
 */
import {
  summarizeIncidents, incidentAgeDays, INCIDENT_TYPES,
} from './incidents'

export const INCIDENT_TYPE_LABEL = Object.freeze({
  near_miss: 'Near miss', damage: 'Damage', breakdown: 'Breakdown', safety: 'Safety', theft: 'Theft', other: 'Other',
})
export const INCIDENT_SEVERITY_LABEL = Object.freeze({ low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' })
export const INCIDENT_STATUS_LABEL = Object.freeze({ open: 'Open', investigating: 'Investigating', resolved: 'Resolved', closed: 'Closed' })

const OPEN = new Set(['open', 'investigating'])
const text = (v) => (v == null ? '' : String(v).trim())
const day = (v) => {
  const s = text(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

export function incidentTypeLabel(t) {
  return INCIDENT_TYPE_LABEL[t] || (t ? String(t).replace(/_/g, ' ') : 'N/A')
}

export const INCIDENT_FILTERS = Object.freeze({ status: 'all', severity: 'all', type: 'all', site: '', from: '', to: '', search: '' })

export function hasIncidentFilters(f = INCIDENT_FILTERS) {
  return ['status', 'severity', 'type'].some((k) => f[k] && f[k] !== 'all')
    || !!text(f.site) || !!text(f.from) || !!text(f.to) || !!text(f.search)
}

export function incidentSiteOptions(rows = []) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => text(r?.site)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
}

/** Attach age (days, or null), date and labels. */
export function incidentTableRows(rows = [], now) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    ...r,
    _age: incidentAgeDays(r, now),
    _date: day(r?.incident_date) || day(r?.created_at),
    _open: OPEN.has(r?.status),
    _typeLabel: incidentTypeLabel(r?.incident_type),
    _severityLabel: INCIDENT_SEVERITY_LABEL[r?.severity] || text(r?.severity) || 'N/A',
    _statusLabel: INCIDENT_STATUS_LABEL[r?.status] || text(r?.status) || 'N/A',
  }))
}

export function filterIncidents(rows = [], f = INCIDENT_FILTERS) {
  const q = text(f.search).toLowerCase()
  const from = day(f.from)
  const to = day(f.to)
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (f.status && f.status !== 'all' && r?.status !== f.status) return false
    if (f.severity && f.severity !== 'all' && r?.severity !== f.severity) return false
    if (f.type && f.type !== 'all' && r?.incident_type !== f.type) return false
    if (text(f.site) && text(r?.site) !== text(f.site)) return false
    if (from || to) {
      const d = day(r?.incident_date) || day(r?.created_at)
      if (!d) return false
      if (from && d < from) return false
      if (to && d > to) return false
    }
    if (q) {
      const hay = `${r?.incident_no || ''} ${r?.asset_no || ''} ${r?.site || ''} ${r?.reported_by || ''} ${r?.description || ''} ${r?.action_taken || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** KPI strip over a set of incidents at `now`. */
export function incidentKpis(rows = [], now) {
  const list = Array.isArray(rows) ? rows : []
  const base = summarizeIncidents(list)
  const openAges = list.filter((r) => OPEN.has(r?.status)).map((r) => incidentAgeDays(r, now)).filter((a) => a != null)
  const done = base.byStatus.resolved + base.byStatus.closed
  const decided = done + base.open
  return {
    total: base.total,
    open: base.open,
    byStatus: base.byStatus,
    bySeverity: base.bySeverity,
    highCritical: base.bySeverity.high + base.bySeverity.critical,
    resolved: done,
    resolutionRatePct: decided ? Math.round((done / decided) * 1000) / 10 : null,
    avgOpenAgeDays: openAges.length ? Math.round(openAges.reduce((s, a) => s + a, 0) / openAges.length) : null,
    oldestOpenDays: openAges.length ? Math.max(...openAges) : null,
    openUndated: list.filter((r) => OPEN.has(r?.status)).length - openAges.length,
  }
}

/**
 * Incidents per calendar month for the `months` months ending at `now`'s
 * month (UTC), zero-filled. Rows without a usable date are left out and
 * counted in `undated` so the chart states what it could not place.
 */
export function incidentMonthlyTrend(rows = [], now, months = 12) {
  const end = new Date(now)
  if (!Number.isFinite(end.getTime())) return { labels: [], keys: [], counts: [], highCritical: [], undated: 0 }
  const keys = []
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1))
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  const idx = new Map(keys.map((k, i) => [k, i]))
  const counts = keys.map(() => 0)
  const highCritical = keys.map(() => 0)
  let undated = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = day(r?.incident_date) || day(r?.created_at)
    if (!d) { undated += 1; continue }
    const i = idx.get(d.slice(0, 7))
    if (i == null) continue
    counts[i] += 1
    if (r?.severity === 'high' || r?.severity === 'critical') highCritical[i] += 1
  }
  const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const labels = keys.map((k) => `${MONTH[Number(k.slice(5)) - 1]} ${k.slice(2, 4)}`)
  return { labels, keys, counts, highCritical, undated }
}

/** Per-site count, open and high/critical. Unsited rows group as "Site not recorded". */
export function incidentsBySite(rows = []) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const site = text(r?.site) || 'Site not recorded'
    const g = map.get(site) || { site, total: 0, open: 0, highCritical: 0 }
    g.total += 1
    if (OPEN.has(r?.status)) g.open += 1
    if (r?.severity === 'high' || r?.severity === 'critical') g.highCritical += 1
    map.set(site, g)
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.site.localeCompare(b.site))
}

/** Count per incident type, in the canonical type order (zero-filled). */
export function incidentsByType(rows = []) {
  const counts = Object.fromEntries(INCIDENT_TYPES.map((t) => [t, 0]))
  for (const r of Array.isArray(rows) ? rows : []) {
    if (counts[r?.incident_type] != null) counts[r.incident_type] += 1
  }
  return INCIDENT_TYPES.map((t) => ({ type: t, label: incidentTypeLabel(t), count: counts[t] }))
}

export const INCIDENT_EXPORT_COLS = ['incident_no', 'incident_type', 'asset_no', 'site', 'incident_date', 'severity', 'status', 'age_days', 'reported_by', 'description', 'action_taken']
export const INCIDENT_EXPORT_HEADERS = ['Incident #', 'Type', 'Asset', 'Site', 'Date', 'Severity', 'Status', 'Age (days)', 'Reported by', 'Description', 'Action taken']

export function incidentExportRows(rows = [], now) {
  return incidentTableRows(rows, now).map((r) => ({
    incident_no: r.incident_no || '',
    incident_type: r._typeLabel,
    asset_no: r.asset_no || '',
    site: r.site || '',
    incident_date: r._date || '',
    severity: r._severityLabel,
    status: r._statusLabel,
    age_days: r._age == null ? 'N/A' : r._age,
    reported_by: r.reported_by || '',
    description: r.description || '',
    action_taken: r.action_taken || '',
  }))
}
