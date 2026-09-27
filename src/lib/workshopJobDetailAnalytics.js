/**
 * Workshop Job Detail analytics - pure engine behind /workshop/:jobId.
 *
 * Works on one work_orders row (the Workshop directory's field selection:
 * labour_cost, parts_cost, total_cost, created_at, completed_at,
 * scheduled_date = target_completion, parts_used) plus, optionally, the other
 * work orders on the same asset.
 *
 * Honesty rules:
 *  - An unmeasurable figure is null (N/A): turnaround needs both timestamps,
 *    on-time needs a completion and a target, a cost share needs a total.
 *    The old page printed "SAR 0" and "0.0%" for these.
 *  - Parts lines are read as recorded; a line with no cost is not priced at 0
 *    in the reconciliation, it is counted as unpriced.
 * No I/O; `now` injectable.
 */

const HOUR_MS = 3600000
const DAY_MS = 86400000

function t(v) {
  if (!v) return null
  const n = new Date(v).getTime()
  return Number.isFinite(n) ? n : null
}

function num(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const CLOSED = new Set(['completed', 'closed', 'cancelled'])

export function isClosedJob(job) {
  return CLOSED.has(String(job?.status || '').toLowerCase()) || Boolean(job?.completed_at)
}

export function turnaroundHours(job) {
  const a = t(job?.created_at)
  const b = t(job?.completed_at)
  if (a == null || b == null || b < a) return null
  return (b - a) / HOUR_MS
}

export function isOnTime(job) {
  const done = t(job?.completed_at)
  const due = t(job?.scheduled_date)
  if (done == null || due == null) return null
  return done <= due
}

/**
 * Days late (positive) or early (negative) against the target. For an open job
 * past its target, days overdue so far. Null when there is no target.
 */
export function scheduleVarianceDays(job, now = Date.now()) {
  const due = t(job?.scheduled_date)
  if (due == null) return null
  const done = t(job?.completed_at)
  if (done != null) return Math.round((done - due) / DAY_MS)
  if (isClosedJob(job)) return null
  return now > due ? Math.floor((now - due) / DAY_MS) : null
}

export function costSplit(job) {
  const total = num(job?.total_cost)
  const labour = num(job?.labour_cost)
  const parts = num(job?.parts_cost)
  const hasTotal = total != null && total > 0
  return {
    total,
    labour,
    parts,
    other: hasTotal ? Math.max(0, total - (labour || 0) - (parts || 0)) : null,
    labourPct: hasTotal && labour != null ? (labour / total) * 100 : null,
    partsPct: hasTotal && parts != null ? (parts / total) * 100 : null,
  }
}

export function parseParts(job) {
  try {
    const raw = typeof job?.parts_used === 'string' ? JSON.parse(job.parts_used) : job?.parts_used
    return Array.isArray(raw) ? raw.filter((p) => p && typeof p === 'object') : []
  } catch {
    return []
  }
}

export function partName(p, i) {
  return p?.name || p?.part_name || p?.description || `Part ${i + 1}`
}

export function partsSummary(parts = [], job = null) {
  let qty = 0
  let cost = 0
  let costed = 0
  for (const p of parts) {
    const q = num(p?.qty)
    if (q != null) qty += q
    const c = num(p?.cost)
    if (c != null) { cost += c; costed += 1 }
  }
  const recorded = num(job?.parts_cost)
  return {
    lines: parts.length,
    qty,
    costed,
    unpriced: parts.length - costed,
    lineCost: costed > 0 ? cost : null,
    recordedPartsCost: recorded,
    reconcileGap: costed > 0 && recorded != null ? recorded - cost : null,
  }
}

/**
 * Asset history around this job. `history` are other work orders on the same
 * asset (the current job may be included; it is excluded by id).
 */
export function assetHistorySummary(history = [], job, { now = Date.now() } = {}) {
  const others = history.filter((h) => h && h.id !== job?.id)
  const yearAgo = now - 365 * DAY_MS
  const created = t(job?.created_at)
  const last12 = others.filter((h) => (t(h.created_at) ?? 0) >= yearAgo)
  const repeat = created == null ? [] : others.filter((h) => {
    const c = t(h.created_at)
    return c != null && c < created && created - c <= 30 * DAY_MS
  })
  const costs = last12.map((h) => num(h.total_cost)).filter((v) => v != null)
  const tas = others.map(turnaroundHours).filter((v) => v != null)
  const prior = others
    .filter((h) => created != null && (t(h.created_at) ?? Infinity) < created)
    .sort((a, b) => t(b.created_at) - t(a.created_at))[0] || null
  return {
    otherJobs: others.length,
    jobs12m: last12.length,
    cost12m: costs.length ? costs.reduce((s, v) => s + v, 0) : null,
    repeatWithin30: repeat.length,
    avgTurnaroundHours: tas.length ? tas.reduce((s, v) => s + v, 0) / tas.length : null,
    daysSincePrior: prior && created != null ? Math.floor((created - t(prior.created_at)) / DAY_MS) : null,
    priorJob: prior ? (prior.work_order_no || prior.id) : null,
  }
}

export function formatHours(h) {
  if (h == null || !Number.isFinite(h) || h < 0) return 'N/A'
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 72) return `${h.toFixed(1)}h`
  return `${(h / 24).toFixed(1)} days`
}

export function formatMoney(v, currency) {
  if (v == null || !Number.isFinite(Number(v))) return 'N/A'
  const n = Number(v)
  if (Math.abs(n) >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `${currency} ${(n / 1_000).toFixed(1)}K`
  return `${currency} ${Math.round(n).toLocaleString('en-US')}`
}

export function formatPct(v) {
  return v == null || !Number.isFinite(v) ? 'N/A' : `${v.toFixed(1)}%`
}

export function partsExportRows(parts = []) {
  return parts.map((p, i) => ({
    line: i + 1,
    part: partName(p, i),
    qty: num(p?.qty) ?? 'N/A',
    cost: num(p?.cost) ?? 'N/A',
  }))
}

export function historyExportRows(history = []) {
  return history.map((h) => ({
    work_order_no: h.work_order_no || h.id,
    created: h.created_at ? String(h.created_at).slice(0, 10) : 'N/A',
    completed: h.completed_at ? String(h.completed_at).slice(0, 10) : 'N/A',
    status: h.status || 'N/A',
    work_type: h.work_type || 'N/A',
    turnaround: formatHours(turnaroundHours(h)),
    total_cost: num(h.total_cost) ?? 'N/A',
  }))
}
