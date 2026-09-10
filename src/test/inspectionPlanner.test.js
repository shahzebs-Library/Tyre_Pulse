// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { addDays, diffDays, weekStart, monthBounds, buildScheduleDates, getInspectionGap, getScheduleCompletion, getFleetCoverage, findScheduleConflicts } from '../lib/inspectionPlanner'

describe('inspection planner dates', () => {
  it('advances calendar dates in Riyadh, including local today near midnight', () => {
    const moduleUrl = new URL('../lib/inspectionPlanner.js', import.meta.url).href
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `import { addDays, todayStr } from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify([addDays('2026-09-10', 1), todayStr(new Date('2026-09-09T22:00:00Z'))]))`], { env: { ...process.env, TZ: 'Asia/Riyadh' }, encoding: 'utf8' })
    expect(JSON.parse(output)).toEqual(['2026-09-11', '2026-09-10'])
  })
  it('handles leap days, month bounds, and Sunday week starts', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(diffDays('2026-03-07', '2026-03-10')).toBe(3)
    expect(weekStart('2026-09-10')).toBe('2026-09-06')
    expect(monthBounds('2026-01-31', -1)).toEqual({ start: '2025-12-01', end: '2025-12-31' })
    expect(monthBounds('2024-02-29')).toEqual({ start: '2024-02-01', end: '2024-02-29' })
  })
  it('rejects impossible and reversed dates without entering an unbounded loop', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError)
    expect(() => buildScheduleDates('', '2026-09-10')).toThrow(RangeError)
    expect(() => buildScheduleDates('2026-09-11', '2026-09-10')).toThrow(/End date/)
    expect(() => buildScheduleDates('2026-01-01', '2027-01-02')).toThrow(/366/)
    expect(() => buildScheduleDates('2026-09-11', '2026-09-11', [0])).toThrow(/No selected/)
    expect(buildScheduleDates('2026-09-10', '2026-09-13', [0, 1, 2, 3, 4])).toEqual(['2026-09-10', '2026-09-13'])
  })
})

describe('inspection planner metrics', () => {
  it('keeps missing history separate from numerical overdue duration', () => {
    expect(getInspectionGap(null, '2026-09-10', 30)).toEqual({ days_since: null, days_overdue: null, status: 'No History' })
    expect(getInspectionGap('2026-08-01', '2026-09-10', 30)).toEqual({ days_since: 40, days_overdue: 10, status: 'Overdue' })
  })
  it('uses only explicitly completed schedules due to date and excludes cancellations', () => {
    const result = getScheduleCompletion([
      { inspection_date: '2026-09-01', status: 'Completed' },
      { inspection_date: '2026-09-02', status: 'Scheduled' },
      { inspection_date: '2026-09-03', status: 'Cancelled' },
      { inspection_date: '2026-09-20', status: 'Completed' },
    ], { start: '2026-09-01', end: '2026-09-30', today: '2026-09-10' })
    expect(result).toEqual({ due: 2, completed: 1, rate: 50 })
    expect(getScheduleCompletion([], { start: '2026-09-01', end: '2026-09-30', today: '2026-09-10' }).rate).toBeNull()
  })
  it('counts distinct known fleet assets with inspections in the interval', () => {
    expect(getFleetCoverage([{ asset_no: 'A' }, { asset_no: 'B' }, { asset_no: 'A' }], [
      { asset_no: 'A', inspection_date: '2026-09-01' },
      { asset_no: 'A', inspection_date: '2026-09-02' },
      { asset_no: 'UNKNOWN', inspection_date: '2026-09-02' },
      { asset_no: 'B', inspection_date: '2026-09-20' },
    ], { today: '2026-09-10', interval: 30 })).toEqual({ total: 2, covered: 1, rate: 50 })
  })
  it('does not share inspection coverage between reused asset numbers across countries', () => {
    expect(getFleetCoverage([{ asset_no: 'A', country: 'KSA' }, { asset_no: 'A', country: 'UAE' }], [
      { asset_no: 'A', country: 'KSA', inspection_date: '2026-09-01' },
      { asset_no: 'A', country: null, inspection_date: '2026-09-02' },
    ], { today: '2026-09-10', interval: 30 })).toEqual({ total: 2, covered: 1, rate: 50 })
  })
})

describe('schedule conflict checks', () => {
  const job = { id: 'one', asset_no: 'A', inspector_name: 'Inspector', inspection_date: '2026-09-10', inspection_time: '08:00:00', status: 'Scheduled' }
  it('detects asset duplicates and inspector slot clashes within a proposed batch', () => {
    const candidate = { ...job, id: undefined, inspection_time: '08:00' }
    expect(findScheduleConflicts([candidate], [job]).map(conflict => conflict.type)).toEqual(['asset', 'inspector'])
    expect(findScheduleConflicts([candidate, { ...candidate, asset_no: 'B' }]).map(conflict => conflict.type)).toEqual(['inspector'])
  })
  it('ignores the edited record and cancellations while preserving other conflicts', () => {
    expect(findScheduleConflicts([job], [job])).toEqual([])
    expect(findScheduleConflicts([{ ...job, id: 'two' }], [{ ...job, status: 'Cancelled' }])).toEqual([])
    expect(findScheduleConflicts([{ ...job, status: 'Cancelled' }], [{ ...job, id: 'two' }])).toEqual([])
  })
  it('separates different known countries but still flags unclassified legacy appointments', () => {
    expect(findScheduleConflicts([{ ...job, id: 'two', country: 'KSA' }], [{ ...job, country: 'UAE' }])).toEqual([])
    expect(findScheduleConflicts([{ ...job, id: 'two', country: 'KSA' }], [{ ...job, country: null }])).toHaveLength(2)
  })
})
