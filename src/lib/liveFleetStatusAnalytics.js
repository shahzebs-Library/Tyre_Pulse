/**
 * liveFleetStatusAnalytics - pure, no-I/O engine behind /live-fleet-status.
 *
 * Joins the fleet master to its fitted tyres, inspections and active alerts,
 * scores each vehicle's tyre health, and derives the KPI strip, filters, the
 * "needs attention" list, this week's inspections and the export rows.
 *
 * Honesty rules:
 *   - a vehicle with no fitted-tyre data has NO health score (null, "No data"),
 *     never 0 / Critical - absence of data is not a failed tyre,
 *   - "days since" is null when there is no date,
 *   - every time-dependent function takes an explicit `now`.
 */

export const RISK_LEVELS = ['Critical', 'High', 'Medium', 'Low']
export const STATUS_FILTERS = ['All', 'Operational', 'At Risk', 'Critical', 'Overdue', 'No data']
export const INSPECTION_STALE_DAYS = 30
const DAY_MS = 86400000
const PENALTY = { Critical: 25, High: 15, Medium: 5 }

/** Tyre health 0..100 from risk levels; null when there are no tyres. */
export function healthScore(tyres = []) {
  if (!Array.isArray(tyres) || tyres.length === 0) return null
  const penalty = tyres.reduce((s, t) => s + (PENALTY[t?.risk_level] || 0), 0)
  return Math.max(0, Math.min(100, 100 - penalty))
}

/** Band key for a score: operational | monitor | atRisk | critical | noData. */
export function scoreBand(score) {
  if (score == null || !Number.isFinite(Number(score))) return 'noData'
  if (score >= 80) return 'operational'
  if (score >= 60) return 'monitor'
  if (score >= 40) return 'atRisk'
  return 'critical'
}

export const BAND_LABEL_EN = {
  operational: 'Operational', monitor: 'Monitor', atRisk: 'At Risk', critical: 'Critical', noData: 'No data',
}

/** Whole days from `date` to `now`; null when there is no valid date. */
export function daysSince(date, now = new Date()) {
  if (!date) return null
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor((now.getTime() - d.getTime()) / DAY_MS)
}

function groupBy(rows, key) {
  const out = {}
  for (const r of rows || []) {
    const k = r?.[key]
    if (!k) continue
    ;(out[k] = out[k] || []).push(r)
  }
  return out
}

/**
 * One enriched row per fleet_master vehicle.
 * @param {{fleet:Array, tyres:Array, inspections:Array, alerts:Array}} src
 */
export function enrichVehicles({ fleet = [], tyres = [], inspections = [], alerts = [] } = {}, { now = new Date() } = {}) {
  const tyresBy = groupBy(tyres, 'asset_no')
  const alertsBy = groupBy(alerts, 'asset_no')
  const lastInsp = {}
  const overdue = {}
  for (const i of inspections || []) {
    if (!i?.asset_no) continue
    const cur = lastInsp[i.asset_no]
    if (!cur || String(i.scheduled_date || '') > String(cur.scheduled_date || '')) lastInsp[i.asset_no] = i
    if (i.status === 'Overdue') overdue[i.asset_no] = true
  }
  return (fleet || []).map((v) => {
    const vt = tyresBy[v.asset_no] || []
    const score = healthScore(vt)
    const lastDate = lastInsp[v.asset_no]?.scheduled_date ?? null
    const days = daysSince(lastDate, now)
    const va = alertsBy[v.asset_no] || []
    return {
      ...v,
      tyres: vt,
      score,
      band: scoreBand(score),
      criticalCount: vt.filter((t) => t.risk_level === 'Critical').length,
      highCount: vt.filter((t) => t.risk_level === 'High').length,
      mediumCount: vt.filter((t) => t.risk_level === 'Medium').length,
      lastInspectionDate: lastDate,
      daysSinceInspection: days,
      inspectionStale: days != null && days > INSPECTION_STALE_DAYS,
      isOverdue: !!overdue[v.asset_no],
      alertCount: va.length,
      vehicleAlerts: va,
    }
  })
}

/** KPI strip. `operational` counts only vehicles with tyre data and no High/Critical tyre. */
export function fleetKpis(vehicles = [], alerts = []) {
  const withData = vehicles.filter((v) => v.score != null)
  const atRisk = vehicles.filter((v) => v.highCount > 0 || v.criticalCount > 0).length
  const operational = withData.filter((v) => v.highCount === 0 && v.criticalCount === 0).length
  const scores = withData.map((v) => v.score)
  return {
    total: vehicles.length,
    operational,
    atRisk,
    critical: vehicles.filter((v) => v.criticalCount > 0).length,
    overdue: vehicles.filter((v) => v.isOverdue).length,
    noData: vehicles.length - withData.length,
    activeAlerts: (alerts || []).filter((a) => a?.is_active !== false).length,
    avgScore: scores.length ? scores.reduce((s, n) => s + n, 0) / scores.length : null,
    operationalPct: withData.length ? (operational / withData.length) * 100 : null,
  }
}

