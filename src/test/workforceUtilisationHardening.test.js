import { describe, it, expect } from 'vitest'
import { summarizeWorkday, validateActivity } from '../lib/workforceIntelligence'
import { findAssignableEmployees, employeeLabel } from '../lib/workforceEmployeeDirectory'
import { filterAssignments } from '../lib/workforceAssignmentFilter'
import { workforceBoardKpis, verifiedDeliveryMetrics } from '../lib/workforceAnalytics'

const start = '2026-10-22T08:00:00+03:00'
const end = '2026-10-22T16:00:00+03:00'
const a = (x, y, category, reason) => ({ started_at: `2026-10-22T${x}:00+03:00`, ended_at: `2026-10-22T${y}:00+03:00`, category, reason })
const run = (activities, extra = {}) => summarizeWorkday({ shift_start: start, shift_end: end, activities, ...extra })

describe('utilisation: zero / one / many activities', () => {
  it('zero activities: valid, nothing recorded, utilisation 0 not null, coverage 0', () => {
    const r = run([])
    expect(r.valid).toBe(true)
    expect(r.recorded_minutes).toBe(0)
    expect(r.unattributed_minutes).toBe(480)
    expect(r.utilization_pct).toBe(0)
    expect(r.coverage_pct).toBe(0)
  })
  it('one activity', () => {
    const r = run([a('08:00', '12:00', 'productive')])
    expect(r.productive_minutes).toBe(240)
    expect(r.utilization_pct).toBe(50)
    expect(r.coverage_pct).toBe(50)
  })
  it('many back-to-back (touching) activities are not overlaps', () => {
    const r = run([a('08:00', '10:00', 'productive'), a('10:00', '11:00', 'coordination'), a('11:00', '12:00', 'reporting'), a('12:00', '16:00', 'productive')])
    expect(r.valid).toBe(true)
    expect(r.productive_minutes).toBe(480)
    expect(r.utilization_pct).toBe(100)
  })
  it('unsorted input is handled', () => {
    const r = run([a('12:00', '16:00', 'productive'), a('08:00', '12:00', 'productive')])
    expect(r.valid).toBe(true)
    expect(r.productive_minutes).toBe(480)
  })
})

describe('utilisation: breaks', () => {
  it('scheduled allowance larger than recorded break excludes the allowance once', () => {
    const r = run([a('08:00', '12:00', 'productive'), a('12:00', '12:30', 'break')], { excluded_break_minutes: 60 })
    expect(r.available_minutes).toBe(420)
  })
  it('recorded break larger than allowance excludes the recorded break once', () => {
    const r = run([a('08:00', '12:00', 'productive'), a('12:00', '13:30', 'break')], { excluded_break_minutes: 30 })
    expect(r.available_minutes).toBe(390)
  })
  it('break allowance can never exceed the shift; denominator zero gives null utilisation', () => {
    const r = run([], { excluded_break_minutes: 9999 })
    expect(r.available_minutes).toBe(0)
    expect(r.utilization_pct).toBeNull()
  })
  it('rejects negative or non-finite break allowance', () => {
    expect(() => run([], { excluded_break_minutes: -1 })).toThrow()
    expect(() => run([], { excluded_break_minutes: NaN })).toThrow()
  })
  it('break time never counts as productive', () => {
    const r = run([a('08:00', '09:00', 'break')])
    expect(r.productive_minutes).toBe(0)
  })
})

describe('utilisation: overlaps and invalid input', () => {
  it('overlap of any pair invalidates the whole summary instead of double counting', () => {
    const r = run([a('08:00', '10:00', 'productive'), a('09:59', '11:00', 'training')])
    expect(r.valid).toBe(false)
    expect(r.minutes).toBeNull()
    expect(r.errors.some(e => e.message === 'Overlapping activity')).toBe(true)
  })
  it('fully nested activity is an overlap', () => {
    expect(run([a('08:00', '12:00', 'productive'), a('09:00', '10:00', 'break')]).valid).toBe(false)
  })
  it('activity outside the shift is rejected', () => {
    const r = run([a('07:00', '09:00', 'productive')])
    expect(r.valid).toBe(false)
    expect(r.errors[0].message).toBe('Activity outside shift')
  })
  it('naive timestamps without timezone are rejected', () => {
    expect(validateActivity({ category: 'productive', started_at: '2026-10-22T08:00:00', ended_at: '2026-10-22T09:00:00' })).toMatch(/timezone/)
  })
  it('zero-length and reversed intervals are rejected', () => {
    expect(validateActivity(a('09:00', '09:00', 'productive'))).not.toBeNull()
    expect(validateActivity(a('10:00', '09:00', 'productive'))).not.toBeNull()
  })
  it('invalid shift throws', () => {
    expect(() => summarizeWorkday({ shift_start: end, shift_end: start })).toThrow()
    expect(() => summarizeWorkday({})).toThrow()
  })
})

