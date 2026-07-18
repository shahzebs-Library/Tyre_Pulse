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
  surfaceScopeValues, computeRoleViewChanges,
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

describe('surfaceScopeValues (scope -> per-surface enabled)', () => {
  it('off turns both surfaces off regardless of scope', () => {
    expect(surfaceScopeValues(false, 'web')).toEqual({ web: false, mobile: false })
    expect(surfaceScopeValues(false, 'both')).toEqual({ web: false, mobile: false })
    expect(surfaceScopeValues(false, 'mobile')).toEqual({ web: false, mobile: false })
  })
  it('web-only = web on, mobile off', () => {
    expect(surfaceScopeValues(true, 'web')).toEqual({ web: true, mobile: false })
  })
  it('mobile-only = web off, mobile on', () => {
    expect(surfaceScopeValues(true, 'mobile')).toEqual({ web: false, mobile: true })
  })
  it('both = both on', () => {
    expect(surfaceScopeValues(true, 'both')).toEqual({ web: true, mobile: true })
  })
  it('unknown scope defaults to web', () => {
    expect(surfaceScopeValues(true, undefined)).toEqual({ web: true, mobile: false })
  })
})

describe('computeRoleViewChanges (authoritative role surface writes)', () => {
  const base = { role: 'Manager', draftView: {}, scopeDraft: {}, baselineView: {}, scopeBaseline: {}, roleRows: {} }

  it('web-only narrowing writes mobile disabled (turns the stale mobile surface off)', () => {
    // Baseline is on both surfaces; narrow to web -> mobile must be written false.
    const changes = computeRoleViewChanges({
      ...base,
      draftView: { analytics: true }, scopeDraft: { analytics: 'web' },
      baselineView: { analytics: true }, scopeBaseline: { analytics: 'both' },
      roleRows: { analytics: true, 'mobile:analytics': true },
    })
    expect(changes).toEqual([
      { role: 'Manager', module_key: 'mobile:analytics', enabled: false, nodeKey: 'analytics' },
    ])
  })

  it('mobile-only narrowing writes web disabled (turns the stale web surface off)', () => {
    const changes = computeRoleViewChanges({
      ...base,
      draftView: { analytics: true }, scopeDraft: { analytics: 'mobile' },
      baselineView: { analytics: true }, scopeBaseline: { analytics: 'both' },
      roleRows: { analytics: true, 'mobile:analytics': true },
    })
    expect(changes).toEqual([
      { role: 'Manager', module_key: 'analytics', enabled: false, nodeKey: 'analytics' },
    ])
  })

  it('both writes both surfaces enabled when neither has a row yet', () => {
    // Unconfigured module (baseline scope web via default); widen to both.
    const changes = computeRoleViewChanges({
      ...base,
      draftView: { analytics: true }, scopeDraft: { analytics: 'both' },
      baselineView: { analytics: true }, scopeBaseline: { analytics: 'web' },
      roleRows: {},
    })
    expect(changes).toEqual([
      { role: 'Manager', module_key: 'analytics', enabled: true, nodeKey: 'analytics' },
      { role: 'Manager', module_key: 'mobile:analytics', enabled: true, nodeKey: 'analytics' },
    ])
  })

  it('turning a module off disables both surfaces', () => {
    const changes = computeRoleViewChanges({
      ...base,
      draftView: { analytics: false }, scopeDraft: { analytics: 'both' },
      baselineView: { analytics: true }, scopeBaseline: { analytics: 'both' },
      roleRows: { analytics: true, 'mobile:analytics': true },
    })
    expect(changes).toEqual([
      { role: 'Manager', module_key: 'analytics', enabled: false, nodeKey: 'analytics' },
      { role: 'Manager', module_key: 'mobile:analytics', enabled: false, nodeKey: 'analytics' },
    ])
  })

  it('untouched modules produce no phantom writes', () => {
    const changes = computeRoleViewChanges({
      ...base,
      draftView: { analytics: true, reports: false },
      scopeDraft: { analytics: 'web', reports: 'web' },
      baselineView: { analytics: true, reports: false },
      scopeBaseline: { analytics: 'web', reports: 'web' },
      roleRows: { analytics: true },
    })
    expect(changes).toEqual([])
  })

  it('Admin is always full access, so its edits are ignored', () => {
    const changes = computeRoleViewChanges({
      ...base, role: 'Admin',
      draftView: { analytics: false }, scopeDraft: { analytics: 'mobile' },
      baselineView: { analytics: true }, scopeBaseline: { analytics: 'both' },
      roleRows: { analytics: true, 'mobile:analytics': true },
    })
    expect(changes).toEqual([])
  })

  it('role-wide Mobile-only produces web-off + mobile-on for every changed module', () => {
    // Two enabled modules currently web-scoped; apply Mobile only to the whole
    // role. Mirrors applyRoleSurface: only ENABLED keys get the new scope, so the
    // disabled module keeps its baseline scope and stays untouched.
    const draftView = { analytics: true, reports: true, stock: false }
    const scopeDraft = { analytics: 'mobile', reports: 'mobile', stock: 'web' }
    const baselineView = { analytics: true, reports: true, stock: false }
    const scopeBaseline = { analytics: 'web', reports: 'web', stock: 'web' }
    const roleRows = { analytics: true, reports: true }
    const changes = computeRoleViewChanges({
      role: 'Manager', draftView, scopeDraft, baselineView, scopeBaseline, roleRows,
    })
    // analytics + reports: web off, mobile on. stock is off + untouched -> no write.
    expect(changes).toContainEqual({ role: 'Manager', module_key: 'analytics', enabled: false, nodeKey: 'analytics' })
    expect(changes).toContainEqual({ role: 'Manager', module_key: 'mobile:analytics', enabled: true, nodeKey: 'analytics' })
    expect(changes).toContainEqual({ role: 'Manager', module_key: 'reports', enabled: false, nodeKey: 'reports' })
    expect(changes).toContainEqual({ role: 'Manager', module_key: 'mobile:reports', enabled: true, nodeKey: 'reports' })
    expect(changes.some((c) => c.nodeKey === 'stock')).toBe(false)
    const changedModules = new Set(changes.map((c) => c.nodeKey))
    expect(changedModules).toEqual(new Set(['analytics', 'reports']))
  })
})
