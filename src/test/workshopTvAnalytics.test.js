import { describe, it, expect } from 'vitest'
import { shapeWorkshopSnapshot, tvNumber, priorityKey, statusFamily, sinceLabel, nextPageIndex } from '../lib/workshopTvAnalytics'

const NOW = new Date('2026-09-27T12:00:00Z')

describe('workshopTvAnalytics', () => {
  it('missing or junk KPI values are null, never 0', () => {
    const s = shapeWorkshopSnapshot({ kpis: { open_jobs: 4, overdue_jobs: null, working: 'x', utilization: 'abc' } }, { now: NOW })
    expect(s.kpis.open_jobs).toBe(4)
    expect(s.kpis.overdue_jobs).toBeNull()
    expect(s.kpis.working).toBeNull()
    expect(s.kpis.absent).toBeUndefined()
    expect(s.utilization).toBeNull()
    expect(tvNumber(true)).toBeNull()
    expect(tvNumber('12')).toBe(12)
  })

  it('orders cards by priority, VOR by longest off road, alerts by level', () => {
    const s = shapeWorkshopSnapshot({
      open_job_cards: [{ wo_no: 'a', priority: 'Low' }, { wo_no: 'b', priority: 'Critical' }, { wo_no: 'c', priority: 'High' }],
      vor_list: [{ asset_no: 'x', since: '2026-09-27T10:00:00Z' }, { asset_no: 'y', since: '2026-09-20T12:00:00Z' }, { asset_no: 'z', since: null }],
      safety_alerts: [{ level: 'info', message: 'i' }, { level: 'critical', message: 'c' }],
      jobs_by_status: [{ label: 'Open', value: 3 }, { label: 'Done', value: 0 }],
    }, { now: NOW })
    expect(s.openCards.map((c) => c.wo_no)).toEqual(['b', 'c', 'a'])
    expect(s.vorList.map((v) => v.asset_no)).toEqual(['y', 'x', 'z'])
    expect(s.vorList.map((v) => v.sinceText)).toEqual(['7d', '2h', 'N/A'])
    expect(s.alerts[0].level).toBe('critical')
    expect(s.jobsByStatus).toEqual([{ label: 'Open', value: 3 }])
    expect(s.counts).toEqual({ openCards: 3, critical: 1, vor: 3, criticalAlerts: 1 })
  })

  it('handles an empty snapshot safely', () => {
    const s = shapeWorkshopSnapshot(null, { now: NOW })
    expect(s.openCards).toEqual([])
    expect(s.counts.openCards).toBe(0)
  })

  it('helpers', () => {
    expect(priorityKey('MEDIUM')).toBe('medium')
    expect(priorityKey('')).toBe('unknown')
    expect(statusFamily('Waiting for parts')).toBe('waiting')
    expect(statusFamily('In Progress')).toBe('active')
    expect(sinceLabel('garbage', { now: NOW })).toBe('N/A')
    expect(nextPageIndex(0, 3)).toBe(1)
    expect(nextPageIndex(2, 3)).toBe(0)
    expect(nextPageIndex(0, 0)).toBe(0)
  })
})
