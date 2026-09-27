import { describe, it, expect } from 'vitest'
import {
  deliveryStatus, recipientCount, summarizeDeliveryLog, filterDeliveryLog,
} from '../lib/reportCenterAnalytics'

const NOW = new Date('2026-09-27T12:00:00Z').getTime()
const rows = [
  { id: 1, schedule_name: 'Daily exec', report_type: 'executive', status: 'sent', recipients: ['a@x', 'b@x'], sent_at: '2026-09-26T05:00:00Z' },
  { id: 2, schedule_name: 'Daily exec', report_type: 'executive', status: 'error', recipients: ['a@x'], sent_at: '2026-09-25T05:00:00Z' },
  { id: 3, schedule_name: 'Claims', report_type: 'claims', status: 'Success', recipients: null, sent_at: '2026-08-01T05:00:00Z' },
  { id: 4, schedule_name: 'PM', report_type: 'pm', status: 'queued' },
  { id: 5, schedule_name: 'Odd', status: 'weird' },
]

describe('deliveryStatus', () => {
  it('folds the free-text vocabulary', () => {
    expect(rows.map(deliveryStatus)).toEqual(['sent', 'failed', 'sent', 'pending', 'unknown'])
  })
  it('counts recipients only when the list exists', () => {
    expect(recipientCount(rows[0])).toBe(2)
    expect(recipientCount(rows[2])).toBeNull()
  })
})

describe('summarizeDeliveryLog', () => {
  it('computes delivery KPIs over decided sends', () => {
    const s = summarizeDeliveryLog(rows, NOW)
    expect(s.total).toBe(5)
    expect(s.counts).toEqual({ sent: 2, failed: 1, pending: 1, unknown: 1 })
    expect(s.successRate).toBeCloseTo(66.7, 1)
    expect(s.recipients).toBe(3)
    expect(s.lastSent).toBe('2026-09-26T05:00:00.000Z')
    expect(s.lastFailed).toBe('2026-09-25T05:00:00.000Z')
    expect(s.last7).toBe(2)
    expect(s.byType[0]).toMatchObject({ key: 'executive', total: 2, sent: 1, failed: 1 })
  })
  it('reports N/A (null) on an empty log', () => {
    const s = summarizeDeliveryLog([], NOW)
    expect(s.successRate).toBeNull()
    expect(s.recipients).toBeNull()
    expect(s.lastSent).toBeNull()
  })
})

describe('filterDeliveryLog', () => {
  it('filters by status, type and search', () => {
    expect(filterDeliveryLog(rows, { status: 'failed' }).map(r => r.id)).toEqual([2])
    expect(filterDeliveryLog(rows, { type: 'unspecified' }).map(r => r.id)).toEqual([5])
    expect(filterDeliveryLog(rows, { search: 'b@x' }).map(r => r.id)).toEqual([1])
    expect(filterDeliveryLog(rows, { search: 'claims' }).map(r => r.id)).toEqual([3])
  })
})
