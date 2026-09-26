/**
 * System Health analytics - pure helpers (no I/O, deterministic).
 *
 * Consumes the result shape produced by src/lib/systemHealth.js
 * (`{ id, group, label, status, latencyMs, detail }`) and turns one or more
 * runs into operator KPIs: availability, latency percentiles, per-group
 * breakdowns, a session run history and flapping detection.
 *
 * HONESTY: there is no server-side health history table. Run history is kept
 * only for as long as the page is open, and every figure derived from it says
 * so. A figure that cannot be measured (no checks, no latency) is null, never 0.
 *
 * Every time-dependent function takes an injectable `now` so it is testable.
 */

export const HEALTH_STATUSES = ['ok', 'degraded', 'down', 'unknown']

export const HEALTH_STATUS_LABEL = {
  ok: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  unknown: 'Unknown',
}

export const HEALTH_GROUP_LABEL = {
  database: 'Database',
  tables: 'Tables',
  storage: 'Storage',
  edge: 'Edge Functions',
  auth: 'Auth',
  general: 'Other',
}

/** Severity order used for sorting: worst first. */
const STATUS_RANK = { down: 0, degraded: 1, unknown: 2, ok: 3 }

/** Maximum number of runs kept in the in-session history. */
export const DEFAULT_HISTORY_LIMIT = 60

function finiteLatency(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
}

function normStatus(s) {
  return HEALTH_STATUSES.includes(s) ? s : 'unknown'
}

function toMs(v) {
  if (v == null) return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/** Percentile (nearest-rank) of a numeric list, or null when empty. */
export function percentile(values, p) {
  const list = (Array.isArray(values) ? values : []).filter((v) => finiteLatency(v) != null).sort((a, b) => a - b)
  if (!list.length) return null
  const rank = Math.min(list.length, Math.max(1, Math.ceil((p / 100) * list.length)))
  return list[rank - 1]
}

/** Flatten checks into table/export rows with display labels. */
export function buildHealthRows(checks) {
  return (Array.isArray(checks) ? checks : []).map((c) => {
    const status = normStatus(c?.status)
    const group = c?.group || 'general'
    return {
      id: String(c?.id ?? ''),
      label: String(c?.label ?? c?.id ?? 'Unknown'),
      group,
      groupLabel: HEALTH_GROUP_LABEL[group] ?? 'Other',
      status,
      statusLabel: HEALTH_STATUS_LABEL[status],
      latencyMs: finiteLatency(c?.latencyMs),
      detail: c?.detail ? String(c.detail) : '',
    }
  })
}

/** Headline KPIs for a single run. */
export function healthKpis(checks) {
  const rows = buildHealthRows(checks)
  const counts = { ok: 0, degraded: 0, down: 0, unknown: 0 }
  for (const r of rows) counts[r.status] += 1
  const latencies = rows.map((r) => r.latencyMs).filter((v) => v != null)
  const avg = latencies.length ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : null
  let slowest = null
  for (const r of rows) {
    if (r.latencyMs == null) continue
    if (!slowest || r.latencyMs > slowest.latencyMs) slowest = r
  }
  return {
    total: rows.length,
    ...counts,
    availabilityPct: rows.length ? Math.round((counts.ok / rows.length) * 1000) / 10 : null,
    avgLatencyMs: avg,
    p95LatencyMs: percentile(latencies, 95),
    measuredLatencyCount: latencies.length,
    slowest: slowest ? { id: slowest.id, label: slowest.label, latencyMs: slowest.latencyMs } : null,
  }
}

/** Per-group counts + worst status, in the canonical group order. */
export function groupBreakdown(checks) {
  const rows = buildHealthRows(checks)
  const order = Object.keys(HEALTH_GROUP_LABEL)
  const map = new Map()
  for (const r of rows) {
    if (!map.has(r.group)) map.set(r.group, { group: r.group, label: r.groupLabel, total: 0, ok: 0, degraded: 0, down: 0, unknown: 0 })
    const g = map.get(r.group)
    g.total += 1
    g[r.status] += 1
  }
  return [...map.values()]
    .map((g) => ({
      ...g,
      worst: g.down ? 'down' : (g.degraded || g.unknown) ? 'degraded' : 'ok',
      healthyPct: g.total ? Math.round((g.ok / g.total) * 1000) / 10 : null,
    }))
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
}

/** Filter + sort rows (worst first, then slowest). */
export function filterHealthRows(rows, { status = 'all', group = 'all', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => status === 'all' || r.status === status)
    .filter((r) => group === 'all' || r.group === group)
    .filter((r) => !q || `${r.label} ${r.id} ${r.groupLabel} ${r.detail}`.toLowerCase().includes(q))
    .sort((a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status])
      || ((b.latencyMs ?? -1) - (a.latencyMs ?? -1))
      || a.label.localeCompare(b.label))
}

