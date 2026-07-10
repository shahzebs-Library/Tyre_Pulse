import { describe, it, expect } from 'vitest'
import {
  can,
  cannot,
  resolveEffectivePermissions,
  keyMatches,
  locationAllows,
  tenantAllows,
  normalizeGrants,
  normalizeLocations,
  SCOPES,
} from '../lib/permissions/engine'
import {
  PERMISSIONS,
  ROLE_TEMPLATES,
  ACTIONS,
  MODULES,
  isValidActionKey,
} from '../lib/permissions/registry'

// A record in the same tenant, so tenant isolation never masks a permission
// result unless a test is specifically about tenants.
const CTX = { orgId: 'org1' }
const base = (over = {}) => ({ orgId: 'org1', ...over })

describe('registry catalog', () => {
  it('every canonical key is a well-formed module.resource.action', () => {
    for (const key of PERMISSIONS) {
      const [mod] = key.split('.')
      expect(key.split('.').length).toBe(3)
      expect(MODULES).toContain(mod)
      expect(isValidActionKey(key)).toBe(true)
    }
  })

  it('exposes the full action vocabulary from the spec', () => {
    for (const a of ['view', 'create', 'edit', 'delete', 'approve', 'reject',
      'return', 'assign', 'export', 'print', 'sign', 'upload', 'configure',
      'view_financial']) {
      expect(ACTIONS).toContain(a)
    }
  })
})

describe('keyMatches (wildcards)', () => {
  it('exact match', () => {
    expect(keyMatches('tyres.records.view', 'tyres.records.view')).toBe(true)
    expect(keyMatches('tyres.records.view', 'tyres.records.edit')).toBe(false)
  })
  it('global wildcard', () => {
    expect(keyMatches('*', 'anything.at.all')).toBe(true)
  })
  it('module wildcard', () => {
    expect(keyMatches('tyres.*', 'tyres.records.view')).toBe(true)
    expect(keyMatches('tyres.*', 'tyres.replacement.approve')).toBe(true)
    expect(keyMatches('tyres.*', 'fleet.vehicles.view')).toBe(false)
  })
  it('resource wildcard', () => {
    expect(keyMatches('inspections.daily.*', 'inspections.daily.approve')).toBe(true)
    expect(keyMatches('inspections.daily.*', 'inspections.scheduled.approve')).toBe(false)
  })
  it('does not partial-segment match', () => {
    // 'tyre.*' must not match 'tyres.records.view' (segment boundary honored).
    expect(keyMatches('tyre.*', 'tyres.records.view')).toBe(false)
  })
})

describe('deny-by-default', () => {
  it('an unknown role gets nothing', () => {
    const subject = base({ role: 'Nobody' })
    expect(can(subject, 'tyres.records.view', CTX)).toBe(false)
  })
  it('a role denies a key its template does not list', () => {
    const subject = base({ role: 'Driver' })
    expect(can(subject, 'finance.costs.view_financial', CTX)).toBe(false)
    expect(can(subject, 'admin.users.delete', CTX)).toBe(false)
  })
  it('malformed inputs fail closed', () => {
    expect(can(null, 'tyres.records.view')).toBe(false)
    expect(can(base({ role: 'Admin' }), '')).toBe(false)
    expect(can(base({ role: 'Admin' }), 'notakey')).toBe(false)
    expect(can(base({ role: 'Admin' }), 123)).toBe(false)
  })
  it('cannot() is the inverse of can()', () => {
    const subject = base({ role: 'Inspector' })
    expect(cannot(subject, 'admin.users.delete', CTX)).toBe(true)
    expect(cannot(subject, 'inspections.daily.create', CTX)).toBe(false)
  })
})

