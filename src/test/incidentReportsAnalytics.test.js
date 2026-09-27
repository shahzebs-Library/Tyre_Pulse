import { describe, it, expect } from 'vitest'
import {
  incidentTableRows, filterIncidents, hasIncidentFilters, incidentKpis, incidentMonthlyTrend,
  incidentsBySite, incidentsByType, incidentExportRows, incidentSiteOptions, INCIDENT_FILTERS,
} from '../lib/incidentReportsAnalytics'

const NOW = Date.parse('2026-09-27T12:00:00Z')
const rows = [
  { id: 1, incident_no: 'IR-1', incident_type: 'damage', site: 'NHC', status: 'open', severity: 'high', incident_date: '2026-09-17', description: 'Sidewall cut' },
  { id: 2, incident_no: 'IR-2', incident_type: 'near_miss', site: 'NHC', status: 'investigating', severity: 'low', incident_date: '2026-09-25' },
  { id: 3, incident_no: 'IR-3', incident_type: 'theft', site: '', status: 'closed', severity: 'critical', incident_date: '2025-12-01' },
  { id: 4, incident_no: 'IR-4', incident_type: 'other', site: 'JED', status: 'open', severity: 'medium', incident_date: null },
]

describe('incidentReportsAnalytics', () => {
  it('filters by status, severity, type, site, date window and text', () => {
    expect(filterIncidents(rows, { ...INCIDENT_FILTERS, status: 'open' }).map((r) => r.id)).toEqual([1, 4])
    expect(filterIncidents(rows, { ...INCIDENT_FILTERS, severity: 'critical' }).map((r) => r.id)).toEqual([3])
    expect(filterIncidents(rows, { ...INCIDENT_FILTERS, site: 'NHC', type: 'damage' }).map((r) => r.id)).toEqual([1])
    expect(filterIncidents(rows, { ...INCIDENT_FILTERS, from: '2026-09-20' }).map((r) => r.id)).toEqual([2])
    expect(filterIncidents(rows, { ...INCIDENT_FILTERS, search: 'sidewall' }).map((r) => r.id)).toEqual([1])
    expect(hasIncidentFilters(INCIDENT_FILTERS)).toBe(false)
    expect(hasIncidentFilters({ ...INCIDENT_FILTERS, severity: 'low' })).toBe(true)
  })

  it('computes honest KPIs: undated open incidents have no age', () => {
    const k = incidentKpis(rows, NOW)
    expect(k).toMatchObject({ total: 4, open: 3, highCritical: 2, resolved: 1, oldestOpenDays: 10, openUndated: 1 })
    expect(k.avgOpenAgeDays).toBe(6) // (10 + 2) / 2
    expect(k.resolutionRatePct).toBe(25)
    const empty = incidentKpis([], NOW)
    expect(empty.resolutionRatePct).toBeNull()
    expect(empty.avgOpenAgeDays).toBeNull()
    expect(empty.oldestOpenDays).toBeNull()
  })

  it('builds a zero-filled 12-month trend and counts undated rows', () => {
    const t = incidentMonthlyTrend(rows, NOW, 12)
    expect(t.keys).toHaveLength(12)
    expect(t.keys[11]).toBe('2026-09')
    expect(t.counts[11]).toBe(2)
    expect(t.highCritical[11]).toBe(1)
    expect(t.counts[t.keys.indexOf('2025-12')]).toBe(1)
    expect(t.undated).toBe(1)
    expect(t.labels[11]).toBe('Sep 26')
    expect(incidentMonthlyTrend(rows, NaN).keys).toEqual([])
  })

  it('breaks incidents down by site and type', () => {
    const s = incidentsBySite(rows)
    expect(s[0]).toEqual({ site: 'NHC', total: 2, open: 2, highCritical: 1 })
    expect(s.find((x) => x.site === 'Site not recorded').total).toBe(1)
    const t = incidentsByType(rows)
    expect(t.find((x) => x.type === 'damage').count).toBe(1)
    expect(t.find((x) => x.type === 'safety').count).toBe(0)
    expect(incidentSiteOptions(rows)).toEqual(['JED', 'NHC'])
  })

  it('labels rows and exports N/A for an unknown age', () => {
    const tr = incidentTableRows(rows, NOW)
    expect(tr[0]).toMatchObject({ _age: 10, _open: true, _typeLabel: 'Damage', _severityLabel: 'High', _statusLabel: 'Open' })
    const out = incidentExportRows(rows, NOW)
    expect(out[3].age_days).toBe('N/A')
    expect(out[1].incident_type).toBe('Near miss')
  })
})
