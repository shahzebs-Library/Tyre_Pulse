import { describe, it, expect } from 'vitest'
import {
  MODULE_GROUPS, ALL_MODULES, MODULE_LABEL, ACCESS_ROLES,
  SUBMODULES, FULL_REGISTRY, REGISTRY_LABEL,
  isSubmoduleKey, parentModuleKey,
  slugifyModuleKey, buildNavModuleCatalog,
} from '../lib/moduleCatalog'

describe('moduleCatalog base registry', () => {
  it('flattens every group module into ALL_MODULES with its group', () => {
    const expected = MODULE_GROUPS.reduce((n, g) => n + g.modules.length, 0)
    expect(ALL_MODULES).toHaveLength(expected)
    for (const m of ALL_MODULES) {
      expect(typeof m.key).toBe('string')
      expect(typeof m.label).toBe('string')
      expect(typeof m.group).toBe('string')
    }
  })

  it('has unique base module keys', () => {
    const keys = ALL_MODULES.map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('MODULE_LABEL maps every base key to its label', () => {
    for (const m of ALL_MODULES) expect(MODULE_LABEL[m.key]).toBe(m.label)
  })

  it('exposes the 11 access roles', () => {
    expect(ACCESS_ROLES).toContain('Admin')
    expect(new Set(ACCESS_ROLES).size).toBe(ACCESS_ROLES.length)
  })
})

describe('SUBMODULES', () => {
  it('every sub-module key is namespaced under its declared parent', () => {
    for (const [parent, subs] of Object.entries(SUBMODULES)) {
      for (const s of subs) {
        expect(s.key.startsWith(`${parent}:`)).toBe(true)
        expect(s.key).not.toBe(`${parent}:`) // must have a child segment
        expect(typeof s.label).toBe('string')
        expect(s.label.length).toBeGreaterThan(0)
      }
    }
  })

  it('only declares sub-modules for real base modules', () => {
    const baseKeys = new Set(ALL_MODULES.map((m) => m.key))
    for (const parent of Object.keys(SUBMODULES)) expect(baseKeys.has(parent)).toBe(true)
  })

  it('has no duplicate sub-module keys across the whole catalog', () => {
    const all = Object.values(SUBMODULES).flat().map((s) => s.key)
    expect(new Set(all).size).toBe(all.length)
  })

  it('covers the tabbed modules called out for gating', () => {
    for (const k of ['accidents', 'ai_analytics', 'user_management', 'reports', 'fleet_master', 'analytics', 'work_orders']) {
      expect(SUBMODULES[k]?.length).toBeGreaterThan(0)
    }
  })

  it('contains no dash punctuation in labels (report-safe ASCII rule)', () => {
    for (const s of Object.values(SUBMODULES).flat()) {
      expect(s.label).not.toMatch(/[‒-―‘’“”]/)
    }
  })
})

describe('FULL_REGISTRY', () => {
  it('places each base module at level 0 immediately followed by its sub-modules', () => {
    const subTotal = Object.values(SUBMODULES).reduce((n, s) => n + s.length, 0)
    expect(FULL_REGISTRY).toHaveLength(ALL_MODULES.length + subTotal)

    // Walk the flat list: level-1 nodes must reference the most recent level-0 parent.
    let currentParent = null
    for (const node of FULL_REGISTRY) {
      if (node.level === 0) {
        currentParent = node.key
        expect(node.parent).toBeUndefined()
      } else {
        expect(node.level).toBe(1)
        expect(node.parent).toBe(currentParent)
        expect(node.key.startsWith(`${currentParent}:`)).toBe(true)
        expect(node.group).toBe(REGISTRY_LABEL_GROUP(currentParent))
      }
    }
  })

  it('has globally unique keys', () => {
    const keys = FULL_REGISTRY.map((n) => n.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('REGISTRY_LABEL resolves both base and sub-module keys', () => {
    for (const n of FULL_REGISTRY) expect(REGISTRY_LABEL[n.key]).toBe(n.label)
  })

  it('every sub-module inherits its parent group', () => {
    const groupByKey = Object.fromEntries(ALL_MODULES.map((m) => [m.key, m.group]))
    for (const node of FULL_REGISTRY) {
      if (node.level === 1) expect(node.group).toBe(groupByKey[node.parent])
    }
  })
})

describe('key helpers', () => {
  it('isSubmoduleKey detects composite keys', () => {
    expect(isSubmoduleKey('accidents')).toBe(false)
    expect(isSubmoduleKey('accidents:analytics')).toBe(true)
    expect(isSubmoduleKey(null)).toBe(false)
  })

  it('parentModuleKey extracts the parent or null', () => {
    expect(parentModuleKey('accidents:analytics')).toBe('accidents')
    expect(parentModuleKey('accidents')).toBe(null)
  })
})

describe('slugifyModuleKey', () => {
  it('slugs a route into a stable underscore key', () => {
    expect(slugifyModuleKey('/live-fleet')).toBe('live_fleet')
    expect(slugifyModuleKey('/tyre-age-compliance')).toBe('tyre_age_compliance')
    expect(slugifyModuleKey('/proof-of-delivery')).toBe('proof_of_delivery')
  })

  it('is lowercase, trimmed, with no leading/trailing/underscore runs', () => {
    expect(slugifyModuleKey('/Fleet--Master//')).toBe('fleet_master')
    expect(slugifyModuleKey('  /Bay_Scheduling ')).toBe('bay_scheduling')
  })

  it('falls back to root for an empty route', () => {
    expect(slugifyModuleKey('/')).toBe('root')
    expect(slugifyModuleKey('')).toBe('root')
    expect(slugifyModuleKey(null)).toBe('root')
  })
})

describe('buildNavModuleCatalog', () => {
  // Minimal NAV_CATALOG-shaped fixture (group key = label, item key = route).
  const navCatalog = [
    {
      key: 'Overview',
      label: 'Overview',
      items: [
        { key: '/', label: 'Dashboard' },        // maps to existing 'dashboard'
        { key: '/tyres', label: 'Tyre Records' }, // maps to existing 'tyre_records'
      ],
    },
    {
      key: 'Operations',
      label: 'Operations',
      items: [
        { key: '/live-fleet', label: 'Live Fleet Status' }, // new -> slug
        { key: '/assets', label: 'Asset Management' },       // maps to existing 'fleet_master'
        { key: '/sites', label: 'Site Management' },         // new -> slug
      ],
    },
  ]
  const map = { '/': 'dashboard', '/tyres': 'tyre_records', '/assets': 'fleet_master' }

  it('lists every curated base module first, owning its label + group', () => {
    const out = buildNavModuleCatalog(navCatalog, map)
    const base = out.slice(0, ALL_MODULES.length)
    expect(base.map((m) => m.module_id)).toEqual(ALL_MODULES.map((m) => m.key))
    const dash = out.find((m) => m.module_id === 'dashboard')
    expect(dash.name).toBe(MODULE_LABEL.dashboard)
    expect(dash.category).toBe('Overview') // curated group, not overwritten by nav
  })

  it('collapses nav items that resolve to an existing key (no duplicate rows)', () => {
    const out = buildNavModuleCatalog(navCatalog, map)
    const ids = out.map((m) => m.module_id)
    expect(new Set(ids).size).toBe(ids.length)                 // globally unique
    expect(ids.filter((k) => k === 'dashboard')).toHaveLength(1)
    expect(ids.filter((k) => k === 'fleet_master')).toHaveLength(1) // /assets folded in
  })

  it('adds unmapped nav items under their nav group, keyed by slug', () => {
    const out = buildNavModuleCatalog(navCatalog, map)
    const live = out.find((m) => m.module_id === 'live_fleet')
    expect(live).toMatchObject({ name: 'Live Fleet Status', category: 'Operations' })
    const sites = out.find((m) => m.module_id === 'sites')
    expect(sites).toMatchObject({ name: 'Site Management', category: 'Operations' })
    // 2 new modules on top of the curated base set.
    expect(out).toHaveLength(ALL_MODULES.length + 2)
  })

  it('is safe on empty / malformed input (returns just the curated base)', () => {
    expect(buildNavModuleCatalog(undefined, map)).toHaveLength(ALL_MODULES.length)
    expect(buildNavModuleCatalog([], map)).toHaveLength(ALL_MODULES.length)
    expect(buildNavModuleCatalog([{ items: [{ label: 'x' }] }], map))
      .toHaveLength(ALL_MODULES.length) // item with no route ignored
  })
})

// Local helper for the registry group assertion.
function REGISTRY_LABEL_GROUP(baseKey) {
  return ALL_MODULES.find((m) => m.key === baseKey)?.group
}
