import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  MOBILE_MODULES, MOBILE_MODULE_BY_KEY, MOBILE_MODULES_BY_GROUP,
  mobileModuleDefaultAllows, webRoleToMobileRole, mobileModuleRoles,
} from '../lib/mobileModules'

describe('mobileModules catalog', () => {
  it('mirrors the Flutter registry: 31 modules, unique keys, grouped', () => {
    expect(MOBILE_MODULES).toHaveLength(31)
    const keys = MOBILE_MODULES.map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
    // the key strings that mobile matches on must be present verbatim.
    // 'workshop' (My Jobs) was missing from this mirror, so the web Access
    // Manager could not allow or deny the mobile Workshop module at all.
    for (const k of ['inspect', 'scan', 'records', 'checklists', 'meter', 'washing', 'reportAccident', 'workorders', 'pm', 'workshop', 'approvals', 'admin', 'repairRequest']) {
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

/**
 * DRIFT GUARD. The Flutter app is the only field app (owner rule 2026-10-04),
 * so this mirror is compared against its registry:
 * tyre_pulse_flutter/lib/core/permissions/module_registry.dart. The retired
 * Expo registry (mobile/lib/permissions.ts) is no longer the source of truth.
 * Effective role defaults = ModuleDef.defaultRoles + flutterRoleDefaultExtensions.
 */
describe('mirror does not drift from the Flutter module registry', () => {
  const root = resolve(__dirname, '../../tyre_pulse_flutter/lib/core/permissions')
  const registry = readFileSync(resolve(root, 'module_registry.dart'), 'utf8').replace(/\r\n/g, '\n')
  const roles = readFileSync(resolve(root, 'roles.dart'), 'utf8').replace(/\r\n/g, '\n')

  // RoleId enum: camelName(token: 'snake', ...)
  const token = Object.fromEntries([...roles.matchAll(/^\s*([a-zA-Z]+)\(\s*token:\s*'([a-z_]+)'/gm)].map(([, n, t]) => [n, t]))
  const roleSet = (body) => [...body.matchAll(/RoleId\.([a-zA-Z]+)/g)].map(([, n]) => token[n] || `?${n}`)

  // Only the ModuleRegistry.all list, not the doc comments above it.
  const allBlock = registry.slice(registry.indexOf('static const List<ModuleDef> all'), registry.indexOf('static const Set<ModuleKey> sensitive'))
  const flutter = {}
  for (const [, kind, body] of allBlock.matchAll(/ModuleDef\.(forRoles|adminOnly)\(([\s\S]*?)\),\n/g)) {
    const key = body.match(/key:\s*ModuleKey\.([a-zA-Z]+)/)[1]
    const label = body.match(/defaultLabel:\s*'([^']*)'/)[1]
    const group = body.match(/group:\s*ModuleGroup\.([a-zA-Z]+)/)[1]
    flutter[key] = { label, group, roles: kind === 'adminOnly' ? [] : roleSet(body.slice(body.indexOf('defaultRoles'))) }
  }
  const extBlock = registry.slice(registry.indexOf('flutterRoleDefaultExtensions ='), registry.indexOf('/// The registry itself.'))
  for (const [, key, body] of extBlock.matchAll(/ModuleKey\.([a-zA-Z]+):\s*<RoleId>\{([^}]*)\}/g)) {
    flutter[key].roles = [...new Set([...flutter[key].roles, ...roleSet(body)])]
  }
  const groupName = Object.fromEntries([...registry.matchAll(/^\s*([a-z]+)\('([A-Za-z]+)'\)[,;]/gm)].map(([, n, label]) => [n, label]))
  const aliasBlock = registry.slice(registry.indexOf('webModuleKeyAliases ='), registry.indexOf('ModuleKey? moduleKeyFromMobileAliasKey'))
  const aliases = Object.fromEntries([...aliasBlock.matchAll(/'([a-z_]+)':\s*ModuleKey\.([a-zA-Z]+)/g)].map(([, w, k]) => [w, k]))

  it('found the Flutter registry to compare against', () => {
    // If the Dart shape ever changes this parse yields {} and every assertion
    // below would vacuously pass, so prove it actually read something.
    expect(Object.keys(flutter)).toHaveLength(31)
    expect(flutter.checklists.roles.length).toBeGreaterThan(5)
    expect(Object.keys(token).length).toBeGreaterThanOrEqual(15)
    expect(Object.keys(aliases).length).toBeGreaterThanOrEqual(8)
  })

  it('same keys, in the same order, as the Flutter ModuleRegistry', () => {
    expect(MOBILE_MODULES.map((m) => m.key)).toEqual(Object.keys(flutter))
  })

  it('every mirrored module has the same label, group and role defaults as the Flutter app', () => {
    const drift = []
    for (const m of MOBILE_MODULES) {
      const theirs = flutter[m.key]
      if (!theirs) { drift.push(`${m.key}: missing from module_registry.dart`); continue }
      if (m.label !== theirs.label) drift.push(`${m.key}: label "${m.label}" vs "${theirs.label}"`)
      if (m.group !== groupName[theirs.group]) drift.push(`${m.key}: group ${m.group} vs ${groupName[theirs.group]}`)
      const a = [...m.roles].sort().join(',')
      const b = [...theirs.roles].sort().join(',')
      if (a !== b) drift.push(`${m.key}: web [${a}] vs flutter [${b}]`)
    }
    expect(drift).toEqual([])
  })

  it("every webModuleKeyAliases target is a key in this catalog (so a mobile:<webKey> row lands on a real module)", () => {
    for (const target of Object.values(aliases)) expect(MOBILE_MODULE_BY_KEY[target]).toBeDefined()
    // and no alias shadows a phone key (an alias only fills a gap)
    for (const webKey of Object.keys(aliases)) expect(MOBILE_MODULE_BY_KEY[webKey]).toBeUndefined()
  })

  it('the trades and the driver can reach checklists on both sides', () => {
    for (const role of ['mechanic', 'electrician', 'driver']) {
      expect(flutter.checklists.roles).toContain(role)
      expect(MOBILE_MODULE_BY_KEY.checklists.roles).toContain(role)
    }
  })

  it('Fleet Supervisor files accidents on the Flutter app (flutterRoleDefaultExtensions)', () => {
    expect(mobileModuleDefaultAllows('reportAccident', 'Fleet Supervisor')).toBe(true)
    expect(mobileModuleDefaultAllows('accidents', 'Fleet Supervisor')).toBe(true)
    expect(mobileModuleDefaultAllows('records', 'Fleet Supervisor')).toBe(false)
  })
})
