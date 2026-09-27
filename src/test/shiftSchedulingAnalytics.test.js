import { describe, expect, it } from 'vitest'
import {
  shiftHours, dayKey, enrichShifts, filterShifts, shiftKpis, coverageNextDays, hoursByRole,
  roleOptions, siteOptions, activeShiftFilterCount, shiftExportRows, EMPTY_SHIFT_FILTERS,
} from '../lib/shiftSchedulingAnalytics'

const NOW = new Date(2026, 8, 27, 10, 0, 0) // 27 Sep 2026 local
const rows = [
  { id: 1, person_name: 'Ahmed', role: 'Driver', shift_date: '2026-09-27', start_time: '08:00', end_time: '16:00', site: 'RUH', status: 'scheduled' },
  { id: 2, person_name: 'Bilal', role: 'Technician', shift_date: '2026-09-29', start_time: '22:00', end_time: '06:00', site: 'JED', status: 'scheduled' },
  { id: 3, person_name: 'ahmed', role: 'Driver', shift_date: '2026-09-20', start_time: '08:00', end_time: '12:30', site: 'RUH', status: 'scheduled' },
  { id: 4, person_name: 'Carl', role: 'Driver', shift_date: '2026-09-21', status: 'completed' },
  { id: 5, person_name: 'Dana', role: 'Fitter', shift_date: '2026-09-22', start_time: '08:00', end_time: '10:00', status: 'absent' },
  { id: 6, person_name: 'Eve', role: 'Driver', shift_date: '', start_time: '08:00', end_time: '10:00', status: 'cancelled' },
]

describe('shiftSchedulingAnalytics', () => {
  it('computes rostered hours with overnight handling and null for missing times', () => {
    expect(shiftHours('08:00', '16:00')).toBe(8)
    expect(shiftHours('22:00', '06:00')).toBe(8)
    expect(shiftHours('08:00', '')).toBeNull()
    expect(shiftHours('bad', '10:00')).toBeNull()
    expect(dayKey(NOW)).toBe('2026-09-27')
  })

  it('classifies timing and flags past shifts never closed out', () => {
    const e = enrichShifts(rows, NOW)
    expect(e.map((r) => r._timing)).toEqual(['today', 'upcoming', 'past', 'past', 'past', 'undated'])
    expect(e.map((r) => r._openPast)).toEqual([false, false, true, false, false, false])
  })

  it('builds KPIs with honest null rates', () => {
    const k = shiftKpis(enrichShifts(rows, NOW))
    expect(k).toMatchObject({ total: 6, people: 5, today: 1, upcoming: 1, openPast: 1 })
    expect(k.rosteredHours).toBe(22.5)
    expect(k.timedShifts).toBe(4)
    expect(k.attendanceRate).toBe(50)
    expect(k.absenceRate).toBe(50)
    const empty = shiftKpis([])
    expect(empty.rosteredHours).toBeNull()
    expect(empty.absenceRate).toBeNull()
    expect(empty.attendanceRate).toBeNull()
  })

  it('filters by status, role, site, timing, dates and search', () => {
    const e = enrichShifts(rows, NOW)
    expect(filterShifts(e, { ...EMPTY_SHIFT_FILTERS, openPastOnly: true }).map((r) => r.id)).toEqual([3])
    expect(filterShifts(e, { ...EMPTY_SHIFT_FILTERS, timing: 'upcoming' }).map((r) => r.id)).toEqual([2])
    expect(filterShifts(e, { ...EMPTY_SHIFT_FILTERS, role: 'Driver', site: 'RUH' }).map((r) => r.id)).toEqual([1, 3])
    expect(filterShifts(e, { ...EMPTY_SHIFT_FILTERS, from: '2026-09-21', to: '2026-09-22' }).map((r) => r.id)).toEqual([4, 5])
    expect(filterShifts(e, { ...EMPTY_SHIFT_FILTERS, search: 'bilal' }).map((r) => r.id)).toEqual([2])
    expect(activeShiftFilterCount({ ...EMPTY_SHIFT_FILTERS, status: 'absent', openPastOnly: true })).toBe(2)
  })

  it('builds coverage, hours by role, options and export', () => {
    const e = enrichShifts(rows, NOW)
    const cov = coverageNextDays(e, NOW, 3)
    expect(cov).toEqual([{ day: '2026-09-27', shifts: 1 }, { day: '2026-09-28', shifts: 0 }, { day: '2026-09-29', shifts: 1 }])
    expect(hoursByRole(e)).toEqual([{ role: 'Driver', hours: 12.5 }, { role: 'Technician', hours: 8 }, { role: 'Fitter', hours: 2 }])
    expect(roleOptions(rows)).toEqual(['Driver', 'Fitter', 'Technician'])
    expect(siteOptions(rows)).toEqual(['JED', 'RUH'])
    const out = shiftExportRows(e)
    expect(out[2]).toMatchObject({ not_closed: 'Yes', timing: 'Past', hours: 4.5 })
    expect(out[3].hours).toBe('N/A')
  })
})
