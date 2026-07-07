/**
 * Monitoring bootstrap — Sentry (errors/performance) + PostHog (analytics).
 *
 * Contract: initMonitoring() must NEVER break app boot. Each provider is
 * initialized inside its own try/catch, and each one independently no-ops
 * when its env var is absent — zero network calls, zero bundle cost (both
 * SDKs are dynamically imported only when configured).
 */

import { initSentry } from './sentry'
import { initPostHog } from './posthog'

export { captureError, isSentryReady } from './sentry'
export { capture, identify, resetAnalytics, isPostHogReady } from './posthog'

/**
 * Initialize all monitoring providers. Fire-and-forget safe: never rejects,
 * never throws, and does nothing unless the relevant env vars are set.
 * @returns {Promise<{sentry: boolean, posthog: boolean}>} which providers started.
 */
export async function initMonitoring() {
  const status = { sentry: false, posthog: false }

  try {
    status.sentry = await initSentry()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[TyrePulse] Sentry init failed (app unaffected):', err)
  }

  try {
    status.posthog = await initPostHog()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[TyrePulse] PostHog init failed (app unaffected):', err)
  }

  return status
}
