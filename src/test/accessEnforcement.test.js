import { describe, it, expect } from 'vitest'
import { resolvePermission } from '../contexts/AuthContext'

/**
 * Exercises the REAL permission-merge resolver used inside
 * AuthContext.hasPermission, covering the frozen precedence:
 *   Admin/super > revoke > role-allows > grant > deny.
 */
describe('resolvePermission — role + per-user grant override merge', () => {
  it('Admin role is always allowed, even against a revoke override', () => {
    expect(resolvePermission({ role: 'Admin', isSuperAdmin: false, roleAllows: false, override: 'revoke' })).toBe(true)
    expect(resolvePermission({ role: 'Admin', isSuperAdmin: false, roleAllows: false, override: undefined })).toBe(true)
  })

  it('Super Admin is always allowed, even against a revoke override', () => {
    expect(resolvePermission({ role: 'Reporter', isSuperAdmin: true, roleAllows: false, override: 'revoke' })).toBe(true)
  })

  it('revoke override forces false for a non-admin even when the role allows it', () => {
    expect(resolvePermission({ role: 'Manager', isSuperAdmin: false, roleAllows: true, override: 'revoke' })).toBe(false)
  })

  it('grant override adds access when the role denies it', () => {
    expect(resolvePermission({ role: 'Reporter', isSuperAdmin: false, roleAllows: false, override: 'grant' })).toBe(true)
  })

  it('plain role verdict passes through with no override', () => {
    expect(resolvePermission({ role: 'Manager', isSuperAdmin: false, roleAllows: true, override: undefined })).toBe(true)
    expect(resolvePermission({ role: 'Inspector', isSuperAdmin: false, roleAllows: false, override: undefined })).toBe(false)
  })

  it('grant does not override an explicit revoke (revoke has higher precedence)', () => {
    // A key cannot be both, but defense-in-depth: revoke wins over role, and
    // grant only applies when there is no revoke.
    expect(resolvePermission({ role: 'Manager', isSuperAdmin: false, roleAllows: false, override: 'revoke' })).toBe(false)
  })
})
