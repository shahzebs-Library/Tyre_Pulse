import { describe, it, expect } from 'vitest'
import {
  attendanceDetailRows, filterDetailRows, personRows, absenceInsights, summarizeAttendance,
} from '../lib/workshopAbsence'

const NOW = new Date('2026-07-14T10:00:00Z')
const shifts = [
  { id: 1, person_name: 'Ali', shift_date: '2026-07-13', start_time: '08:00', end_time: '17:00', site: 'NHC' },
  { id: 2, person_name: 'Ali', shift_date: '2026-07-12', start_time: '08:00', end_time: '17:00', site: 'NHC' },
  { id: 3, person_name: 'Sara', shift_date: '2026-07-13', start_time: '08:00', site: 'JED' },
  { id: 4, person_name: 'Omar', shift_date: '2026-07-20', start_time: '08:00', site: 'JED' },
]
const attendance = [{ person_name: 'Sara', check_in: '2026-07-13T08:30:00Z' }]

describe('attendance register view', () => {
  const summary = summarizeAttendance({ shifts, attendance, now: NOW })

  it('flattens detail worst-first with honest blanks', () => {
    const rows = attendanceDetailRows(summary.detail)
    expect(rows[0].status).toBe('absent')
    expect(rows.find((r) => r.person === 'Omar').checkIn).toBeNull()
    expect(rows.find((r) => r.person === 'Sara').checkIn).toBe('08:30')
    expect(rows.find((r) => r.person === 'Omar').rostered).toBe('08:00')
  })

  it('filters by status and query', () => {
    const rows = attendanceDetailRows(summary.detail)
    expect(filterDetailRows(rows, { status: 'absent' }).every((r) => r.status === 'absent')).toBe(true)
    expect(filterDetailRows(rows, { query: 'jed' }).map((r) => r.person).sort()).toEqual(['Omar', 'Sara'])
    expect(filterDetailRows(rows, {})).toHaveLength(rows.length)
  })

  it('person rate is null when unmeasurable', () => {
    const rows = personRows([{ person: 'X', present: 0, absent: 0 }, { person: 'Y', present: 3, absent: 1 }])
    expect(rows[0].rate).toBeNull()
    expect(rows[1].rate).toBe(0.75)
  })

  it('insights: repeat absentees, worst site, null late rate on empty', () => {
    const ins = absenceInsights(summary)
    expect(ins.repeatAbsentees).toContain('Ali')
    expect(ins.worstSite.site).toBe('NHC')
    expect(absenceInsights({}).lateRate).toBeNull()
    expect(absenceInsights({}).worstSite).toBeNull()
  })
})
