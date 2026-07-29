import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted supabase mock: an rpc() that returns a per-function { data, error }
// result and records every call so the argument mapping can be asserted.
const h = vi.hoisted(() => {
  const state = { results: {}, calls: [] }
  return {
    state,
    supabase: {
      rpc(fn, args) {
        state.calls.push([fn, args])
        const r = fn in state.results ? state.results[fn] : { data: null, error: null }
        return Promise.resolve(r)
      },
    },
  }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const api = await import('../lib/api/accidentPortal')

// PGRST202 (function not in schema cache) is the "not provisioned" signal the
// shared isMissingRelation helper recognises for a missing RPC.
const MISSING = { data: null, error: { message: 'Could not find the function public.accident_portal_create', code: 'PGRST202' } }

beforeEach(() => {
  h.state.results = {}
  h.state.calls = []
})

describe('accidentPortal - createCasePortalLink', () => {
  it('maps to accident_portal_create with the SQL parameter names and returns the payload', async () => {
    h.state.results = { accident_portal_create: { data: { ok: true, id: 's1', token: 'acp_abc' }, error: null } }
    const res = await api.createCasePortalLink('a1', { password: 'secret', expires: '2026-08-01T23:59:59.000Z' })
    expect(res).toEqual({ ok: true, id: 's1', token: 'acp_abc' })
    expect(h.state.calls[0]).toEqual([
      'accident_portal_create',
      { p_accident_id: 'a1', p_password: 'secret', p_expires: '2026-08-01T23:59:59.000Z' },
    ])
  })

  it('sends null for a blank password and a missing expiry', async () => {
    h.state.results = { accident_portal_create: { data: { ok: true, id: 's2', token: 'acp_x' }, error: null } }
    await api.createCasePortalLink('a1', { password: '   ' })
    expect(h.state.calls[0][1]).toEqual({ p_accident_id: 'a1', p_password: null, p_expires: null })
  })

  it('requires an accident id', async () => {
    await expect(api.createCasePortalLink('')).rejects.toThrow(/incident is required/i)
  })

  it('degrades to { ok:false, reason:not_provisioned } when the RPC is not provisioned', async () => {
    h.state.results = { accident_portal_create: MISSING }
    const res = await api.createCasePortalLink('a1')
    expect(res).toEqual({ ok: false, reason: 'not_provisioned' })
  })

  it('surfaces a real (non-missing) error rather than swallowing it', async () => {
    h.state.results = { accident_portal_create: { data: null, error: { message: 'permission denied', code: '42501' } } }
    await expect(api.createCasePortalLink('a1')).rejects.toBeTruthy()
  })
})

describe('accidentPortal - revokeCasePortalLink', () => {
  it('maps to accident_portal_revoke with p_id and returns the payload', async () => {
    h.state.results = { accident_portal_revoke: { data: { ok: true, id: 's1', active: false }, error: null } }
    const res = await api.revokeCasePortalLink('s1')
    expect(res).toEqual({ ok: true, id: 's1', active: false })
    expect(h.state.calls[0]).toEqual(['accident_portal_revoke', { p_id: 's1' }])
  })

  it('requires a portal link id', async () => {
    await expect(api.revokeCasePortalLink('')).rejects.toThrow(/portal link id is required/i)
  })

  it('degrades to { ok:false, reason:not_provisioned } when the RPC is not provisioned', async () => {
    h.state.results = { accident_portal_revoke: { data: null, error: { message: 'relation does not exist', code: 'PGRST202' } } }
    const res = await api.revokeCasePortalLink('s1')
    expect(res).toEqual({ ok: false, reason: 'not_provisioned' })
  })
})

describe('accidentPortal - buildCasePortalUrl', () => {
  it('builds an /accident-portal/<token> URL from the current origin', () => {
    // jsdom provides window.location.origin (http://localhost:3000 by default).
    const url = api.buildCasePortalUrl('acp_abc')
    expect(url.endsWith('/accident-portal/acp_abc')).toBe(true)
  })
})
