import { describe, it, expect, vi } from 'vitest'
import {
  classifyShift, summarizeAttendance, indexAttendance, attendanceForShift,
  clockMinutes, checkInMinutes, personKey, filterShiftsByRange,
  bucketByDay, bucketBySite, bucketByPerson,
  localClock, timeZoneForCountry, localCheckInTime,
} from '../lib/workshopAbsence'

const NOW = new Date('2026-07-14T10:00:00Z') // a Tuesday, 10:00 UTC

describe('helpers', () => {
  it('clockMinutes parses HH:MM and HH:MM:SS', () => {
    expect(clockMinutes('08:00')).toBe(480)
    expect(clockMinutes('08:30:15')).toBe(510)
    expect(clockMinutes('')).toBeNull()
    expect(clockMinutes(null)).toBeNull()
  })

  it('checkInMinutes takes the clock portion of an ISO timestamp (tz-stable)', () => {
    expect(checkInMinutes('2026-07-14T08:35:00Z')).toBe(515)
    expect(checkInMinutes('2026-07-14 09:05')).toBe(545)
    expect(checkInMinutes(null)).toBeNull()
  })

  it('personKey normalises whitespace + case', () => {
    expect(personKey('  Ahmed   Khan ')).toBe('ahmed khan')
    expect(personKey(null)).toBe('')
  })
})

describe('classifyShift', () => {
  it('present when checked in on time', () => {
    const shift = { id: 1, person_name: 'A', shift_date: '2026-07-14', start_time: '08:00' }
    const att = { shift_id: 1, check_in: '2026-07-14T07:58:00Z' }
    expect(classifyShift(shift, att, { now: NOW })).toBe('present')
  })

  it('late when checked in after start_time', () => {
    const shift = { id: 2, person_name: 'B', shift_date: '2026-07-14', start_time: '08:00' }
    const att = { shift_id: 2, check_in: '2026-07-14T08:35:00Z' }
    expect(classifyShift(shift, att, { now: NOW })).toBe('late')
  })

  it('absent when a PAST rostered shift has no check-in', () => {
    const shift = { id: 3, person_name: 'C', shift_date: '2026-07-10', start_time: '08:00' }
    expect(classifyShift(shift, null, { now: NOW })).toBe('absent')
  })

  it('scheduled (NOT absent) for a FUTURE shift with no check-in', () => {
    const shift = { id: 4, person_name: 'D', shift_date: '2026-07-20', start_time: '08:00' }
    expect(classifyShift(shift, null, { now: NOW })).toBe('scheduled')
  })

  it('today: scheduled before start, absent after start', () => {
    const beforeStart = { id: 5, person_name: 'E', shift_date: '2026-07-14', start_time: '14:00' }
    const afterStart = { id: 6, person_name: 'F', shift_date: '2026-07-14', start_time: '08:00' }
    // now is 10:00 UTC
    expect(classifyShift(beforeStart, null, { now: NOW })).toBe('scheduled')
    expect(classifyShift(afterStart, null, { now: NOW })).toBe('absent')
  })

  it('today with no start_time cannot assert absence -> scheduled', () => {
    const shift = { id: 7, person_name: 'G', shift_date: '2026-07-14', start_time: null }
    expect(classifyShift(shift, null, { now: NOW })).toBe('scheduled')
  })

  it('cancelled roster status -> cancelled regardless of evidence', () => {
    const shift = { id: 8, person_name: 'H', shift_date: '2026-07-10', start_time: '08:00', status: 'cancelled' }
    expect(classifyShift(shift, null, { now: NOW })).toBe('cancelled')
  })

  it('explicit roster absent marking with no check-in -> absent', () => {
    const shift = { id: 9, person_name: 'I', shift_date: '2026-07-14', start_time: '23:00', status: 'absent' }
    expect(classifyShift(shift, null, { now: NOW })).toBe('absent')
  })
})

describe('indexAttendance + attendanceForShift', () => {
  it('matches by shift_id first, then person + date fallback', () => {
    const attendance = [
      { shift_id: 1, check_in: '2026-07-14T08:00:00Z' },
      { person_name: 'Ahmed Khan', check_in: '2026-07-14T09:00:00Z' },
    ]
    const idx = indexAttendance(attendance)
    expect(attendanceForShift({ id: 1 }, idx)?.check_in).toBe('2026-07-14T08:00:00Z')
    expect(attendanceForShift({ id: 99, person_name: 'ahmed khan', shift_date: '2026-07-14' }, idx)?.check_in)
      .toBe('2026-07-14T09:00:00Z')
    expect(attendanceForShift({ id: 42, person_name: 'Nobody', shift_date: '2026-07-14' }, idx)).toBeNull()
  })
})

