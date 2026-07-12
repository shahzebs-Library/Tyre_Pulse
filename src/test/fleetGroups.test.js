import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber, buildHierarchy, collectSubtree, rollupAssetCount, depthOf, summariseGroups,
} from '../lib/fleetGroups'

const g = (name, parent, extra = {}) => ({
  id: `${name}`, group_name: name, parent_group: parent ?? null, ...extra,
})

describe('fleetGroups — toFiniteNumber', () => {
  it('parses numbers and numeric strings', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('1,200')).toBe(1200)
    expect(toFiniteNumber('  55 ')).toBe(55)
  })
  it('returns null for empty / non-numeric', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('fleetGroups — buildHierarchy', () => {
  it('returns [] for empty / non-array input', () => {
    expect(buildHierarchy([])).toEqual([])
    expect(buildHierarchy()).toEqual([])
    expect(buildHierarchy(null)).toEqual([])
  })

  it('treats groups with no parent as roots', () => {
    const rows = [g('Holding'), g('Other')]
    const tree = buildHierarchy(rows)
    expect(tree.map((n) => n.group.group_name).sort()).toEqual(['Holding', 'Other'])
    expect(tree.every((n) => n.children.length === 0)).toBe(true)
  })

  it('nests children under their parent', () => {
    const rows = [g('Holding'), g('Sub A', 'Holding'), g('Sub B', 'Holding'), g('Depot 1', 'Sub A')]
    const tree = buildHierarchy(rows)
    expect(tree).toHaveLength(1)
    const root = tree[0]
    expect(root.group.group_name).toBe('Holding')
    expect(root.children.map((c) => c.group.group_name).sort()).toEqual(['Sub A', 'Sub B'])
    const subA = root.children.find((c) => c.group.group_name === 'Sub A')
    expect(subA.children.map((c) => c.group.group_name)).toEqual(['Depot 1'])
  })

  it('treats a group whose parent is not in the set as an orphan root', () => {
    const rows = [g('Division', 'GhostParent'), g('Depot', 'Division')]
    const tree = buildHierarchy(rows)
    expect(tree).toHaveLength(1)
    expect(tree[0].group.group_name).toBe('Division')
    expect(tree[0].children.map((c) => c.group.group_name)).toEqual(['Depot'])
  })

  it('treats a self-referential group as a root without infinite recursion', () => {
    const rows = [g('Self', 'Self')]
    const tree = buildHierarchy(rows)
    expect(tree).toHaveLength(1)
    expect(tree[0].group.group_name).toBe('Self')
    expect(tree[0].children).toEqual([])
  })

  it('guards mutual cycles (A→B→A) and still produces a finite tree', () => {
    const rows = [g('A', 'B'), g('B', 'A')]
    const tree = buildHierarchy(rows)
    // Both reference an existing parent, so neither is a plain root; the cycle
    // guard prevents infinite recursion. The tree must be finite (no throw).
    const names = []
    const walk = (nodes) => nodes.forEach((n) => { names.push(n.group.group_name); walk(n.children) })
    walk(tree)
    expect(names.length).toBeLessThan(10)
  })

  it('ignores rows without a group_name', () => {
    const rows = [g('Real'), { id: 'x', group_name: '', parent_group: null }]
    const tree = buildHierarchy(rows)
    expect(tree.map((n) => n.group.group_name)).toEqual(['Real'])
  })
})

describe('fleetGroups — collectSubtree', () => {
  it('returns the group plus all descendants', () => {
    const rows = [g('Root'), g('A', 'Root'), g('B', 'Root'), g('A1', 'A')]
    const names = collectSubtree(rows, 'Root').map((r) => r.group_name).sort()
    expect(names).toEqual(['A', 'A1', 'B', 'Root'])
  })
  it('returns [] for an unknown group', () => {
    expect(collectSubtree([g('Root')], 'Nope')).toEqual([])
  })
})

describe('fleetGroups — rollupAssetCount', () => {
  it('sums a group plus all descendants', () => {
    const rows = [
      g('Holding', null, { asset_count: 5 }),
      g('Sub A', 'Holding', { asset_count: 10 }),
      g('Sub B', 'Holding', { asset_count: 20 }),
      g('Depot 1', 'Sub A', { asset_count: 3 }),
    ]
    expect(rollupAssetCount(rows, 'Holding')).toBe(38)
    expect(rollupAssetCount(rows, 'Sub A')).toBe(13)
    expect(rollupAssetCount(rows, 'Depot 1')).toBe(3)
  })

  it('treats missing / non-numeric / negative counts as zero', () => {
    const rows = [
      g('Root', null, { asset_count: null }),
      g('Child', 'Root', { asset_count: 'abc' }),
      g('Child2', 'Root', { asset_count: -5 }),
      g('Child3', 'Root', { asset_count: 7 }),
    ]
    expect(rollupAssetCount(rows, 'Root')).toBe(7)
  })

  it('returns 0 for an unknown group', () => {
    expect(rollupAssetCount([g('Root', null, { asset_count: 4 })], 'Ghost')).toBe(0)
  })

  it('does not double-count under a mutual cycle', () => {
    const rows = [g('A', 'B', { asset_count: 1 }), g('B', 'A', { asset_count: 2 })]
    // Cycle-guarded traversal visits each node at most once → 1 + 2 = 3.
    expect(rollupAssetCount(rows, 'A')).toBe(3)
  })
})

describe('fleetGroups — depthOf', () => {
  const rows = [g('Holding'), g('Sub', 'Holding'), g('Div', 'Sub'), g('Depot', 'Div')]

  it('is 0 for a root', () => {
    expect(depthOf(rows, 'Holding')).toBe(0)
  })
  it('increments per level down the tree', () => {
    expect(depthOf(rows, 'Sub')).toBe(1)
    expect(depthOf(rows, 'Div')).toBe(2)
    expect(depthOf(rows, 'Depot')).toBe(3)
  })
  it('returns null for an unknown group', () => {
    expect(depthOf(rows, 'Ghost')).toBeNull()
  })
  it('treats an orphan-parented group as depth 0', () => {
    expect(depthOf([g('X', 'MissingParent')], 'X')).toBe(0)
  })
  it('terminates on a cycle without throwing', () => {
    const cyc = [g('A', 'B'), g('B', 'A')]
    expect(typeof depthOf(cyc, 'A')).toBe('number')
  })
})

describe('fleetGroups — summariseGroups', () => {
  it('returns zeroes for an empty set', () => {
    expect(summariseGroups([])).toEqual({
      totalGroups: 0, activeGroups: 0, rootGroups: 0,
      totalAssets: 0, maxDepth: 0, totalBudget: 0,
    })
  })

  it('computes totals, roots, active counts, assets, depth and budget', () => {
    const rows = [
      g('Holding', null, { asset_count: 2, budget: 1000, active: true }),
      g('Sub', 'Holding', { asset_count: 5, budget: 500, active: true }),
      g('Div', 'Sub', { asset_count: 3, budget: 250, active: false }),
      g('Standalone', null, { asset_count: 4, budget: 100 }),
    ]
    const s = summariseGroups(rows)
    expect(s.totalGroups).toBe(4)
    expect(s.activeGroups).toBe(3) // Div is inactive; Standalone has no active flag → counted active
    expect(s.rootGroups).toBe(2) // Holding + Standalone
    expect(s.totalAssets).toBe(14) // 2 + 5 + 3 + 4
    expect(s.maxDepth).toBe(2) // Holding(0) → Sub(1) → Div(2)
    expect(s.totalBudget).toBe(1850)
  })

  it('counts an orphan-parented group as a root', () => {
    const rows = [g('A', 'Ghost', { asset_count: 1 })]
    const s = summariseGroups(rows)
    expect(s.rootGroups).toBe(1)
    expect(s.totalGroups).toBe(1)
  })
})
