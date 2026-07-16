import { describe, it, expect } from 'vitest'
import {
  ADMIN_ROLES,
  ADMIN_ROLE_META,
  ADMIN_CAPABILITIES,
  canonAdminRole,
  adminCan,
  adminRoleAtLeast,
  regionScopeApplies,
} from './adminRoles.js'

const ALL_CAPS = Object.keys(ADMIN_CAPABILITIES)

describe('adminRoles constants', () => {
  it('exports exactly the three tiers in the documented order', () => {
    expect(ADMIN_ROLES).toEqual(['super_admin', 'regional_admin', 'viewer'])
  })

  it('meta covers every role with a distinct rank', () => {
    for (const r of ADMIN_ROLES) expect(ADMIN_ROLE_META[r]).toBeTruthy()
    expect(ADMIN_ROLE_META.super_admin.rank).toBe(3)
    expect(ADMIN_ROLE_META.regional_admin.rank).toBe(2)
    expect(ADMIN_ROLE_META.viewer.rank).toBe(1)
  })

  it('capability matrix exposes the nine expected keys', () => {
    expect(new Set(ALL_CAPS)).toEqual(
      new Set([
        'view_health',
        'view_logs',
        'resolve_logs',
        'view_backups',
        'create_backup',
        'restore_backup',
        'manage_admins',
        'view_config',
        'edit_config',
      ]),
    )
  })
})

describe('canonAdminRole', () => {
  it('passes through valid tokens', () => {
    expect(canonAdminRole('super_admin')).toBe('super_admin')
    expect(canonAdminRole('regional_admin')).toBe('regional_admin')
    expect(canonAdminRole('viewer')).toBe('viewer')
  })

  it('folds case, spaces and hyphens', () => {
    expect(canonAdminRole('Super Admin')).toBe('super_admin')
    expect(canonAdminRole('super-admin')).toBe('super_admin')
    expect(canonAdminRole('  SUPER_ADMIN  ')).toBe('super_admin')
    expect(canonAdminRole('Regional-Admin')).toBe('regional_admin')
    expect(canonAdminRole('VIEWER')).toBe('viewer')
  })

  it('defaults unknown / empty / null to viewer', () => {
    expect(canonAdminRole('wizard')).toBe('viewer')
    expect(canonAdminRole('')).toBe('viewer')
    expect(canonAdminRole('   ')).toBe('viewer')
    expect(canonAdminRole(null)).toBe('viewer')
    expect(canonAdminRole(undefined)).toBe('viewer')
  })
})

describe('adminCan', () => {
  it('super_admin can do every capability', () => {
    for (const cap of ALL_CAPS) expect(adminCan('super_admin', cap)).toBe(true)
  })

  it('viewer can only view_health / view_logs / view_backups / view_config', () => {
    const allowed = new Set(['view_health', 'view_logs', 'view_backups', 'view_config'])
    for (const cap of ALL_CAPS) {
      expect(adminCan('viewer', cap)).toBe(allowed.has(cap))
    }
  })

  it('regional_admin can view_health / view_logs / resolve_logs / view_backups / view_config only', () => {
    const allowed = new Set([
      'view_health',
      'view_logs',
      'resolve_logs',
      'view_backups',
      'view_config',
    ])
    for (const cap of ALL_CAPS) {
      expect(adminCan('regional_admin', cap)).toBe(allowed.has(cap))
    }
  })

  it('regional_admin cannot do app-wide privileged actions', () => {
    expect(adminCan('regional_admin', 'create_backup')).toBe(false)
    expect(adminCan('regional_admin', 'restore_backup')).toBe(false)
    expect(adminCan('regional_admin', 'manage_admins')).toBe(false)
    expect(adminCan('regional_admin', 'edit_config')).toBe(false)
  })

  it('folds the role before checking', () => {
    expect(adminCan('Super Admin', 'edit_config')).toBe(true)
    expect(adminCan('Regional-Admin', 'resolve_logs')).toBe(true)
  })

  it('unknown capability returns false', () => {
    expect(adminCan('super_admin', 'launch_missiles')).toBe(false)
    expect(adminCan('super_admin', '')).toBe(false)
    expect(adminCan('viewer', undefined)).toBe(false)
  })

  it('unknown role folds to viewer', () => {
    expect(adminCan('nobody', 'view_health')).toBe(true)
    expect(adminCan('nobody', 'resolve_logs')).toBe(false)
  })
})

describe('adminRoleAtLeast', () => {
  it('compares by rank', () => {
    expect(adminRoleAtLeast('super_admin', 'viewer')).toBe(true)
    expect(adminRoleAtLeast('super_admin', 'regional_admin')).toBe(true)
    expect(adminRoleAtLeast('regional_admin', 'viewer')).toBe(true)
    expect(adminRoleAtLeast('regional_admin', 'super_admin')).toBe(false)
    expect(adminRoleAtLeast('viewer', 'regional_admin')).toBe(false)
  })

  it('is reflexive for equal ranks', () => {
    for (const r of ADMIN_ROLES) expect(adminRoleAtLeast(r, r)).toBe(true)
  })

  it('folds both arguments', () => {
    expect(adminRoleAtLeast('Super Admin', 'Viewer')).toBe(true)
    expect(adminRoleAtLeast('unknown', 'viewer')).toBe(true)
    expect(adminRoleAtLeast('unknown', 'regional_admin')).toBe(false)
  })
})

describe('regionScopeApplies', () => {
  it('is true only for regional_admin', () => {
    expect(regionScopeApplies('regional_admin')).toBe(true)
    expect(regionScopeApplies('super_admin')).toBe(false)
    expect(regionScopeApplies('viewer')).toBe(false)
  })

  it('folds the input and defaults safely', () => {
    expect(regionScopeApplies('Regional-Admin')).toBe(true)
    expect(regionScopeApplies('nonsense')).toBe(false)
    expect(regionScopeApplies(null)).toBe(false)
  })
})