describe('filterShiftsByRange', () => {
  const shifts = [
    { shift_date: '2026-07-01' }, { shift_date: '2026-07-14' }, { shift_date: '2026-07-31' },
  ]
  it('inclusive on both ends', () => {
    expect(filterShiftsByRange(shifts, { from: '2026-07-01', to: '2026-07-14' })).toHaveLength(2)
  })
  it('no bounds returns all', () => {
    expect(filterShiftsByRange(shifts, {})).toHaveLength(3)
  })
  it('non-array -> []', () => {
    expect(filterShiftsByRange(null)).toEqual([])
  })
})

describe('summarizeAttendance', () => {
  const shifts = [
    { id: 1, person_name: 'Ahmed', shift_date: '2026-07-14', start_time: '08:00', site: 'NHC' }, // present
    { id: 2, person_name: 'Bilal', shift_date: '2026-07-14', start_time: '08:00', site: 'NHC' }, // late
    { id: 3, person_name: 'Carlos', shift_date: '2026-07-10', start_time: '08:00', site: 'METRO' }, // absent (past)
    { id: 4, person_name: 'Dan', shift_date: '2026-07-20', start_time: '08:00', site: 'METRO' }, // scheduled (future)
    { id: 5, person_name: 'Ehab', shift_date: '2026-07-13', start_time: '08:00', site: 'NHC', status: 'leave' }, // on leave
  ]
  const attendance = [
    { shift_id: 1, check_in: '2026-07-14T07:55:00Z' },
    { shift_id: 2, check_in: '2026-07-14T08:40:00Z' },
  ]

  it('classifies present/late/absent/scheduled/leave and computes the rate', () => {
    const s = summarizeAttendance({ shifts, attendance, from: '2026-07-01', to: '2026-07-31', now: NOW })
    expect(s.present).toBe(2) // Ahmed (on time) + Bilal (late) both attended
    expect(s.late).toBe(1)
    expect(s.absent).toBe(1)
    expect(s.scheduled).toBe(1)
    expect(s.onLeave).toBe(1)
    // rate = present / (present + absent) = 2 / 3
    expect(s.attendanceRate).toBeCloseTo(2 / 3, 5)
  })

  it('byDay / bySite / byPerson buckets are populated honestly', () => {
    const s = summarizeAttendance({ shifts, attendance, from: '2026-07-01', to: '2026-07-31', now: NOW })
    const day14 = s.byDay.find((d) => d.date === '2026-07-14')
    expect(day14).toMatchObject({ present: 2, late: 1, absent: 0 })
    const nhc = s.bySite.find((x) => x.site === 'NHC')
    expect(nhc).toMatchObject({ present: 2, absent: 0 })
    const ahmed = s.byPerson.find((p) => p.person === 'Ahmed')
    expect(ahmed).toMatchObject({ scheduled: 1, present: 1, absent: 0, late: 0, lastSeen: '2026-07-14' })
    const carlos = s.byPerson.find((p) => p.person === 'Carlos')
    expect(carlos).toMatchObject({ scheduled: 1, present: 0, absent: 1, lastSeen: null })
  })

  it('empty input -> zeros and null rate (never NaN)', () => {
    const s = summarizeAttendance({ shifts: [], attendance: [], from: '2026-07-01', to: '2026-07-31', now: NOW })
    expect(s.present).toBe(0)
    expect(s.absent).toBe(0)
    expect(s.late).toBe(0)
    expect(s.attendanceRate).toBeNull()
    expect(s.byDay).toEqual([])
    expect(s.byPerson).toEqual([])
  })

  it('no-arg call does not throw and returns a null rate', () => {
    const s = summarizeAttendance()
    expect(s.attendanceRate).toBeNull()
    expect(s.rostered).toBe(0)
  })
})

describe('bucket helpers are directly usable', () => {
  const classified = [
    { shift: { shift_date: '2026-07-14', site: 'NHC', person_name: 'A' }, cls: 'present', att: { check_in: '2026-07-14T08:00:00Z' } },
    { shift: { shift_date: '2026-07-14', site: 'NHC', person_name: 'B' }, cls: 'absent', att: null },
  ]
  it('bucketByDay', () => {
    expect(bucketByDay(classified)[0]).toMatchObject({ date: '2026-07-14', present: 1, absent: 1 })
  })
  it('bucketBySite', () => {
    expect(bucketBySite(classified)[0]).toMatchObject({ site: 'NHC', present: 1, absent: 1 })
  })
  it('bucketByPerson tracks lastSeen', () => {
    const a = bucketByPerson(classified).find((p) => p.person === 'A')
    expect(a.lastSeen).toBe('2026-07-14')
  })
})

