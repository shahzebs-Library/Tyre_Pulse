// signInWithIdentifier: username sign-in through the `sign-in` edge function.
// The function never returns an email; refusals are already counted
// server-side, so they come back marked `counted`.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
// A rejecting implementation is installed through `throwNext` instead of the
// spy: a vi.fn that returns a rejected promise is reported as unhandled by the
// spy's own result tracking, even when the caller catches it.
let throwNext = null
vi.mock('../lib/api/_client', () => ({
  supabase: {
    functions: {
      invoke: (...a) => {
        if (throwNext) { const e = throwNext; throwNext = null; return Promise.reject(e) }
        return invoke(...a)
      },
    },
    rpc: vi.fn(),
  },
}))

const { signInWithIdentifier } = await import('../lib/api/loginGuard')

const httpError = (body) => ({ context: { json: async () => body, clone: () => ({ json: async () => body }) } })

describe('signInWithIdentifier', () => {
  beforeEach(() => invoke.mockReset())

  it('returns the session on success and sends no email', async () => {
    invoke.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'r', user: { id: 'u' } }, error: null })
    const out = await signInWithIdentifier(' jdoe ', 'pw', 'cap')
    expect(out.session.access_token).toBe('a')
    expect(invoke).toHaveBeenCalledWith('sign-in', { body: { identifier: ' jdoe ', password: 'pw', captcha_token: 'cap' } })
  })

  it('maps invalid_credentials to one counted generic refusal', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError({ error: 'invalid_credentials' }) })
    const out = await signInWithIdentifier('jdoe', 'bad')
    expect(out.error).toMatchObject({ code: 'invalid_credentials', counted: true })
  })

  it('maps locked with its retry window', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError({ error: 'locked', retry_after_seconds: 900 }) })
    const out = await signInWithIdentifier('jdoe', 'bad')
    expect(out.error).toMatchObject({ code: 'login_locked', counted: true, retry_after_seconds: 900 })
  })

  it('treats an unreadable or transport failure as unavailable, never wrong password', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'Failed to send a request' } })
    expect((await signInWithIdentifier('jdoe', 'pw')).error.code).toBe('auth_unavailable')
    throwNext = new Error('network')
    expect((await signInWithIdentifier('jdoe', 'pw')).error.code).toBe('auth_unavailable')
  })
})
