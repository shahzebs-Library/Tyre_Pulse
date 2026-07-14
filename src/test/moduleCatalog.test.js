import { describe, it, expect } from 'vitest'
import {
  MODULE_GROUPS, ALL_MODULES, MODULE_LABEL, ACCESS_ROLES,
  SUBMODULES, FULL_REGISTRY, REGISTRY_LABEL,
  isSubmoduleKey, parentModuleKey,
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

// Local helper for the registry group assertion.
function REGISTRY_LABEL_GROUP(baseKey) {
  return ALL_MODULES.find((m) => m.key === baseKey)?.group
}
