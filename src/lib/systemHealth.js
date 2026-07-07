/**
 * systemHealth — internal subsystem health checks (roadmap #23).
 *
 * Every check is a thin, zero-cost reachability probe returning a uniform
 * result shape:
 *
 *   { id, group, label, status: 'ok'|'degraded'|'down'|'unknown', latencyMs, detail }
 *
 * Design rules:
 *  - NEVER exercises paid paths (no AI prompts, no emails, no embeddings) —
 *    edge functions are probed with an OPTIONS ping only.
 *  - Reads at most one row per table probe (`select('id').limit(1)`), so the
 *    checks stay cheap even against millions of records.
 *  - Every check catches its own failures; `runAllChecks` uses allSettled so
 *    one broken subsystem can never blank the whole board.
 *  - Pure helpers (latency classification, result shaping, status rollup,
 *    summary) are exported separately for unit testing without a network.
 */
import { supabase } from './supabase'

// ── Constants ─────────────────────────────────────────────────────────────────

export const STATUS = Object.freeze({
  OK:       'ok',
  DEGRADED: 'degraded',
  DOWN:     'down',
  UNKNOWN:  'unknown',
})

const VALID_STATUSES = new Set(Object.values(STATUS))

/** Queries slower than this are healthy-but-degraded. */
export const LATENCY_DEGRADED_MS = 2000

/** Edge-function OPTIONS pings abort after this long → 'down'. */
export const EDGE_FN_TIMEOUT_MS = 8000

/** Core tables the app reads today (matches existing code, not the migrations). */
export const HEALTH_TABLES = Object.freeze([
  'vehicle_fleet',
  'tyre_records',
  'inspections',
  'work_orders',
  'alerts',
  'import_batches',
  'audit_log_v2',
  'knowledge_documents',
])

/** Storage buckets referenced by the app (imports.js, vehicle360.js, tyre photos). */
export const HEALTH_BUCKETS = Object.freeze([
  'tyre-photos',
  'import-files',
  'vehicle-photos',
])

/** Edge functions invoked from the client (uploads/agents/emailService/embeddingService). */
export const HEALTH_EDGE_FUNCTIONS = Object.freeze([
  'chat-ai',
  'generate-embedding',
  'send-email',
])

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────

/**
 * Classify a successful check's latency: fast → ok, slow → degraded.
 * Non-finite / negative latencies are treated as ok (we cannot judge them).
 */
export function classifyLatency(latencyMs, thresholdMs = LATENCY_DEGRADED_MS) {
  if (typeof latencyMs !== 'number' || !Number.isFinite(latencyMs) || latencyMs < 0) {
    return STATUS.OK
  }
  return latencyMs > thresholdMs ? STATUS.DEGRADED : STATUS.OK
}

/**
 * Normalize a raw check outcome into the canonical result shape.
 * Unknown/invalid statuses collapse to 'unknown' so the UI never renders
 * an unstyled state.
 */
export function shapeResult({ id, group = 'general', label, status, latencyMs = null, detail = '' } = {}) {
  return {
    id:        String(id ?? 'unknown'),
    group,
    label:     String(label ?? id ?? 'Unknown'),
    status:    VALID_STATUSES.has(status) ? status : STATUS.UNKNOWN,
    latencyMs: (typeof latencyMs === 'number' && Number.isFinite(latencyMs))
      ? Math.max(0, Math.round(latencyMs))
      : null,
    detail: String(detail ?? ''),
  }
}

/**
 * Roll a list of results up into one overall status.
 * Any down → 'down'; else any degraded/unknown → 'degraded'; else 'ok'.
 * Empty input → 'unknown'.
 */
export function rollupStatus(results) {
  if (!Array.isArray(results) || results.length === 0) return STATUS.UNKNOWN
  let degraded = false
  for (const r of results) {
    const s = r?.status
    if (s === STATUS.DOWN) return STATUS.DOWN
    if (s === STATUS.DEGRADED || s === STATUS.UNKNOWN || !VALID_STATUSES.has(s)) degraded = true
  }
  return degraded ? STATUS.DEGRADED : STATUS.OK
}

/** Count results per status + overall rollup. */
export function summarizeResults(results) {
  const list = Array.isArray(results) ? results : []
  const summary = { ok: 0, degraded: 0, down: 0, unknown: 0, total: list.length }
  for (const r of list) {
    const s = VALID_STATUSES.has(r?.status) ? r.status : STATUS.UNKNOWN
    summary[s] += 1
  }
  summary.overall = rollupStatus(list)
  return summary
}

// ── Internal utilities ────────────────────────────────────────────────────────

function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
}

function errMessage(err) {
  if (!err) return 'Unknown error'
  return err.message || err.error_description || err.hint || String(err)
}

function supabaseBaseUrl() {
  // Same env var src/lib/supabase.js builds the client from.
  try {
    const url = import.meta.env?.VITE_SUPABASE_URL
    return typeof url === 'string' && url ? url.replace(/\/+$/, '') : null
  } catch {
    return null
  }
}

// ── Checks ────────────────────────────────────────────────────────────────────

/**
 * Core database reachability + latency: fetch at most one id from
 * vehicle_fleet. Degraded above LATENCY_DEGRADED_MS.
 */
