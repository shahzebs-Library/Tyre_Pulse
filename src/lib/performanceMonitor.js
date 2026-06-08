// performanceMonitor.js — Query and render performance tracking
const _metrics = []
const MAX_METRICS = 200

export function trackQuery(name, durationMs, recordCount = 0) {
  _metrics.push({ type: 'query', name, durationMs, recordCount, ts: Date.now() })
  if (_metrics.length > MAX_METRICS) _metrics.shift()

  if (durationMs > 3000) {
    console.warn(`[PerfMonitor] Slow query: ${name} took ${durationMs}ms (${recordCount} records)`)
  }
}

export function trackRender(component, durationMs) {
  _metrics.push({ type: 'render', component, durationMs, ts: Date.now() })
  if (_metrics.length > MAX_METRICS) _metrics.shift()
}

export function getMetrics(type = null) {
  return type ? _metrics.filter(m => m.type === type) : [..._metrics]
}

export function getSlowQueries(thresholdMs = 2000) {
  return _metrics.filter(m => m.type === 'query' && m.durationMs > thresholdMs)
}

export function clearMetrics() {
  _metrics.length = 0
}

// Timed Supabase query wrapper
export async function timedQuery(name, queryFn) {
  const start = performance.now()
  const result = await queryFn()
  const duration = performance.now() - start
  trackQuery(name, duration, result.data?.length ?? 0)
  return result
}
