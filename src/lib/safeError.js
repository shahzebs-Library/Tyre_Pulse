// ─────────────────────────────────────────────────────────────────────────────
// safeError.js — turn raw backend/Postgres/PostgREST errors into safe,
// user-facing messages.
//
// Rendering a raw database error to the UI is an information-disclosure risk:
// it can leak table/column names, constraint names, RLS policy details, and
// internal query structure. This module maps the common Postgres/PostgREST
// error shapes to short, generic strings and otherwise returns a neutral
// fallback — it NEVER surfaces the raw message of a database/PostgREST error.
//
// Dependency-free by design so it is safe to import anywhere (UI, hooks,
// contexts). `logAndMessage` additionally forwards the original error to
// monitoring via a lazy, guarded import so a missing/broken monitoring module
// can never break error handling.
// ─────────────────────────────────────────────────────────────────────────────

/** Safe default when we cannot (or must not) surface anything specific. */
export const DEFAULT_FALLBACK = 'Something went wrong. Please try again.'

// Postgres SQLSTATE / PostgREST codes → safe, generic user messages.
const CODE_MESSAGES = {
  '23505': 'A record with these details already exists.',
  '23503': 'This action references a record that no longer exists.',
  '23514': 'Some values are not valid.',
  '42501': 'You do not have permission to do that.',
  PGRST116: 'Not found.',
}

const PERMISSION_MESSAGE = 'You do not have permission to do that.'
const NETWORK_MESSAGE = 'Network error — check your connection.'

// Substrings that indicate the message came from the database / PostgREST layer
// and therefore must never be echoed back to the user verbatim.
const DB_MESSAGE_MARKERS = [
  'violates',
  'relation',
  'column',
  'permission denied',
  'row-level',
  'row level security',
  'schema cache',
  'constraint',
  'duplicate key',
]

// Substrings that specifically indicate a permission / RLS failure.
const PERMISSION_MARKERS = [
  'permission denied',
  'row-level',
  'row level security',
  'rls',
  'not authorized',
  'unauthorized',
]

// Substrings that indicate a transport / connectivity failure.
const NETWORK_MARKERS = [
  'failed to fetch',
  'network error',
  'networkerror',
  'load failed',
  'fetch failed',
  'connection refused',
  'econnrefused',
  'timeout',
  'timed out',
]

function normalize(value) {
  return typeof value === 'string' ? value.toLowerCase() : ''
}

function includesAny(haystack, markers) {
  return markers.some((m) => haystack.includes(m))
}

/**
 * Best-effort extraction of a PostgREST/Postgres error code from a variety of
 * error shapes (`err.code`, `err.error?.code`, nested `details`).
 */
function extractCode(err) {
  if (!err || typeof err !== 'object') return ''
  if (typeof err.code === 'string' && err.code) return err.code
  if (typeof err.code === 'number') return String(err.code)
  if (err.error && typeof err.error.code === 'string') return err.error.code
  return ''
}

/**
 * Convert any thrown value into a safe, user-facing message.
 *
 * Guarantees:
 *   • Never returns the raw message of a database/PostgREST error.
 *   • Maps known Postgres/PostgREST codes to fixed generic strings.
 *   • Detects permission/RLS and network failures by message content even when
 *     no code is present.
 *   • Allows short, code-less messages from our own thrown `Error`s (client-side
 *     validation) to pass through unchanged.
 *
 * @param {unknown} err       The caught error (any shape).
 * @param {string}  fallback  Message to use when nothing more specific is safe.
 * @returns {string}
 */
export function toUserMessage(err, fallback = DEFAULT_FALLBACK) {
  const safeFallback = typeof fallback === 'string' && fallback ? fallback : DEFAULT_FALLBACK

  if (err == null) return safeFallback

  const code = extractCode(err)
  const rawMessage = typeof err === 'string' ? err : (err && typeof err.message === 'string' ? err.message : '')
  const message = normalize(rawMessage)
  const details = normalize(err && typeof err === 'object' ? err.details : '')
  const hint = normalize(err && typeof err === 'object' ? err.hint : '')
  const combined = `${message} ${details} ${hint}`

  // 1) Known code mappings win first.
  if (code && Object.prototype.hasOwnProperty.call(CODE_MESSAGES, code)) {
    return CODE_MESSAGES[code]
  }

  // 2) Permission / RLS detection (code 42501 handled above; catch textual form).
  if (includesAny(combined, PERMISSION_MARKERS)) {
    return PERMISSION_MESSAGE
  }

  // 3) Network / transport failures.
  if (includesAny(combined, NETWORK_MARKERS)) {
    return NETWORK_MESSAGE
  }

  // 4) Any database/PostgREST-shaped error must never leak its raw message.
  //    Presence of a code, or DB-specific markers, marks it as backend-origin.
  if (code || includesAny(combined, DB_MESSAGE_MARKERS)) {
    return safeFallback
  }

  // 5) Our own validation errors: plain Error, no code, short message. OK to show.
  if (rawMessage && rawMessage.length <= 200) {
    return rawMessage
  }

  return safeFallback
}

/**
 * Like {@link toUserMessage}, but also reports the original error to monitoring
 * (Sentry) when available. The monitoring import is lazy + guarded so this
 * module stays dependency-free and never fails if monitoring is absent.
 *
 * @param {unknown} err
 * @param {string}  fallback
 * @returns {string} the safe user-facing message
 */
export function logAndMessage(err, fallback = DEFAULT_FALLBACK) {
  try {
    // Lazy, guarded import — avoids a hard dependency and any import-time cost.
    import('./monitoring.js')
      .then((mod) => {
        if (mod && typeof mod.captureError === 'function') {
          mod.captureError(err, { source: 'safeError.logAndMessage' })
        }
      })
      .catch(() => {})
  } catch {
    // Never let monitoring failures affect the returned message.
  }
  return toUserMessage(err, fallback)
}

export default toUserMessage
