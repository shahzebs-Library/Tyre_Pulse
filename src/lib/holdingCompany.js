/**
 * Holding Company — pure, dependency-free domain logic for the group
 * consolidation module (/holding-company). Turns the consolidated KPI payload
 * (from `rpc('holding_consolidated_kpis')`) into ranked league tables, spend
 * breakdowns, a deterministic permission matrix, and a group-level summary.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/holdingCompany.js`) and page
 * (`src/pages/HoldingCompany.jsx`) both build on these primitives so the
 * roll-up logic lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Numeric read that coerces missing/invalid to 0 (for aggregations/sorts). */
function num(v) {
  const n = toFiniteNumber(v)
  return n == null ? 0 : n
}

/**
 * Metric registry for the league table. `dir` is the ranking direction:
 *   'desc' → higher is better (rank 1 = largest value)
 *   'asc'  → lower is better  (rank 1 = smallest value)
 */
export const LEAGUE_METRICS = {
  fleet_health_score: { label: 'Fleet Health', dir: 'desc' },
  vehicles: { label: 'Vehicles', dir: 'desc' },
  open_alerts: { label: 'Open Alerts', dir: 'asc' },
  spend_30d: { label: 'Spend (30d)', dir: 'asc' },
}

/**
 * Rank subsidiaries by a chosen metric. HQ rows (`is_hq`) are excluded so the
 * headquarters never competes in the operating-company league. Higher-is-better
 * for every metric except `open_alerts` / `spend_30d`, which are lower-is-better.
 * Ties break on name (stable, deterministic). Returns a new array of shallow
 * clones, each carrying a 1-based `rank`.
 *
 * @param {Array<object>} subsidiaries
 * @param {'fleet_health_score'|'vehicles'|'open_alerts'|'spend_30d'} [metric]
 * @returns {Array<object>}
 */
export function leagueTable(subsidiaries = [], metric = 'fleet_health_score') {
  const meta = LEAGUE_METRICS[metric] || LEAGUE_METRICS.fleet_health_score
  const key = LEAGUE_METRICS[metric] ? metric : 'fleet_health_score'
  const lowerIsBetter = meta.dir === 'asc'

  const rows = (Array.isArray(subsidiaries) ? subsidiaries : [])
    .filter((s) => s && !s.is_hq)
    .map((s) => ({ ...s, _metricValue: num(s[key]) }))

  rows.sort((a, b) => {
    const diff = lowerIsBetter
      ? a._metricValue - b._metricValue
      : b._metricValue - a._metricValue
    if (diff !== 0) return diff
    return String(a.name || '').localeCompare(String(b.name || ''))
  })

  return rows.map((r, i) => {
    const { _metricValue, ...rest } = r
    return { ...rest, metricValue: _metricValue, rank: i + 1 }
  })
}

/**
 * Spend distribution across subsidiaries. Each entry is
 * `{ name, spend, pct }`, sorted by spend descending, where `pct` is the share
 * of total 30-day spend (0 when the total is zero — never divide-by-zero).
 * Includes HQ (group spend is total spend). Zero/negative spends are kept so
 * the caller can still show the full roster.
 *
 * @param {Array<object>} subsidiaries
 * @returns {Array<{name:string, spend:number, pct:number}>}
 */
export function spendBreakdown(subsidiaries = []) {
  const list = (Array.isArray(subsidiaries) ? subsidiaries : []).map((s) => ({
    name: s?.name || 'Unknown',
    spend: num(s?.spend_30d),
  }))
  const total = list.reduce((sum, s) => sum + s.spend, 0)
  return list
    .map((s) => ({
      name: s.name,
      spend: s.spend,
      pct: total > 0 ? Math.round((s.spend / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.spend - a.spend || String(a.name).localeCompare(String(b.name)))
}

const ACCESS = { FULL: 'full', WRITE: 'write', READ: 'read', NONE: 'none' }

/**
 * Deterministic access grid for a set of roles across the group's subsidiaries.
 *
 *   owner / admin → 'full' on every organisation
 *   manager       → 'write' on HQ, 'read' on every other subsidiary
 *   viewer        → 'read' on HQ, 'none' on every other subsidiary
 *
 * Pure and side-effect free — the same inputs always produce the same grid.
 *
 * @param {string[]} roles
 * @param {Array<object>} subsidiaries
 * @returns {Array<{ role:string, cells:Array<{tenant_id:*, name:string, is_hq:boolean, level:string}> }>}
 */
export function permissionMatrix(roles = ['owner', 'admin', 'manager', 'viewer'], subsidiaries = []) {
  const orgs = Array.isArray(subsidiaries) ? subsidiaries : []
  const levelFor = (role, isHq) => {
    switch (role) {
      case 'owner':
      case 'admin':
        return ACCESS.FULL
      case 'manager':
        return isHq ? ACCESS.WRITE : ACCESS.READ
      case 'viewer':
        return isHq ? ACCESS.READ : ACCESS.NONE
      default:
        return ACCESS.NONE
    }
  }
  return (Array.isArray(roles) ? roles : []).map((role) => ({
    role,
    cells: orgs.map((s) => ({
      tenant_id: s?.tenant_id,
      name: s?.name || 'Unknown',
      is_hq: !!s?.is_hq,
      level: levelFor(role, !!s?.is_hq),
    })),
  }))
}

/**
 * Group-level KPI summary derived from the consolidated dashboard payload.
 * Reads the authoritative grand-total roll-up (server computed) and averages
 * subsidiary fleet-health for the group health index.
 *
 * @param {object} dashboard  shape from rpc('holding_consolidated_kpis')
 * @returns {{ subsidiaryCount:number, totalVehicles:number, totalTyres:number,
 *             totalOpenAlerts:number, totalCritical:number,
 *             totalSpend30d:number, avgHealth:number }}
 */
export function summariseHolding(dashboard = {}) {
  const d = dashboard || {}
  const gt = d.grand_total || {}
  const subs = Array.isArray(d.subsidiaries) ? d.subsidiaries : []

  const healthValues = subs
    .map((s) => toFiniteNumber(s?.fleet_health_score))
    .filter((v) => v != null)
  const avgHealth = healthValues.length
    ? Math.round(healthValues.reduce((a, b) => a + b, 0) / healthValues.length)
    : 0

  return {
    subsidiaryCount: num(d.subsidiary_count) || subs.length,
    totalVehicles: num(gt.vehicles),
    totalTyres: num(gt.tyres),
    totalOpenAlerts: num(gt.alerts),
    totalCritical: num(gt.critical_alerts),
    totalSpend30d: num(gt.spend_30d),
    avgHealth,
  }
}
