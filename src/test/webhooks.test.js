import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Supabase mock (app_settings key/value store) ─────────────────────────────
const state = { row: null, selectError: null, upserted: null, upsertError: null }
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.row, error: state.selectError }) }) }),
      upsert: async (payload) => { state.upserted = payload; return { error: state.upsertError } },
    }),
  },
}))

import {
  validateWebhookUrl, endpointAcceptsEvent, getWebhookEndpoints,
  saveWebhookEndpoints, dispatchEvent, sendTestEvent, signBody, clearWebhookCache,
} from '../lib/webhooks'

const EVENT = Object.freeze({
  id: 'evt-1', type: 'workorder.created', occurred_at: '2026-07-07T10:00:00.000Z',
  payload: { work_order_no: 'WO-1' },
})

const endpoint = (over = {}) => ({
  id: 'ep-1', url: 'https://hooks.example.com/tp', events: ['*'],
  enabled: true, secret: null, description: '', created_by: null,
  created_at: '2026-01-01T00:00:00.000Z', ...over,
})

let fetchMock
beforeEach(() => {
  state.row = null; state.selectError = null; state.upserted = null; state.upsertError = null
  clearWebhookCache()
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const setSavedEndpoints = (list) => { state.row = { value: JSON.stringify(list) } }

// ─────────────────────────────────────────────────────────────────────────────
// URL validation (https-only + SSRF blocks)
// ─────────────────────────────────────────────────────────────────────────────
describe('validateWebhookUrl', () => {
  it('accepts public https URLs', () => {
    expect(validateWebhookUrl('https://hooks.example.com/tp').ok).toBe(true)
    expect(validateWebhookUrl('https://n8n.mycompany.io:8443/webhook/abc').ok).toBe(true)
  })

  it('rejects plain http', () => {
    expect(validateWebhookUrl('http://hooks.example.com/tp').ok).toBe(false)
  })

  it('rejects other protocols and garbage', () => {
    expect(validateWebhookUrl('ftp://example.com').ok).toBe(false)
    expect(validateWebhookUrl('not a url').ok).toBe(false)
    expect(validateWebhookUrl('').ok).toBe(false)
    expect(validateWebhookUrl(null).ok).toBe(false)
  })

  it('blocks internal / private network targets (SSRF)', () => {
    const blocked = [
      'https://localhost/hook',
      'https://127.0.0.1/hook',
      'https://10.0.0.5/hook',
      'https://172.16.1.1/hook',
      'https://172.31.255.255/hook',
      'https://192.168.1.10/hook',
      'https://169.254.169.254/latest/meta-data', // cloud metadata
      'https://0.0.0.0/hook',
      'https://[::1]/hook',
      'https://printer.local/hook',
      'https://db.internal/hook',
    ]
    for (const url of blocked) {
      expect(validateWebhookUrl(url).ok, url).toBe(false)
    }
  })

  it('does not over-block lookalike public hosts', () => {
    expect(validateWebhookUrl('https://172.32.0.1/hook').ok).toBe(true)   // outside 172.16/12
    expect(validateWebhookUrl('https://10x.example.com/hook').ok).toBe(true)
    expect(validateWebhookUrl('https://mylocal.example.com/hook').ok).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint filtering
// ─────────────────────────────────────────────────────────────────────────────
describe('endpointAcceptsEvent', () => {
  it('matches wildcard and exact subscriptions, only when enabled', () => {
    expect(endpointAcceptsEvent(endpoint({ events: ['*'] }), 'tyre.created')).toBe(true)
    expect(endpointAcceptsEvent(endpoint({ events: ['tyre.created'] }), 'tyre.created')).toBe(true)
    expect(endpointAcceptsEvent(endpoint({ events: ['gatepass.issued'] }), 'tyre.created')).toBe(false)
    expect(endpointAcceptsEvent(endpoint({ enabled: false }), 'tyre.created')).toBe(false)
    expect(endpointAcceptsEvent(null, 'tyre.created')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Config persistence + cache
// ─────────────────────────────────────────────────────────────────────────────
describe('getWebhookEndpoints / saveWebhookEndpoints', () => {
  it('parses the stored JSON list and caches it (TTL)', async () => {
    setSavedEndpoints([endpoint()])
    const first = await getWebhookEndpoints()
    expect(first).toHaveLength(1)
    expect(first[0].url).toBe('https://hooks.example.com/tp')

    state.row = { value: JSON.stringify([]) } // DB changes...
    const second = await getWebhookEndpoints() // ...but cache still serves
    expect(second).toHaveLength(1)

    const forced = await getWebhookEndpoints({ force: true })
    expect(forced).toHaveLength(0)
  })

  it('returns [] (never throws) on read failure', async () => {
    state.selectError = { message: 'permission denied' }
    await expect(getWebhookEndpoints()).resolves.toEqual([])
  })

  it('save rejects invalid / internal URLs before persisting', async () => {
    await expect(saveWebhookEndpoints([endpoint({ url: 'http://x.com' })])).rejects.toThrow(/https/)
    await expect(saveWebhookEndpoints([endpoint({ url: 'https://192.168.0.9/h' })])).rejects.toThrow(/Internal/)
    expect(state.upserted).toBeNull()
  })

  it('save upserts the sanitized list under webhook_endpoints and refreshes the cache', async () => {
    const saved = await saveWebhookEndpoints([endpoint({ description: 'x'.repeat(500) })])
    expect(state.upserted.key).toBe('webhook_endpoints')
    expect(JSON.parse(state.upserted.value)).toHaveLength(1)
    expect(saved[0].description).toHaveLength(200) // clamped

    state.row = { value: JSON.stringify([]) }
    expect(await getWebhookEndpoints()).toHaveLength(1) // cache refreshed by save
  })

  it('save surfaces persistence errors', async () => {
    state.upsertError = { message: 'RLS: admins only' }
    await expect(saveWebhookEndpoints([endpoint()])).rejects.toThrow('RLS: admins only')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch
// ─────────────────────────────────────────────────────────────────────────────
describe('dispatchEvent', () => {
  it('POSTs the envelope to every enabled, subscribed endpoint only', async () => {
    setSavedEndpoints([
      endpoint({ id: 'a', events: ['workorder.created'] }),
      endpoint({ id: 'b', url: 'https://other.example.com/h', events: ['gatepass.issued'] }),
      endpoint({ id: 'c', url: 'https://third.example.com/h', events: ['*'], enabled: false }),
    ])
    const results = await dispatchEvent(EVENT)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://hooks.example.com/tp')
    expect(opts.method).toBe('POST')
    expect(opts.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(opts.body)).toEqual({
      id: 'evt-1', type: 'workorder.created',
      occurred_at: '2026-07-07T10:00:00.000Z', payload: { work_order_no: 'WO-1' },
    })
    expect(results).toEqual([{ ok: true }])
  })

  it('re-validates URLs at dispatch time (DB-edited internal target is skipped)', async () => {
    setSavedEndpoints([endpoint({ url: 'https://169.254.169.254/steal' })])
    const results = await dispatchEvent(EVENT)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(results[0].ok).toBe(false)
  })

  it('never throws: fetch failure becomes a warned, per-endpoint result', async () => {
    setSavedEndpoints([endpoint()])
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(dispatchEvent(EVENT)).resolves.toEqual([{ ok: false, reason: 'Failed to fetch' }])
  })

  it('maps aborts to a timeout reason', async () => {
    setSavedEndpoints([endpoint()])
    const abort = new Error('aborted'); abort.name = 'AbortError'
    fetchMock.mockRejectedValueOnce(abort)
    const [res] = await dispatchEvent(EVENT)
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/timeout/)
  })

  it('one failing endpoint does not stop delivery to the others', async () => {
    setSavedEndpoints([
      endpoint({ id: 'a' }),
      endpoint({ id: 'b', url: 'https://other.example.com/h' }),
    ])
    fetchMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ ok: true, status: 200 })
    const results = await dispatchEvent(EVENT)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(results.map((r) => r.ok).sort()).toEqual([false, true])
  })

  it('non-2xx responses are failures', async () => {
    setSavedEndpoints([endpoint()])
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    const [res] = await dispatchEvent(EVENT)
    expect(res).toEqual({ ok: false, reason: 'HTTP 500' })
  })

  it('is a silent no-op with no endpoints or a malformed event', async () => {
    await expect(dispatchEvent(EVENT)).resolves.toEqual([])
    await expect(dispatchEvent(null)).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// HMAC signature
// ─────────────────────────────────────────────────────────────────────────────
describe('signature header', () => {
  it('adds X-TyrePulse-Signature (hex HMAC-SHA256) when a secret is set', async () => {
    vi.stubGlobal('crypto', {
      subtle: {
        importKey: vi.fn(async () => 'key'),
        sign: vi.fn(async () => new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer),
      },
    })
    setSavedEndpoints([endpoint({ secret: 'shhh' })])
    await dispatchEvent(EVENT)
    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.headers['X-TyrePulse-Signature']).toBe('deadbeef')
  })

  it('omits the header when crypto.subtle is unavailable (still delivers)', async () => {
    vi.stubGlobal('crypto', {}) // no subtle
    setSavedEndpoints([endpoint({ secret: 'shhh' })])
    const [res] = await dispatchEvent(EVENT)
    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.headers['X-TyrePulse-Signature']).toBeUndefined()
    expect(res.ok).toBe(true)
  })

  it('omits the header (and warns instead of failing) when signing throws', async () => {
    vi.stubGlobal('crypto', { subtle: { importKey: vi.fn(async () => { throw new Error('nope') }) } })
    setSavedEndpoints([endpoint({ secret: 'shhh' })])
    const [res] = await dispatchEvent(EVENT)
    expect(fetchMock.mock.calls[0][1].headers['X-TyrePulse-Signature']).toBeUndefined()
    expect(res.ok).toBe(true)
  })

  it('signBody returns null without a secret or subtle', async () => {
    await expect(signBody(null, '{}')).resolves.toBeNull()
    vi.stubGlobal('crypto', {})
    await expect(signBody('s', '{}')).resolves.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test deliveries (panel button)
// ─────────────────────────────────────────────────────────────────────────────
describe('sendTestEvent', () => {
  it('delivers a test envelope even to a disabled endpoint', async () => {
    const res = await sendTestEvent(endpoint({ enabled: false }), 'gatepass.issued')
    expect(res.ok).toBe(true)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.type).toBe('gatepass.issued')
    expect(body.payload.test).toBe(true)
  })

  it('still refuses internal targets', async () => {
    const res = await sendTestEvent(endpoint({ url: 'https://localhost/h' }), 'tyre.created')
    expect(res.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
