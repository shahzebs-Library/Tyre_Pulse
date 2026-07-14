import { describe, it, expect } from 'vitest'
import { resolveCapability, CAPABILITIES } from '../lib/permissionMatrix'

// resolveCapability mirrors AuthContext.resolvePermission's precedence for a
// single capability. Precedence (highest first):
//   Admin/super -> true; 'revoke' -> false; roleAllows -> true;
//   'grant' -> true; else false.
describe('resolveCapability precedence', () => {
  it('Super Admin is always allowed, even with a revoke override', () => {
    expect(resolveCapability({ role: 'Reporter', isSuperAdmin: true, roleAllows: false, override: 'revoke' })).toBe(true)
  })

  it('Admin role is always allowed, even when the role would deny', () => {
    expect(resolveCapability({ role: 'Admin', isSuperAdmin: false, roleAllows: false, override: undefined })).toBe(true)
  })

  it('revoke override beats roleAllows', () => {
    expect(resolveCapability({ role: 'Manager', isSuperAdmin: false, roleAllows: true, override: 'revoke' })).toBe(false)
  })

  it('grant override allows a capability the role denies', () => {
    expect(resolveCapability({ role: 'Inspector', isSuperAdmin: false, roleAllows: false, override: 'grant' })).toBe(true)
  })

  it('roleAllows alone allows (no override)', () => {
    expect(resolveCapability({ role: 'Manager', isSuperAdmin: false, roleAllows: true, override: undefined })).toBe(true)
  })

  it('plain deny when nothing grants it', () => {
    expect(resolveCapability({ role: 'Reporter', isSuperAdmin: false, roleAllows: false, override: undefined })).toBe(false)
  })
})

describe('CAPABILITIES enforcement honesty', () => {
  it('marks only view as server-enforced; the rest are client-gate only', () => {
    const enforced = CAPABILITIES.filter((c) => c.enforced).map((c) => c.key)
    expect(enforced).toEqual(['view'])
    for (const c of CAPABILITIES) {
      if (c.key !== 'view') expect(c.enforced).toBe(false)
    }
  })
})
