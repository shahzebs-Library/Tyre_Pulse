/**
 * opsIntelligenceAnalytics.js - page-level shaping for the Operations
 * Intelligence Center (src/pages/OpsIntelligence.jsx), layered on the domain
 * engine in opsIntelligence.js (buildExceptions, summarizeExceptions, pulse,
 * anomalies, financials). No I/O, no React, no colours.
 *
 * Owns: the preventive-maintenance attention items folded into the anomaly
 * feed, the exception register filter, the site and asset hotspot roll-ups and
 * the export rows. Nothing here invents a signal: PM items only appear when a
 * plan is genuinely overdue or due soon, and a hotspot needs at least one real
 * exception.
 */
import { SEVERITY_META, CATEGORY_META } from './opsIntelligence'

/** PM attention items shaped like anomaly feed rows. Empty when nothing is due. */
export function pmAttentionItems(pmCompliance) {
  if (!pmCompliance) return []
  const items = []
  const overdue = Number(pmCompliance.overdue) || 0
  const dueSoon = Number(pmCompliance.dueSoon) || 0
  if (overdue > 0) {
    items.push({
      type: 'pm_overdue',
      severity: 'critical',
      title: `${overdue} preventive maintenance ${overdue === 1 ? 'plan' : 'plans'} overdue`,
      detail: 'Overdue preventive maintenance raises breakdown and safety risk. Review and schedule service now.',
      action: 'Open PM Programs',
      link: '/pm-programs',
    })
  }
  if (dueSoon > 0) {
    items.push({
      type: 'pm_due_soon',
      severity: 'warning',
      title: `${dueSoon} preventive maintenance ${dueSoon === 1 ? 'plan' : 'plans'} due soon`,
      detail: 'These plans reach their service window shortly. Plan workshop capacity ahead of time.',
      action: 'Open PM Programs',
      link: '/pm-programs',
    })
  }
  return items
}

/** Exception register filter: severity, category, site, free text. */
export function filterExceptions(exceptions, { severity = 'all', category = 'all', site = '', q = '' } = {}) {
  const needle = String(q || '').trim().toLowerCase()
  return (Array.isArray(exceptions) ? exceptions : []).filter((e) => {
    if (severity !== 'all' && e.severity !== severity) return false
    if (category !== 'all' && e.category !== category) return false
    if (site && e.site !== site) return false
    if (!needle) return true
    return `${e.title || ''} ${e.asset_no || ''} ${e.serial || ''} ${e.site || ''} ${e.detail || ''}`.toLowerCase().includes(needle)
  })
}

/** Distinct sites carrying an exception, sorted. */
export function exceptionSites(exceptions) {
  return [...new Set((exceptions || []).map((e) => e.site).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

const SEV_RANK = { high: 0, medium: 1, low: 2 }

/**
 * Hotspots: exceptions grouped by a key (site or asset_no), with a severity
 * split, ordered by high-severity count then total. Rows without the key are
 * dropped rather than bucketed as a fake "Unknown" hotspot.
 */
export function exceptionHotspots(exceptions, key = 'site', limit = 10) {
  const map = new Map()
  for (const e of exceptions || []) {
    const k = e?.[key]
    if (!k) continue
    const cur = map.get(k) || { key: k, total: 0, high: 0, medium: 0, low: 0, worst: 'low' }
    cur.total += 1
    if (e.severity in cur) cur[e.severity] += 1
    if ((SEV_RANK[e.severity] ?? 9) < (SEV_RANK[cur.worst] ?? 9)) cur.worst = e.severity
    map.set(k, cur)
  }
  return [...map.values()]
    .sort((a, b) => b.high - a.high || b.total - a.total || String(a.key).localeCompare(String(b.key)))
    .slice(0, limit)
}

/** Share of exceptions that are high severity, null when there are none. */
export function highSeveritySharePct(summary) {
  const total = Number(summary?.total) || 0
  if (!total) return null
  return Math.round(((Number(summary?.bySeverity?.high) || 0) / total) * 1000) / 10
}

/** Flat rows for Excel/PDF over the whole filtered set. */
export function exceptionExportRows(exceptions) {
  return (exceptions || []).map((e) => ({
    severity: SEVERITY_META[e.severity]?.label || e.severity || '',
    category: CATEGORY_META[e.category]?.label || e.category || '',
    title: e.title || '',
    asset_no: e.asset_no || '',
    serial: e.serial || '',
    site: e.site || '',
    detail: e.detail || '',
  }))
}
