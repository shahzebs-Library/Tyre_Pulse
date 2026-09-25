import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  moduleOptions, requesterStatus, canCancel, summarizeMine, ineligibleReason, minutesLeft, REQUESTER_STATUS_META,
} from '../lib/requestAccess'

const NOW = Date.parse('2026-09-25T12:00:00Z')
const iso = (msOffset) => new Date(NOW + msOffset).toISOString()

describe('moduleOptions', () => {
  it('keeps catalog groups and drops invalid keys and empty groups', () => {
    const out = moduleOptions([
      { group: 'A', modules: [{ key: 'tyre_records', label: 'Tyres' }, { key: 'Bad Key!', label: 'x' }] },
      { group: 'B', modules: [{ key: 'NOPE NOPE' }] },
    ])
    expect(out).toEqual([{ group: 'A', modules: [{ key: 'tyre_records', label: 'Tyres' }] }])
  })
  it('defaults to the real catalog, every key server-valid', () => {
    const out = moduleOptions()
    expect(out.length).toBeGreaterThan(0)
    for (const g of out) for (const m of g.modules) expect(m.key).toMatch(/^[a-z0-9_:-]{1,80}$/)
  })
})

describe('requesterStatus', () => {
  it('maps a running approval to active and a past one to expired', () => {
    expect(requesterStatus({ status: 'approved', expires_at: iso(60000) }, NOW)).toBe('active')
    expect(requesterStatus({ status: 'approved', expires_at: iso(-1000) }, NOW)).toBe('expired')
  })
  it('keeps pending, denied and revoked; a stale pending reads lapsed', () => {
    expect(requesterStatus({ status: 'pending', created_at: iso(-3600000) }, NOW)).toBe('pending')
    expect(requesterStatus({ status: 'pending', created_at: iso(-25 * 3600000) }, NOW)).toBe('lapsed')
    expect(requesterStatus({ status: 'denied' }, NOW)).toBe('denied')
    expect(requesterStatus({ status: 'revoked' }, NOW)).toBe('revoked')
    expect(requesterStatus(null)).toBeNull()
  })
  it('has a label for every status it can produce', () => {
    for (const s of ['pending', 'active', 'denied', 'expired', 'revoked', 'cancelled', 'lapsed']) {
      expect(REQUESTER_STATUS_META[s]).toBeTruthy()
    }
  })
  it('only a waiting request can be withdrawn', () => {
    expect(canCancel({ status: 'pending', created_at: iso(-1000) }, NOW)).toBe(true)
    expect(canCancel({ status: 'approved', expires_at: iso(60000) }, NOW)).toBe(false)
  })
})

describe('summarizeMine + minutesLeft', () => {
  it('counts by requester status', () => {
    const rows = [
      { status: 'pending', created_at: iso(-1000) },
      { status: 'approved', expires_at: iso(600000) },
      { status: 'approved', expires_at: iso(-600000) },
      { status: 'denied' },
      { status: 'revoked' },
    ]
    expect(summarizeMine(rows, NOW)).toEqual({ total: 5, pending: 1, active: 1, denied: 1, ended: 2 })
  })
  it('rounds remaining minutes up and is null when not active', () => {
    expect(minutesLeft({ status: 'approved', expires_at: iso(61000) }, NOW)).toBe(2)
    expect(minutesLeft({ status: 'pending' }, NOW)).toBeNull()
  })
})

describe('ineligibleReason', () => {
  it('explains the accounts the server refuses', () => {
    expect(ineligibleReason(null)).toMatch(/Sign in/)
    expect(ineligibleReason({ role: 'Manager' }, true)).toMatch(/Super admins/)
    expect(ineligibleReason({ role: 'Admin' }, false)).toMatch(/Admins/)
    expect(ineligibleReason({ role: 'Manager', approved: false })).toMatch(/approved/)
    expect(ineligibleReason({ role: 'Manager', approved: true, locked: true })).toMatch(/locked/)
    expect(ineligibleReason({ role: 'Tyre Man', approved: true })).toBeNull()
  })
})

const rpc = vi.fn()
vi.mock('../lib/api/_client', () => ({
  supabase: { rpc: (...a) => rpc(...a) },
  unwrap: ({ data, error }) => { if (error) throw error; return data },
  fetchAllPages: vi.fn(),
}))

describe('requester service', () => {
  beforeEach(() => rpc.mockReset())
  it('requestElevation and listMyElevations call their own-rows RPCs', async () => {
    const api = await import('../lib/api/jitElevation')
    rpc.mockResolvedValueOnce({ data: { ok: true, id: 'r1' }, error: null })
    await api.requestElevation({ moduleKey: 'stock', capability: 'edit', minutes: '60', reason: '  count the store  ' })
    expect(rpc).toHaveBeenCalledWith('request_elevation', { p_module_key: 'stock', p_capability: 'edit', p_minutes: 60, p_reason: 'count the store' })
    rpc.mockResolvedValueOnce({ data: [{ id: 'r1' }], error: null })
    expect(await api.listMyElevations()).toEqual([{ id: 'r1' }])
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    await expect(api.listMyElevations()).rejects.toBeTruthy()
  })
})
