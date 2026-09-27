import { describe, it, expect } from 'vitest'
import {
  flattenModules, matrixStats, filterModules, cellSummary, matrixExportRows,
} from '../lib/permissionMatrixAnalytics'

const groups = [
  { group: 'Fleet', modules: [{ key: 'fleet', label: 'Fleet Master' }, { key: 'tyres', label: 'Tyre Records' }] },
  { group: 'Admin', modules: [{ key: 'users', label: 'Users' }] },
]
const caps = [
  { key: 'view', label: 'View', enforced: true },
  { key: 'create', label: 'Create', enforced: false },
  { key: 'delete', label: 'Delete', enforced: true },
]
const roles = ['Admin', 'Manager', 'Reporter']
const matrix = {
  Admin: { fleet: { view: true }, tyres: { view: true }, users: { view: true } },
  Manager: { fleet: { view: true, create: true }, tyres: { view: true }, users: { view: false } },
  Reporter: { fleet: { view: true }, tyres: { view: false }, users: { view: false } },
}

describe('flattenModules', () => {
  it('produces one row per module with its group', () => {
    const rows = flattenModules(groups)
    expect(rows).toHaveLength(3)
    expect(rows[2]).toEqual({ key: 'users', label: 'Users', group: 'Admin' })
    expect(flattenModules(null)).toEqual([])
  })
})

describe('matrixStats', () => {
  it('counts editable roles only', () => {
    const rows = flattenModules(groups)
    const s = matrixStats(matrix, roles, rows, caps, new Set(['Manager::fleet']), new Set(['Reporter::tyres']))
    expect(s.editableRoles).toBe(2)
    expect(s.cells).toBe(6)
    expect(s.viewGrants).toBe(3)
    expect(s.viewCoverage).toBe(50)
    expect(s.storedOn).toBe(1)
    expect(s.overriddenModules).toBe(1)
    expect(s.unsavedModules).toBe(1)
    expect(s.perRole).toEqual({ Manager: 2, Reporter: 1 })
  })
  it('is N/A (null) coverage with no modules', () => {
    expect(matrixStats(matrix, roles, [], caps).viewCoverage).toBeNull()
  })
})

describe('filterModules', () => {
  const rows = flattenModules(groups)
  const ctx = { matrix, roles, overridden: new Set(['Manager::fleet']), unsaved: new Set(['Reporter::tyres']) }
  it('filters by search, group and state', () => {
    expect(filterModules(rows, { search: 'tyre' }, ctx).map(r => r.key)).toEqual(['tyres'])
    expect(filterModules(rows, { group: 'Admin' }, ctx).map(r => r.key)).toEqual(['users'])
    expect(filterModules(rows, { state: 'overridden' }, ctx).map(r => r.key)).toEqual(['fleet'])
    expect(filterModules(rows, { state: 'unsaved' }, ctx).map(r => r.key)).toEqual(['tyres'])
    expect(filterModules(rows, { state: 'hidden' }, ctx).map(r => r.key)).toEqual(['users'])
  })
})

describe('cellSummary + matrixExportRows', () => {
  it('names the capabilities in each cell', () => {
    expect(cellSummary(matrix, 'Admin', 'users', caps)).toBe('Full access')
    expect(cellSummary(matrix, 'Manager', 'fleet', caps)).toBe('View, Create')
    expect(cellSummary(matrix, 'Reporter', 'users', caps)).toBe('No access')
    const out = matrixExportRows(flattenModules(groups), matrix, roles, caps)
    expect(out[0]).toMatchObject({ group: 'Fleet', module: 'Fleet Master', Manager: 'View, Create', Admin: 'Full access' })
  })
})
