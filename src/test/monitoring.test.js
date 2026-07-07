import { describe, it, expect, vi } from 'vitest'

// The SDKs must never be pulled in (dynamic import) when env vars are unset -
// mock them to throw so an unexpected load fails the test loudly.
vi.mock('@sentry/react', () => { throw new Error('Sentry SDK must not load without VITE_SENTRY_DSN') })
vi.mock('posthog-js', () => { throw new Error('PostHog SDK must not load without VITE_POSTHOG_KEY') })

const monitoring = await import('../lib/monitoring')

describe('monitoring - disabled by default (no env vars)', () => {
  it('initMonitoring resolves without loading either SDK and never throws', async () => {
    await expect(monitoring.initMonitoring()).resolves.not.toThrow()
    expect(monitoring.isSentryReady()).toBe(false)
    expect(monitoring.isPostHogReady()).toBe(false)
  })

  it('helpers are safe no-ops when uninitialised', () => {
    expect(() => monitoring.captureError(new Error('x'), { where: 'test' })).not.toThrow()
    expect(() => monitoring.capture('event', { a: 1 })).not.toThrow()
    expect(() => monitoring.identify('user-1', { role: 'Admin' })).not.toThrow()
    expect(() => monitoring.resetAnalytics()).not.toThrow()
  })
})
