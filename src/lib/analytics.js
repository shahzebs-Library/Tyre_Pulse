// ─────────────────────────────────────────────────────────────────────────────
// analytics.js — product analytics (PostHog), fully env-gated.
//
// When VITE_POSTHOG_KEY is NOT set, initAnalytics() is a no-op and every helper
// below silently does nothing — the app behaves identically with or without a
// key, and call sites never need to check whether PostHog is active. Mirrors the
// Sentry pattern in monitoring.js.
//
// Privacy:
//   • person_profiles: 'identified_only' — no anonymous-visitor profiles.
//   • We identify a user by id + role + site ONLY — never email or name
//     (same rule as Sentry setMonitoringUser).
//   • sanitize_properties strips URL query strings (which can carry tokens).
// ─────────────────────────────────────────────────────────────────────────────
import posthog from 'posthog-js'

let initialized = false

/** Remove the query string / fragment from a URL. Never throws. */
function stripQuery(url) {
  if (typeof url !== 'string') return url
  const i = url.search(/[?#]/)
  return i === -1 ? url : url.slice(0, i)
}

/**
 * Initialize PostHog. No-op unless VITE_POSTHOG_KEY is configured. Returns true
 * when analytics is active, false otherwise. Never throws.
 */
export function initAnalytics() {
  if (initialized) return true
  const key = import.meta.env.VITE_POSTHOG_KEY
  if (!key) return false

  try {
    posthog.init(key, {
      api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
      person_profiles: 'identified_only',
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
      persistence: 'localStorage+cookie',
      // Strip query strings (possible tokens) from any URL PostHog records.
      sanitize_properties: (props) => {
        try {
          for (const k of ['$current_url', '$referrer', '$pathname']) {
            if (typeof props[k] === 'string') props[k] = stripQuery(props[k])
          }
        } catch { /* never break capture */ }
        return props
      },
    })
    initialized = true
    return true
  } catch (err) {
    // Analytics must never break the app.
    console.error('[analytics] PostHog init failed:', err)
    return false
  }
}

/** True when PostHog has been initialized with a key. */
export function isAnalyticsActive() {
  return initialized
}

/**
 * Attach the signed-in user to analytics.
 * PRIVACY: only id, role, and site — NEVER email or name.
 */
export function identifyUser({ id, role, site } = {}) {
  if (!initialized || !id) return
  try {
    posthog.identify(id, { role, site })
  } catch { /* no-op — analytics must never throw */ }
}

/** Detach the user (call on sign-out) so the next session starts anonymous. */
export function resetAnalyticsUser() {
  if (!initialized) return
  try {
    posthog.reset()
  } catch { /* no-op */ }
}

/**
 * Capture a product event with optional properties.
 * Safe to call anywhere — no-ops (never throws) when PostHog is not active.
 */
export function trackEvent(name, properties = undefined) {
  if (!initialized || !name) return
  try {
    posthog.capture(name, properties)
  } catch { /* no-op */ }
}
