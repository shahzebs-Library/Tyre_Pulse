/**
 * Role-level Web / Mobile / Both surface scope for the Access Manager.
 *
 * Covers the pure mapping that backs the ROLE-mode scope selector:
 *   - scope -> module_permissions row keys (grantKeysForScope)
 *   - existing role rows -> detected scope (roleScopeForKey)
 *   - the web permission reader safely IGNORES `mobile:` prefixed rows.
 */
import { describe, it, expect } from 'vitest'
import {
  MOBILE_GRANT_PREFIX, mobileGrantKey, isMobileGrantKey,
  grantKeysForScope, parseGrantScope, roleScopeForKey,
} from '../lib/api/accessGrants'
import { NAV_MODULE_KEY } from '../lib/navAccess'

describe('grantKeysForScope (scope -> rows)', () => {
  it('web writes only the plain key', () => {
    expect(grantKeysForScope('analytics', 'web')).toEqual(['analytics'])
  })
  it('mobile writes only the mobile: key', () => {
    expect(grantKeysForScope('analytics', 'mobile')).toEqual(['mobile:analytics'])
  })
  it('both writes plain and mobile: keys', () => {
    expect(grantKeysForScope('analytics', 'both')).toEqual(['analytics', 'mobile:analytics'])
  })
  it('defaults an unknown scope to web', () => {
    expect(grantKeysForScope('analytics', undefined)).toEqual(['analytics'])
  })
  it('carries composite sub-module keys through the prefix', () => {
    expect(grantKeysForScope('accidents:builder', 'both'))
      .toEqual(['accidents:builder', 'mobile:accidents:builder'])
  })
})

describe('roleScopeForKey (rows -> scope)', () => {
  it('plain row only -> web', () => {
    expect(roleScopeForKey({ analytics: true }, 'analytics')).toBe('web')
  })
  it('mobile row only -> mobile', () => {
    expect(roleScopeForKey({ 'mobile:analytics': true }, 'analytics')).toBe('mobile')
  })
  it('both rows -> both (even when the two values differ)', () => {
    expect(roleScopeForKey({ analytics: true, 'mobile:analytics': false }, 'analytics')).toBe('both')
  })
  it('presence, not value, drives detection (a false plain row is still web)', () => {
    expect(roleScopeForKey({ analytics: false }, 'analytics')).toBe('web')
  })
  it('no row on either surface -> null (caller defaults the selector)', () => {
    expect(roleScopeForKey({ other: true }, 'analytics')).toBeNull()
    expect(roleScopeForKey({}, 'analytics')).toBeNull()
    expect(roleScopeForKey(null, 'analytics')).toBeNull()
  })
})

describe('parseGrantScope', () => {
  it('resolves each surface combination', () => {
    expect(parseGrantScope('grant', null)).toBe('web')
    expect(parseGrantScope(null, 'revoke')).toBe('mobile')
    expect(parseGrantScope('grant', 'grant')).toBe('both')
    expect(parseGrantScope(null, null)).toBeNull()
  })
})

describe('web reader skips mobile: rows', () => {
  it('identifies mobile-prefixed keys', () => {
    expect(isMobileGrantKey(mobileGrantKey('analytics'))).toBe(true)
    expect(isMobileGrantKey('analytics')).toBe(false)
    expect(isMobileGrantKey(null)).toBe(false)
  })

  it('no web nav module key is ever a mobile: key (they can never collide)', () => {
    for (const key of Object.values(NAV_MODULE_KEY)) {
      expect(key.startsWith(MOBILE_GRANT_PREFIX)).toBe(false)
    }
  })

  it('a mobile: role row never changes the plain web-key verdict', () => {
    // Simulates the modulePerms map the web hasPermission reads: keyed lookups on
    // PLAIN keys only, so a mobile:analytics=false row cannot flip web analytics.
    const modulePerms = { analytics: true, 'mobile:analytics': false }
    const webKeyed = (k) => modulePerms[k] === true
    expect(webKeyed('analytics')).toBe(true) // unaffected by mobile:analytics=false
    // And stripping mobile: rows out leaves exactly the web keys.
    const webOnly = Object.keys(modulePerms).filter((k) => !isMobileGrantKey(k))
    expect(webOnly).toEqual(['analytics'])
  })
})
