import { describe, it, expect } from 'vitest'
import {
  WEB_TO_MOBILE_KEY, mobileKeyFor, matrixColumns, webCell, phoneCell, stageKey, describeChange,
  stagedPeople, peopleByRole, newAndNotShared, buildShareChanges, describeGrant, areaLabel,
} from '../lib/accessOverview'
import { MOBILE_MODULE_BY_KEY } from '../lib/mobileModules'
import { baseRoleAllows, NEW_FEATURES_ADMIN_ONLY_KEY } from '../lib/permissionMatrix'
import { CONFIG_DEFAULTS, ENFORCEMENT_STATUS } from '../lib/api/systemConfig'

describe('accessOverview web to phone map', () => {
  it('only maps to real mobile module keys', () => {
    for (const m of Object.values(WEB_TO_MOBILE_KEY)) expect(MOBILE_MODULE_BY_KEY[m]).toBeTruthy()
    expect(mobileKeyFor('tyre_records')).toBe('records')
    expect(mobileKeyFor('inspections')).toBe('inspect')
    expect(mobileKeyFor('user_management')).toBeNull()
  })
})

describe('matrix cells', () => {
  const perm = { Manager: { tyre_records: false, 'mobile:records': true }, 'Tyre Man': {} }
  it('Admin is always on and locked', () => {
    expect(webCell(perm, 'Admin', 'anything')).toEqual({ on: true, saved: false, locked: true })
    expect(phoneCell(perm, 'Admin', 'records')).toEqual({ on: true, saved: false, locked: true })
  })
  it('a saved row wins over the default', () => {
    expect(webCell(perm, 'Manager', 'tyre_records')).toEqual({ on: false, saved: true, locked: false })
    expect(phoneCell(perm, 'Manager', 'records')).toEqual({ on: true, saved: true, locked: false })
  })
  it('falls back to built-in defaults when no row exists', () => {
    expect(webCell(perm, 'Tyre Man', 'tyre_records')).toMatchObject({ on: true, saved: false })
    expect(webCell(perm, 'Tyre Man', 'user_management')).toMatchObject({ on: false, saved: false })
    expect(phoneCell(perm, 'Tyre Man', 'inspect').saved).toBe(false)
  })
  it('a web only area has no phone cell', () => {
    expect(phoneCell(perm, 'Manager', null)).toBeNull()
  })
})

describe('columns and people', () => {
  it('puts built-in roles first then active custom roles', () => {
    const cols = matrixColumns([{ name: 'Fleet Supervisor' }, { name: 'Off Role', active: false }, { name: 'Manager' }])
    expect(cols[0]).toEqual({ name: 'Admin', custom: false })
    expect(cols.filter((c) => c.custom).map((c) => c.name)).toEqual(['Fleet Supervisor'])
  })
  it('counts approved people by role', () => {
    expect(peopleByRole([{ role: 'Driver' }, { role: 'Driver' }, { role: 'Driver', approved: false }, {}])).toEqual({ Driver: 2 })
  })
})

describe('staged change descriptions', () => {
  it('says who and where in plain English', () => {
    const d = describeChange({ role: 'Tyre Man', storedKey: 'mobile:records', enabled: false }, { 'Tyre Man': 17 })
    expect(d.title).toBe('Tyre Man loses Tyre Records on the phone')
    expect(d.detail).toMatch(/^17 people/)
    expect(stageKey('A', 'b')).toBe('A|b')
  })
  it('reports an unknown people count honestly', () => {
    const s = stagedPeople([{ role: 'X' }, { role: 'Driver' }], { Driver: 5 })
    expect(s).toEqual({ total: 5, roles: 2, known: false })
  })
  it('labels mobile and sub-module keys', () => {
    expect(areaLabel('mobile:inspect')).toBe(MOBILE_MODULE_BY_KEY.inspect.label)
    expect(areaLabel('accidents:analytics')).toMatch(/\/ analytics$/)
  })
})

describe('new and not yet shared', () => {
  const catalog = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }]
  it('lists areas no non-admin role has a saved rule for', () => {
    const perm = { Admin: { a: true, b: true }, Manager: { b: false } }
    const out = newAndNotShared(perm, catalog)
    expect(out.map((o) => o.key)).toEqual(['a', 'c'])
    expect(out[0].seenByDefault).toContain('Manager')
  })
  it('does not list deliberately admin-only phone screens unless asked', () => {
    expect(newAndNotShared({}, []).length).toBe(0)
    expect(newAndNotShared({}, [], { includePhone: true }).some((o) => o.surface === 'phone')).toBe(true)
  })
  it('builds share rows for web, phone and both, never for Admin', () => {
    const item = { key: 'tyre_records', storedKey: 'tyre_records', surface: 'web' }
    expect(buildShareChanges(item, ['Admin', 'Manager'], 'both')).toEqual([
      { role: 'Manager', module_key: 'tyre_records', enabled: true },
      { role: 'Manager', module_key: 'mobile:records', enabled: true },
    ])
    expect(buildShareChanges({ key: 'user_management', storedKey: 'user_management', surface: 'web' }, ['Manager'], 'phone')).toEqual([])
  })
})

describe('grant rows', () => {
  it('describes surface, effect and end date', () => {
    const d = describeGrant({ module_key: 'mobile:inspect', effect: 'revoke', expires_at: '2020-01-01T00:00:00Z' }, Date.parse('2021-01-01'))
    expect(d).toMatchObject({ surface: 'phone', effectLabel: 'Block', ends: '2020-01-01', expired: true })
    expect(describeGrant({ module_key: 'stock', effect: 'grant' }).ends).toBeNull()
  })
})

describe('baseRoleAllows (the new-areas policy)', () => {
  const managerDefault = (k) => k !== 'user_management'
  it('policy OFF: saved row wins, otherwise the built-in default decides (unchanged behaviour)', () => {
    expect(baseRoleAllows({ moduleKey: 'x', modulePerms: { x: false }, roleDefault: managerDefault })).toBe(false)
    expect(baseRoleAllows({ moduleKey: 'x', modulePerms: { x: true }, roleDefault: () => false })).toBe(true)
    expect(baseRoleAllows({ moduleKey: 'new_area', modulePerms: {}, roleDefault: managerDefault })).toBe(true)
    expect(baseRoleAllows({ moduleKey: 'new_area', modulePerms: null, roleDefault: managerDefault })).toBe(true)
  })
  it('policy ON: an area with no saved row is denied, saved rows still apply', () => {
    const on = { adminOnlyNew: true, roleDefault: managerDefault }
    expect(baseRoleAllows({ ...on, moduleKey: 'new_area', modulePerms: {} })).toBe(false)
    expect(baseRoleAllows({ ...on, moduleKey: 'new_area', modulePerms: null })).toBe(false)
    expect(baseRoleAllows({ ...on, moduleKey: 'shared', modulePerms: { shared: true } })).toBe(true)
    expect(baseRoleAllows({ ...on, moduleKey: 'shared', modulePerms: { shared: false } })).toBe(false)
  })
  it('defaults the flag to off and registers it as enforced', () => {
    expect(NEW_FEATURES_ADMIN_ONLY_KEY).toBe('new_features_admin_only')
    expect(CONFIG_DEFAULTS.new_features_admin_only).toBe(false)
    expect(ENFORCEMENT_STATUS.new_features_admin_only.status).toBe('active')
  })
})