describe('site clock (check-ins are UTC instants, rosters are local wall-clock)', () => {
  it('localClock converts a zoned instant to the site day and minutes', () => {
    expect(timeZoneForCountry('KSA')).toBe('Asia/Riyadh')
    expect(timeZoneForCountry(' uae ')).toBe('Asia/Dubai')
    expect(timeZoneForCountry(null)).toBe('UTC')
    expect(localClock('2026-07-14T05:35:00Z', 'Asia/Riyadh')).toEqual({ date: '2026-07-14', minutes: 515 })
    // 22:30 UTC is already the next day in Riyadh.
    expect(localClock('2026-07-13T22:30:00Z', 'Asia/Riyadh').date).toBe('2026-07-14')
    // A naive value is read as written.
    expect(localClock('2026-07-14 09:05', 'Asia/Riyadh')).toEqual({ date: '2026-07-14', minutes: 545 })
    expect(localCheckInTime('2026-07-14T05:35:00+00:00', 'Asia/Riyadh')).toBe('08:35')
  })

  it('a KSA check-in 35 minutes late reads as late, not on time', () => {
    const shift = { id: 'k1', person_name: 'B', shift_date: '2026-07-14', start_time: '08:00', country: 'KSA' }
    expect(classifyShift(shift, { check_in: '2026-07-14T05:35:00Z' }, { now: NOW })).toBe('late')
    expect(classifyShift(shift, { check_in: '2026-07-14T04:55:00Z' }, { now: NOW })).toBe('present')
  })

  it('today in KSA: an 08:00 shift with no check-in is absent at 09:00 local (06:00 UTC)', () => {
    const shift = { id: 'k2', person_name: 'C', shift_date: '2026-07-14', start_time: '08:00', country: 'KSA' }
    expect(classifyShift(shift, null, { now: new Date('2026-07-14T06:00:00Z') })).toBe('absent')
    expect(classifyShift(shift, null, { now: new Date('2026-07-14T04:00:00Z') })).toBe('scheduled')
  })

  it('a check-in on a later local day than the shift is late', () => {
    const shift = { id: 'k3', person_name: 'D', shift_date: '2026-07-13', start_time: '22:00', country: 'KSA' }
    expect(classifyShift(shift, { check_in: '2026-07-13T22:10:00Z' }, { now: NOW })).toBe('late')
  })

  it('an explicit timeZone option overrides the country', () => {
    const shift = { id: 'k4', person_name: 'E', shift_date: '2026-07-14', start_time: '08:00', country: 'KSA' }
    expect(classifyShift(shift, { check_in: '2026-07-14T07:30:00Z' }, { now: NOW, timeZone: 'UTC' })).toBe('present')
  })
})

describe('absence loader', () => {
  it('shiftDay does UTC day arithmetic', async () => {
    const { shiftDay } = await import('../lib/api/workshopAbsence')
    expect(shiftDay('2026-07-01', -1)).toBe('2026-06-30')
    expect(shiftDay('2026-12-31', 2)).toBe('2027-01-02')
    expect(shiftDay('', 1)).toBeNull()
    expect(shiftDay('nope', 1)).toBeNull()
  })

  it('pages the roster past the 1,000-row server cap with an id tiebreak', async () => {
    const calls = []
    vi.resetModules()
    vi.doMock('../lib/supabase', () => {
      const from = (table) => {
        const rec = { table, order: [] }
        calls.push(rec)
        const b = {
          select: () => b, eq: () => b, gte: () => b, lte: () => b, lt: () => b, or: () => b, is: () => b,
          order: (c) => { rec.order.push(c); return b },
          range: (a) => {
            const n = table === 'shifts' && a === 0 ? 1000 : table === 'shifts' && a === 1000 ? 5 : 0
            return Promise.resolve({ data: Array.from({ length: n }, (_, i) => ({ id: `${a + i}` })), error: null })
          },
        }
        return b
      }
      return { supabase: { from } }
    })
    const { loadAbsenceData } = await import('../lib/api/workshopAbsence')
    const res = await loadAbsenceData({ from: '2026-07-01', to: '2026-07-31', country: 'KSA' })
    expect(res.shifts).toHaveLength(1005)
    const shiftCalls = calls.filter((c) => c.table === 'shifts')
    expect(shiftCalls.length).toBeGreaterThanOrEqual(2)
    expect(shiftCalls[0].order).toEqual(['shift_date', 'id'])
    vi.doUnmock('../lib/supabase')
  })
})
