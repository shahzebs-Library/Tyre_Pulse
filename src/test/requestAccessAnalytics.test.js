import { describe, it, expect } from 'vitest'
import {
  requestKpis, decisionMinutes, formatDecisionTime, remainingLabel, filterRequests,
  statusCounts, exportRows, EXPORT_COLUMNS, EXPORT_HEADERS,
} from '../lib/requestAccessAnalytics'

const NOW = Date.parse('2026-09-25T12:00:00Z')
const iso = (off) => new Date(NOW + off).toISOString()
const MIN = 60000

const ME = 'u1'
const ADMIN = 'a1'
const rows = [
  { id: 1, status: 'pending', created_at: iso(-10 * MIN), requested_by: ME, module_key: 'tyre_records', capability: 'edit', requested_minutes: 60, reason: 'fix serials' },
  { id: 2, status: 'approved', created_at: iso(-60 * MIN), decided_at: iso(-40 * MIN), requested_by: ME, decided_by: ADMIN, expires_at: iso(30 * MIN), granted_minutes: 60, module_key: 'stock', capability: 'view', reason: 'count' },
  { id: 3, status: 'approved', created_at: iso(-300 * MIN), decided_at: iso(-280 * MIN), requested_by: ME, decided_by: ADMIN, expires_at: iso(-10 * MIN), granted_minutes: 60, module_key: 'stock', capability: 'export', reason: 'report' },
  { id: 4, status: 'denied', created_at: iso(-500 * MIN), decided_at: iso(-470 * MIN), requested_by: ME, decided_by: ADMIN, module_key: 'accidents', capability: 'edit', reason: 'close case', decision_note: 'Not your site' },
  { id: 5, status: 'revoked', created_at: iso(-900 * MIN), decided_at: iso(-900 * MIN), requested_by: ADMIN, decided_by: ADMIN, module_key: 'fleet_master', capability: 'edit', reason: 'direct grant', revoke_reason: 'done' },
  { id: 6, status: 'cancelled', created_at: iso(-50 * MIN), requested_by: ME, module_key: 'stock', capability: 'view', reason: 'oops' },
]

describe('requestKpis', () => {
  it('counts each requester status and approvals ever', () => {
    const k = requestKpis(rows, NOW)
    expect(k.total).toBe(6)
    expect(k.pending).toBe(1)
    expect(k.active).toBe(1)
    expect(k.expired).toBe(1)
    expect(k.denied).toBe(1)
    expect(k.revoked).toBe(1)
    expect(k.closed).toBe(1)
    expect(k.approved).toBe(3) // active + expired + revoked
    expect(k.approvalRate).toBe(75)
  })
  it('averages decision time, excluding direct grants', () => {
    // 20, 20, 30 minutes; row 5 is a self-decided direct grant
    expect(requestKpis(rows, NOW).avgDecisionMinutes).toBe(23)
    expect(requestKpis(rows, NOW).decisionSample).toBe(3)
  })
  it('returns null (not 0) when nothing is measurable', () => {
    const k = requestKpis([rows[0]], NOW)
    expect(k.avgDecisionMinutes).toBeNull()
    expect(k.approvalRate).toBeNull()
    expect(requestKpis([], NOW).total).toBe(0)
  })
})

describe('decisionMinutes', () => {
  it('null for undecided, self-decided and reversed timestamps', () => {
    expect(decisionMinutes(rows[0])).toBeNull()
    expect(decisionMinutes(rows[4])).toBeNull()
    expect(decisionMinutes({ created_at: iso(0), decided_at: iso(-MIN) })).toBeNull()
    expect(decisionMinutes(rows[1])).toBe(20)
  })
})

describe('formatDecisionTime', () => {
  it('formats and says N/A for null', () => {
    expect(formatDecisionTime(null)).toBe('N/A')
    expect(formatDecisionTime(0)).toBe('0 min')
    expect(formatDecisionTime(90)).toBe('1h 30m')
    expect(formatDecisionTime(60 * 72)).toBe('3 days')
  })
})

describe('remainingLabel', () => {
  it('only for active grants', () => {
    expect(remainingLabel(rows[1], NOW)).toBe('30m 00s')
    expect(remainingLabel(rows[2], NOW)).toBeNull()
    expect(remainingLabel(rows[0], NOW)).toBeNull()
  })
})

describe('filterRequests + statusCounts', () => {
  it('filters by status and label-aware search', () => {
    expect(filterRequests(rows, { status: 'active' }, NOW).map((r) => r.id)).toEqual([2])
    expect(filterRequests(rows, { search: 'your site' }, NOW).map((r) => r.id)).toEqual([4])
    const labels = { moduleLabel: (k) => (k === 'stock' ? 'Stock Management' : k) }
    expect(filterRequests(rows, { search: 'management' }, NOW, labels)).toHaveLength(3)
  })
  it('counts per status', () => {
    expect(statusCounts(rows, NOW)).toEqual({ pending: 1, active: 1, expired: 1, denied: 1, revoked: 1, cancelled: 1 })
  })
})

describe('exportRows', () => {
  it('flattens with N/A for blanks and matches the column list', () => {
    const out = exportRows(rows, NOW)
    expect(EXPORT_COLUMNS).toHaveLength(EXPORT_HEADERS.length)
    for (const r of out) expect(Object.keys(r)).toEqual(EXPORT_COLUMNS)
    expect(out[0].decided).toBe('N/A')
    expect(out[0].decision_time).toBe('N/A')
    expect(out[1].remaining).toBe('30m 00s')
    expect(out[4].note).toBe('Revoked: done')
  })
})
