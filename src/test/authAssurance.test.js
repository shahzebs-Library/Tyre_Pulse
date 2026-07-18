import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock only the MFA assurance surface of the shared Supabase client.
const h = vi.hoisted(() => {
  const state = { aal: { data: null, error: null }, throws: false }
  return {
    state,
    supabase: {
      auth: {
        mfa: {
          getAuthenticatorAssuranceLevel: () => {
            if (state.throws) return Promise.reject(new Error('network'))
            return Promise.resolve(state.aal)
          },
        },
      },
    },
  }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { hasUnmetMfa } = await import('../lib/authAssurance')

beforeEach(() => {
  h.state.aal = { data: null, error: null }
  h.state.throws = false
})

describe('hasUnmetMfa - password-only (AAL1) session detection', () => {
  it('is TRUE when MFA is enrolled but not completed (aal1 while aal2 required)', async () => {
    h.state.aal = { data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null }
    expect(await hasUnmetMfa()).toBe(true)
  })

  it('is FALSE once MFA is completed (aal2 reached)', async () => {
    h.state.aal = { data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null }
    expect(await hasUnmetMfa()).toBe(false)
  })

  it('is FALSE for a user with no MFA enrolled (aal1/aal1)', async () => {
    h.state.aal = { data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }
    expect(await hasUnmetMfa()).toBe(false)
  })

  it('fails OPEN (false) on an API error so a normal user is never locked out', async () => {
    h.state.aal = { data: null, error: { message: 'boom' } }
    expect(await hasUnmetMfa()).toBe(false)
  })

  it('fails OPEN (false) when the call throws', async () => {
    h.state.throws = true
    expect(await hasUnmetMfa()).toBe(false)
  })

  it('fails OPEN (false) on a malformed/empty response', async () => {
    h.state.aal = { data: undefined, error: null }
    expect(await hasUnmetMfa()).toBe(false)
  })
})
