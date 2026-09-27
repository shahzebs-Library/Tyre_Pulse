import { describe, it, expect } from 'vitest'
import {
  filterActions, actionKpis, categoryBars, severityShares, actionTableRows,
  actionExportRows, activeActionFilterCount, EMPTY_ACTION_FILTERS,
  categoryLabel, statusLabel,
} from '../lib/actionCenterAnalytics'

const NOW = Date.parse('2026-09-27T12:00:00Z')

const ROWS = [
  { id: 1, title: 'Steer tyre below legal tread', category: 'tyre', severity: 'critical', status: 'open', due_date: '2026-09-20', asset_no: 'TRK-1', assigned_to: 'Ali' },
  { id: 2, title: 'Missing inspection', category: 'inspection', severity: 'medium', status: 'in_progress', due_date: '2026-10-10', assigned_to: '' },
  { id: 3, title: 'Cost spike', category: 'cost', severity: 'low', status: 'resolved', due_date: '2026-09-01' },
  { id: 4, title: 'Duplicate serial', category: 'data_quality', severity: 'info', status: 'dismissed' },
]

describe('actionCenterAnalytics', () => {
  it('filters by search, status, severity, category and open-only, ranking worst first', () => {
    expect(filterActions(ROWS, { search: 'serial' }, NOW).map((r) => r.id)).toEqual([4])
    expect(filterActions(ROWS, { status: 'resolved' }, NOW).map((r) => r.id)).toEqual([3])
    expect(filterActions(ROWS, { severity: 'medium' }, NOW).map((r) => r.id)).toEqual([2])
    expect(filterActions(ROWS, { category: 'tyre' }, NOW).map((r) => r.id)).toEqual([1])
    const open = filterActions(ROWS, { openOnly: true }, NOW)
    expect(open.map((r) => r.id)).toEqual([1, 2])
    expect(filterActions(ROWS, EMPTY_ACTION_FILTERS, NOW)[0].id).toBe(1)
  })

  it('reports the resolution rate as null (N/A) when there is nothing to resolve', () => {
    const empty = actionKpis([], NOW)
    expect(empty.resolutionRate).toBeNull()
    expect(empty.overdueShare).toBeNull()
    expect(empty.totalItems).toBe(0)
  })

  it('computes counts, overdue share and unassigned open items', () => {
    const k = actionKpis(ROWS, NOW)
    expect(k.totalItems).toBe(4)
    expect(k.openCount).toBe(2)
    expect(k.overdueCount).toBe(1)
    expect(k.overdueShare).toBe(50)
    expect(k.resolutionRate).toBe(25)
    expect(k.unassignedOpen).toBe(1)
  })

  it('scales category bars against the busiest open count with visible floors', () => {
    const bars = categoryBars([{ category: 'tyre', open: 4, total: 5 }, { category: 'cost', open: 0, total: 2 }, { category: 'safety', open: 1, total: 1 }])
    expect(bars[0]).toMatchObject({ label: 'Tyre', widthPct: 100 })
    expect(bars[1].widthPct).toBe(3)
    expect(bars[2].widthPct).toBe(25)
  })

  it('turns severity counts into ordered shares', () => {
    const s = severityShares({ critical: 1, high: 0, medium: 3, low: 0, info: 0 })
    expect(s.map((x) => x.key)).toEqual(['critical', 'high', 'medium', 'low', 'info'])
    expect(s[0].pct).toBe(25)
    expect(severityShares({}).every((x) => x.pct === 0)).toBe(true)
  })

  it('shapes table rows with labels, overdue flags and days late', () => {
    const t = actionTableRows(ROWS, NOW)
    expect(t[0]).toMatchObject({ _overdue: true, _daysOverdue: 7, _categoryLabel: 'Tyre', _statusLabel: 'Open' })
    expect(t[2]._overdue).toBe(false) // resolved items are never overdue
  })

  it('exports labels, keeps blanks blank and never fabricates a zero', () => {
    const out = actionExportRows(ROWS, NOW)
    expect(out[0].days_overdue).toBe(7)
    expect(out[1].days_overdue).toBe('')
    expect(out[3].priority_score).toBe('')
    expect(out[3].category).toBe('Data Quality')
  })

  it('counts active filters and labels unknown tokens honestly', () => {
    expect(activeActionFilterCount(EMPTY_ACTION_FILTERS)).toBe(0)
    expect(activeActionFilterCount({ search: ' x ', status: 'open', openOnly: true })).toBe(3)
    expect(categoryLabel('')).toBe('Other')
    expect(statusLabel('weird')).toBe('weird')
  })
})
