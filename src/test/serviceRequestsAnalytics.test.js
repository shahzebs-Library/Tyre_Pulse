import { describe, expect, it } from 'vitest'
import {
  enrichRequests, openAgeHours, filterRequests, srKpis, monthlyFlow, categoryMix,
  assigneeOptions, activeSrFilterCount, srExportRows, statusLabel, EMPTY_SR_FILTERS,
} from '../lib/serviceRequestsAnalytics'

const NOW = new Date('2026-09-27T12:00:00Z')
const rows = [
  { id: 1, request_no: 'SR-1', subject: 'Flat tyre', category: 'tyre', priority: 'urgent', status: 'new', requested_at: '2026-09-27T00:00:00Z', assigned_to: '' },
  { id: 2, request_no: 'SR-2', subject: 'Brake noise', category: 'mechanical', priority: 'low', status: 'in_progress', requested_at: '2026-09-26T12:00:00Z', assigned_to: 'Team A' },
  { id: 3, request_no: 'SR-3', subject: 'Lamp', category: 'electrical', priority: 'medium', status: 'resolved', requested_at: '2026-08-01T00:00:00Z', resolved_at: '2026-08-01T10:00:00Z', assigned_to: 'Team A' },
  { id: 4, request_no: 'SR-4', subject: 'No date', category: 'tyre', priority: 'high', status: 'triaged' },
]

describe('serviceRequestsAnalytics', () => {
  it('measures open age only when a start time exists', () => {
    expect(openAgeHours(rows[0], NOW)).toBe(12)
    expect(openAgeHours(rows[2], NOW)).toBeNull()
    expect(openAgeHours(rows[3], NOW)).toBeNull()
  })

  it('flags open requests past their priority target', () => {
    const e = enrichRequests(rows, NOW)
    expect(e.map((r) => r._overdue)).toEqual([true, false, false, false])
    expect(e[2]._resolution).toBe(10)
    expect(e[1]._statusLabel).toBe('In progress')
  })

  it('computes KPIs with honest nulls', () => {
    const k = srKpis(enrichRequests(rows, NOW))
    expect(k).toMatchObject({ total: 4, open: 3, urgentOpen: 1, overdue: 1, unassignedOpen: 2, resolved: 1, resolvedPct: 25 })
    expect(k.avgResolutionHours).toBe(10)
    expect(k.avgOpenAgeHours).toBe(18)
    const empty = srKpis([])
    expect(empty.avgResolutionHours).toBeNull()
    expect(empty.resolvedPct).toBeNull()
    expect(empty.avgOpenAgeHours).toBeNull()
  })

  it('filters by every dimension', () => {
    const e = enrichRequests(rows, NOW)
    expect(filterRequests(e, { ...EMPTY_SR_FILTERS, openOnly: true })).toHaveLength(3)
    expect(filterRequests(e, { ...EMPTY_SR_FILTERS, overdueOnly: true }).map((r) => r.id)).toEqual([1])
    expect(filterRequests(e, { ...EMPTY_SR_FILTERS, assignee: '__none' }).map((r) => r.id)).toEqual([1, 4])
    expect(filterRequests(e, { ...EMPTY_SR_FILTERS, assignee: 'Team A' })).toHaveLength(2)
    expect(filterRequests(e, { ...EMPTY_SR_FILTERS, category: 'tyre', priority: 'high' }).map((r) => r.id)).toEqual([4])
    expect(filterRequests(e, { ...EMPTY_SR_FILTERS, search: 'brake' }).map((r) => r.id)).toEqual([2])
    expect(activeSrFilterCount({ ...EMPTY_SR_FILTERS, openOnly: true, status: 'new' })).toBe(2)
  })

  it('builds flow, category mix, options and export rows', () => {
    const e = enrichRequests(rows, NOW)
    expect(monthlyFlow(e)).toEqual([{ month: '2026-08', raised: 1, resolved: 1 }, { month: '2026-09', raised: 2, resolved: 0 }])
    expect(categoryMix(e)[0]).toEqual({ category: 'tyre', count: 2 })
    expect(assigneeOptions(rows)).toEqual(['Team A'])
    expect(statusLabel('cancelled')).toBe('Cancelled')
    const out = srExportRows(e)
    expect(out[0]).toMatchObject({ overdue: 'Yes', open_age_h: 12, resolution_h: 'N/A' })
    expect(out[2]).toMatchObject({ overdue: 'N/A', resolution_h: 10, open_age_h: 'N/A' })
  })
})
