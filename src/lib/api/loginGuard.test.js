import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = { rpc: {} } // name -> { data, error } | throws
  return {
    state,
    supabase: {
      rpc: vi.fn(async (name) => {
        const r = state.rpc[name]
        if (r && r.throw) throw new Error('boom')
        return r || { data: null, error: null }
      }),
    },
  }
})

vi.mock('./_client', () => ({ supabase: h.supabase }))

const api = await import('./loginGuard')

beforeEach(() => { h.state.rpc = {}; h.supabase.rpc.mockClear() })

describe('loginGuard — fail-safe wrappers', () => {
  it('loginAttemptStatus returns the RPC payload', async () => {
    h.state.rpc.login_attempt_status = { data: { enabled: true, locked: true, retry_after_seconds: 900 }, error: null }
    const s = await api.loginAttemptStatus('bob')
    expect(s.locked).toBe(true)
    expect(h.supabase.rpc).toHaveBeenCalledWith('login_attempt_status', { p_identifier: 'bob' })
  })

  it('loginAttemptStatus fails safe (not locked) on error or throw', async () => {
    h.state.rpc.login_attempt_status = { data: null, error: { message: 'x' } }
    expect(await api.loginAttemptStatus('bob')).toEqual({ enabled: false, locked: false })
    h.state.rpc.login_attempt_status = { throw: true }
    expect(await api.loginAttemptStatus('bob')).toEqual({ enabled: false, locked: false })
  })

  it('recordLoginFailure returns the lock state and fails safe', async () => {
    h.state.rpc.record_login_failure = { data: { enabled: true, locked: false, remaining: 3 }, error: null }
    expect((await api.recordLoginFailure('bob')).remaining).toBe(3)
    h.state.rpc.record_login_failure = { throw: true }
    expect(await api.recordLoginFailure('bob')).toEqual({ enabled: false, locked: false })
  })

  it('resetLoginAttempts never throws', async () => {
    h.state.rpc.reset_login_attempts = { throw: true }
    await expect(api.resetLoginAttempts()).resolves.toBeUndefined()
  })

  it('lockMinutes rounds up to whole minutes, min 1', () => {
    expect(api.lockMinutes({ retry_after_seconds: 900 })).toBe(15)
    expect(api.lockMinutes({ retry_after_seconds: 61 })).toBe(2)
    expect(api.lockMinutes({ retry_after_seconds: 0 })).toBe(1)
    expect(api.lockMinutes(null)).toBe(1)
  })

  it('coerces a nullish identifier to an empty string', async () => {
    h.state.rpc.login_attempt_status = { data: { locked: false }, error: null }
    await api.loginAttemptStatus(undefined)
    expect(h.supabase.rpc).toHaveBeenCalledWith('login_attempt_status', { p_identifier: '' })
  })
})
