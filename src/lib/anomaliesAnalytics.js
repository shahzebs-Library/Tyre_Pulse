/**
 * Anomalies page analytics - pure engine behind /anomalies.
 *
 * The rule engine (src/lib/anomalyEngine.js) finds the anomalies; this module
 * holds the page-level logic that used to live inline in Anomalies.jsx:
 *
 *  - the supplementary Data Quality detector (records missing cost, issue
 *    date or asset number, which the rule engine skips on purpose);
 *  - filtering (type, severity, site, free-text search across the anomaly and
 *    its underlying records) and stable grouping by detector type;
 *  - the headline figures: severity counts come from summariseAnomalies, plus
 *    affected vehicles / sites and the site carrying most high-severity items;
 *  - workshop-visit roll-up and flat export rows for both views.
 *
 * Honesty: an empty or failed scan is never summarised as "clean" here; the
 * page decides that from its own load state. Rates over zero are null.
 * No I/O.
 */
import { ANOMALY_SEVERITY, ANOMALY_TYPES, ANOMALY_TYPE_LABELS, summariseAnomalies } from './anomalyEngine'

export const DATA_QUALITY = 'DATA_QUALITY'
export const DATA_QUALITY_LABEL = 'Data Quality'

export const TYPE_ORDER = [
  ANOMALY_TYPES.RAPID_RECURRENCE,
  ANOMALY_TYPES.FREQUENT_VISITS,
  ANOMALY_TYPES.SERIAL_REUSE,
  ANOMALY_TYPES.DUPLICATE_ENTRY,
  ANOMALY_TYPES.SHORT_INTERVAL,
  ANOMALY_TYPES.SAME_DAY_BURST,
  ANOMALY_TYPES.COST_SPIKE,
  DATA_QUALITY,
]

export const TYPE_LABELS = { ...ANOMALY_TYPE_LABELS, [DATA_QUALITY]: DATA_QUALITY_LABEL }
export const SEVERITIES = [ANOMALY_SEVERITY.HIGH, ANOMALY_SEVERITY.MEDIUM, ANOMALY_SEVERITY.LOW]

/**
 * Supplementary Data-Quality detection. Each qualifying row is wrapped as a
 * single-record "anomaly" so it renders identically to engine output.
 */
export function detectDataQuality(rows = []) {
  const out = []
  for (const r of rows) {
    const cost = Number(r.cost_per_tyre)
    const hasCost = r.cost_per_tyre != null && r.cost_per_tyre !== '' && Number.isFinite(cost)
    const missing = []
    if (!hasCost) missing.push('cost')
    if (!r.issue_date) missing.push('issue date')
    if (!r.asset_no) missing.push('asset no')
    if (missing.length === 0) continue
    out.push({
      id: `DQ::${r.id}`,
      type: DATA_QUALITY,
      severity: ANOMALY_SEVERITY.LOW,
      asset_no: r.asset_no || 'N/A',
      site: r.site || 'N/A',
      record_ids: [r.id],
      records: [r],
      message: `Missing ${missing.join(', ')}, record cannot be used for CPK / lifecycle analytics`,
      detail: [r.brand || 'Unknown brand', r.serial_no ? `serial ${r.serial_no}` : null, r.issue_date || null]
        .filter(Boolean).join(' | '),
    })
  }
  return out
}

const lc = (v) => String(v ?? '').toLowerCase()

export function matchesSearch(a, search) {
  const q = lc(search).trim()
  if (!q) return true
  return (
    lc(a.asset_no).includes(q) || lc(a.site).includes(q) || lc(a.message).includes(q) ||
    (a.records || []).some((r) => lc(r.serial_no).includes(q) || lc(r.asset_no).includes(q))
  )
}

export function filterAnomalies(list = [], { type = 'ALL', severity = 'all', site = 'all', search = '' } = {}) {
  return list.filter((a) =>
    (type === 'ALL' || a.type === type) &&
    (severity === 'all' || a.severity === severity) &&
    (site === 'all' || (a.site || 'N/A') === site) &&
    matchesSearch(a, search))
}

export function groupAnomalies(list = [], descs = {}) {
  const map = new Map()
  for (const a of list) {
    if (!map.has(a.type)) map.set(a.type, [])
    map.get(a.type).push(a)
  }
  return TYPE_ORDER.filter((t) => map.has(t)).map((t) => ({
    type: t, label: TYPE_LABELS[t] || t, desc: descs[t] || '', items: map.get(t),
  }))
}

