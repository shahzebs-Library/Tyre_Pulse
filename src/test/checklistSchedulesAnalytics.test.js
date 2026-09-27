import { describe, it, expect } from 'vitest'
import {
  dueState, daysToDue, targetSummary, enrichSchedules, filterSchedules, summarizeSchedules,
  scheduleExportRows, SCHEDULE_EXPORT_COLUMNS,
} from '../lib/checklistSchedulesAnalytics'

const NOW = new Date('2026-06-10T12:00:00').getTime()
const ROWS = [
  { id: 1, name: 'Weekly steer check', cadence: 'weekly', active: true, next_due: '2026-06-01', sites: ['NHC'], template_id: 't1' },
  { id: 2, name: 'Daily walk', cadence: 'daily', active: true, next_due: '2026-06-12', asset_nos: ['TM1', 'TM2'], template_id: 't1', assignee_role: 'Mechanic' },
  { id: 3, name: 'Monthly audit', cadence: 'monthly', active: true, next_due: '2026-08-01', template_id: 't2' },
  { id: 4, name: 'Paused', cadence: 'weekly', active: false, next_due: '2026-01-01' },
  { id: 5, name: 'Old', cadence: 'once', active: true, next_due: '2026-06-20', end_date: '2026-01-01' },
  { id: 6, name: 'No date', cadence: 'weekly', active: true, next_due: null },
]

describe('checklistSchedulesAnalytics', () => {
  it('assigns exactly one due state with the right precedence', () => {
    expect(ROWS.map((r) => dueState(r, NOW))).toEqual(['overdue', 'due_soon', 'scheduled', 'paused', 'ended', 'no_date'])
  })

  it('keeps the one-day grace before a schedule reads overdue (the rule the page always used)', () => {
    expect(dueState({ active: true, next_due: '2026-06-10' }, NOW)).toBe('due_soon')
    // due at midnight yesterday, now midday today: more than 24h past
    expect(dueState({ active: true, next_due: '2026-06-09' }, NOW)).toBe('overdue')
    expect(dueState({ active: true, next_due: '2026-06-09T13:00:00' }, NOW)).toBe('due_soon')
    expect(daysToDue({ next_due: null }, NOW)).toBeNull()
  })

  it('summarises a schedule target', () => {
    expect(targetSummary(ROWS[0])).toBe('1 site')
    expect(targetSummary(ROWS[1])).toBe('2 assets')
    expect(targetSummary(ROWS[2])).toBe('All')
  })

  it('filters enriched schedules by text, cadence, state and role', () => {
    const e = enrichSchedules(ROWS, NOW, (id) => (id === 't1' ? 'Steer sheet' : ''))
    expect(filterSchedules(e, { query: 'steer sheet' }).map((r) => r.id)).toEqual([1, 2])
    expect(filterSchedules(e, { cadence: 'weekly' }).map((r) => r.id)).toEqual([1, 4, 6])
    expect(filterSchedules(e, { state: 'overdue' }).map((r) => r.id)).toEqual([1])
    expect(filterSchedules(e, { role: 'Mechanic' }).map((r) => r.id)).toEqual([2])
    expect(filterSchedules(e, { role: 'anyone' })).toHaveLength(5)
    expect(filterSchedules(e, { query: 'tm2' }).map((r) => r.id)).toEqual([2])
  })

  it('summarises, with an on-time rate over running schedules only', () => {
    const s = summarizeSchedules(enrichSchedules(ROWS, NOW))
    expect(s).toMatchObject({ total: 6, active: 5, paused: 1, overdue: 1, dueSoon: 1, ended: 1, noDate: 1, unscoped: 4 })
    expect(s.onTimePct).toBe(75)
    expect(summarizeSchedules([]).onTimePct).toBeNull()
  })

  it('exports every column', () => {
    const out = scheduleExportRows(enrichSchedules(ROWS, NOW))
    expect(Object.keys(out[0])).toEqual(SCHEDULE_EXPORT_COLUMNS.map((c) => c.key))
    expect(out[3].active).toBe('No')
    expect(out[1].assignee_role).toBe('Mechanic')
  })
})
