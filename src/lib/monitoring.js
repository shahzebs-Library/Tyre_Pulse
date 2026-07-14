// ─────────────────────────────────────────────────────────────────────────────
// monitoring.js — production error monitoring (Sentry), fully env-gated.
//
// When VITE_SENTRY_DSN is NOT set, initMonitoring() is a no-op and every
// helper below silently does nothing — the app behaves identically with or
// without a DSN, and call sites never need to check whether Sentry is active.
//
// Privacy guarantees:
//   • sendDefaultPii: false — no IP addresses, cookies, or headers.
//   • beforeSend strips query strings from all URLs and drops any event whose
//     message looks like it contains a secret (authorization / apikey / token).
//   • Session replays mask all text and block all media.
//   • User context is id + role + site ONLY — never email or name.
// ─────────────────────────────────────────────────────────────────────────────
import * as Sentry from '@sentry/react'

let initialized = false

// Patterns that indicate an event message may contain credential material.
const SECRET_PATTERNS = [
  /authorization/i,
  /api[-_]?key/i,
  /(?:^|[^\w])(?:access[-_]?|refresh[-_]?|id[-_]?|bearer[-_]?|auth[-_]?)?token[^\w]*[:=]/i,
  /bearer\s+[\w.~+/-]+/i,
  /sk-[a-zA-Z0-9-]{8,}/, // API secret key shapes (e.g. sk-ant-..., sk-live-...)
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
  /password\s*[:=]/i,
  /client[-_]?secret/i,
]

/** Remove the query string (and fragment) from a URL. Never throws. */
export function stripQueryString(url) {
  if (typeof url !== 'string') return url
  const qIdx = url.search(/[?#]/)
  return qIdx === -1 ? url : url.slice(0, qIdx)
}

function containsSecret(text) {
  if (typeof text !== 'string' || !text) return false
  return SECRET_PATTERNS.some(re => re.test(text))
}

function collectEventMessages(event) {
  const messages = []
  if (event?.message) messages.push(event.message)
  const values = event?.exception?.values
  if (Array.isArray(values)) {
    for (const v of values) if (v?.value) messages.push(v.value)
  }
  return messages
}

/**
 * beforeSend hook: drops events whose messages look like they contain
 * secrets, and strips query strings from every URL on the event.
 * Exported for unit testing. Never throws — on scrub failure the event is
 * dropped rather than sent unscrubbed.
 */
export function scrubEvent(event) {
  try {
    if (collectEventMessages(event).some(containsSecret)) return null

    if (event.request?.url) event.request.url = stripQueryString(event.request.url)
    if (event.request?.query_string) delete event.request.query_string

    if (Array.isArray(event.breadcrumbs)) {
      for (const crumb of event.breadcrumbs) {
        if (crumb?.data?.url) crumb.data.url = stripQueryString(crumb.data.url)
        if (crumb?.data?.to) crumb.data.to = stripQueryString(crumb.data.to)
        if (crumb?.data?.from) crumb.data.from = stripQueryString(crumb.data.from)
        if (containsSecret(crumb?.message)) crumb.message = '[redacted]'
      }
    }
    return event
  } catch {
    // Fail closed: never send an event we could not scrub.
    return null
  }
}

/**
 * Initialize Sentry. No-op unless VITE_SENTRY_DSN is configured.
 * Returns true when monitoring is active, false otherwise. Never throws.
 */
export function initMonitoring() {
  if (initialized) return true
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return false

  try {
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_APP_VERSION || undefined,
      sendDefaultPii: false,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
      ],
      tracesSampleRate: 0.2,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1.0,
      beforeSend: scrubEvent,
    })
    initialized = true
    return true
  } catch (err) {
    // Monitoring must never break the app.
    console.error('[monitoring] Sentry init failed:', err)
    return false
  }
}

/** True when Sentry has been initialized with a DSN. */
export function isMonitoringActive() {
  return initialized
}

/**
 * Report an error with optional structured context.
 * Safe to call anywhere — no-ops (never throws) when Sentry is not active.
 * Returns the Sentry event id when the event was captured, otherwise null.
 */
export function captureError(error, context = undefined) {
  if (!initialized) return null
  try {
    const eventId = Sentry.captureException(error, context ? { extra: context } : undefined)
    return eventId || null
  } catch { /* no-op — monitoring must never throw */ }
  return null
}

/**
 * Record a breadcrumb for debugging context on future errors.
 * Safe to call anywhere — no-ops (never throws) when Sentry is not active.
 */
export function addBreadcrumb(category, message, data = undefined) {
  if (!initialized) return
  try {
    Sentry.addBreadcrumb({ category, message, data, level: 'info' })
  } catch { /* no-op */ }
}

/**
 * Attach the signed-in user to monitoring context.
 * PRIVACY: only id, role, and site — NEVER email or name.
 */
export function setMonitoringUser({ id, role, site } = {}) {
  if (!initialized) return
  try {
    Sentry.setUser({ id, role, site })
  } catch { /* no-op */ }
}

/** Detach user context on sign-out. */
export function clearMonitoringUser() {
  if (!initialized) return
  try {
    Sentry.setUser(null)
  } catch { /* no-op */ }
}