/** Distinct sites, sorted. */
export function siteOptions(vehicles = []) {
  return [...new Set(vehicles.map((v) => v.site).filter(Boolean))].sort()
}

/** Ascending by score, no-data vehicles last. */
export function byScoreAsc(a, b) {
  if (a.score == null && b.score == null) return String(a.asset_no).localeCompare(String(b.asset_no))
  if (a.score == null) return 1
  if (b.score == null) return -1
  return a.score - b.score
}

/** Site / status / free-text filter, worst health first. */
export function filterVehicles(vehicles = [], { site = 'All', status = 'All', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return vehicles.filter((v) => {
    if (site !== 'All' && v.site !== site) return false
    if (status === 'Operational' && (v.score == null || v.criticalCount > 0 || v.highCount > 0)) return false
    if (status === 'At Risk' && v.highCount === 0 && v.criticalCount === 0) return false
    if (status === 'Critical' && v.criticalCount === 0) return false
    if (status === 'Overdue' && !v.isOverdue) return false
    if (status === 'No data' && v.score != null) return false
    if (q) {
      const hay = [v.asset_no, v.fleet_number, v.site, v.operator_name, v.vehicle_type].map((x) => String(x || '').toLowerCase())
      if (!hay.some((h) => h.includes(q))) return false
    }
    return true
  }).sort(byScoreAsc)
}

/** Worst `n` measured vehicles below full health. */
export function topAttention(vehicles = [], n = 5) {
  return vehicles.filter((v) => v.score != null && v.score < 100).sort(byScoreAsc).slice(0, n)
}

/** Sunday..Saturday ISO bounds of the week containing `now`. */
export function weekBounds(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay())
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { start: iso(start), end: iso(end) }
}

/** Inspections scheduled this week, soonest first. */
export function upcomingInspections(inspections = [], { now = new Date(), limit = 8 } = {}) {
  const { start, end } = weekBounds(now)
  return (inspections || [])
    .filter((i) => {
      const d = String(i?.scheduled_date || '').slice(0, 10)
      return d && d >= start && d <= end
    })
    .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)))
    .slice(0, limit)
}

/** Count of fitted tyres per risk level (+ unrated). */
export function riskBreakdown(tyres = []) {
  const out = { Critical: 0, High: 0, Medium: 0, Low: 0, none: 0 }
  for (const t of tyres || []) {
    if (RISK_LEVELS.includes(t?.risk_level)) out[t.risk_level] += 1
    else out.none += 1
  }
  return out
}

export const EXPORT_COLS = [
  'asset_no', 'fleet_number', 'vehicle_type', 'site', 'operator_name', 'score', 'status',
  'critical', 'high', 'medium', 'tyres', 'alerts', 'last_inspection', 'days_since_inspection', 'overdue',
]
export const EXPORT_HEADERS = [
  'Asset No', 'Fleet No', 'Vehicle Type', 'Site', 'Operator', 'Health Score', 'Status',
  'Critical Tyres', 'High Tyres', 'Medium Tyres', 'Total Tyres', 'Active Alerts', 'Last Inspection',
  'Days Since Inspection', 'Inspection Overdue',
]

/** Export rows; unmeasured values read N/A. */
export function exportRows(vehicles = []) {
  return vehicles.map((v) => ({
    asset_no: v.asset_no,
    fleet_number: v.fleet_number || 'N/A',
    vehicle_type: v.vehicle_type || 'N/A',
    site: v.site || 'N/A',
    operator_name: v.operator_name || 'N/A',
    score: v.score == null ? 'N/A' : v.score,
    status: BAND_LABEL_EN[v.band] || 'No data',
    critical: v.criticalCount,
    high: v.highCount,
    medium: v.mediumCount,
    tyres: v.tyres.length,
    alerts: v.alertCount,
    last_inspection: v.lastInspectionDate ? String(v.lastInspectionDate).slice(0, 10) : 'None',
    days_since_inspection: v.daysSinceInspection == null ? 'N/A' : v.daysSinceInspection,
    overdue: v.isOverdue ? 'Yes' : 'No',
  }))
}