export function siteOptions(list = []) {
  return [...new Set(list.map((a) => a.site || 'N/A'))].sort()
}

/** Headline figures for the KPI strip. */
export function anomalyKpis(list = []) {
  const s = summariseAnomalies(list)
  const assets = new Set()
  const sites = new Map()
  for (const a of list) {
    if (a.asset_no && a.asset_no !== 'N/A') assets.add(a.asset_no)
    const site = a.site || 'N/A'
    const cur = sites.get(site) || { site, total: 0, high: 0 }
    cur.total += 1
    if (a.severity === ANOMALY_SEVERITY.HIGH) cur.high += 1
    sites.set(site, cur)
  }
  const siteList = [...sites.values()].sort((a, b) => b.high - a.high || b.total - a.total)
  const hotSite = siteList.find((x) => x.high > 0) || null
  const dq = s.byType[DATA_QUALITY] || 0
  return {
    ...s,
    affectedAssets: assets.size,
    affectedSites: siteList.filter((x) => x.site !== 'N/A').length,
    hotSite: hotSite ? hotSite.site : null,
    hotSiteHigh: hotSite ? hotSite.high : 0,
    highShare: s.total > 0 ? Math.round((s.bySeverity.high / s.total) * 100) : null,
    ruleFindings: s.total - dq,
    dataQuality: dq,
  }
}

export function visitSummary(stats = []) {
  const totalVisits = stats.reduce((s, v) => s + (v.total || 0), 0)
  return {
    totalVisits,
    thisWeek: stats.reduce((s, v) => s + (v.last7 || 0), 0),
    thisMonth: stats.reduce((s, v) => s + (v.last30 || 0), 0),
    assets: stats.length,
    busiest: stats.slice().sort((a, b) => (b.total || 0) - (a.total || 0))[0] || null,
    repeatAssets: stats.filter((v) => (v.peak90 || 0) >= 3).length,
    avgPerAsset: stats.length ? Math.round((totalVisits / stats.length) * 10) / 10 : null,
  }
}

export function filterVisits(stats = [], { search = '', site = 'all' } = {}) {
  const q = lc(search).trim()
  return stats.filter((v) =>
    (site === 'all' || (v.site || 'N/A') === site) &&
    (!q || lc(v.asset_no).includes(q) || lc(v.site).includes(q)))
}

export const ANOMALY_EXPORT_COLUMNS = [
  { key: 'type', header: 'Type' },
  { key: 'severity', header: 'Severity' },
  { key: 'asset_no', header: 'Asset' },
  { key: 'site', header: 'Site' },
  { key: 'records', header: 'Records' },
  { key: 'message', header: 'Finding' },
  { key: 'detail', header: 'Detail' },
]

export function anomalyExportRows(list = []) {
  return list.map((a) => ({
    type: TYPE_LABELS[a.type] || a.type,
    severity: a.severity,
    asset_no: a.asset_no || 'N/A',
    site: a.site || 'N/A',
    records: (a.records || []).length,
    message: a.message || '',
    detail: a.detail || '',
  }))
}

export const VISIT_EXPORT_COLUMNS = [
  { key: 'asset_no', header: 'Vehicle' },
  { key: 'site', header: 'Site' },
  { key: 'total', header: 'Total visits' },
  { key: 'last7', header: 'Last 7 days' },
  { key: 'last30', header: 'Last 30 days' },
  { key: 'last90', header: 'Last 90 days' },
  { key: 'peak90', header: 'Peak per 90 days' },
  { key: 'visits_per_month', header: 'Rate per month' },
  { key: 'last_visit', header: 'Last visit' },
  { key: 'country', header: 'Country' },
]

export function visitExportRows(stats = []) {
  return stats.map((v) => ({
    asset_no: v.asset_no ?? 'N/A',
    site: v.site ?? 'N/A',
    total: v.total ?? 0,
    last7: v.last7 ?? 0,
    last30: v.last30 ?? 0,
    last90: v.last90 ?? 0,
    peak90: v.peak90 ?? 0,
    visits_per_month: v.visits_per_month ?? 'N/A',
    last_visit: v.last_visit ?? 'N/A',
    country: v.country || 'Not recorded',
  }))
}
