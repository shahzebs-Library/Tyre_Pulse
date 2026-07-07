import { describe, it, expect } from 'vitest'
import {
  initMonitoring,
  isMonitoringActive,
  captureError,
  addBreadcrumb,
  setMonitoringUser,
  clearMonitoringUser,
  stripQueryString,
  scrubEvent,
} from '../lib/monitoring'

// ─────────────────────────────────────────────────────────────────────────────
// No-DSN safety: with VITE_SENTRY_DSN unset (as in the test env), monitoring
// must stay inert and every helper must be a safe no-op that never throws.
// ─────────────────────────────────────────────────────────────────────────────
describe('monitoring without a DSN', () => {
  it('initMonitoring returns false and stays inactive', () => {
    expect(initMonitoring()).toBe(false)
    expect(isMonitoringActive()).toBe(false)
  })

  it('captureError never throws', () => {
    expect(() => captureError(new Error('boom'))).not.toThrow()
    expect(() => captureError(new Error('boom'), { page: 'dashboard' })).not.toThrow()
    expect(() => captureError(null)).not.toThrow()
    expect(() => captureError(undefined, undefined)).not.toThrow()
    expect(() => captureError('string error')).not.toThrow()
  })

  it('addBreadcrumb never throws', () => {
    expect(() => addBreadcrumb('nav', 'went to /tyres')).not.toThrow()
    expect(() => addBreadcrumb('api', 'fetch failed', { status: 500 })).not.toThrow()
    expect(() => addBreadcrumb()).not.toThrow()
  })

  it('setMonitoringUser / clearMonitoringUser never throw', () => {
    expect(() => setMonitoringUser({ id: 'u1', role: 'Admin', site: 'HQ' })).not.toThrow()
    expect(() => setMonitoringUser()).not.toThrow()
    expect(() => setMonitoringUser(null ?? {})).not.toThrow()
    expect(() => clearMonitoringUser()).not.toThrow()
  })

  it('repeated init calls are idempotent no-ops', () => {
    expect(initMonitoring()).toBe(false)
    expect(initMonitoring()).toBe(false)
    expect(isMonitoringActive()).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// URL scrubbing
// ─────────────────────────────────────────────────────────────────────────────
describe('stripQueryString', () => {
  it('removes query strings', () => {
    expect(stripQueryString('https://x.co/a?token=abc&b=2')).toBe('https://x.co/a')
  })

  it('removes fragments', () => {
    expect(stripQueryString('https://x.co/a#access_token=abc')).toBe('https://x.co/a')
  })

  it('leaves clean URLs untouched', () => {
    expect(stripQueryString('https://x.co/a/b')).toBe('https://x.co/a/b')
  })

  it('is safe on non-string input', () => {
    expect(stripQueryString(null)).toBe(null)
    expect(stripQueryString(undefined)).toBe(undefined)
    expect(stripQueryString(42)).toBe(42)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// beforeSend scrubbing
// ─────────────────────────────────────────────────────────────────────────────
describe('scrubEvent', () => {
  it('passes clean events through', () => {
    const event = { message: 'Cannot read properties of undefined' }
    expect(scrubEvent(event)).toBe(event)
  })

  it('drops events whose message contains an authorization header', () => {
    expect(scrubEvent({ message: 'Request failed: Authorization header rejected' })).toBeNull()
  })

  it('drops events containing api key material', () => {
    expect(scrubEvent({ message: 'invalid apikey provided' })).toBeNull()
    expect(scrubEvent({ message: 'leaked sk-ant-abcdef1234567890' })).toBeNull()
  })

  it('drops events containing bearer tokens or JWTs', () => {
    expect(scrubEvent({ message: 'sent Bearer abc.def.ghi' })).toBeNull()
    expect(
      scrubEvent({
        exception: { values: [{ value: 'jwt eyJhbGciOiJIUzI1NiIsInR5cCI6.eyJzdWIiOiIxMjM0NTY3ODkwIn0' }] },
      }),
    ).toBeNull()
  })

  it('drops events with token assignments in exception values', () => {
    expect(scrubEvent({ exception: { values: [{ value: 'refresh_token=abc123' }] } })).toBeNull()
  })

  it('strips query strings from request URL and breadcrumb URLs', () => {
    const event = {
      message: 'network error',
      request: { url: 'https://api.x.co/v1/tyres?apikey=secret', query_string: 'apikey=secret' },
      breadcrumbs: [
        { data: { url: 'https://api.x.co/v1/vehicles?page=2' } },
        { data: { from: '/login?next=%2Ftyres', to: '/tyres?tab=live' } },
      ],
    }
    const out = scrubEvent(event)
    expect(out.request.url).toBe('https://api.x.co/v1/tyres')
    expect(out.request.query_string).toBeUndefined()
    expect(out.breadcrumbs[0].data.url).toBe('https://api.x.co/v1/vehicles')
    expect(out.breadcrumbs[1].data.from).toBe('/login')
    expect(out.breadcrumbs[1].data.to).toBe('/tyres')
  })

  it('redacts secret-looking breadcrumb messages instead of sending them', () => {
    const out = scrubEvent({
      message: 'plain error',
      breadcrumbs: [{ message: 'attached Bearer abc.def.ghi to request' }],
    })
    expect(out.breadcrumbs[0].message).toBe('[redacted]')
  })

  it('never throws on malformed events (fails closed)', () => {
    expect(() => scrubEvent(null)).not.toThrow()
    expect(() => scrubEvent({ breadcrumbs: 'not-an-array' })).not.toThrow()
  })
})
