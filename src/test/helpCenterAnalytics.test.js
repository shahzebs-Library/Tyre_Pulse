import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(), auth: { getUser: vi.fn() } } }))

const {
  ticketKpis, filterTickets, sortTickets, ticketExportRows, responseHours,
  resolutionHours, ageDays, formatHours,
} = await import('../lib/helpCenterAnalytics')

const NOW = new Date('2026-09-27T12:00:00Z').getTime()
const rows = [
  { id: 1, subject: 'Import fails', message: 'CSV rejected', category: 'data', severity: 'high', status: 'open', created_at: '2026-09-17T12:00:00Z', created_by_name: 'Ali' },
  { id: 2, subject: 'How to export', message: 'question', category: 'question', severity: 'low', status: 'in_progress', admin_response: 'Use the Excel button', created_at: '2026-09-26T12:00:00Z', responded_at: '2026-09-26T14:00:00Z' },
  { id: 3, subject: 'Login bug', message: 'blank page', category: 'bug', severity: 'critical', status: 'resolved', admin_response: 'Fixed', created_at: '2026-09-20T00:00:00Z', responded_at: '2026-09-20T04:00:00Z', resolved_at: '2026-09-21T00:00:00Z' },
  { id: 4, subject: 'Old', message: '', category: null, severity: 'medium', status: 'closed', created_at: '2026-08-01T00:00:00Z' },
]

describe('helpCenterAnalytics', () => {
  it('measures response and resolution only when timestamps exist', () => {
    expect(responseHours(rows[1])).toBe(2)
    expect(responseHours(rows[0])).toBeNull()
    expect(resolutionHours(rows[2])).toBe(24)
    expect(resolutionHours(rows[1])).toBeNull()
    expect(ageDays(rows[0], NOW)).toBe(10)
    expect(ageDays(rows[2], NOW)).toBeNull()
  })

  it('builds KPIs honestly', () => {
    const k = ticketKpis(rows, { now: NOW })
    expect(k.total).toBe(4)
    expect(k.unresolved).toBe(2)
    expect(k.criticalOpen).toBe(1)
    expect(k.awaitingResponse).toBe(1)
    expect(k.resolvedRate).toBe(50)
    expect(k.responseRate).toBe(50)
    expect(k.medianResponseHours).toBe(3)
    expect(k.medianResolutionHours).toBe(24)
    expect(k.oldestOpenDays).toBe(10)
    expect(k.staleOpen).toBe(1)
    expect(k.byCategory.find((c) => c.key === 'other').count).toBe(1)
    const empty = ticketKpis([], { now: NOW })
    expect(empty.resolvedRate).toBeNull()
    expect(empty.medianResponseHours).toBeNull()
    expect(empty.oldestOpenDays).toBeNull()
  })

  it('filters and sorts worst first', () => {
    expect(filterTickets(rows, { search: 'csv' }).map((r) => r.id)).toEqual([1])
    expect(filterTickets(rows, { category: 'other' }).map((r) => r.id)).toEqual([4])
    expect(filterTickets(rows, { awaiting: true }).map((r) => r.id)).toEqual([1])
    expect(filterTickets(rows, { severity: 'critical', status: 'resolved' }).map((r) => r.id)).toEqual([3])
    expect(sortTickets(rows).map((r) => r.id)).toEqual([1, 2, 3, 4])
  })

  it('formats hours and exports N/A for gaps', () => {
    expect(formatHours(null)).toBe('N/A')
    expect(formatHours(0.5)).toBe('30 min')
    expect(formatHours(72)).toBe('3.0 days')
    const out = ticketExportRows(rows, NOW)
    expect(out[0].responseTime).toBe('N/A')
    expect(out[0].age).toBe(10)
    expect(out[3].category).toBe('Other')
  })
})
