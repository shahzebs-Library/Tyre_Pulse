import { describe, it, expect } from 'vitest'
import { summarizeShifts, SHIFT_STATUS_VALUES } from '../lib/shifts'

describe('shifts — SHIFT_STATUS_VALUES', () => {
  it('exposes the canonical status lifecycle', () => {
    expect(SHIFT_STATUS_VALUES).toEqual(['scheduled', 'completed', 'absent', 'cancelled'])
  })
})

describe('shifts — summarizeShifts', () => {
  const TODAY = new Date('2026-07-12T09:00:00Z')
  const rows = [
    { id: '1', person_name: 'Ali',   status: 'scheduled', shift_date: '2026-07-12' }, // today
    { id: '2', person_name: 'Ali',   status: 'scheduled', shift_date: '2026-07-13' }, // future
    { id: '3', person_name: 'Sara',  status: 'completed', shift_date: '2026-07-11' },
    { id: '4', person_name: 'Omar',  status: 'absent',    shift_date: '2026-07-12' }, // today, not scheduled
    { id: '5', person_name: 'Sara',  status: 'cancelled', shift_date: '2026-07-12' },
    { id: '6', person_name: 'Layla', status: 'scheduled', shift_date: '2026-07-12T14:00:00Z' }, // today w/ time
  ]

  it('counts the total number of shifts', () => {
    expect(summarizeShifts(rows, TODAY).total).toBe(6)
  })

  it('counts shifts by status', () => {
    const s = summarizeShifts(rows, TODAY)
    expect(s.byStatus).toEqual({ scheduled: 3, completed: 1, absent: 1, cancelled: 1 })
  })

  it('counts only scheduled shifts dated today', () => {
    // rows 1 and 6 are scheduled + today; row 4 is today but absent; row 2 is future.
    expect(summarizeShifts(rows, TODAY).scheduledToday).toBe(2)
  })

  it('accepts a date-only string reference for "today"', () => {
    expect(summarizeShifts(rows, '2026-07-12').scheduledToday).toBe(2)
  })

  it('counts distinct people case-insensitively', () => {
    const s = summarizeShifts(
      [
        { person_name: 'Ali', status: 'scheduled' },
        { person_name: 'ali', status: 'completed' },
        { person_name: 'Sara', status: 'scheduled' },
      ],
      TODAY,
    )
    // Ali/ali collapse to one; Sara is the second.
    expect(s.distinctPeople).toBe(2)
  })

  it('ignores blank / missing person names when counting people', () => {
    const s = summarizeShifts(
      [
        { person_name: '  ', status: 'scheduled' },
        { person_name: null, status: 'scheduled' },
        { status: 'scheduled' },
        { person_name: 'Real Person', status: 'scheduled' },
      ],
      TODAY,
    )
    expect(s.distinctPeople).toBe(1)
  })

  it('ignores unknown statuses in the byStatus tally', () => {
    const s = summarizeShifts([{ person_name: 'X', status: 'bogus' }], TODAY)
    expect(s.byStatus).toEqual({ scheduled: 0, completed: 0, absent: 0, cancelled: 0 })
    expect(s.total).toBe(1)
  })

  it('handles empty / non-array input safely', () => {
    expect(summarizeShifts([], TODAY)).toEqual({
      total: 0,
      byStatus: { scheduled: 0, completed: 0, absent: 0, cancelled: 0 },
      scheduledToday: 0,
      distinctPeople: 0,
    })
    expect(summarizeShifts(null).total).toBe(0)
    expect(summarizeShifts(undefined).distinctPeople).toBe(0)
  })

  it('is deterministic for the same inputs', () => {
    expect(summarizeShifts(rows, TODAY)).toEqual(summarizeShifts(rows, TODAY))
  })
})