export async function checkDatabase() {
  const meta = { id: 'database', group: 'database', label: 'Database (Postgres)' }
  const start = now()
  try {
    const { error } = await supabase.from('vehicle_fleet').select('id').limit(1)
    const latencyMs = now() - start
    if (error) {
      return shapeResult({ ...meta, status: STATUS.DOWN, latencyMs, detail: errMessage(error) })
    }
    const status = classifyLatency(latencyMs)
    return shapeResult({
      ...meta,
      status,
      latencyMs,
      detail: status === STATUS.DEGRADED ? `Slow response (> ${LATENCY_DEGRADED_MS}ms)` : 'Query OK',
    })
  } catch (err) {
    return shapeResult({ ...meta, status: STATUS.DOWN, latencyMs: now() - start, detail: errMessage(err) })
  }
}

/** Auth service: getSession must resolve (a null session is still a healthy service). */
export async function checkAuth() {
  const meta = { id: 'auth', group: 'auth', label: 'Authentication' }
  const start = now()
  try {
    const { data, error } = await supabase.auth.getSession()
    const latencyMs = now() - start
    if (error) {
      return shapeResult({ ...meta, status: STATUS.DEGRADED, latencyMs, detail: errMessage(error) })
    }
    return shapeResult({
      ...meta,
      status: classifyLatency(latencyMs),
      latencyMs,
      detail: data?.session ? 'Session active' : 'Service reachable (no session)',
    })
  } catch (err) {
    return shapeResult({ ...meta, status: STATUS.DOWN, latencyMs: now() - start, detail: errMessage(err) })
  }
}

/** Per-table reachability: cheapest possible read (one id). RLS-empty is still ok. */
export async function checkTable(name) {
  const meta = { id: `table:${name}`, group: 'tables', label: name }
  const start = now()
  try {
    const { error } = await supabase.from(name).select('id').limit(1)
    const latencyMs = now() - start
    if (error) {
      return shapeResult({ ...meta, status: STATUS.DOWN, latencyMs, detail: errMessage(error) })
    }
    return shapeResult({
      ...meta,
      status: classifyLatency(latencyMs),
      latencyMs,
      detail: 'Reachable',
    })
  } catch (err) {
    return shapeResult({ ...meta, status: STATUS.DOWN, latencyMs: now() - start, detail: errMessage(err) })
  }
}

/** Storage bucket reachability: list a single object (no downloads). */
export async function checkStorage(bucket) {
  const meta = { id: `storage:${bucket}`, group: 'storage', label: bucket }
  const start = now()
  try {
    const { error } = await supabase.storage.from(bucket).list('', { limit: 1 })
    const latencyMs = now() - start
    if (error) {
      return shapeResult({ ...meta, status: STATUS.DOWN, latencyMs, detail: errMessage(error) })
    }
    return shapeResult({
      ...meta,
      status: classifyLatency(latencyMs),
      latencyMs,
      detail: 'Bucket reachable',
    })
  } catch (err) {
    return shapeResult({ ...meta, status: STATUS.DOWN, latencyMs: now() - start, detail: errMessage(err) })
  }
}

/**
 * Edge-function reachability: OPTIONS preflight-style ping against
 * {VITE_SUPABASE_URL}/functions/v1/{name}. NEVER invokes the function body —
 * zero AI/email cost. Interpretation:
 *   - any HTTP response except 404      → reachable ('ok'; 401/403 still prove
 *                                         the gateway routed to the function)
 *   - 404                               → 'down' (function not deployed)
 *   - network error / timeout           → 'down'
 *   - missing VITE_SUPABASE_URL         → 'unknown'
 */
export async function checkEdgeFunction(name, { timeoutMs = EDGE_FN_TIMEOUT_MS } = {}) {
  const meta = { id: `edge:${name}`, group: 'edge', label: name }
  const base = supabaseBaseUrl()
  if (!base) {
    return shapeResult({ ...meta, status: STATUS.UNKNOWN, detail: 'VITE_SUPABASE_URL not configured' })
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = now()
  try {
    const res = await fetch(`${base}/functions/v1/${name}`, {
      method: 'OPTIONS',
      signal: controller.signal,
    })
    const latencyMs = now() - start
    if (res.status === 404) {
      return shapeResult({ ...meta, status: STATUS.DOWN, latencyMs, detail: 'Function not deployed (404)' })
    }
    const status = classifyLatency(latencyMs)
    return shapeResult({
      ...meta,
      status,
      latencyMs,
      detail: `Reachable (HTTP ${res.status})`,
    })
  } catch (err) {
    const latencyMs = now() - start
    const timedOut = err?.name === 'AbortError'
    return shapeResult({
      ...meta,
      status: STATUS.DOWN,
      latencyMs,
      detail: timedOut ? `Timed out after ${timeoutMs}ms` : errMessage(err),
    })
  } finally {
    clearTimeout(timer)
  }
}

// ── Orchestration ─────────────────────────────────────────────────────────────

/**
 * Run every check in parallel. Each check already catches its own errors;
 * allSettled is a second safety net so a bug in one check cannot reject the
 * whole run. Returns { checks, summary, checkedAt }.
 */
export async function runAllChecks() {
  const jobs = [
    checkDatabase(),
    checkAuth(),
    ...HEALTH_TABLES.map((t) => checkTable(t)),
    ...HEALTH_BUCKETS.map((b) => checkStorage(b)),
    ...HEALTH_EDGE_FUNCTIONS.map((f) => checkEdgeFunction(f)),
  ]
  const settled = await Promise.allSettled(jobs)
  const checks = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? shapeResult(s.value)
      : shapeResult({ id: `job:${i}`, group: 'general', label: 'Check failed', status: STATUS.UNKNOWN, detail: errMessage(s.reason) }),
  )
  return {
    checks,
    summary:   summarizeResults(checks),
    checkedAt: new Date().toISOString(),
  }
}
