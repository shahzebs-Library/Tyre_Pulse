import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  WORKSHOP_ACTIONS, WORKSHOP_ACTION_KEYS, WORKSHOP_CATEGORIES, WORKSHOP_MODULE_KEY,
  WORKSHOP_PERMISSION_KEY, ROLE_GROUPS, DEFAULT_ROLE_MATRIX,
  resolveWorkshopPermissions, NO_WORKSHOP_PERMISSIONS,
} from '../lib/workshopStatus/permissions'
import { SUBMODULES } from '../lib/moduleCatalog'

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261007100000_workshop_status_permissions.sql'),
  'utf8',
).replace(/\r/g, '')

// Read a `v_<name> text[] := array[...]` declaration out of the migration.
function sqlArray(name) {
  const m = SQL.match(new RegExp(`v_${name}\\s+text\\[\\]\\s*:=\\s*array\\[([^\\]]*)\\]`))
  if (!m) throw new Error(`v_${name} not found in the migration`)
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1])
}
// The action allowlist inside workshop_status_can (the first array after "Unknown actions").
function sqlActionAllowlist() {
  const body = SQL.slice(SQL.indexOf('Unknown actions are refused'))
  const m = body.match(/array\[([^\]]*)\]/)
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1])
}

describe('resolveWorkshopPermissions', () => {
  it('fails closed: no input, junk input and non-true values are all false', () => {
    for (const input of [undefined, {}, { myPermissions: null }, { myPermissions: 'yes' },
      { myPermissions: [true] }, { myPermissions: { view: 'true', update: 1, export: {} } }]) {
      const p = resolveWorkshopPermissions(input)
      expect(Object.keys(p).sort()).toEqual([...WORKSHOP_ACTION_KEYS].sort())
      expect(Object.values(p).every((v) => v === false)).toBe(true)
    }
  })

  it('keeps only explicit true answers and ignores unknown keys', () => {
    const p = resolveWorkshopPermissions({ myPermissions: { view: true, update: true, upload: false, bogus: true } })
    expect(p.view).toBe(true)
    expect(p.update).toBe(true)
    expect(p.upload).toBe(false)
    expect(p.permanent_delete).toBe(false)
    expect('bogus' in p).toBe(false)
  })

  it('returns a frozen object', () => {
    const p = resolveWorkshopPermissions({ myPermissions: { view: true } })
    expect(Object.isFrozen(p)).toBe(true)
    expect(Object.isFrozen(NO_WORKSHOP_PERMISSIONS)).toBe(true)
  })
})

describe('WORKSHOP_ACTIONS', () => {
  it('every action has a key, label, known category and description', () => {
    for (const a of WORKSHOP_ACTIONS) {
      expect(typeof a.key).toBe('string')
      expect(a.label.length).toBeGreaterThan(0)
      expect(a.description.length).toBeGreaterThan(0)
      expect(WORKSHOP_CATEGORIES).toContain(a.category)
      expect(typeof a.superAdminOnly).toBe('boolean')
    }
    expect(new Set(WORKSHOP_ACTION_KEYS).size).toBe(WORKSHOP_ACTION_KEYS.length)
  })

  it('permanent_delete is the only super-admin-only action and has no permission key', () => {
    expect(WORKSHOP_ACTIONS.filter((a) => a.superAdminOnly).map((a) => a.key)).toEqual(['permanent_delete'])
    expect(WORKSHOP_PERMISSION_KEY('permanent_delete')).toBe(null)
    expect(WORKSHOP_PERMISSION_KEY('nonsense')).toBe(null)
  })

  it('maps view to the module key and every other action under it', () => {
    expect(WORKSHOP_PERMISSION_KEY('view')).toBe(WORKSHOP_MODULE_KEY)
    expect(WORKSHOP_PERMISSION_KEY('export')).toBe('daily_ops:workshop:export')
  })

  it('matches the server allowlist in workshop_status_can and workshop_status_my_permissions', () => {
    expect([...sqlActionAllowlist()].sort()).toEqual([...WORKSHOP_ACTION_KEYS].sort())
    const map = SQL.slice(SQL.indexOf('function public.workshop_status_my_permissions'))
    const m = map.match(/array\[([^\]]*)\]/)
    const mapActions = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1])
    expect(mapActions.sort()).toEqual([...WORKSHOP_ACTION_KEYS].sort())
  })

  it('every grantable action is listed in the Access Manager catalog, and permanent_delete is not', () => {
    const catalogKeys = (SUBMODULES.daily_ops || []).map((s) => s.key)
    for (const a of WORKSHOP_ACTIONS) {
      const key = WORKSHOP_PERMISSION_KEY(a.key)
      if (key) expect(catalogKeys).toContain(key)
    }
    expect(catalogKeys.some((k) => k.endsWith('permanent_delete'))).toBe(false)
  })
})

describe('DEFAULT_ROLE_MATRIX mirrors the SQL seed', () => {
  for (const group of ['ground', 'supervisor', 'manager']) {
    it(`${group}: roles and actions equal the migration arrays`, () => {
      expect([...ROLE_GROUPS[group].roles]).toEqual(sqlArray(`${group}_roles`))
      expect([...ROLE_GROUPS[group].actions].sort()).toEqual(sqlArray(`${group}_actions`).sort())
      for (const role of ROLE_GROUPS[group].roles) {
        expect([...DEFAULT_ROLE_MATRIX[role]]).toEqual(['view', ...sqlArray(`${group}_actions`)].sort())
      }
    })
  }

  it('seeded actions are real actions and never permanent_delete or the admin-only three', () => {
    for (const g of Object.values(ROLE_GROUPS)) {
      for (const a of g.actions) {
        expect(WORKSHOP_ACTION_KEYS).toContain(a)
        expect(['permanent_delete', 'soft_delete', 'configure', 'view_audit']).not.toContain(a)
      }
    }
  })

  it('Admin holds everything but permanent_delete; Super Admin holds everything', () => {
    expect(DEFAULT_ROLE_MATRIX.Admin).not.toContain('permanent_delete')
    expect(DEFAULT_ROLE_MATRIX.Admin.length).toBe(WORKSHOP_ACTION_KEYS.length - 1)
    expect([...DEFAULT_ROLE_MATRIX['Super Admin']]).toEqual([...WORKSHOP_ACTION_KEYS].sort())
  })

  it('no role appears in two groups', () => {
    const roles = Object.values(ROLE_GROUPS).flatMap((g) => g.roles)
    expect(new Set(roles).size).toBe(roles.length)
  })
})
