import { describe, it, expect } from 'vitest'
import {
  dueDeltaDays, dueHint, effectiveStatus, decorateAssignments, checklistKpis,
  filterByTab, filterAssignments, distinctValues, tabCount, assignmentExportRows,
} from '../lib/myChecklistsAnalytics'

const NOW = new Date('2026-09-10T10:00:00')
const rows = [
  { id: 1, template_name: 'A', status: 'pending', due_date: '2026-09-08', site: 'NHC' },
  { id: 2, template_name: 'B', status: 'pending', due_date: '2026-09-12', site: 'JED', asset_no: 'TM1' },
  { id: 3, template_name: 'A', status: 'completed', due_date: '2026-09-01' },
  { id: 4, template_name: 'C', status: 'skipped', due_date: null },
  { id: 5, template_name: 'C', status: 'pending', due_date: null },
]

describe('myChecklistsAnalytics', () => {
  it('computes due deltas and hints against an injected now', () => {
    expect(dueDeltaDays('2026-09-08', NOW)).toBe(-2)
    expect(dueDeltaDays(null, NOW)).toBeNull()
    expect(dueHint('2026-09-08', 'overdue', NOW).text).toBe('2 days overdue')
    expect(dueHint('2026-09-10', 'pending', NOW).text).toBe('Due today')
    expect(dueHint(null, 'pending', NOW).text).toBe('No due date')
    expect(effectiveStatus(rows[0], NOW)).toBe('overdue')
    expect(effectiveStatus(rows[4], NOW)).toBe('pending')
  })

  it('orders by urgency and rolls up honest KPIs', () => {
    const d = decorateAssignments(rows, NOW)
    expect(d.map((a) => a.id)).toEqual([1, 2, 5, 3, 4])
    const k = checklistKpis(d)
    expect(k).toMatchObject({ overdue: 1, pending: 2, completed: 1, skipped: 1, todo: 3, total: 5, dueThisWeek: 1 })
    expect(k.completionRate).toBeCloseTo(33.3, 1)
    expect(checklistKpis([]).completionRate).toBeNull()
    expect(tabCount('todo', k)).toBe(3)
    expect(tabCount('all', k)).toBe(5)
  })

  it('filters by tab, search, site and checklist', () => {
    const d = decorateAssignments(rows, NOW)
    expect(filterByTab(d, 'todo')).toHaveLength(3)
    expect(filterByTab(d, 'skipped')).toHaveLength(1)
    expect(filterAssignments(d, { q: 'tm1' }).map((a) => a.id)).toEqual([2])
    expect(filterAssignments(d, { site: 'NHC' })).toHaveLength(1)
    expect(filterAssignments(d, { template: 'C' })).toHaveLength(2)
    expect(distinctValues(d, 'site')).toEqual(['JED', 'NHC'])
  })

  it('exports every filtered row', () => {
    const out = assignmentExportRows(decorateAssignments(rows, NOW), NOW)
    expect(out).toHaveLength(5)
    expect(out[0]).toMatchObject({ checklist: 'A', status: 'Overdue', due: '2 days overdue' })
  })
})
