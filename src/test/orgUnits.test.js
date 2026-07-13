import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber, buildTree, descendantsOf, depthOf, assignmentsActive, summariseUnits,
  effectiveUnitIdsForUser, coverageByUser,
} from '../lib/orgUnits'

const u = (id, parent, extra = {}) => ({
  id, parent_id: parent ?? null, name: `Unit ${id}`, unit_type: 'branch', ...extra,
})

describe('orgUnits — toFiniteNumber', () => {
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

describe('orgUnits — buildTree', () => {
  it('returns [] for empty / non-array input', () => {
    expect(buildTree([])).toEqual([])
    expect(buildTree()).toEqual([])
    expect(buildTree(null)).toEqual([])
  })

  it('treats units with no parent as roots', () => {
    const tree = buildTree([u('a'), u('b')])
    expect(tree.map((n) => n.unit.id).sort()).toEqual(['a', 'b'])
    expect(tree.every((n) => n.children.length === 0)).toBe(true)
  })

  it('nests children under their parent', () => {
    const rows = [u('root'), u('a', 'root'), u('b', 'root'), u('a1', 'a')]
    const tree = buildTree(rows)
    expect(tree).toHaveLength(1)
    const root = tree[0]
    expect(root.unit.id).toBe('root')
    expect(root.children.map((c) => c.unit.id).sort()).toEqual(['a', 'b'])
    const a = root.children.find((c) => c.unit.id === 'a')
    expect(a.children.map((c) => c.unit.id)).toEqual(['a1'])
  })

  it('treats a unit whose parent is not in the set as an orphan root', () => {
    const tree = buildTree([u('x', 'ghost'), u('y', 'x')])
    expect(tree).toHaveLength(1)
    expect(tree[0].unit.id).toBe('x')
    expect(tree[0].children.map((c) => c.unit.id)).toEqual(['y'])
  })

  it('treats a self-referential unit as a root without infinite recursion', () => {
    const tree = buildTree([u('self', 'self')])
    expect(tree).toHaveLength(1)
    expect(tree[0].unit.id).toBe('self')
    expect(tree[0].children).toEqual([])
  })

  it('guards a mutual cycle (A→B→A) into a finite tree', () => {
    // Both reference each other; neither is a plain root, so buildTree treats
    // each as a root boundary and stops before re-expanding an ancestor.
    const tree = buildTree([u('A', 'B'), u('B', 'A')])
    expect(Array.isArray(tree)).toBe(true)
    // Every node expands finitely; total expanded nodes is bounded.
    const count = (nodes) => nodes.reduce((n, x) => n + 1 + count(x.children), 0)
    expect(count(tree)).toBeLessThan(10)
  })

  it('ignores rows without an id', () => {
    const tree = buildTree([{ name: 'no id' }, u('a')])
    expect(tree.map((n) => n.unit.id)).toEqual(['a'])
  })
})

describe('orgUnits — descendantsOf', () => {
  const rows = [u('root'), u('a', 'root'), u('b', 'root'), u('a1', 'a'), u('a1x', 'a1')]

  it('returns all transitive descendants, excluding the unit itself', () => {
    expect(descendantsOf(rows, 'root').sort()).toEqual(['a', 'a1', 'a1x', 'b'])
    expect(descendantsOf(rows, 'a').sort()).toEqual(['a1', 'a1x'])
  })

  it('returns [] for a leaf and for an unknown unit', () => {
    expect(descendantsOf(rows, 'a1x')).toEqual([])
    expect(descendantsOf(rows, 'nope')).toEqual([])
  })

  it('is cycle-safe on a corrupted parent chain', () => {
    const cyclic = [u('A', 'C'), u('B', 'A'), u('C', 'B')]
    const d = descendantsOf(cyclic, 'A')
    expect(d).toContain('B')
    expect(d).toContain('C')
    expect(d).not.toContain('A') // never re-includes the start
    expect(new Set(d).size).toBe(d.length) // no duplicates → terminated
  })
})

describe('orgUnits — depthOf', () => {
  const rows = [u('root'), u('a', 'root'), u('a1', 'a')]

  it('is 0 for a root, incrementing per level', () => {
    expect(depthOf(rows, 'root')).toBe(0)
    expect(depthOf(rows, 'a')).toBe(1)
    expect(depthOf(rows, 'a1')).toBe(2)
  })

  it('returns null for an unknown unit', () => {
    expect(depthOf(rows, 'ghost')).toBeNull()
  })

  it('stops on a cyclic ancestry rather than looping forever', () => {
    const cyclic = [u('A', 'B'), u('B', 'A')]
    expect(typeof depthOf(cyclic, 'A')).toBe('number')
  })
})

describe('orgUnits — assignmentsActive', () => {
  const now = Date.parse('2026-07-13T12:00:00Z')
  const rows = [
    { id: 'open', starts_at: null, ends_at: null },
    { id: 'past', starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-06-01T00:00:00Z' },
    { id: 'future', starts_at: '2026-12-01T00:00:00Z', ends_at: null },
    { id: 'current', starts_at: '2026-07-01T00:00:00Z', ends_at: '2026-08-01T00:00:00Z' },
  ]

  it('keeps open-ended and currently-active assignments', () => {
    const ids = assignmentsActive(rows, now).map((a) => a.id).sort()
    expect(ids).toEqual(['current', 'open'])
  })

  it('drops past and future windows', () => {
    const ids = assignmentsActive(rows, now).map((a) => a.id)
    expect(ids).not.toContain('past')
    expect(ids).not.toContain('future')
  })

  it('treats window boundaries as inclusive', () => {
    const atStart = Date.parse('2026-07-01T00:00:00Z')
    const atEnd = Date.parse('2026-08-01T00:00:00Z')
    expect(assignmentsActive([rows[3]], atStart).map((a) => a.id)).toEqual(['current'])
    expect(assignmentsActive([rows[3]], atEnd).map((a) => a.id)).toEqual(['current'])
  })

  it('excludes just outside the boundaries', () => {
    const beforeStart = Date.parse('2026-06-30T23:59:59Z')
    const afterEnd = Date.parse('2026-08-01T00:00:01Z')
    expect(assignmentsActive([rows[3]], beforeStart)).toEqual([])
    expect(assignmentsActive([rows[3]], afterEnd)).toEqual([])
  })

  it('returns [] for non-array input', () => {
    expect(assignmentsActive(null, now)).toEqual([])
    expect(assignmentsActive(undefined, now)).toEqual([])
  })
})

describe('orgUnits — summariseUnits', () => {
  it('summarises totals, active count, roots, byType and depth', () => {
    const rows = [
      u('root', null, { unit_type: 'company' }),
      u('a', 'root', { unit_type: 'region' }),
      u('a1', 'a', { unit_type: 'branch', active: false }),
      u('other', null, { unit_type: 'company' }),
    ]
    const s = summariseUnits(rows)
    expect(s.total).toBe(4)
    expect(s.active).toBe(3)
    expect(s.rootCount).toBe(2)
    expect(s.maxDepth).toBe(2)
    expect(s.byType).toEqual({ company: 2, region: 1, branch: 1 })
  })

  it('handles an empty set', () => {
    const s = summariseUnits([])
    expect(s).toEqual({ total: 0, active: 0, byType: {}, rootCount: 0, maxDepth: 0 })
  })
})

describe('orgUnits — effectiveUnitIdsForUser', () => {
  // company → region → branch; region → branch2
  const rows = [
    u('co', null, { unit_type: 'company' }),
    u('reg', 'co', { unit_type: 'region' }),
    u('br', 'reg', { unit_type: 'branch' }),
    u('br2', 'reg', { unit_type: 'branch' }),
    u('other', null, { unit_type: 'company' }),
  ]
  const asg = (user_id, org_unit_id, extra = {}) => ({ id: `${user_id}-${org_unit_id}`, user_id, org_unit_id, ...extra })

  it('covers the assigned unit plus all descendants', () => {
    const cover = effectiveUnitIdsForUser(rows, [asg('u1', 'reg')], 'u1')
    expect([...cover].sort()).toEqual(['br', 'br2', 'reg'])
  })

  it('unions coverage across multiple assignments', () => {
    const cover = effectiveUnitIdsForUser(rows, [asg('u1', 'br'), asg('u1', 'other')], 'u1')
    expect([...cover].sort()).toEqual(['br', 'other'])
  })

  it('ignores assignments outside the active window', () => {
    const past = asg('u1', 'reg', { ends_at: '2020-01-01T00:00:00Z' })
    expect(effectiveUnitIdsForUser(rows, [past], 'u1', Date.parse('2026-01-01T00:00:00Z')).size).toBe(0)
  })

  it('ignores other users and returns empty for missing user', () => {
    expect(effectiveUnitIdsForUser(rows, [asg('u2', 'reg')], 'u1').size).toBe(0)
    expect(effectiveUnitIdsForUser(rows, [asg('u1', 'reg')], '').size).toBe(0)
  })
})

describe('orgUnits — coverageByUser', () => {
  const rows = [
    u('co', null), u('reg', 'co'), u('br', 'reg'),
  ]
  it('rolls up direct + effective coverage and primary unit per user', () => {
    const assignments = [
      { id: '1', user_id: 'u1', org_unit_id: 'co', is_primary: true },
      { id: '2', user_id: 'u2', org_unit_id: 'br' },
    ]
    const cov = coverageByUser(rows, assignments)
    expect(cov).toHaveLength(2)
    const u1 = cov.find((c) => c.userId === 'u1')
    expect(u1.directCount).toBe(1)
    expect(u1.effectiveCount).toBe(3) // co + reg + br
    expect(u1.primaryUnitId).toBe('co')
    const u2 = cov.find((c) => c.userId === 'u2')
    expect(u2.effectiveCount).toBe(1)
    expect(u2.primaryUnitId).toBeNull()
  })

  it('sorts by effective coverage descending', () => {
    const assignments = [
      { id: '1', user_id: 'narrow', org_unit_id: 'br' },
      { id: '2', user_id: 'wide', org_unit_id: 'co' },
    ]
    const cov = coverageByUser(rows, assignments)
    expect(cov[0].userId).toBe('wide')
  })

  it('returns [] when there are no active assignments', () => {
    expect(coverageByUser(rows, [])).toEqual([])
  })
})
