/**
 * Technician Scorecard — pure helpers (no I/O) that turn a flat list of
 * `work_orders` into a ranked, per-technician performance leaderboard.
 *
 * All functions are currency-agnostic and deterministic: they return raw
 * numbers only (the page formats for display) and never read the wall clock,
 * so the ranking logic lives in exactly one unit-tested place.
 *
 * Metrics per technician:
 *   - jobs            total work orders assigned
 *   - completed       work orders with status "Completed"
 *   - open            active work orders (Open / In Progress / Awaiting Parts)
 *   - cancelled       cancelled work orders
 *   - completionRate  completed / jobs  (%)
 *   - avgTurnaround   mean (completed_at - created_at) in DAYS over completed jobs
 *   - totalCost       Σ total_cost
 *   - avgCostPerJob   totalCost / jobs
 *   - score           composite 0–100 (see COMPOSITE_WEIGHTS)
 *   - rank            1-based position after sorting by score desc
 */

const UNASSIGNED = 'Unassigned'
const OPEN_STATUSES = new Set(['open', 'in progress', 'awaiting parts'])
const MS_PER_DAY = 24 * 3600 * 1000

/**
 * Composite score weights. Completion is weighted highest (throughput quality),
 * then turnaround speed (lower is better), then raw volume (experience/load).
 */
export const COMPOSITE_WEIGHTS = { completion: 0.5, turnaround: 0.3, volume: 0.2 }

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : Number(v)) || 0
const round1 = (v) => Math.round(v * 10) / 10

/** Turnaround for one work order, in DAYS. Null unless both dates valid & ordered. */
export function turnaroundDays(order) {
  if (!order?.created_at || !order?.completed_at) return null
  const start = new Date(order.created_at).getTime()
  const end = new Date(order.completed_at).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  const diff = (end - start) / MS_PER_DAY
  return diff < 0 ? null : round1(diff)
}

const statusKey = (o) => (o?.status || '').toString().trim().toLowerCase()

/**
 * Group work orders by technician and compute per-technician KPIs, a composite
 * score and a rank. Pure — pass the already-fetched rows.
 *
 * @param {Array<object>} workOrders  rows selected from `work_orders`
 * @returns {{ rows: Array<object>, totals: object }}
 */
export function summarizeTechnicians(workOrders) {
  const list = Array.isArray(workOrders) ? workOrders : []
  const map = new Map()

  for (const o of list) {
    const name = (o?.technician_name || o?.assigned_to || '').toString().trim() || UNASSIGNED
    let t = map.get(name)
    if (!t) {
      t = {
        technician: name,
        jobs: 0,
        completed: 0,
        open: 0,
        cancelled: 0,
        totalCost: 0,
        _taSum: 0,
        _taN: 0,
      }
      map.set(name, t)
    }
    t.jobs += 1
    t.totalCost += num(o?.total_cost)

    const s = statusKey(o)
    if (s === 'completed') {
      t.completed += 1
      const ta = turnaroundDays(o)
      if (ta != null) { t._taSum += ta; t._taN += 1 }
    } else if (s === 'cancelled') {
      t.cancelled += 1
    } else if (OPEN_STATUSES.has(s)) {
      t.open += 1
    }
  }

  const prelim = [...map.values()].map((t) => {
    const completionRate = t.jobs ? round1((t.completed / t.jobs) * 100) : 0
    const avgTurnaround = t._taN ? round1(t._taSum / t._taN) : null
    const avgCostPerJob = t.jobs ? Math.round(t.totalCost / t.jobs) : 0
    return {
      technician: t.technician,
      jobs: t.jobs,
      completed: t.completed,
      open: t.open,
      cancelled: t.cancelled,
      completionRate,
      avgTurnaround,
      totalCost: Math.round(t.totalCost),
      avgCostPerJob,
    }
  })

  // Normalisation bounds for the composite score.
  const maxJobs = prelim.reduce((m, r) => Math.max(m, r.jobs), 0) || 1
  const taValues = prelim.map((r) => r.avgTurnaround).filter((v) => v != null)
  const maxTa = taValues.length ? Math.max(...taValues, 1) : 1

  const scored = prelim.map((r) => {
    const volumeNorm = r.jobs / maxJobs                 // 0..1, higher better
    const taNorm = r.avgTurnaround == null ? 0.5 : r.avgTurnaround / maxTa // 0..1, lower better
    const score = Math.round(
      r.completionRate * COMPOSITE_WEIGHTS.completion +
      (1 - taNorm) * 100 * COMPOSITE_WEIGHTS.turnaround +
      volumeNorm * 100 * COMPOSITE_WEIGHTS.volume,
    )
    return { ...r, score }
  })

  scored.sort((a, b) =>
    b.score - a.score ||
    b.completionRate - a.completionRate ||
    b.jobs - a.jobs ||
    a.technician.localeCompare(b.technician),
  )
  scored.forEach((r, i) => { r.rank = i + 1 })

  return { rows: scored, totals: computeTotals(scored) }
}

/** Fleet-wide roll-up across the per-technician rows. */
export function computeTotals(rows) {
  const list = Array.isArray(rows) ? rows : []
  const technicians = list.length
  const totalJobs = list.reduce((s, r) => s + r.jobs, 0)
  const totalCompleted = list.reduce((s, r) => s + r.completed, 0)
  const totalOpen = list.reduce((s, r) => s + r.open, 0)
  const totalCost = list.reduce((s, r) => s + r.totalCost, 0)

  const avgCompletionRate = totalJobs ? round1((totalCompleted / totalJobs) * 100) : 0

  const taRows = list.filter((r) => r.avgTurnaround != null)
  const avgTurnaround = taRows.length
    ? round1(taRows.reduce((s, r) => s + r.avgTurnaround, 0) / taRows.length)
    : null

  return {
    technicians,
    totalJobs,
    totalCompleted,
    totalOpen,
    totalCost,
    avgCompletionRate,
    avgTurnaround,
  }
}

/** Rating badge derived from completion rate — presentation-agnostic label. */
export function completionRating(rate) {
  if (rate >= 95) return 'Excellent'
  if (rate >= 85) return 'Good'
  if (rate >= 70) return 'Average'
  return 'Needs Improvement'
}
