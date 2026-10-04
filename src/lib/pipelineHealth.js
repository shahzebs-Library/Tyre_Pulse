/**
 * pipelineHealth.js - per-job health for the Pipeline Monitor.
 *
 * Pure, no I/O. Turns the recorded run history (get_pipeline_runs rows) into
 * one row per job: how often it runs, how often it fails, when it last
 * succeeded, and whether it is failing right now (consecutive failures from
 * the newest run backwards). Unknown stays null, never a fake 0.
 */

export const isFailStatus = (s) => /fail|error/i.test(String(s || ''))
export const isOkStatus = (s) => /commit|success|sent|done/i.test(String(s || ''))

const ts = (v) => {
  const t = new Date(v || '').getTime()
  return Number.isFinite(t) ? t : null
}

/** Window filter: keep runs started within the last `days` (null = all). */
export function withinDays(rows, days, now = Date.now(), field = 'started_at') {
  const list = Array.isArray(rows) ? rows : []
  if (!days) return list
  const cut = now - days * 86400000
  return list.filter((r) => {
    const t = ts(r[field])
    return t != null && t >= cut
  })
}

/**
 * @param {Array<object>} runs
 * @returns {Array<{job:string, source:string|null, total:number, failed:number, ok:number,
 *   successRate:number|null, lastRun:string|null, lastStatus:string|null, lastSuccess:string|null,
 *   lastFailure:string|null, failingStreak:number, health:'failing'|'flaky'|'healthy'|'unknown',
 *   avgDurationMs:number|null}>}
 */
export function jobHealth(runs) {
  const groups = new Map()
  for (const r of Array.isArray(runs) ? runs : []) {
    const key = r?.job_key || 'Unnamed job'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  const out = []
  for (const [job, list] of groups) {
    const sorted = [...list].sort((a, b) => (ts(b.started_at) ?? 0) - (ts(a.started_at) ?? 0))
    const failed = sorted.filter((r) => isFailStatus(r.status)).length
    const ok = sorted.filter((r) => isOkStatus(r.status)).length
    let streak = 0
    for (const r of sorted) { if (isFailStatus(r.status)) streak += 1; else break }
    const durations = sorted
      .map((r) => { const a = ts(r.started_at); const b = ts(r.finished_at); return a != null && b != null && b >= a ? b - a : null })
      .filter((d) => d != null)
    const decided = failed + ok
    const successRate = decided ? ok / decided : null
    let health = 'unknown'
    if (streak > 0) health = 'failing'
    else if (successRate != null && successRate < 0.9) health = 'flaky'
    else if (successRate != null) health = 'healthy'
    out.push({
      job,
      source: sorted[0]?.source || null,
      total: sorted.length,
      failed,
      ok,
      successRate,
      lastRun: sorted[0]?.started_at || null,
      lastStatus: sorted[0]?.status || null,
      lastSuccess: sorted.find((r) => isOkStatus(r.status))?.started_at || null,
      lastFailure: sorted.find((r) => isFailStatus(r.status))?.started_at || null,
      failingStreak: streak,
      health,
      avgDurationMs: durations.length ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : null,
    })
  }
  const rank = { failing: 0, flaky: 1, unknown: 2, healthy: 3 }
  return out.sort((a, b) => rank[a.health] - rank[b.health] || b.failed - a.failed || a.job.localeCompare(b.job))
}

/** Counts of jobs per health band. */
export function healthCounts(rows) {
  const c = { failing: 0, flaky: 0, healthy: 0, unknown: 0 }
  for (const r of Array.isArray(rows) ? rows : []) c[r.health] = (c[r.health] || 0) + 1
  return c
}

/** Human duration: 850 ms, 12 s, 3 min 5 s. null -> 'N/A'. */
export function fmtDuration(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return 'N/A'
  const n = Number(ms)
  if (n < 1000) return `${Math.round(n)} ms`
  const s = Math.round(n / 1000)
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${s % 60} s`
}