/** Append a run report to the in-session history (bounded, newest last). */
export function appendRun(history, report, limit = DEFAULT_HISTORY_LIMIT) {
  const list = Array.isArray(history) ? history.slice() : []
  if (!report || !Array.isArray(report.checks)) return list
  const k = healthKpis(report.checks)
  list.push({
    checkedAt: report.checkedAt ?? null,
    overall: normStatus(report.summary?.overall ?? (k.down ? 'down' : (k.degraded || k.unknown) ? 'degraded' : k.total ? 'ok' : 'unknown')),
    ok: k.ok,
    degraded: k.degraded,
    down: k.down,
    unknown: k.unknown,
    total: k.total,
    avgLatencyMs: k.avgLatencyMs,
    statuses: Object.fromEntries(buildHealthRows(report.checks).map((r) => [r.id, r.status])),
  })
  return list.length > limit ? list.slice(list.length - limit) : list
}

/** Session history stats: run count, share of fully-healthy runs, last incident. */
export function historyStats(history) {
  const list = Array.isArray(history) ? history : []
  const healthy = list.filter((h) => h.overall === 'ok').length
  const incidents = list.filter((h) => h.overall === 'down' || h.overall === 'degraded')
  const last = incidents.length ? incidents[incidents.length - 1] : null
  return {
    runs: list.length,
    healthyRuns: healthy,
    healthyRunPct: list.length ? Math.round((healthy / list.length) * 1000) / 10 : null,
    lastIncidentAt: last?.checkedAt ?? null,
    lastIncidentStatus: last?.overall ?? null,
  }
}

/**
 * Checks whose status changed between consecutive runs. A check that flips
 * repeatedly is less trustworthy than one that is steadily down.
 */
export function flappingChecks(history, minChanges = 2) {
  const list = Array.isArray(history) ? history : []
  const changes = new Map()
  for (let i = 1; i < list.length; i += 1) {
    const prev = list[i - 1].statuses || {}
    const cur = list[i].statuses || {}
    for (const id of Object.keys(cur)) {
      if (prev[id] != null && prev[id] !== cur[id]) changes.set(id, (changes.get(id) || 0) + 1)
    }
  }
  return [...changes.entries()]
    .filter(([, n]) => n >= minChanges)
    .map(([id, n]) => ({ id, changes: n }))
    .sort((a, b) => b.changes - a.changes || a.id.localeCompare(b.id))
}

/** How old a run is, and whether it is stale (older than 2x the refresh cadence). */
export function runFreshness(checkedAt, now = Date.now(), refreshMs = 60000) {
  const t = toMs(checkedAt)
  const n = toMs(now)
  if (t == null || n == null) return { ageSec: null, stale: null, label: 'N/A' }
  const ageSec = Math.max(0, Math.round((n - t) / 1000))
  const label = ageSec < 60 ? `${ageSec} s ago`
    : ageSec < 3600 ? `${Math.round(ageSec / 60)} min ago`
      : `${Math.round(ageSec / 3600)} h ago`
  return { ageSec, stale: ageSec * 1000 > refreshMs * 2, label }
}

/** Export-ready rows (strings only, N/A for gaps). */
export function healthExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    group: r.groupLabel,
    label: r.label,
    id: r.id,
    status: r.statusLabel,
    latency: r.latencyMs == null ? 'N/A' : `${r.latencyMs} ms`,
    detail: r.detail || 'N/A',
  }))
}
