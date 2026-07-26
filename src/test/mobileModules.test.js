import { describe, it, expect } from 'vitest'
import {
  MOBILE_MODULES, MOBILE_MODULE_BY_KEY, MOBILE_MODULES_BY_GROUP,
  mobileModuleDefaultAllows, webRoleToMobileRole, mobileModuleRoles,
} from '../lib/mobileModules'

describe('mobileModules catalog', () => {
  it('mirrors the mobile registry: 30 modules, unique keys, grouped', () => {
    expect(MOBILE_MODULES).toHaveLength(30)
    const keys = MOBILE_MODULES.map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
    // the key strings that mobile matches on must be present verbatim.
    // 'workshop' (My Jobs) was missing from this mirror, so the web Access
    // Manager could not allow or deny the mobile Workshop module at all.
    for (const k of ['inspect', 'scan', 'records', 'checklists', 'meter', 'washing', 'reportAccident', 'workorders', 'pm', 'workshop', 'approvals', 'admin']) {
      expect(keys).toContain(k)
    }
    // groups preserved in order
    expect(MOBILE_MODULES_BY_GROUP.map((g) => g.group)).toEqual(['Field', 'Fleet', 'Maintenance', 'Management', 'Admin'])
    const total = MOBILE_MODULES_BY_GROUP.reduce((n, g) => n + g.modules.length, 0)
    expect(total).toBe(MOBILE_MODULES.length)
  })

  it('every module has a label and a roles array', () => {
    for (const m of MOBILE_MODULES) {
      expect(typeof m.label).toBe('string')
      expect(m.label.length).toBeGreaterThan(0)
      expect(Array.isArray(m.roles)).toBe(true)
      expect(MOBILE_MODULE_BY_KEY[m.key]).toBe(m)
    }
  })

  it('webRoleToMobileRole lowercases + underscores (Tyre Man -> tyre_man)', () => {
    expect(webRoleToMobileRole('Tyre Man')).toBe('tyre_man')
    expect(webRoleToMobileRole('Manager')).toBe('manager')
    expect(webRoleToMobileRole('Admin')).toBe('admin')
    expect(webRoleToMobileRole('')).toBe('')
    expect(webRoleToMobileRole(null)).toBe('')
  })

  it('mobileModuleDefaultAllows honors the role list, Admin always allowed', () => {
    // scan default roles include inspector + tyre_man, not reporter/driver
    expect(mobileModuleDefaultAllows('scan', 'Inspector')).toBe(true)
    expect(mobileModuleDefaultAllows('scan', 'Tyre Man')).toBe(true)
    expect(mobileModuleDefaultAllows('scan', 'Reporter')).toBe(false)
    expect(mobileModuleDefaultAllows('scan', 'Driver')).toBe(false)
    // Data-heavy modules are ADMIN-ONLY (roles: []): mobile is a field-capture
    // app, and these pulled whole tables onto the handset. Manager no longer
    // gets Analytics by default; an admin can still grant it per user.
    expect(mobileModuleDefaultAllows('analytics', 'Admin')).toBe(true)
    expect(mobileModuleDefaultAllows('analytics', 'Manager')).toBe(false)
    expect(mobileModuleDefaultAllows('analytics', 'Director')).toBe(false)
    expect(mobileModuleDefaultAllows('records', 'Manager')).toBe(false)
    expect(mobileModuleDefaultAllows('overview', 'Manager')).toBe(false)
    // Serial search stays open to the field roles: it is one indexed lookup,
    // not a bulk load, and the yard needs it.
    expect(mobileModuleDefaultAllows('serial', 'Tyre Man')).toBe(true)
    expect(mobileModuleDefaultAllows('serial', 'Driver')).toBe(true)
    // Admin always allowed even on a roles:[] module (users)
    expect(mobileModuleDefaultAllows('users', 'Admin')).toBe(true)
    expect(mobileModuleDefaultAllows('users', 'Manager')).toBe(false)
    // washing includes driver
    expect(mobileModuleDefaultAllows('washing', 'Driver')).toBe(true)
    // unknown key -> false
    expect(mobileModuleDefaultAllows('nope', 'Manager')).toBe(false)
  })

  it('mobileModuleRoles returns the module role tokens ([] for unknown)', () => {
    expect(mobileModuleRoles('meter')).toContain('driver')
    expect(mobileModuleRoles('nope')).toEqual([])
  })
})