describe('assignment directory search and role filter edge cases', () => {
  const people = [
    { id: 'u1', employee_id: 'E-001', full_name: 'Zainab', username: 'z', role: 'Driver', site: 'A', approved: true, locked: false },
    { id: 'u2', employee_id: 'E-002', full_name: 'Ahmad', username: 'a', role: 'Driver', site: 'B', approved: true, locked: false },
    { id: 'u3', employee_id: null, full_name: 'عمر الفاروق', username: null, role: 'Technician', site: null, approved: true, locked: false },
    { id: 'u4', employee_id: 'E-004', full_name: 'Ghost', role: 'Driver', approved: true, locked: true },
  ]
  it('empty directory and empty result are empty arrays', () => {
    expect(findAssignableEmployees([])).toEqual([])
    expect(findAssignableEmployees(people, { search: 'nobody-matches' })).toEqual([])
  })
  it('sorts by name and is case-insensitive', () => {
    expect(findAssignableEmployees(people, { role: 'Driver' }).map(p => p.id)).toEqual(['u2', 'u1'])
    expect(findAssignableEmployees(people, { search: '  ZAINAB ' }).map(p => p.id)).toEqual(['u1'])
  })
  it('matches Arabic names and tolerates null fields', () => {
    expect(findAssignableEmployees(people, { search: 'عمر' }).map(p => p.id)).toEqual(['u3'])
    expect(employeeLabel(people[2])).toBe('عمر الفاروق | Technician')
  })
  it('role filter combined with search narrows both ways; locked is never offered', () => {
    expect(findAssignableEmployees(people, { role: 'Driver', search: 'ghost' })).toEqual([])
    expect(findAssignableEmployees(people, { role: 'Driver', search: 'E-00' }).map(p => p.id)).toEqual(['u2', 'u1'])
  })
  it('unnamed account has a safe label', () => {
    expect(employeeLabel({ id: 'x' })).toBe('Unnamed account')
  })
})

describe('assignment board filter', () => {
  const rows = [
    { id: 1, title: 'Replace tyre', site: 'NHC', status: 'assigned', priority: 'high', assigned_to: 'u1' },
    { id: 2, title: 'Wash fleet', site: 'RIY', status: 'blocked', priority: 'low', assigned_to: 'u2' },
    { id: 3, title: 'Inspect', site: null, status: 'blocked', priority: 'high', assigned_to: 'u2', instructions: 'check PSI' },
  ]
  const employeeById = new Map([['u1', { full_name: 'Zainab' }], ['u2', { full_name: 'Ahmad', employee_id: 'E-002' }]])
  it('defaults return everything; empty input is safe', () => {
    expect(filterAssignments(rows)).toHaveLength(3)
    expect(filterAssignments(undefined)).toEqual([])
    expect(filterAssignments(null)).toEqual([])
  })
  it('filters by status and priority together', () => {
    expect(filterAssignments(rows, { status: 'blocked', priority: 'high' }).map(r => r.id)).toEqual([3])
  })
  it('searches title, site, instructions and employee name or ID', () => {
    expect(filterAssignments(rows, { search: 'tyre' }).map(r => r.id)).toEqual([1])
    expect(filterAssignments(rows, { search: 'riy' }).map(r => r.id)).toEqual([2])
    expect(filterAssignments(rows, { search: 'psi' }).map(r => r.id)).toEqual([3])
    expect(filterAssignments(rows, { search: 'ahmad', employeeById }).map(r => r.id)).toEqual([2, 3])
    expect(filterAssignments(rows, { search: 'e-002', employeeById }).map(r => r.id)).toEqual([2, 3])
  })
  it('no match returns empty, not an error', () => {
    expect(filterAssignments(rows, { search: 'zzz' })).toEqual([])
  })
})

describe('board KPIs are honest at the extremes', () => {
  it('zero assignments gives zeros and null completion', () => {
    const k = workforceBoardKpis([], [])
    expect(k).toMatchObject({ assigned: 0, active: 0, blocked: 0, overdue: 0, reports_pending: 0 })
    expect(verifiedDeliveryMetrics([]).verified_completion_pct).toBeNull()
  })
  it('overdue ignores closed work and missing due dates', () => {
    const past = '2000-01-01T00:00:00Z'
    const k = workforceBoardKpis([{ status: 'verified', due_at: past }, { status: 'cancelled', due_at: past }, { status: 'assigned', due_at: null }, { status: 'blocked', due_at: past }])
    expect(k.overdue).toBe(1)
  })
})
