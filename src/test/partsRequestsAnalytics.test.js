import { describe, it, expect } from 'vitest'
import {
  decorateRequests, openAgeing, openByPriority, fillRate, fmtAge, requestExportRows,
} from '../lib/partsRequestsAnalytics'

const NOW = new Date('2026-09-10T12:00:00Z')
const rows = [
  { id: 1, status: 'requested', priority: 'high', requested_at: '2026-09-10T00:00:00Z', needed_by: '2026-09-09' },
  { id: 2, status: 'approved', priority: 'critical', requested_at: '2026-09-08T12:00:00Z' },
  { id: 3, status: 'issued', priority: 'weird', requested_at: '2026-08-20T12:00:00Z' },
  { id: 4, status: 'requested', priority: 'low', requested_at: null },
  { id: 5, status: 'fulfilled', priority: 'medium', requested_at: '2026-09-01T00:00:00Z', fulfilled_at: '2026-09-02T00:00:00Z', needed_by: '2026-08-01' },
  { id: 6, status: 'rejected', priority: 'low' },
]

describe('partsRequestsAnalytics', () => {
  it('decorates overdue and age without inventing values', () => {
    const d = decorateRequests(rows, NOW)
    expect(d[0]).toMatchObject({ _open: true, _overdue: true, _ageHours: 12 })
    expect(d[3]._ageHours).toBeNull()
    expect(d[4]._overdue).toBe(false)
  })

  it('ages open requests into buckets', () => {
    const a = openAgeing(decorateRequests(rows, NOW))
    expect(a.buckets.map((b) => b.count)).toEqual([1, 1, 0, 1])
    expect(a.undated).toBe(1)
  })

  it('splits open requests by priority', () => {
    const p = openByPriority(decorateRequests(rows, NOW))
    expect(p.byPriority.find((x) => x.priority === 'high').count).toBe(1)
    expect(p.byPriority.find((x) => x.priority === 'critical').count).toBe(1)
    expect(p.other).toBe(1)
  })

  it('reports a null fill rate before any outcome', () => {
    expect(fillRate(decorateRequests(rows, NOW))).toBe(50)
    expect(fillRate(decorateRequests(rows.slice(0, 2), NOW))).toBeNull()
    expect(fmtAge(null)).toBe('N/A')
    expect(fmtAge(72)).toBe('3 d')
  })

  it('exports every row', () => {
    const out = requestExportRows(decorateRequests(rows, NOW))
    expect(out).toHaveLength(6)
    expect(out[0]).toMatchObject({ overdue: 'Yes', age: '12 h' })
  })
})
