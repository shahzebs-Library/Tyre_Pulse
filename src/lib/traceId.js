/**
 * traceId.js - lightweight cross-layer correlation id (Data Trust Phase 3).
 * A stable per-tab session trace id plus a fresh per-operation id, so an action,
 * its logs and its records can be correlated. No secrets, no PII - just an id.
 * Pure/DOM-safe: falls back gracefully when sessionStorage / crypto are absent.
 */
const KEY = 'tp_trace'

function rand() {
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const b = new Uint8Array(8)
      crypto.getRandomValues(b)
      return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    }
  } catch { /* fall through */ }
  // Deterministic-free fallback (no Math.random dependency for testability): time-based.
  return (Date.now().toString(16) + '00000000').slice(0, 16)
}

/** The stable per-tab session trace id (created once). */
export function getSessionTraceId() {
  try {
    const ss = typeof sessionStorage !== 'undefined' ? sessionStorage : null
    if (ss) {
      let v = ss.getItem(KEY)
      if (!v) { v = 'trace_' + rand(); ss.setItem(KEY, v) }
      return v
    }
  } catch { /* fall through */ }
  return 'trace_' + rand()
}

/** A fresh id for a single operation, tagged with an optional label. */
export function newTraceId(label = 'op') {
  return `${String(label).replace(/[^a-z0-9_-]/gi, '')}_${rand()}`
}

/** Short, human-readable form for display. */
export function shortTrace(id) {
  const s = String(id || '')
  return s.length > 12 ? s.slice(0, 12) : s
}
