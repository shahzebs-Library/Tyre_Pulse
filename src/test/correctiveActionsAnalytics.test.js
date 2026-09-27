import { describe, it, expect } from 'vitest'
import {
  overdueDays, daysOpen, avgDaysToClose, matchesSearch, statusCounts, overdueRate,
  rootCauseDistribution, siteBreakdown, sortActions, actionExportRows,
} from '../lib/correctiveActionsAnalytics'

const NOW = Date.parse('2026-09-20T12:00:00Z')
const rows = [
  { id: 1, title: 'Fix valve', status: 'Open', priority: 'High', site: 'NHC', due_date: '2026-09-10', created_at: '2026-09-01', root_cause: 'Under Inflation' },
  { id: 2, title: 'Align axle', status: 'In Progress', priority: 'Low', site: 'NHC', due_date: '2026-10-01', created_at: '2026-09-15', root_cause: 'Alignment Issue' },
  { id: 3, title: 'Replace', status: 'Closed', priority: 'Medium', site: 'JED', due_date: '2026-09-01', created_at: '2026-08-01', closed_at: '2026-08-11', root_cause: 'Under Inflation' },
  { id: 4, title: 'Unknown', status: 'Open', priority: 'Medium', created_at: null },
]

describe('correctiveActionsAnalytics', () => {
  it('computes overdue days against an injected now', () => {
    expect(overdueDays('2026-09-10', 'Open', NOW)).toBe(10)
    expect(overdueDays('2026-09-10', 'Closed', NOW)).toBeNull()
    expect(overdueDays(null, 'Open', NOW)).toBeNull()
    expect(overdueDays('2026-10-01', 'Open', NOW)).toBeNull()
  })

  it('returns null age when created_at is unknown', () => {
    expect(daysOpen(null, null, NOW)).toBeNull()
    expect(daysOpen('2026-08-01', '2026-08-11', NOW)).toBe(10)
  })

  it('averages close time over closed actions only', () => {
    expect(avgDaysToClose(rows, NOW)).toBe(10)
    expect(avgDaysToClose([rows[0]], NOW)).toBeNull()
  })

  it('searches the typed fields', () => {
    expect(matchesSearch(rows[0], 'valve')).toBe(true)
    expect(matchesSearch(rows[0], 'NHC')).toBe(true)
    expect(matchesSearch(rows[0], 'zzz')).toBe(false)
    expect(matchesSearch(rows[0], '')).toBe(true)
  })

  it('counts statuses and overdue share of open actions', () => {
    expect(statusCounts(rows)).toEqual({ Open: 2, 'In Progress': 1, Closed: 1 })
    expect(overdueRate(rows, NOW)).toBeCloseTo((1 / 3) * 100)
    expect(overdueRate([rows[2]], NOW)).toBeNull()
  })

  it('ranks root causes and sites', () => {
    expect(rootCauseDistribution(rows)[0]).toEqual({ cause: 'Under Inflation', count: 2 })
    const s = siteBreakdown(rows, NOW)
    expect(s[0]).toMatchObject({ site: 'NHC', open: 2, overdue: 1 })
    expect(s.find(x => x.site === 'No site').total).toBe(1)
  })

  it('sorts the card view without mutating', () => {
    const copy = [...rows]
    expect(sortActions(rows, 'priority', NOW)[0].priority).toBe('High')
    expect(sortActions(rows, 'overdue', NOW)[0].id).toBe(1)
    expect(sortActions(rows, 'created_at', NOW)[0].id).toBe(2)
    expect(rows).toEqual(copy)
  })

  it('exports N/A for missing values', () => {
    const ex = actionExportRows(rows, NOW)
    expect(ex[3].site).toBe('N/A')
    expect(ex[3].age_days).toBe('N/A')
    expect(ex[0].overdue_days).toBe(10)
    expect(ex[0].source).toBe('Manual')
  })
})
