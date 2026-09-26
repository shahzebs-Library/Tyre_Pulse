import { describe, it, expect } from 'vitest'
import {
  countsByUnit, unitRegister, filterUnits, hierarchyKpis, typeMix, memberRows, coverageRows,
  unitExportRows, memberExportRows, personLabel,
} from '../lib/orgHierarchyAnalytics'

const NOW = Date.UTC(2026, 8, 26)
const units = [
  { id: 'a', name: 'Company', unit_type: 'company' },
  { id: 'b', name: 'KSA', unit_type: 'country', parent_id: 'a', country: 'KSA' },
  { id: 'c', name: 'NHC', unit_type: 'site', parent_id: 'b', code: 'NHC1' },
  { id: 'd', name: 'Old', unit_type: 'team', parent_id: 'zz', active: false },
]
const assignments = [
  { id: 1, user_id: 'u1', org_unit_id: 'b', is_primary: true },
  { id: 2, user_id: 'u2', org_unit_id: 'c', ends_at: '2026-01-01' },
  { id: 3, user_id: 'u3', org_unit_id: 'c', starts_at: '2026-01-01' },
]
const profiles = new Map([['u1', { id: 'u1', full_name: 'Ali', email: 'a@x' }], ['u3', { id: 'u3', username: 'sara' }]])

describe('orgHierarchyAnalytics', () => {
  it('counts total and active members per unit', () => {
    const m = countsByUnit(assignments, NOW)
    expect(m.get('c')).toEqual({ total: 2, active: 1 })
    expect(m.get('b')).toEqual({ total: 1, active: 1 })
  })

  it('enriches the register with parent, depth, children and members', () => {
    const reg = unitRegister(units, assignments, NOW)
    const c = reg.find((r) => r.id === 'c')
    expect(c).toMatchObject({ parentName: 'KSA', depth: 2, members: 2, activeMembers: 1, typeLabel: 'Site' })
    expect(reg.find((r) => r.id === 'a')).toMatchObject({ isRoot: true, children: 1 })
    expect(reg.find((r) => r.id === 'd')).toMatchObject({ orphanParent: true, isActive: false })
  })

  it('filters by type, status, staffing and search', () => {
    const reg = unitRegister(units, assignments, NOW)
    expect(filterUnits(reg, { type: 'site' }).map((r) => r.id)).toEqual(['c'])
    expect(filterUnits(reg, { status: 'inactive' }).map((r) => r.id)).toEqual(['d'])
    expect(filterUnits(reg, { staffing: 'unstaffed' }).map((r) => r.id)).toEqual(['a', 'd'])
    expect(filterUnits(reg, { search: 'ksa' }).map((r) => r.id)).toEqual(['b', 'c'])
  })

  it('computes KPIs and type mix', () => {
    const reg = unitRegister(units, assignments, NOW)
    const k = hierarchyKpis(units, reg, assignments, NOW)
    expect(k).toMatchObject({ total: 4, active: 3, inactive: 1, activeMembers: 2, people: 2, unstaffed: 1, orphanParents: 1 })
    expect(k.staffedPct).toBeCloseTo(66.7, 1)
    expect(hierarchyKpis([], [], [], NOW).staffedPct).toBeNull()
    expect(typeMix(reg).map((t) => t.type)).toEqual(['company', 'country', 'site', 'team'])
  })

  it('builds member and coverage registers with honest labels', () => {
    const m = memberRows(assignments, 'c', profiles, NOW)
    expect(m.map((r) => r.name)).toEqual(['sara', 'Unknown user'])
    expect(m[0]._active).toBe(true)
    expect(memberRows(assignments, null, profiles, NOW)).toEqual([])
    const cov = coverageRows(units, assignments, profiles, NOW)
    const ali = cov.find((c) => c.userId === 'u1')
    expect(ali).toMatchObject({ name: 'Ali', primaryUnit: 'KSA', directCount: 1, effectiveCount: 2, inherited: 1 })
    expect(personLabel(null, 'abcdefghij').sub).toBe('abcdefgh')
  })

  it('exports N/A and plain text, never blanks', () => {
    const reg = unitRegister(units, assignments, NOW)
    const out = unitExportRows(reg)
    expect(out.find((r) => r.name === 'Company').parent).toBe('Root')
    expect(out.find((r) => r.name === 'Old').parent).toBe('N/A')
    expect(out.find((r) => r.name === 'Company').code).toBe('N/A')
    const mem = memberExportRows(memberRows(assignments, 'c', profiles, NOW))
    expect(mem[1]).toMatchObject({ starts: 'Open', ends: '2026-01-01', status: 'Scheduled or ended' })
  })
})
