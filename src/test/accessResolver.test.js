import { describe, it, expect } from 'vitest'
import {
  resolveAccess,
  overrideToFlags,
  ACCESS_REASON,
  isOrgWideSites,
  withoutOrgWide,
  SITE_ALL_TOKENS,
} from '../lib/accessResolver'
import { resolvePermission } from '../contexts/AuthContext'
import { resolveCapability } from '../lib/permissionMatrix'

// ── Precedence (canonical) ───────────────────────────────────────────────────
describe('resolveAccess — canonical precedence', () => {
  it('1. Admin role always allows (beats a revoke)', () => {
    const r = resolveAccess({ role: 'Admin', roleAllows: false, revoke: true })
    expect(r.allowed).toBe(true)
    expect(r.reason).toBe(ACCESS_REASON.ADMIN)
  })

  it('1. super-admin always allows (beats a revoke)', () => {
    const r = resolveAccess({ role: 'Reporter', isSuperAdmin: true, roleAllows: false, revoke: true })
    expect(r.allowed).toBe(true)
    expect(r.reason).toBe(ACCESS_REASON.ADMIN)
  })

  it('2. explicit revoke denies a role that would otherwise allow', () => {
    const r = resolveAccess({ role: 'Manager', roleAllows: true, revoke: true })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe(ACCESS_REASON.REVOKE)
  })

  it('2. revoke beats a simultaneous grant', () => {
    const r = resolveAccess({ role: 'Reporter', roleAllows: false, grant: true, revoke: true })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe(ACCESS_REASON.REVOKE)
  })

  it('3. explicit grant allows when the role does not', () => {
    const r = resolveAccess({ role: 'Reporter', roleAllows: false, grant: true })
    expect(r.allowed).toBe(true)
    expect(r.reason).toBe(ACCESS_REASON.GRANT)
  })

  it('4. role allows when there is no override', () => {
    const r = resolveAccess({ role: 'Manager', roleAllows: true })
    expect(r.allowed).toBe(true)
    expect(r.reason).toBe(ACCESS_REASON.ROLE)
  })

  it('5. deny-by-default when nothing grants it', () => {
    const r = resolveAccess({ role: 'Reporter', roleAllows: false })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe(ACCESS_REASON.DEFAULT)
  })

  it('carries moduleKey and capability through untouched', () => {
    const r = resolveAccess({ role: 'Manager', moduleKey: 'tyre_records', capability: 'edit', roleAllows: true })
    expect(r.moduleKey).toBe('tyre_records')
    expect(r.capability).toBe('edit')
  })

  it('defaults capability to view', () => {
    expect(resolveAccess({ role: 'Reporter', roleAllows: true }).capability).toBe('view')
  })

  it('handles empty / undefined input as deny-by-default', () => {
    expect(resolveAccess().allowed).toBe(false)
    expect(resolveAccess({}).allowed).toBe(false)
    expect(resolveAccess({}).reason).toBe(ACCESS_REASON.DEFAULT)
  })

  it('treats non-strict-true flags as absent (only === true counts)', () => {
    expect(resolveAccess({ role: 'X', roleAllows: 1 }).allowed).toBe(false)
    expect(resolveAccess({ role: 'X', roleAllows: false, grant: 1 }).allowed).toBe(false)
    expect(resolveAccess({ role: 'X', roleAllows: true, revoke: 'yes' }).allowed).toBe(true)
    expect(resolveAccess({ role: 'X', isSuperAdmin: 'true', roleAllows: false }).allowed).toBe(false)
  })
})

// ── overrideToFlags helper ───────────────────────────────────────────────────
describe('overrideToFlags', () => {
  it('maps the legacy override union to {grant,revoke}', () => {
    expect(overrideToFlags('grant')).toEqual({ grant: true, revoke: false })
    expect(overrideToFlags('revoke')).toEqual({ grant: false, revoke: true })
    expect(overrideToFlags(undefined)).toEqual({ grant: false, revoke: false })
    expect(overrideToFlags(null)).toEqual({ grant: false, revoke: false })
    expect(overrideToFlags('nonsense')).toEqual({ grant: false, revoke: false })
  })
})

// ── Parity: resolveAccess must agree with BOTH legacy resolvers ───────────────
describe('resolveAccess — parity with resolvePermission & resolveCapability', () => {
  const roles = ['Admin', 'Manager', 'Director', 'Reporter', 'Inspector', 'Tyre Man', 'Driver', undefined]
  const supers = [true, false, undefined]
  const allows = [true, false, undefined]
  const overrides = ['grant', 'revoke', undefined]

  it('agrees on the full cartesian matrix of inputs', () => {
    let checked = 0
    for (const role of roles) {
      for (const isSuperAdmin of supers) {
        for (const roleAllows of allows) {
          for (const override of overrides) {
            const legacyPerm = resolvePermission({ role, isSuperAdmin, roleAllows, override })
            const legacyCap = resolveCapability({ role, isSuperAdmin, roleAllows, override })
            // Both legacy functions must themselves agree (they are identical).
            expect(legacyCap).toBe(legacyPerm)

            const { grant, revoke } = overrideToFlags(override)
            const canonical = resolveAccess({ role, isSuperAdmin, roleAllows, grant, revoke })
            expect(canonical.allowed).toBe(legacyPerm)
            checked += 1
          }
        }
      }
    }
    // 8 roles * 3 supers * 3 allows * 3 overrides
    expect(checked).toBe(roles.length * supers.length * allows.length * overrides.length)
  })
})

// ── Re-exported scope sentinel helpers (single import surface) ────────────────
describe('accessResolver re-exports scopeSentinel helpers', () => {
  it('exposes SITE_ALL_TOKENS', () => {
    expect(SITE_ALL_TOKENS).toEqual(['ALL', '*'])
  })

  it('isOrgWideSites detects ALL/* sentinels', () => {
    expect(isOrgWideSites(['ALL'])).toBe(true)
    expect(isOrgWideSites(['*'])).toBe(true)
    expect(isOrgWideSites([' all '])).toBe(true)
    expect(isOrgWideSites(['DHAHBAN'])).toBe(false)
    expect(isOrgWideSites([])).toBe(false)
    expect(isOrgWideSites(null)).toBe(false)
  })

  it('withoutOrgWide strips sentinels, keeps concrete sites', () => {
    expect(withoutOrgWide(['ALL', 'DHAHBAN', '*'])).toEqual(['DHAHBAN'])
    expect(withoutOrgWide(['METRO', 'NHC'])).toEqual(['METRO', 'NHC'])
    expect(withoutOrgWide(null)).toEqual([])
  })
})
