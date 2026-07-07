/**
 * PostHog product analytics — client-side wiring.
 *
 * Zero-cost by default: the SDK is only loaded (dynamic import) and initialized
 * when VITE_POSTHOG_KEY is present. A PostHog project API key is a public,
 * write-only client value, so it is allowed in VITE_ env.
 *
 * Privacy defaults:
 *  - Session recording is OFF unless VITE_POSTHOG_RECORDING=true.
 *  - Do Not Track is respected (respect_dnt: true).
 */

const DEFAULT_HOST = 'https://eu.i.posthog.com'

let posthogClient = null

/**
 * Initialize PostHog. No-ops (returns false) when VITE_POSTHOG_KEY is unset.
 * Safe to call more than once — subsequent calls are ignored.
 * @returns {Promise<boolean>} true when the SDK was initialized.
 */
export async function initPostHog() {
  if (posthogClient) return true
  const key = import.meta.env.VITE_POSTHOG_KEY
  if (!key) return false

  const { default: posthog } = await import('posthog-js')

  const recordingEnabled = import.meta.env.VITE_POSTHOG_RECORDING === 'true'
  posthog.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || DEFAULT_HOST,
    autocapture: true,
    capture_pageview: true,
    capture_pageleave: true,
    disable_session_recording: !recordingEnabled,
    respect_dnt: true,
    persistence: 'localStorage+cookie',
    ...(recordingEnabled
      ? { session_recording: { maskAllInputs: true } }
      : {}),
  })

  posthogClient = posthog
  return true
}

/**
 * Capture a product analytics event. Safe to call unconditionally —
 * no-ops when PostHog is not initialized or the event name is invalid.
 * @param {string} event  Event name, e.g. 'inspection_saved'.
 * @param {Record<string, unknown>} [props]  Event properties.
 */
export function capture(event, props) {
  if (!posthogClient || typeof event !== 'string' || event.length === 0) return
  try {
    posthogClient.capture(event, props)
  } catch {
    /* monitoring must never throw into app code */
  }
}

/**
 * Associate the current session with a user. Safe to call unconditionally —
 * no-ops when PostHog is not initialized or userId is invalid.
 * @param {string} userId  Stable user identifier (e.g. Supabase auth user id).
 * @param {Record<string, unknown>} [props]  Person properties (avoid PII beyond need).
 */
export function identify(userId, props) {
  if (!posthogClient || typeof userId !== 'string' || userId.length === 0) return
  try {
    posthogClient.identify(userId, props)
  } catch {
    /* monitoring must never throw into app code */
  }
}

/**
 * Clear the identified user (call on logout so sessions don't bleed across
 * accounts on shared devices). No-ops when uninitialized.
 */
export function resetAnalytics() {
  if (!posthogClient) return
  try {
    posthogClient.reset()
  } catch {
    /* monitoring must never throw into app code */
  }
}

/** @returns {boolean} whether PostHog is active in this session. */
export function isPostHogReady() {
  return posthogClient !== null
}