describe('role-template grants', () => {
  it('Inspector can create a daily inspection', () => {
    const subject = base({ role: 'Inspector' })
    expect(can(subject, 'inspections.daily.create', CTX)).toBe(true)
  })
  it('Inspector cannot approve a daily inspection (not in template)', () => {
    const subject = base({ role: 'Inspector' })
    expect(can(subject, 'inspections.daily.approve', CTX)).toBe(false)
  })
  it('Tyre Man can upload+sign a daily inspection', () => {
    const subject = base({ role: 'Tyre Man' })
    expect(can(subject, 'inspections.daily.upload', CTX)).toBe(true)
    expect(can(subject, 'inspections.daily.sign', CTX)).toBe(true)
  })
  it('Reporter has reports.* via wildcard but not fleet edits', () => {
    const subject = base({ role: 'Reporter' })
    expect(can(subject, 'reports.executive.export', CTX)).toBe(true)
    expect(can(subject, 'fleet.vehicles.edit', CTX)).toBe(false)
  })
  it('Finance gets financial views others do not', () => {
    const subject = base({ role: 'Finance' })
    expect(can(subject, 'finance.costs.view_financial', CTX)).toBe(true)
    expect(can(subject, 'purchasing.orders.approve', CTX)).toBe(true)
  })
  it('Store Keeper has full inventory + store', () => {
    const subject = base({ role: 'Store Keeper' })
    expect(can(subject, 'inventory.issue.approve', CTX)).toBe(true)
    expect(can(subject, 'store.issuance.sign', CTX)).toBe(true)
  })
  it('multiple roles union their grants', () => {
    const subject = base({ role: 'Driver', roles: ['Reporter'] })
    // Driver can create daily inspections; Reporter adds reports.*
    expect(can(subject, 'inspections.daily.create', CTX)).toBe(true)
    expect(can(subject, 'reports.standard.export', CTX)).toBe(true)
  })
})

describe('module wildcard templates', () => {
  it('Manager holds tyres.* so all tyre actions pass', () => {
    const subject = base({ role: 'Manager' })
    expect(can(subject, 'tyres.replacement.authorize', CTX)).toBe(true)
    expect(can(subject, 'tyres.scrap.sign', CTX)).toBe(true)
  })
  it('Manager lacks admin.* (not granted)', () => {
    const subject = base({ role: 'Manager' })
    expect(can(subject, 'admin.tenants.create', CTX)).toBe(false)
  })
})

describe('explicit overrides', () => {
  it('explicit allow grants a key the role lacks', () => {
    const subject = base({ role: 'Driver', permissions: ['finance.costs.view'] })
    expect(can(subject, 'finance.costs.view', CTX)).toBe(true)
  })
  it('explicit deny beats a role-template allow', () => {
    const subject = base({ role: 'Manager', permissions: { deny: ['tyres.scrap.sign'] } })
    // Manager has tyres.* but the explicit deny removes this exact key.
    expect(can(subject, 'tyres.scrap.sign', CTX)).toBe(false)
    expect(can(subject, 'tyres.records.view', CTX)).toBe(true)
  })
  it('explicit deny beats an explicit allow', () => {
    const subject = base({
      role: 'Driver',
      permissions: { allow: ['finance.costs.view'], deny: ['finance.costs.view'] },
    })
    expect(can(subject, 'finance.costs.view', CTX)).toBe(false)
  })
  it('a wildcard deny removes a whole module', () => {
    const subject = base({ role: 'Manager', permissions: { deny: ['finance.*'] } })
    expect(can(subject, 'finance.costs.view', CTX)).toBe(false)
  })
  it('!prefix array form is treated as deny', () => {
    const g = normalizeGrants(['tyres.records.view', '!tyres.records.delete'])
    expect(g.allow).toContain('tyres.records.view')
    expect(g.deny).toContain('tyres.records.delete')
  })
})

describe('super admin', () => {
  it('Platform Super Admin can do anything within a tenant', () => {
    const subject = base({ role: 'Platform Super Admin', isSuperAdmin: true })
    expect(can(subject, 'admin.tenants.delete', CTX)).toBe(true)
    expect(can(subject, 'finance.costs.view_financial', CTX)).toBe(true)
  })
  it('resolveEffectivePermissions returns [*] for super admin', () => {
    const eff = resolveEffectivePermissions({ isSuperAdmin: true })
    expect(eff.allow).toEqual(['*'])
  })
  it('super admin crosses tenants (isolated global role)', () => {
    const subject = { role: 'Platform Super Admin', isSuperAdmin: true, orgId: 'orgA' }
    expect(can(subject, 'admin.users.view', { orgId: 'orgB' })).toBe(true)
  })
})

