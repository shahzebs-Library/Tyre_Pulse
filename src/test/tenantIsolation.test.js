import { describe, it, expect } from 'vitest'
import { resolvePermission } from '../contexts/AuthContext.jsx'
import { resolveCapability } from '../lib/permissionMatrix.js'
import {
  isOrgWideSites,
  withoutOrgWide,
  SITE_ALL_TOKENS,
} from '../lib/scopeSentinel.js'

// Phase-1 access-model invariants. Pure logic only: no live DB, no network.
// These lock in the precedence rules and the site-scope sentinel semantics so a
// future refactor cannot silently widen or narrow tenant isolation.

describe('resolvePermission — precedence (AuthContext)', () => {
  it('Admin role is allowed everything, even a revoke override', () => {
    expect(resolvePermission({ role: 'Admin', isSuperAdmin: false, roleAllows: false, override: 'revoke' })).toBe(true)
    expect(resolvePermission({ role: 'Admin', isSuperAdmin: false, roleAllows: false, override: undefined })).toBe(true)
  })

  it('Super Admin is allowed everything, even a revoke override', () => {
    expect(resolvePermission({ role: 'Reporter', isSuperAdmin: true, roleAllows: false, override: 'revoke' })).toBe(true)
    expect(resolvePermission({ role: 'Tyre Man', isSuperAdmin: true, roleAllows: false, override: undefined })).toBe(true)
  })

  it('revoke beats roleAllows for a non-admin', () => {
    expect(resolvePermission({ role: 'Manager', isSuperAdmin: false, roleAllows: true, override: 'revoke' })).toBe(false)
  })

  it('roleAllows grants access when there is no override', () => {
    expect(resolvePermission({ role: 'Manager', isSuperAdmin: false, roleAllows: true, override: undefined })).toBe(true)
  })

  it('grant adds access on top of a role that does not already allow it', () => {
    expect(resolvePermission({ role: 'Reporter', isSuperAdmin: false, roleAllows: false, override: 'grant' })).toBe(true)
  })

  it('a plain non-super role is NOT widened onto an admin-only module unless explicitly granted', () => {
    // roleAllows=false models an admin-only module the role does not cover.
    expect(resolvePermission({ role: 'Reporter', isSuperAdmin: false, roleAllows: false, override: undefined })).toBe(false)
    expect(resolvePermission({ role: 'Manager', isSuperAdmin: false, roleAllows: false, override: undefined })).toBe(false)
    // Only an explicit grant opens it.
    expect(resolvePermission({ role: 'Manager', isSuperAdmin: false, roleAllows: false, override: 'grant' })).toBe(true)
  })

  it('deny-by-default: unknown/blank inputs resolve to false', () => {
    expect(resolvePermission({ role: 'Reporter', isSuperAdmin: false, roleAllows: false })).toBe(false)
    expect(resolvePermission({ role: undefined, isSuperAdmin: false, roleAllows: undefined, override: undefined })).toBe(false)
  })

  it('precedence is exactly Admin/super > revoke > roleAllows > grant > deny', () => {
    // revoke must beat a grant too (revoke wins whenever present, for non-admins)
    expect(resolvePermission({ role: 'Manager', isSuperAdmin: false, roleAllows: true, override: 'grant' })).toBe(true)
    expect(resolvePermission({ role: 'Manager', isSuperAdmin: false, roleAllows: false, override: 'revoke' })).toBe(false)
  })
})

