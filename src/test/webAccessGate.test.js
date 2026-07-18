import { describe, it, expect } from 'vitest'
import { shouldBlockWeb } from '../components/ProtectedRoute'

// Pure decision for the WEB-only login gate (V278). Block only a regular account
// whose web_access is explicitly false; Admin / super-admin are never blocked and
// null/undefined/true web_access is fail-open (stays on the web).
describe('shouldBlockWeb', () => {
  it('blocks a regular user with web_access === false', () => {
    expect(shouldBlockWeb({ role: 'Inspector', web_access: false })).toBe(true)
    expect(shouldBlockWeb({ role: 'Tyre Man', web_access: false, is_super_admin: false })).toBe(true)
  })

  it('never blocks an Admin', () => {
    expect(shouldBlockWeb({ role: 'Admin', web_access: false })).toBe(false)
  })

  it('never blocks a super-admin (even with a non-Admin role)', () => {
    expect(shouldBlockWeb({ role: 'Manager', web_access: false, is_super_admin: true })).toBe(false)
  })

  it('fails open when web_access is null / undefined / true', () => {
    expect(shouldBlockWeb({ role: 'Inspector', web_access: true })).toBe(false)
    expect(shouldBlockWeb({ role: 'Inspector', web_access: null })).toBe(false)
    expect(shouldBlockWeb({ role: 'Inspector' })).toBe(false)
  })

  it('returns false for a missing profile', () => {
    expect(shouldBlockWeb(null)).toBe(false)
    expect(shouldBlockWeb(undefined)).toBe(false)
  })
})
