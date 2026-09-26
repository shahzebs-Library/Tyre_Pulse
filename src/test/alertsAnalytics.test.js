import { describe, it, expect } from 'vitest'
import {
  alertSeverity, alertSite, alertAgeDays, alertSinceDate, buildAlertRows, summarizeAlerts,
  filterAlertRows, sortAlertRows, alertExportRows, bySite, UNRATED, NO_SITE,
  ALERT_EXPORT_COLS, ALERT_EXPORT_HEADERS,
} from '../lib/alertsAnalytics'

const NOW = new Date('2026-09-26T12:00:00Z')

const ALERTS = [
  { id: 'a1', type: 'OVERDUE_ACTION', severity: 'critical', title: 'Overdue Action: Fix', message: 'x', data: { site: 'NHC', due_date: '2026-09-06' } },
  { id: 'a2', type: 'INSPECTION_OVERDUE', severity: 'high', title: 'Overdue Inspection', message: 'y', data: { site: 'JED', scheduled_date: '2026-09-23' } },
  { id: 'a3', type: 'STOCK_CRITICAL', severity: 'medium', title: 'Low Stock', message: 'z', data: { site: 'NHC' } },
  { id: 'a4', type: 'DATA_QUALITY', severity: 'info', title: 'Missing Cost', message: 'q', data: { missingCost: 3 } },
  { id: 'a5', type: 'VEHICLE_INACTIVE', severity: 'bogus', title: 'Vehicle TM1', message: 'r', data: { lastSeen: '2026-06-01T00:00:00Z', site: 'JED' } },
]

describe('alert field readers', () => {
  it('goes through the severity ladder and keeps unreadable severities visible', () => {
    expect(alertSeverity(ALERTS[0])).toBe('Critical')
    expect(alertSeverity(ALERTS[3])).toBe('Info')
    expect(alertSeverity(ALERTS[4])).toBe(UNRATED)
  })

  it('reads the site from the source record and returns null when none', () => {
    expect(alertSite(ALERTS[0])).toBe('NHC')
    expect(alertSite(ALERTS[3])).toBeNull()
    expect(alertSite({ site: '  ' })).toBeNull()
  })

  it('derives age only from a real source date and never fabricates 0', () => {
    expect(alertAgeDays(ALERTS[0], NOW)).toBe(20)
    expect(alertAgeDays(ALERTS[1], NOW)).toBe(3)
    expect(alertAgeDays(ALERTS[4], NOW)).toBe(117)
    expect(alertAgeDays(ALERTS[2], NOW)).toBeNull()
    expect(alertSinceDate(ALERTS[2])).toBeNull()
    expect(alertAgeDays({ data: { due_date: 'not a date' } }, NOW)).toBeNull()
  })
})

describe('summarizeAlerts', () => {
  const rows = buildAlertRows(ALERTS, new Set(['a3']), { now: NOW })

  it('counts open alerts per severity and the dismissal rate', () => {
    const s = summarizeAlerts(rows, { olderThanDays: 7 })
    expect(s.total).toBe(5)
    expect(s.open).toBe(4)
    expect(s.acknowledged).toBe(1)
    expect(s.ackRate).toBe(20)
    expect(s.bySeverity.Critical).toBe(1)
    expect(s.bySeverity.Medium).toBe(0)
    expect(s.bySeverity[UNRATED]).toBe(1)
    expect(s.urgent).toBe(2)
  })

  it('counts only alerts with a known age as older than N', () => {
    const s = summarizeAlerts(rows, { olderThanDays: 7 })
    expect(s.olderThan).toBe(2)
    expect(s.agedKnown).toBe(3)
    expect(s.oldestDays).toBe(117)
    expect(s.ageCoverage).toBe(75)
  })

  it('reports null rather than 0 when nothing can be measured', () => {
    const s = summarizeAlerts([])
    expect(s.ackRate).toBeNull()
    expect(s.olderThan).toBeNull()
    expect(s.oldestDays).toBeNull()
    expect(s.ageCoverage).toBeNull()
    const noAge = summarizeAlerts(buildAlertRows([ALERTS[2]], new Set(), { now: NOW }))
    expect(noAge.olderThan).toBeNull()
  })

  it('groups open alerts per site with an honest bucket for none', () => {
    const s = summarizeAlerts(rows)
    expect(s.bySite).toEqual([
      { name: 'JED', count: 2 },
      { name: 'NHC', count: 1 },
      { name: NO_SITE, count: 1 },
    ])
    expect(s.sitesAffected).toBe(2)
    expect(bySite([])).toEqual([])
  })
})

describe('filter, sort and export', () => {
  const rows = buildAlertRows(ALERTS, new Set(['a3']), { now: NOW, typeLabels: { STOCK_CRITICAL: 'Stock' } })

  it('filters by status, severity, site, age and search', () => {
    expect(filterAlertRows(rows).length).toBe(4)
    expect(filterAlertRows(rows, { status: 'dismissed' }).map((r) => r.id)).toEqual(['a3'])
    expect(filterAlertRows(rows, { status: 'all', site: 'NHC' }).length).toBe(2)
    expect(filterAlertRows(rows, { site: NO_SITE }).map((r) => r.id)).toEqual(['a4'])
    expect(filterAlertRows(rows, { minAgeDays: 7 }).map((r) => r.id).sort()).toEqual(['a1', 'a5'])
    expect(filterAlertRows(rows, { search: 'inspection' }).map((r) => r.id)).toEqual(['a2'])
    expect(filterAlertRows(rows, { severity: 'Critical' }).map((r) => r.id)).toEqual(['a1'])
  })

  it('sorts worst first and oldest first within a level', () => {
    const sorted = sortAlertRows(rows).map((r) => r.id)
    expect(sorted[0]).toBe('a1')
    expect(sorted[sorted.length - 1]).toBe('a5')
  })

  it('exports N/A for unknowns and matches the header list', () => {
    const out = alertExportRows(rows)
    expect(ALERT_EXPORT_COLS.length).toBe(ALERT_EXPORT_HEADERS.length)
    const stock = out.find((r) => r.title === 'Low Stock')
    expect(stock.type).toBe('Stock')
    expect(stock.age).toBe('N/A')
    expect(stock.status).toBe('Dismissed')
    const dq = out.find((r) => r.title === 'Missing Cost')
    expect(dq.site).toBe('N/A')
  })
})