describe('resolveCapability — precedence (permissionMatrix)', () => {
  it('mirrors resolvePermission precedence', () => {
    expect(resolveCapability({ role: 'Admin', isSuperAdmin: false, roleAllows: false, override: 'revoke' })).toBe(true)
    expect(resolveCapability({ role: 'Reporter', isSuperAdmin: true, roleAllows: false, override: 'revoke' })).toBe(true)
    expect(resolveCapability({ role: 'Manager', isSuperAdmin: false, roleAllows: true, override: 'revoke' })).toBe(false)
    expect(resolveCapability({ role: 'Manager', isSuperAdmin: false, roleAllows: true, override: undefined })).toBe(true)
    expect(resolveCapability({ role: 'Reporter', isSuperAdmin: false, roleAllows: false, override: 'grant' })).toBe(true)
    expect(resolveCapability({ role: 'Reporter', isSuperAdmin: false, roleAllows: false, override: undefined })).toBe(false)
  })

  it('non-super role is not widened without an explicit grant', () => {
    expect(resolveCapability({ role: 'Director', isSuperAdmin: false, roleAllows: false, override: undefined })).toBe(false)
    expect(resolveCapability({ role: 'Director', isSuperAdmin: false, roleAllows: false, override: 'grant' })).toBe(true)
  })
})

describe('scopeSentinel — isOrgWideSites', () => {
  it('blank / empty / non-array is NOT org-wide', () => {
    expect(isOrgWideSites([])).toBe(false)
    expect(isOrgWideSites(null)).toBe(false)
    expect(isOrgWideSites(undefined)).toBe(false)
    expect(isOrgWideSites('ALL')).toBe(false) // a bare string is not an array
    expect(isOrgWideSites({})).toBe(false)
    expect(isOrgWideSites(0)).toBe(false)
  })

  it('an ALL / * sentinel anywhere marks org-wide (case-insensitive, trimmed)', () => {
    expect(isOrgWideSites(['ALL'])).toBe(true)
    expect(isOrgWideSites(['all'])).toBe(true)
    expect(isOrgWideSites(['All'])).toBe(true)
    expect(isOrgWideSites([' all '])).toBe(true)
    expect(isOrgWideSites(['*'])).toBe(true)
    expect(isOrgWideSites(['NHC', '*'])).toBe(true)
    expect(isOrgWideSites(['NHC', 'ALL', 'DHAHBAN'])).toBe(true)
  })

  it('a concrete site list is NOT org-wide', () => {
    expect(isOrgWideSites(['NHC'])).toBe(false)
    expect(isOrgWideSites(['NHC', 'DHAHBAN', 'RED SEA'])).toBe(false)
    expect(isOrgWideSites([''])).toBe(false)
  })
})

describe('scopeSentinel — withoutOrgWide', () => {
  it('strips ALL / * sentinels (case-insensitive, trimmed) and keeps concrete sites', () => {
    expect(withoutOrgWide(['ALL'])).toEqual([])
    expect(withoutOrgWide(['all'])).toEqual([])
    expect(withoutOrgWide(['*'])).toEqual([])
    expect(withoutOrgWide([' ALL '])).toEqual([])
    expect(withoutOrgWide(['NHC', '*'])).toEqual(['NHC'])
    expect(withoutOrgWide(['NHC', 'ALL', 'DHAHBAN'])).toEqual(['NHC', 'DHAHBAN'])
  })

  it('leaves a pure concrete list untouched', () => {
    expect(withoutOrgWide(['NHC'])).toEqual(['NHC'])
    expect(withoutOrgWide(['NHC', 'DHAHBAN'])).toEqual(['NHC', 'DHAHBAN'])
  })

  it('non-array / empty input yields an empty array', () => {
    expect(withoutOrgWide(null)).toEqual([])
    expect(withoutOrgWide(undefined)).toEqual([])
    expect(withoutOrgWide('NHC')).toEqual([])
    expect(withoutOrgWide([])).toEqual([])
    expect(withoutOrgWide({})).toEqual([])
  })
})

describe('scopeSentinel — consistency invariant', () => {
  it('SITE_ALL_TOKENS covers the recognised sentinels', () => {
    expect(SITE_ALL_TOKENS).toContain('ALL')
    expect(SITE_ALL_TOKENS).toContain('*')
  })

  it('withoutOrgWide result is never itself org-wide', () => {
    const samples = [['ALL'], ['NHC', '*'], ['a', 'ALL', 'b'], [], null]
    for (const s of samples) {
      expect(isOrgWideSites(withoutOrgWide(s))).toBe(false)
    }
  })
})
