/**
 * Sentry error monitoring — client-side wiring.
 *
 * Zero-cost by default: the SDK is only loaded (dynamic import) and initialized
 * when VITE_SENTRY_DSN is present. A Sentry DSN is a public, client-safe value
 * (it can only ingest events, never read them) so it is allowed in VITE_ env.
 *
 * Privacy defaults:
 *  - Session Replay is OFF unless VITE_SENTRY_REPLAY=true.
 *  - sendDefaultPii is false — no IP/user enrichment beyond what app code sets.
 */

let sentryClient = null

/** Clamp a sample-rate env string into [0, 1]; fall back on invalid input. */
export function parseSampleRate(raw, fallback) {
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

/**
 * Initialize Sentry. No-ops (returns false) when VITE_SENTRY_DSN is unset.
 * Safe to call more than once — subsequent calls are ignored.
 * @returns {Promise<boolean>} true when the SDK was initialized.
 */
export async function initSentry() {
  if (sentryClient) return true
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return false

  const Sentry = await import('@sentry/react')

  const replayEnabled = import.meta.env.VITE_SENTRY_REPLAY === 'true'
  const integrations = [Sentry.browserTracingIntegration()]
  if (replayEnabled) {
    // Aggressive masking even when replay is opted in — fleet data is sensitive.
    integrations.push(Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }))
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION || undefined,
    integrations,
    tracesSampleRate: parseSampleRate(import.meta.env.VITE_SENTRY_TRACES_RATE, 0.1),
    replaysSessionSampleRate: replayEnabled ? 0.1 : 0,
    replaysOnErrorSampleRate: replayEnabled ? 1.0 : 0,
    sendDefaultPii: false,
  })

  sentryClient = Sentry
  return true
}

/**
 * Report an error with optional structured context. Safe to call
 * unconditionally — no-ops when Sentry is not initialized.
 * @param {unknown} error   Error (or value) to capture.
 * @param {Record<string, unknown>} [context]  Extra key/values attached to the event.
 */
export function captureError(error, context) {
  if (!sentryClient) return
  try {
    sentryClient.captureException(error, context ? { extra: context } : undefined)
  } catch {
    /* monitoring must never throw into app code */
  }
}

/** @returns {boolean} whether Sentry is active in this session. */
export function isSentryReady() {
  return sentryClient !== null
}
