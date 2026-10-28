/**
 * Pure shapers for the AI tyre inspection operations panel. No I/O.
 * Time-to-result = created_at to updated_at on COMPLETED jobs (the jobs table has no completed_at).
 * Every figure is null (shown as N/A) when it cannot be measured; nothing is estimated.
 */
export const OPS_STATUSES = Object.freeze(['pending', 'processing', 'completed', 'failed'])

const finite = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null }

/** Nearest-rank percentile on an unsorted array; null when empty. */
export function percentile(values, p) {
  const xs = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!xs.length) return null
  const rank = Math.min(xs.length, Math.max(1, Math.ceil((p / 100) * xs.length)))
  return xs[rank - 1]
}

export function queueDepth(jobs) {
  const out = Object.fromEntries(OPS_STATUSES.map((s) => [s, 0]))
  let other = 0
  for (const j of jobs || []) { if (j.status in out) out[j.status]++; else other++ }
  return { ...out, other, total: (jobs || []).length }
}

/** Seconds from creation to completion for completed jobs with sane timestamps. */
export function timeToResult(jobs) {
  const secs = []
  for (const j of jobs || []) {
    if (j.status !== 'completed') continue
    const a = Date.parse(j.created_at), b = Date.parse(j.updated_at)
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) secs.push((b - a) / 1000)
  }
  return { count: secs.length, medianSec: percentile(secs, 50), p95Sec: percentile(secs, 95) }
}

export function failureBreakdown(jobs) {
  const list = jobs || []
  const failed = list.filter((j) => j.status === 'failed')
  const kinds = new Map()
  for (const j of failed) { const k = j.failure_kind || 'unknown'; kinds.set(k, (kinds.get(k) || 0) + 1) }
  const terminal = list.filter((j) => j.status === 'failed' || j.status === 'completed').length
  return {
    failed: failed.length,
    terminal,
    ratePct: terminal ? Math.round((failed.length / terminal) * 1000) / 10 : null,
    byKind: [...kinds.entries()].map(([kind, count]) => ({ kind, count, sharePct: Math.round((count / failed.length) * 1000) / 10 }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
  }
}

/** Provider/model mix over jobs, with job count, priced cost and unpriced count. */
export function providerMix(jobs) {
  const m = new Map()
  for (const j of jobs || []) {
    const provider = j.provider || 'unknown', model = j.model_version || 'unknown'
    const key = provider + '|' + model
    const cur = m.get(key) || { provider, model, jobs: 0, costUsd: 0, unpriced: 0 }
    cur.jobs++
    const c = finite(j.cost_usd)
    if (c === null) cur.unpriced++; else cur.costUsd += c
    m.set(key, cur)
  }
  return [...m.values()].map((r) => ({ ...r, costUsd: Math.round(r.costUsd * 1e6) / 1e6 })).sort((a, b) => b.jobs - a.jobs)
}

/** Parse the system_config budget value; null = uncapped/unset, NaN-safe. */
export function parseBudget(raw) {
  const s = String(raw ?? '').replace(/^"+|"+$/g, '').trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Spend this month: tyre jobs (authoritative) plus token-log rows of other features. */
export function monthSpend(jobs, logs, budgetRaw) {
  let tyre = 0, other = 0, unpricedCalls = 0
  for (const j of jobs || []) {
    if (!j.provider_called_at && finite(j.cost_usd) === null) continue
    const c = finite(j.cost_usd)
    if (c === null) unpricedCalls++; else tyre += c
  }
  for (const r of logs || []) {
    if (r.feature === 'ai_tyre_inspection') continue
    const c = finite(r.cost_usd)
    if (c !== null) other += c
  }
  const spent = Math.round((tyre + other) * 1e6) / 1e6
  const limit = parseBudget(budgetRaw)
  return {
    spentUsd: spent, tyreUsd: Math.round(tyre * 1e6) / 1e6, otherUsd: Math.round(other * 1e6) / 1e6,
    unpricedCalls, limitUsd: limit,
    usedPct: limit ? Math.round((spent / limit) * 1000) / 10 : null,
  }
}

export function shapeOps({ jobs, monthJobs, monthLogs, budgetRaw }) {
  return {
    queue: queueDepth(jobs), latency: timeToResult(jobs), failures: failureBreakdown(jobs),
    mix: providerMix(jobs), spend: monthSpend(monthJobs ?? jobs, monthLogs, budgetRaw),
  }
}

export function fmtDuration(sec) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return 'N/A'
  if (sec < 90) return `${Math.round(sec)} s`
  if (sec < 5400) return `${Math.round(sec / 60)} min`
  return `${Math.round(sec / 360) / 10} h`
}
