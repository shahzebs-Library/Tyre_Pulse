import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls = { insert: [], update: [] }
let nextResult = { data: { id: 't1' }, error: null }
vi.mock('../lib/supabase', () => {
  const builder = (kind, row) => {
    const b = {
      eq: () => b,
      select: () => b,
      single: () => Promise.resolve(nextResult),
    }
    calls[kind].push(row)
    return b
  }
  return {
    supabase: {
      from: () => ({
        insert: row => builder('insert', row),
        update: row => builder('update', row),
      }),
    },
  }
})

import { employeePayload, historyDiff, certificateState, reportingTree, saveTaskType, saveEmployeeRecord } from '../lib/api/workforceEmployees'

beforeEach(() => { calls.insert.length = 0; calls.update.length = 0; nextResult = { data: { id: 't1' }, error: null } })

describe('employeePayload', () => {
  const base = { profile_id: 'p1', designation: '  Tyre Technician ', employment_status: 'active' }
  it('requires an account and a designation', () => {
    expect(() => employeePayload({ designation: 'x' })).toThrow(/employee account/)
    expect(() => employeePayload({ profile_id: 'p1', designation: '   ' })).toThrow(/Designation is required/)
  })
  it('refuses self supervision and identical shift times', () => {
    expect(() => employeePayload({ ...base, supervisor_id: 'p1' })).toThrow(/cannot supervise themselves/)
    expect(() => employeePayload({ ...base, shift_start: '08:00', shift_end: '08:00' })).toThrow(/cannot be the same/)
  })
  it('trims, uppercases and dedupes sites and blanks to null', () => {
    const r = employeePayload({ ...base, sites: ['nhc', ' NHC ', 'jed', '', null], department: '  ', team: 'A' })
    expect(r.designation).toBe('Tyre Technician')
    expect(r.sites).toEqual(['NHC', 'JED'])
    expect(r.department).toBeNull()
    expect(r.team).toBe('A')
  })
  it('accepts a comma-separated site string', () => {
    expect(employeePayload({ ...base, sites: 'nhc, jed' }).sites).toEqual(['NHC', 'JED'])
  })
  it('keeps unavailable_until only for temporarily unavailable and folds unknown status to active', () => {
    expect(employeePayload({ ...base, employment_status: 'active', unavailable_until: '2026-12-01' }).unavailable_until).toBeNull()
    expect(employeePayload({ ...base, employment_status: 'temporarily_unavailable', unavailable_until: '2026-12-01' }).unavailable_until).toBe('2026-12-01')
    expect(employeePayload({ ...base, employment_status: 'bogus' }).employment_status).toBe('active')
  })
})

describe('historyDiff', () => {
  it('lists only changed tracked fields, comparing arrays by value', () => {
    const d = historyDiff(
      { designation: 'A', sites: ['NHC'], team: null, supervisor_id: 's1' },
      { designation: 'B', sites: ['NHC'], team: null, supervisor_id: 's2', updated_at: 'x' },
    )
    expect(d.map(x => x.field)).toEqual(['designation', 'supervisor_id'])
    expect(d[0]).toEqual({ field: 'designation', from: 'A', to: 'B' })
  })
  it('treats missing and null as the same and tracks escalation contact', () => {
    expect(historyDiff({}, { team: null })).toEqual([])
    expect(historyDiff({ escalation_contact: 'x' }, { escalation_contact: 'y' }).map(d => d.field)).toEqual(['escalation_contact'])
  })
})

describe('certificateState', () => {
  const today = '2026-11-09'
  it('classifies valid, expiring, expired and not yet valid', () => {
    expect(certificateState({ expires_on: null }, today)).toBe('valid')
    expect(certificateState({ expires_on: '2027-06-01' }, today)).toBe('valid')
    expect(certificateState({ expires_on: '2026-11-30' }, today)).toBe('expiring')
    expect(certificateState({ expires_on: '2026-11-09' }, today)).toBe('expiring')
    expect(certificateState({ expires_on: '2026-11-08' }, today)).toBe('expired')
    expect(certificateState({ issued_on: '2026-12-01', expires_on: '2027-12-01' }, today)).toBe('not_yet_valid')
  })
  it('honours a custom warning window', () => {
    expect(certificateState({ expires_on: '2026-12-20' }, today, 60)).toBe('expiring')
    expect(certificateState({ expires_on: '2026-12-20' }, today, 10)).toBe('valid')
  })
})

describe('reportingTree', () => {
  const recs = [
    { profile_id: 'b', supervisor_id: 'a' },
    { profile_id: 'c', supervisor_id: 'b' },
    { profile_id: 'd', supervisor_id: 'a' },
    { profile_id: 'e', supervisor_id: null },
  ]
  it('returns direct and indirect reports', () => {
    expect(reportingTree(recs, 'a').sort()).toEqual(['b', 'c', 'd'])
    expect(reportingTree(recs, 'b')).toEqual(['c'])
    expect(reportingTree(recs, 'e')).toEqual([])
  })
  it('terminates on a reporting loop and never includes the supervisor', () => {
    const loop = [{ profile_id: 'x', supervisor_id: 'y' }, { profile_id: 'y', supervisor_id: 'z' }, { profile_id: 'z', supervisor_id: 'x' }]
    expect(reportingTree(loop, 'x').sort()).toEqual(['y', 'z'])
  })
})

describe('saveTaskType', () => {
  it('requires a task type', async () => {
    await expect(saveTaskType({ task_type: ' ' })).rejects.toThrow(/Task type is required/)
  })
  it('refuses a safety-critical task with no skill or certificate', async () => {
    await expect(saveTaskType({ task_type: 'tyre change', safety_critical: true })).rejects.toThrow(/must name the required skill or certificate/)
    expect(calls.insert).toHaveLength(0)
  })
  it('clamps skill level and inserts a new row', async () => {
    await saveTaskType({ task_type: 'tyre change', safety_critical: true, required_skill_id: 'tyre_change', min_skill_level: 9 })
    expect(calls.insert[0]).toMatchObject({ task_type: 'tyre change', min_skill_level: 3, safety_critical: true, active: true, required_cert_type: null })
  })
  it('updates when an id is present', async () => {
    await saveTaskType({ id: 't1', task_type: 'inspection', min_skill_level: 0, active: false })
    expect(calls.update[0]).toMatchObject({ task_type: 'inspection', min_skill_level: 1, active: false })
  })
})

describe('saveEmployeeRecord', () => {
  it('maps the database reporting-loop refusal to a plain sentence', async () => {
    nextResult = { data: null, error: { message: 'This supervisor would create a reporting loop', code: '23514' } }
    await expect(saveEmployeeRecord({ profile_id: 'p1', designation: 'Tech', supervisor_id: 'p2' }, { exists: true })).rejects.toThrow('This supervisor would create a reporting loop.')
    expect(calls.update).toHaveLength(1)
  })
})
