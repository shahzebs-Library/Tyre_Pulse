import { describe, it, expect } from 'vitest'
import {
  isoDay, daysAgo, defaultFilters, quickRanges, activeQuickRange, activeFilterCount,
  fmtNum, fmtHours, fmtPct, fmtMin, labelReason, priorityRank, priorityLabel,
  buildKpis, leaderboardRows, delayRows, delayTotals, leaderboardExportRows, LEADERBOARD_EXPORT,
} from '../lib/workshopAnalyticsView'

// 2026-09-12 23:30 local - late evening, where a toISOString() date would drift.
const NOW = new Date(2026, 8, 12, 23, 30)

describe('date windows use the LOCAL calendar day', () => {
  it('builds local ISO days', () => {
    expect(isoDay(NOW)).toBe('2026-09-12')
    expect(daysAgo(7, NOW)).toBe('2026-09-05')
  })
  it('default window is the last 14 days, all sites', () => {
    expect(defaultFilters(NOW)).toEqual({ from: '2026-08-29', to: '2026-09-12', site: 'All' })
  })
  it('quick ranges and the active one', () => {
    const r = quickRanges(NOW)
    expect(r.map((q) => q.id)).toEqual(['7', '14', '30', 'month'])
    expect(r.find((q) => q.id === 'month').from).toBe('2026-09-01')
    expect(activeQuickRange(defaultFilters(NOW), NOW)).toBe('14')
    expect(activeQuickRange({ from: '2020-01-01', to: '2020-01-02' }, NOW)).toBeNull()
  })
  it('counts only filters that differ from the default', () => {
    expect(activeFilterCount(defaultFilters(NOW), NOW)).toBe(0)
    expect(activeFilterCount({ ...defaultFilters(NOW), site: 'NHC' }, NOW)).toBe(1)
    expect(activeFilterCount({ from: '2026-01-01', to: '2026-01-02', site: 'NHC' }, NOW)).toBe(2)
  })
})

describe('formatters are honest', () => {
  it('render N/A for missing values, never 0', () => {
    for (const f of [fmtNum, fmtHours, fmtPct, fmtMin]) {
      expect(f(null)).toBe('N/A')
      expect(f(undefined)).toBe('N/A')
      expect(f('abc')).toBe('N/A')
    }
    expect(fmtNum(0)).toBe('0')
    expect(fmtHours(12.5)).toBe('12.5 h')
    expect(fmtPct(66.6)).toBe('67%')
    expect(fmtMin(9.4)).toBe('9 min')
  })
  it('labels causes and priorities', () => {
    expect(labelReason('parts')).toBe('Parts')
    expect(labelReason('waiting_on_crane')).toBe('waiting on crane')
    expect(labelReason(null)).toBe('Other')
    expect(priorityRank('High')).toBe(3)
    expect(priorityRank('x')).toBe(0)
    expect(priorityLabel('medium')).toBe('Medium')
    expect(priorityLabel(null)).toBe('N/A')
  })
})

describe('kpis and rows', () => {
  it('builds the 8-tile strip with N/A on unmeasurable figures', () => {
    const k = buildKpis({ avgUtilization: null, totalProductiveHours: 10, firstTimeFixRate: 0.5, jobsCompleted: 4 }, { firstTime: 2, completed: 4 }, 'SAR')
    expect(k).toHaveLength(8)
    expect(k.find((x) => x.id === 'util').value).toBe('N/A')
    expect(k.find((x) => x.id === 'ftf').value).toBe('50%')
    expect(k.find((x) => x.id === 'ftf').sub).toBe('2 of 4')
    expect(k.find((x) => x.id === 'delay').sub).toMatch(/SAR/)
    expect(buildKpis(null, null).find((x) => x.id === 'ftf').sub).toBe('No completed jobs')
  })
  it('shapes the leaderboard and export with honest blanks', () => {
    const rows = leaderboardRows([{ userId: 'u1', rank: 1, name: 'Ali', productiveHours: 8, utilization: null, jobsCompleted: 2, blockedHours: 1 }])
    expect(rows[0]).toMatchObject({ id: 'u1', name: 'Ali', utilization: null })
    const out = leaderboardExportRows(rows)
    expect(out[0].utilization).toBe('N/A')
    expect(Object.keys(out[0])).toEqual(LEADERBOARD_EXPORT.map(([k]) => k))
  })
  it('shapes the delay register and totals', () => {
    const rows = delayRows([
      { reason: 'parts', hoursLost: 3, costImpact: 300, priority: 'high', responsibleDept: 'Stores', suggestedAction: 'Stock it' },
      { reason: 'tools', hoursLost: null, costImpact: 50, priority: 'low' },
    ])
    expect(rows[0]).toMatchObject({ cause: 'Parts', priorityLabel: 'High', priorityRank: 3 })
    expect(rows[1].responsibleDept).toBe('N/A')
    expect(delayTotals(rows)).toEqual({ hours: 3, cost: 350, highPriority: 1 })
    expect(delayTotals([])).toEqual({ hours: null, cost: null, highPriority: 0 })
  })
})
