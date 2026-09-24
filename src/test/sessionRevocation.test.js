import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke: h.invoke } } }))

import { revokeUserSessions, readFunctionError, ACCESS_TOKEN_NOTE, REVOCATION_FUNCTION } from '../lib/api/sessionRevocation'

const ID = '11111111-2222-3333-4444-555555555555'

function httpError(body) {
  const res = { json: async () => body }
  res.clone = () => res
  return { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: res }
}

describe('revokeUserSessions', () => {
  beforeEach(() => h.invoke.mockReset())

  it('calls the edge function with the trimmed payload and maps the result', async () => {
    h.invoke.mockResolvedValue({ data: { ok: true, sessions_revoked: 3, locked: true, note: 'server note' }, error: null })
    const r = await revokeUserSessions(` ${ID} `, { reason: '  left company ', lock: true })
    expect(h.invoke).toHaveBeenCalledWith(REVOCATION_FUNCTION, { body: { user_id: ID, reason: 'left company', lock: true } })
    expect(r).toEqual({ ok: true, sessionsRevoked: 3, locked: true, note: 'server note' })
  })

  it('defaults lock to false and falls back to the access-token note', async () => {
    h.invoke.mockResolvedValue({ data: { ok: true, sessions_revoked: 0, locked: false }, error: null })
    const r = await revokeUserSessions(ID, { reason: 'suspicious login' })
    expect(h.invoke.mock.calls[0][1].body.lock).toBe(false)
    expect(r.note).toBe(ACCESS_TOKEN_NOTE)
    expect(r.sessionsRevoked).toBe(0)
  })

  it('validates input without calling the server', async () => {
    expect((await revokeUserSessions('not-a-uuid', { reason: 'abc' })).ok).toBe(false)
    expect((await revokeUserSessions(ID, { reason: ' x ' })).error).toMatch(/reason/i)
    expect((await revokeUserSessions(ID, { reason: 'a'.repeat(501) })).error).toMatch(/too long/i)
    expect((await revokeUserSessions(ID)).ok).toBe(false)
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('surfaces the function JSON error body on failure', async () => {
    h.invoke.mockResolvedValue({ data: null, error: httpError({ ok: false, error: 'Cannot lock the last active super admin.' }) })
    const r = await revokeUserSessions(ID, { reason: 'test reason', lock: true })
    expect(r).toEqual({ ok: false, error: 'Cannot lock the last active super admin.' })
  })

  it('maps a 403 permission message to the safe permission text', async () => {
    h.invoke.mockResolvedValue({ data: null, error: httpError({ ok: false, error: 'Not authorized to revoke these sessions.' }) })
    const r = await revokeUserSessions(ID, { reason: 'test reason' })
    expect(r.error).toBe('You do not have permission to do that.')
  })

  it('never leaks a raw database message', async () => {
    h.invoke.mockResolvedValue({ data: null, error: httpError({ ok: false, error: 'relation "auth.sessions" does not exist' }) })
    const r = await revokeUserSessions(ID, { reason: 'test reason' })
    expect(r.error).toBe('Could not revoke sessions. Please try again.')
  })

  it('handles transport failures', async () => {
    h.invoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to fetch' } })
    expect((await revokeUserSessions(ID, { reason: 'test reason' })).error).toBe('Network error. Check your connection.')
  })

  it('never throws when the client itself rejects', async () => {
    h.invoke.mockImplementationOnce(() => Promise.reject(new TypeError('socket hang up')))
    const r = await revokeUserSessions(ID, { reason: 'test reason' })
    expect(r).toEqual({ ok: false, error: 'socket hang up' })
  })

  it('treats an ok:false data payload as a failure', async () => {
    h.invoke.mockResolvedValue({ data: { ok: false }, error: null })
    const r = await revokeUserSessions(ID, { reason: 'test reason' })
    expect(r).toEqual({ ok: false, error: 'Could not revoke sessions. Please try again.' })
  })
})

describe('readFunctionError', () => {
  it('returns null when there is no readable body', async () => {
    expect(await readFunctionError(null)).toBeNull()
    expect(await readFunctionError({ context: { json: async () => { throw new Error('x') } } })).toBeNull()
    expect(await readFunctionError(httpError({ nope: 1 }))).toBeNull()
  })
})
