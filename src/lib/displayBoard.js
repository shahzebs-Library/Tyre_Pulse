/**
 * displayBoard — pure data-shaping helpers for the Executive TV Display
 * Dashboard (/display). Every function is side-effect free and unit-tested in
 * src/test/displayBoard.test.js. Column names mirror the reads used by
 * Dashboard.jsx / LiveFleetStatus.jsx / FleetHealthBoard.jsx:
 *   fleet_master:  asset_no, site, status, vehicle_type
 *   tyre_records:  asset_no, risk_level, site, cost_per_tyre, qty, issue_date
 *   inspections:   asset_no, scheduled_date, status, findings, site
 *   alerts:        severity, is_active
 *   import_batches: approval_status
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/**
 * Fleet availability from fleet_master rows.
 * A vehicle counts as available when status === 'Active' (FleetMaster.jsx
 * convention). Rows with no status are treated as available so a fleet that
 * never populated the column still reads 100%, not 0%.
 * @returns {{ total:number, available:number, pct:number }}
 */
export function computeFleetAvailability(vehicles = []) {
  const total = vehicles.length
  if (!total) return { total: 0, available: 0, pct: 0 }
  const available = vehicles.filter(v => !v.status || v.status === 'Active').length
  return { total, available, pct: Math.round((available / total) * 100) }
}

/**
 * Vehicle counts grouped by site, descending, capped at `limit` buckets.
 * Null/empty sites bucket under 'Unassigned'.
 * @returns {Array<{ site:string, count:number }>}
 */
export function groupVehiclesBySite(vehicles = [], limit = 6) {
  const bySite = {}
  vehicles.forEach(v => {
    const site = (v.site && String(v.site).trim()) || 'Unassigned'
    bySite[site] = (bySite[site] || 0) + 1
  })
  return Object.entries(bySite)
    .map(([site, count]) => ({ site, count }))
    .sort((a, b) => b.count - a.count || a.site.localeCompare(b.site))
    .slice(0, limit)
}

/**
 * Tyres needing attention from active tyre_records rows (removal_date null).
 * @returns {{ total:number, critical:number, high:number, attention:number }}
 */
export function computeTyreAttention(tyres = []) {
  const critical = tyres.filter(t => t.risk_level === 'Critical').length
  const high     = tyres.filter(t => t.risk_level === 'High').length
  return { total: tyres.length, critical, high, attention: critical + high }
}

/**
 * Sum of cost_per_tyre × qty for rows whose issue_date falls inside the
 * calendar month of `now` (qty defaults to 1 — same rule as
 * analyticsEngine.recordCost / supplierScorecard).
 * @returns {{ cost:number, tyreCount:number }}
 */
export function computeMonthlyTyreCost(tyres = [], now = new Date()) {
  const y = now.getFullYear()
  const m = now.getMonth()
  let cost = 0
  let tyreCount = 0
  tyres.forEach(t => {
    if (!t.issue_date) return
    const d = new Date(t.issue_date)
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== y || d.getMonth() !== m) return
    const qty = t.qty == null ? 1 : num(t.qty) || 1
    cost += num(t.cost_per_tyre) * qty
    tyreCount += qty
  })
  return { cost: Math.round(cost), tyreCount }
}

/**
 * Pressure-compliance approximation — the same proxy kpiEngine.js uses:
 * of non-cancelled inspections, the share that are Done WITH findings text.
 * @returns {{ pct:number, compliant:number, total:number }}
 */
export function computePressureCompliancePct(inspections = []) {
  const rows = inspections.filter(i => i.status !== 'Cancelled')
  if (!rows.length) return { pct: 0, compliant: 0, total: 0 }
  const compliant = rows.filter(
    i => i.status === 'Done' && i.findings && String(i.findings).trim() !== ''
  ).length
  return { pct: Math.round((compliant / rows.length) * 100), compliant, total: rows.length }
}

/**
 * Today's inspections split by state.
 * @param {Object[]} inspections rows with scheduled_date (YYYY-MM-DD) + status
 * @param {string}   todayStr    ISO date, e.g. '2026-07-07'
 * @returns {{ total:number, done:number, pending:number, overdue:number }}
 */
export function countTodaysInspections(inspections = [], todayStr) {
  const today = inspections.filter(
    i => i.scheduled_date && String(i.scheduled_date).slice(0, 10) === todayStr
  )
  const done    = today.filter(i => i.status === 'Done').length
  const overdue = today.filter(i => i.status === 'Overdue').length
  return { total: today.length, done, overdue, pending: today.length - done - overdue }
}

/**
 * Active alerts bucketed by severity (Critical/High/Medium/Low; anything else
 * — including null — buckets as 'Info').
 * @returns {{ total:number, bySeverity:Object<string,number> }}
 */
export function summariseAlerts(alerts = []) {
  const KNOWN = ['Critical', 'High', 'Medium', 'Low']
  const bySeverity = { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0 }
  alerts.forEach(a => {
    const key = KNOWN.includes(a.severity) ? a.severity : 'Info'
    bySeverity[key] += 1
  })
  return { total: alerts.length, bySeverity }
}

/** Cyclic next index for board rotation. Safe for length 0 (returns 0). */
export function nextBoardIndex(current, length) {
  if (!Number.isFinite(length) || length <= 0) return 0
  return ((Number(current) || 0) + 1) % length
}

/** mm:ss countdown label from a seconds value (clamped at 0). */
export function formatCountdown(seconds) {
  const s = Math.max(0, Math.floor(num(seconds)))
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

/** Compact money label for TV distance-reading: 12.4K / 1.2M / 940. */
export function formatCompactMoney(value) {
  const v = num(value)
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return String(Math.round(v))
}