describe('tenant isolation', () => {
  it('denies a normal user acting on another tenant', () => {
    const subject = { role: 'Admin', orgId: 'orgA' }
    expect(can(subject, 'admin.users.view', { orgId: 'orgB' })).toBe(false)
  })
  it('allows a normal user acting on their own tenant', () => {
    const subject = { role: 'Admin', orgId: 'orgA' }
    expect(can(subject, 'admin.users.view', { orgId: 'orgA' })).toBe(true)
  })
  it('unknown org on either side defers to RLS (allowed at engine)', () => {
    expect(tenantAllows({ role: 'Admin' }, { orgId: 'orgB' })).toBe(true)
    expect(tenantAllows({ role: 'Admin', orgId: 'orgA' }, {})).toBe(true)
  })
})

describe('location scope', () => {
  it('company-scope grant satisfies any record', () => {
    const subject = base({ role: 'Manager', locations: ['company'] })
    expect(can(subject, 'tyres.records.view', base({ site: 'S1', country: 'AE' }))).toBe(true)
  })
  it('site-scope grant allows the matching site only', () => {
    const subject = base({ role: 'Site Supervisor', locations: [{ scope: 'site', site: 'S1' }] })
    expect(can(subject, 'tyres.records.view', base({ site: 'S1' }))).toBe(true)
    expect(can(subject, 'tyres.records.view', base({ site: 'S2' }))).toBe(false)
  })
  it('country-scope grant allows the matching country only', () => {
    const subject = base({ role: 'Manager', locations: [{ scope: 'country', country: 'AE' }] })
    expect(can(subject, 'fleet.vehicles.view', base({ country: 'AE', site: 'S9' }))).toBe(true)
    expect(can(subject, 'fleet.vehicles.view', base({ country: 'SA' }))).toBe(false)
  })
  it('no location grants defaults to company-wide (back-compat)', () => {
    const subject = base({ role: 'Manager' })
    expect(can(subject, 'tyres.records.view', base({ site: 'S1' }))).toBe(true)
    expect(locationAllows(subject, { site: 'S1' })).toBe(true)
  })
  it('own-record scope requires ownership', () => {
    const owner = base({ role: 'Driver', id: 'u1' })
    const other = base({ role: 'Driver', id: 'u2' })
    const ctx = base({ scope: SCOPES.OWN, ownerId: 'u1' })
    expect(can(owner, 'inspections.daily.view', ctx)).toBe(true)
    expect(can(other, 'inspections.daily.view', ctx)).toBe(false)
  })
  it('own-record scope denies when owner is unknown', () => {
    const subject = base({ role: 'Driver', id: 'u1' })
    expect(can(subject, 'inspections.daily.view', base({ scope: SCOPES.OWN }))).toBe(false)
  })
})

describe('normalizers', () => {
  it('normalizeLocations infers scope from fields', () => {
    expect(normalizeLocations({ site: 'S1' })).toEqual([{ scope: 'site', site: 'S1' }])
    expect(normalizeLocations({ country: 'AE' })).toEqual([{ scope: 'country', country: 'AE' }])
    expect(normalizeLocations('company')).toEqual([{ scope: 'company' }])
    expect(normalizeLocations(null)).toEqual([])
  })
  it('normalizeGrants coerces array to allow-list', () => {
    expect(normalizeGrants(['a.b.c'])).toEqual({ allow: ['a.b.c'], deny: [] })
  })
})

describe('resolveEffectivePermissions', () => {
  it('unions template + explicit allow', () => {
    const eff = resolveEffectivePermissions({ role: 'Driver', permissions: ['x.y.z'] })
    expect(eff.allow).toContain('x.y.z')
    expect(eff.allow).toContain('inspections.daily.create')
  })
  it('every listed role template resolves without error', () => {
    for (const role of Object.keys(ROLE_TEMPLATES)) {
      const eff = resolveEffectivePermissions({ role })
      expect(Array.isArray(eff.allow)).toBe(true)
      expect(eff.allow.length).toBeGreaterThan(0)
    }
  })
})
