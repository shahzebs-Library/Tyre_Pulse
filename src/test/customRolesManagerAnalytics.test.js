import { describe, it, expect } from 'vitest'
import {
  enrichRoles, filterRoles, roleKpis, coveragePct, roleExport,
} from '../lib/customRolesManagerAnalytics'

const roles = [
  { id: 'a', name: 'Fleet Supervisor', description: 'Runs the yard', active: true, created_at: '2026-01-01' },
  { id: 'b', name: 'Auditor', description: null, active: false, created_at: '2026-03-01' },
  { id: 'c', name: 'Clerk', description: 'Data entry', created_at: '2026-02-01' },
]

describe('customRolesManagerAnalytics', () => {
  const e = enrichRoles(roles, { 'Fleet Supervisor': 12, Auditor: 0 }, { 'Fleet Supervisor': 3, Auditor: 0 })

  it('keeps unknown counts null, never 0', () => {
    expect(e[2]._users).toBeNull()
    expect(e[2]._modules).toBeNull()
    expect(e[1]._active).toBe(false)
  })

  it('filters and sorts through consoleTable rules', () => {
    expect(filterRoles(e).map((r) => r.id)).toEqual(['b', 'c', 'a'])
    expect(filterRoles(e, { status: 'inactive' }).map((r) => r.id)).toEqual(['b'])
    expect(filterRoles(e, { assignment: 'unassigned' }).map((r) => r.id)).toEqual(['b'])
    expect(filterRoles(e, { assignment: 'unknown' }).map((r) => r.id)).toEqual(['c'])
    expect(filterRoles(e, { assignment: 'assigned' }).map((r) => r.id)).toEqual(['a'])
    expect(filterRoles(e, { sort: 'users' }).map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(filterRoles(e, { sort: 'newest' }).map((r) => r.id)).toEqual(['b', 'c', 'a'])
    expect(filterRoles(e, { search: 'entry' }).map((r) => r.id)).toEqual(['c'])
  })

  it('computes KPIs and coverage', () => {
    expect(roleKpis(e, 160)).toMatchObject({ total: 3, active: 2, inactive: 1, assignedUsers: 3, usersKnownFor: 2, unassignedRoles: 1, avgModules: 6, emptyRoles: 1, catalogSize: 160 })
    expect(roleKpis([]).assignedUsers).toBeNull()
    expect(roleKpis([]).avgModules).toBeNull()
    expect(coveragePct(40, 160)).toBe(25)
    expect(coveragePct(null, 160)).toBeNull()
  })

  it('exports N/A for unknown counts', () => {
    const x = roleExport(e)
    expect(x.rows[2].users).toBe('N/A')
    expect(x.rows[1].status).toBe('Inactive')
  })
})
