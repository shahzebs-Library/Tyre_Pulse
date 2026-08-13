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
// THE SDK IS LOADED ON DEMAND, NOT AT MODULE SCOPE. It used to be
// `import * as Sentry from '@sentry/react'`, and because this module is
// statically imported by AuthContext and both error boundaries, that pulled the
// whole SDK into the eager startup graph - measured at 68 kB gz that every
// user, including one sitting on the login form, downloaded and parsed before
// first paint. main.jsx already deferred the *call*; only removing this import
// actually defers the *bytes*.
//
// A namespace import is also what makes it expensive: vite.config's vendor-react
// rule matches `/react/`, which catches `@sentry/react` too, so the SDK lands in
// a chunk the whole app depends on. Keep this import dynamic.
let Sentry = null
let initialized = false
let loading = null

// Calls made before the SDK finishes loading are held here rather than dropped.
// Without this the lazy load would open a window - roughly the auth round trip -
// in which a real error is reported nowhere, and the whole point of monitoring
// is the errors you did not expect. Bounded so a boot loop cannot grow it.
const MAX_PENDING = 20
let pending = []

function replayPending() {
  const queued = pending
  pending = []
  for (const item of queued) {
    try {
      if (item.kind === 'error') {
        Sentry.captureException(item.error, item.context ? { extra: item.context } : undefined)
      } else if (item.kind === 'breadcrumb') {
        Sentry.addBreadcrumb(item.crumb)
      } else if (item.kind === 'user') {
        Sentry.setUser(item.user)
      }
    } catch { /* no-op - monitoring must never throw */ }
  }
}

function queue(item) {
  if (pending.length >= MAX_PENDING) return
  pending.push(item)
}

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
 *
 * RETURNS A PROMISE<boolean> now that the SDK is fetched on demand - it cannot
 * report success synchronously for something that has not downloaded yet. The
 * no-DSN case still settles to false without touching the network, so an app
 * with no DSN configured pays nothing at all. Never rejects.
 */
export function initMonitoring() {
  if (initialized) return Promise.resolve(true)
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return Promise.resolve(false)
  if (loading) return loading

  loading = import('@sentry/react')
    .then((mod) => {
      Sentry = mod
      const ok = initWithSdk(dsn)
      if (ok) replayPending()
      return ok
    })
    .catch((err) => {
      // A blocked or failed SDK fetch must never break the app, and must not
      // leave callers waiting on a promise that never settles.
      console.error('[monitoring] Sentry SDK failed to load:', err)
      pending = []
      return false
    })

  return loading
}

/** Init against an already-loaded SDK. Split out so initMonitoring stays readable. */
function initWithSdk(dsn) {
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
  let eventId = null
  if (initialized) {
    try {
      eventId = Sentry.captureException(error, context ? { extra: context } : undefined) || null
    } catch { /* no-op — monitoring must never throw */ }
  } else if (loading) {
    // The SDK is on its way. Hold the error rather than drop it: this window is
    // roughly the auth round trip, which is exactly when a boot error happens,
    // and an error reported nowhere is the failure monitoring exists to prevent.
    // No event id can be returned yet - the caller's ERR-XXXX reference still
    // works, because the system_logs mirror below runs regardless.
    queue({ kind: 'error', error, context })
  }
  // Best-effort mirror into system_logs so the super-admin System Health console
  // sees application errors even when Sentry is not configured. Fully guarded:
  // never throws, never runs server-side, and never blocks the caller.
  try {
    if (typeof window !== 'undefined') {
      import('./api/systemLogs')
        .then(m => m.logSystemEvent({
          module_id: context?.module || context?.boundary || null,
          severity: 'error',
          source: context?.boundary || 'app',
          message: String(error?.message || error),
          reference_id: context?.referenceId || null,
          url: (typeof location !== 'undefined' ? location.pathname : null),
          detail: { componentStack: context?.componentStack },
        }))
        .catch(() => {})
    }
  } catch { /* no-op - logging must never break the caller */ }
  return eventId
}

/**
 * Record a breadcrumb for debugging context on future errors.
 * Safe to call anywhere — no-ops (never throws) when Sentry is not active.
 */
export function addBreadcrumb(category, message, data = undefined) {
  if (!initialized) {
    // Breadcrumbs are the trail that makes a later error readable, so the ones
    // recorded during startup are the most valuable ones to keep.
    if (loading) queue({ kind: 'breadcrumb', crumb: { category, message, data, level: 'info' } })
    return
  }
  try {
    Sentry.addBreadcrumb({ category, message, data, level: 'info' })
  } catch { /* no-op */ }
}

/**
 * Attach the signed-in user to monitoring context.
 * PRIVACY: only id, role, and site — NEVER email or name.
 */
export function setMonitoringUser({ id, role, site } = {}) {
  if (!initialized) {
    // Sign-in happens during the load window, so without this the user context
    // is missing from exactly the errors raised just after login. Only ONE user
    // entry is ever queued - a later sign-out must not be overtaken by an
    // earlier sign-in when the queue replays.
    if (loading) {
      pending = pending.filter((p) => p.kind !== 'user')
      queue({ kind: 'user', user: { id, role, site } })
    }
    return
  }
  try {
    Sentry.setUser({ id, role, site })
  } catch { /* no-op */ }
}

/** Detach user context on sign-out. */
export function clearMonitoringUser() {
  if (!initialized) {
    if (loading) {
      pending = pending.filter((p) => p.kind !== 'user')
      queue({ kind: 'user', user: null })
    }
    return
  }
  try {
    Sentry.setUser(null)
  } catch { /* no-op */ }
}
