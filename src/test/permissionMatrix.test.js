import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared, hoisted Supabase mock — chainable, thenable builder that records the
// table + modifiers and resolves to a configurable { data, error }. Mirrors
// src/test/notifications.test.js.
const h = vi.hoisted(() => {
  const state = { result: { data: null, error: null }, last: null, upserts: [] }
  function from(table) {
    const calls = { eq: [] }
    const b = {
      _table: table,
      _calls: calls,
      select(cols) { calls.select = cols; return b },
      eq(col, val) { calls.eq.push([col, val]); return b },
      maybeSingle() { calls.maybeSingle = true; return Promise.resolve(state.result) },
      upsert(row, opts) {
        state.upserts.push({ table, row, opts })
        return Promise.resolve(state.upsertResult || { error: null })
      },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

import {
  MODULES, ROLES, CAPABILITIES, CAPABILITY_KEYS,
  PERMISSION_OVERRIDES_KEY, ROLE_VIEW_DEFAULTS, defaultViewAccess,
  buildDefaultMatrix, getEffectiveMatrix, setPermission,
  matrixDiff, diffFromDefaults, isEmptyDiff, countDiff,
  extractViewChanges, stripView, serializeOverrides, parseOverrides,
  resolvePermissions, getPermissionOverrides, savePermissionOverrides,
} from '../lib/permissionMatrix'

beforeEach(() => {
  h.state.result = { data: null, error: null }
  h.state.upsertResult = { error: null }
  h.state.upserts = []
  h.state.last = null
})

// ── Defaults mirror (guards AuthContext ROLE_DEFAULTS behaviour) ─────────────
// This is a literal re-implementation of src/contexts/AuthContext.jsx
// ROLE_DEFAULTS. If the default matrix ever drifts from the app's actual
// hardcoded fallback behaviour, this test fails loudly.
const AUTH_CONTEXT_ROLE_DEFAULTS = {
  Admin: () => true,
  Manager: (k) => !['user_management', 'erp_sync', 'data_cleaning', 'audit_trail'].includes(k),
  Director: (k) => !['user_management', 'erp_sync', 'data_cleaning', 'audit_trail'].includes(k),
  Inspector: (k) => ['dashboard', 'tyre_records', 'inspections', 'alerts', 'fleet_master', 'gate_pass', 'daily_ops'].includes(k),
  'Tyre Man': (k) => ['dashboard', 'tyre_records', 'inspections', 'alerts', 'stock', 'work_orders', 'gate_pass'].includes(k),
  Reporter: (k) => ['dashboard', 'analytics', 'kpi_scorecard', 'reports', 'executive_report', 'tyre_records'].includes(k),
  Driver: (k) => ['dashboard', 'inspections', 'alerts'].includes(k),
  'Integration Admin': (k) => ['dashboard', 'alerts', 'erp_sync', 'data_cleaning', 'upload_data', 'custom_data', 'audit_trail'].includes(k),
  'Data Engineer': (k) => ['dashboard', 'alerts', 'erp_sync', 'data_cleaning', 'upload_data', 'custom_data', 'tyre_records', 'fleet_master', 'analytics'].includes(k),
  Automation: (k) => ['dashboard', 'alerts', 'erp_sync', 'upload_data', 'custom_data'].includes(k),
}

describe('defaults mirror AuthContext ROLE_DEFAULTS exactly', () => {
  it('covers every role AuthContext knows about', () => {
    expect(Object.keys(ROLE_VIEW_DEFAULTS).sort()).toEqual(Object.keys(AUTH_CONTEXT_ROLE_DEFAULTS).sort())
    expect([...ROLES].sort()).toEqual(Object.keys(AUTH_CONTEXT_ROLE_DEFAULTS).sort())
  })

  it('defaultViewAccess matches the hardcoded predicates for every role × module', () => {
    for (const role of ROLES) {
      for (const m of MODULES) {
        expect(defaultViewAccess(role, m.key), `${role} × ${m.key}`)
          .toBe(AUTH_CONTEXT_ROLE_DEFAULTS[role](m.key))
      }
    }
  })

  it('unknown role gets no access (mirrors AuthContext ?? () => false)', () => {
    expect(defaultViewAccess('Ghost', 'dashboard')).toBe(false)
  })

  it('default matrix view equals the predicates, other capabilities follow view', () => {
    const matrix = buildDefaultMatrix()
    for (const role of ROLES) {
      for (const m of MODULES) {
        const expected = AUTH_CONTEXT_ROLE_DEFAULTS[role](m.key)
        for (const cap of CAPABILITY_KEYS) {
          expect(matrix[role][m.key][cap], `${role} × ${m.key} × ${cap}`).toBe(expected)
        }
      }
    }
  })

  it('Admin defaults to full access for every capability', () => {
    const matrix = buildDefaultMatrix()
    for (const m of MODULES)
      for (const cap of CAPABILITY_KEYS) expect(matrix.Admin[m.key][cap]).toBe(true)
  })
})

// ── getEffectiveMatrix ───────────────────────────────────────────────────────
describe('getEffectiveMatrix', () => {
  it('no overrides / no view map → identical to defaults', () => {
    expect(getEffectiveMatrix()).toEqual(buildDefaultMatrix())
    expect(getEffectiveMatrix(null, null)).toEqual(buildDefaultMatrix())
  })

  it('applies capability overrides', () => {
    const m = getEffectiveMatrix({ Driver: { inspections: { create: false, export: true } } })
    expect(m.Driver.inspections.create).toBe(false)
    expect(m.Driver.inspections.export).toBe(true)
    expect(m.Driver.inspections.view).toBe(true) // untouched
  })

  it('ignores view entries in overrides — the DB owns view', () => {
    const m = getEffectiveMatrix({ Driver: { dashboard: { view: false } } })
    expect(m.Driver.dashboard.view).toBe(true)
  })

  it('Admin is immune to overrides', () => {
    const m = getEffectiveMatrix({ Admin: { dashboard: { delete: false } } })
    expect(m.Admin.dashboard.delete).toBe(true)
  })

  it('ignores unknown roles, modules and capabilities in overrides', () => {
    const m = getEffectiveMatrix({
      Ghost: { dashboard: { edit: false } },
      Driver: { nonsense_module: { edit: false }, dashboard: { hack: true } },
    })
    expect(m).toEqual(buildDefaultMatrix())
  })

  it('viewMap with rows for a role fully defines its view (missing key ⇒ false), mirroring hasPermission', () => {
    // Manager has DB rows: only dashboard listed → everything else false.
    const m = getEffectiveMatrix(null, { Manager: { dashboard: true } })
    expect(m.Manager.dashboard.view).toBe(true)
    expect(m.Manager.analytics.view).toBe(false)   // default true, DB map wins wholly
    // Director has NO DB rows → hardcoded defaults stay.
    expect(m.Director.analytics.view).toBe(true)
  })

  it('viewMap never demotes Admin', () => {
    const m = getEffectiveMatrix(null, { Admin: { dashboard: false } })
    expect(m.Admin.dashboard.view).toBe(true)
  })
})

// ── setPermission ────────────────────────────────────────────────────────────
describe('setPermission', () => {
  it('immutably updates a single cell', () => {
    const base = buildDefaultMatrix()
    const next = setPermission(base, 'Driver', 'inspections', 'delete', false)
    expect(next).not.toBe(base)
    expect(next.Driver.inspections.delete).toBe(false)
    expect(base.Driver.inspections.delete).toBe(true) // original untouched
    expect(next.Manager).toBe(base.Manager)           // untouched branches shared
  })

  it('Admin row is locked — returns the matrix unchanged', () => {
    const base = buildDefaultMatrix()
    expect(setPermission(base, 'Admin', 'dashboard', 'view', false)).toBe(base)
  })

  it('throws on unknown role / module / capability', () => {
    const base = buildDefaultMatrix()
    expect(() => setPermission(base, 'Ghost', 'dashboard', 'view', true)).toThrow(/role/i)
    expect(() => setPermission(base, 'Driver', 'nope', 'view', true)).toThrow(/module/i)
    expect(() => setPermission(base, 'Driver', 'dashboard', 'fly', true)).toThrow(/capability/i)
  })

  it('coerces value to a strict boolean', () => {
    const next = setPermission(buildDefaultMatrix(), 'Driver', 'dashboard', 'export', 'yes')
    expect(next.Driver.dashboard.export).toBe(true)
  })
})

// ── Diffing ──────────────────────────────────────────────────────────────────
describe('diffFromDefaults / matrixDiff', () => {
  it('defaults diff to an empty object', () => {
    const d = diffFromDefaults(buildDefaultMatrix())
    expect(isEmptyDiff(d)).toBe(true)
    expect(countDiff(d)).toBe(0)
  })

  it('captures only the changed cells', () => {
    let m = buildDefaultMatrix()
    m = setPermission(m, 'Reporter', 'reports', 'delete', false)
    m = setPermission(m, 'Driver', 'alerts', 'export', false)
    const d = diffFromDefaults(m)
    expect(d).toEqual({
      Reporter: { reports: { delete: false } },
      Driver: { alerts: { export: false } },
    })
    expect(countDiff(d)).toBe(2)
  })

  it('round-trips: defaults + diff overrides = the edited matrix', () => {
    let m = buildDefaultMatrix()
    m = setPermission(m, 'Inspector', 'inspections', 'approve', false)
    m = setPermission(m, 'Manager', 'stock', 'delete', false)
    const rebuilt = getEffectiveMatrix(stripView(diffFromDefaults(m)))
    expect(rebuilt).toEqual(m)
  })

  it('extractViewChanges produces the set_module_permissions payload shape', () => {
    let m = buildDefaultMatrix()
    m = setPermission(m, 'Driver', 'tyre_records', 'view', true)
    m = setPermission(m, 'Driver', 'tyre_records', 'edit', true)
    const diff = matrixDiff(buildDefaultMatrix(), m)
    expect(extractViewChanges(diff)).toEqual([
      { role: 'Driver', module_key: 'tyre_records', enabled: true },
    ])
    expect(stripView(diff)).toEqual({ Driver: { tyre_records: { edit: true } } })
  })
})

// ── Serialization ────────────────────────────────────────────────────────────
describe('serializeOverrides / parseOverrides', () => {
  it('round-trips a sparse overrides object', () => {
    const overrides = { Driver: { alerts: { export: false } }, Reporter: { reports: { approve: true } } }
    expect(parseOverrides(serializeOverrides(overrides))).toEqual(overrides)
  })

  it('serialized envelope carries a version and timestamp', () => {
    const env = JSON.parse(serializeOverrides({}))
    expect(env.version).toBe(1)
    expect(typeof env.updated_at).toBe('string')
    expect(env.overrides).toEqual({})
  })

  it('parse tolerates raw objects (already-parsed jsonb) and bare maps', () => {
    expect(parseOverrides({ overrides: { Driver: { alerts: { export: false } } } }))
      .toEqual({ Driver: { alerts: { export: false } } })
    expect(parseOverrides({ Driver: { alerts: { export: false } } }))
      .toEqual({ Driver: { alerts: { export: false } } })
  })

  it('garbage in → {} out', () => {
    expect(parseOverrides(null)).toEqual({})
    expect(parseOverrides('not json {')).toEqual({})
    expect(parseOverrides(42)).toEqual({})
    expect(parseOverrides([1, 2])).toEqual({})
  })

  it('strips Admin, view, unknown keys and non-boolean values', () => {
    const parsed = parseOverrides({
      Admin: { dashboard: { delete: false } },
      Driver: { dashboard: { view: false, edit: false, hack: true, export: 'yes' }, nope: { edit: false } },
      Ghost: { dashboard: { edit: false } },
    })
    expect(parsed).toEqual({ Driver: { dashboard: { edit: false } } })
  })
})

// ── resolvePermissions (AuthContext consumption hook) ────────────────────────
describe('resolvePermissions', () => {
  it('returns the per-module capability map for a role', () => {
    const perms = resolvePermissions('Driver', { Driver: { alerts: { export: false } } })
    expect(perms.alerts.view).toBe(true)
    expect(perms.alerts.export).toBe(false)
    expect(perms.tyre_records.view).toBe(false)
  })

  it('Admin resolves to full access everywhere', () => {
    const perms = resolvePermissions('Admin', { Admin: { dashboard: { delete: false } } })
    for (const m of MODULES)
      for (const cap of CAPABILITY_KEYS) expect(perms[m.key][cap]).toBe(true)
  })

  it('unknown role resolves to no access at all', () => {
    const perms = resolvePermissions('Ghost')
    for (const m of MODULES)
      for (const cap of CAPABILITY_KEYS) expect(perms[m.key][cap]).toBe(false)
  })
})

// ── Persistence (app_settings, erp.js pattern) ───────────────────────────────
describe('persistence', () => {
  it('getPermissionOverrides reads app_settings under the permission_overrides key', async () => {
    h.state.result = { data: { value: JSON.stringify({ version: 1, overrides: { Driver: { alerts: { export: false } } } }) }, error: null }
    const out = await getPermissionOverrides()
    expect(out).toEqual({ Driver: { alerts: { export: false } } })
    expect(h.state.last._table).toBe('app_settings')
    expect(h.state.last._calls.eq).toContainEqual(['key', PERMISSION_OVERRIDES_KEY])
  })

  it('getPermissionOverrides returns {} when no row exists', async () => {
    h.state.result = { data: null, error: null }
    expect(await getPermissionOverrides()).toEqual({})
  })

  it('getPermissionOverrides throws on a DB error', async () => {
    h.state.result = { data: null, error: { message: 'boom' } }
    await expect(getPermissionOverrides()).rejects.toThrow('boom')
  })

  it('savePermissionOverrides upserts a sanitized envelope onConflict key', async () => {
    await savePermissionOverrides({
      Driver: { alerts: { export: false, view: false } },
      Ghost: { alerts: { edit: false } },
    })
    expect(h.state.upserts).toHaveLength(1)
    const { table, row, opts } = h.state.upserts[0]
    expect(table).toBe('app_settings')
    expect(row.key).toBe(PERMISSION_OVERRIDES_KEY)
    expect(opts).toEqual({ onConflict: 'key' })
    const stored = JSON.parse(row.value)
    expect(stored.overrides).toEqual({ Driver: { alerts: { export: false } } }) // view + Ghost stripped
  })

  it('savePermissionOverrides throws on a DB error', async () => {
    h.state.upsertResult = { error: { message: 'denied' } }
    await expect(savePermissionOverrides({ Driver: { alerts: { export: false } } })).rejects.toThrow('denied')
  })
})

// ── Registry sanity ──────────────────────────────────────────────────────────
describe('registries', () => {
  it('exposes the 10 real roles with Admin first', () => {
    expect(ROLES).toHaveLength(10)
    expect(ROLES[0]).toBe('Admin')
    expect(ROLES).toEqual(expect.arrayContaining([
      'Admin', 'Manager', 'Director', 'Reporter', 'Tyre Man', 'Inspector', 'Driver',
      'Integration Admin', 'Data Engineer', 'Automation',
    ]))
  })

  it('exposes the 6 capability dimensions with only view enforced today', () => {
    expect(CAPABILITY_KEYS).toEqual(['view', 'create', 'edit', 'delete', 'export', 'approve'])
    expect(CAPABILITIES.filter((c) => c.enforced).map((c) => c.key)).toEqual(['view'])
  })

  it('every default-referenced module key exists in the module catalog', () => {
    const keys = new Set(MODULES.map((m) => m.key))
    for (const def of Object.values(ROLE_VIEW_DEFAULTS)) {
      for (const k of def.keys || []) expect(keys.has(k), `catalog missing ${k}`).toBe(true)
    }
  })
})
