import { describe, it, expect } from 'vitest'
import {
  emailStats, pushStats, mergeTrend,
} from '../lib/api/deliveryHealth'

describe('emailStats', () => {
  const rows = [
    { id: 1, report_type: 'kpi', status: 'sent', sent_at: '2026-07-10T09:00:00Z' },
    { id: 2, report_type: 'kpi', status: 'error', error: 'smtp', sent_at: '2026-07-10T10:00:00Z' },
    { id: 3, report_type: 'claims', status: 'sent', sent_at: '2026-07-11T09:00:00Z' },
    { id: 4, report_type: 'claims', status: 'failed', error: 'bounce', sent_at: '2026-07-11T10:00:00Z' },
  ]

  it('counts sent vs failed and computes failure rate', () => {
    const s = emailStats(rows)
    expect(s.sent).toBe(2)
    expect(s.failed).toBe(2)
    expect(s.total).toBe(4)
    expect(s.failureRate).toBe(0.5)
  })

  it('breaks down by report type', () => {
    const s = emailStats(rows)
    const kpi = s.byType.find((t) => t.type === 'kpi')
    expect(kpi).toMatchObject({ sent: 1, failed: 1, total: 2 })
  })

  it('builds an ascending per-day series', () => {
    const s = emailStats(rows)
    expect(s.byDay.map((d) => d.date)).toEqual(['2026-07-10', '2026-07-11'])
    expect(s.byDay[0]).toMatchObject({ sent: 1, failed: 1 })
  })

  it('lists only failures in recentFailures with a channel tag', () => {
    const s = emailStats(rows)
    expect(s.recentFailures).toHaveLength(2)
    expect(s.recentFailures.every((r) => r.channel === 'email')).toBe(true)
  })

  it('is empty-safe', () => {
    const s = emailStats(null)
    expect(s.total).toBe(0)
    expect(s.failureRate).toBe(0)
    expect(s.recentFailures).toEqual([])
  })
})

describe('pushStats', () => {
  const rows = [
    { id: 1, event_type: 'inspection.approval_requested', status: 'delivered', recipient_count: 3, created_at: '2026-07-10T09:00:00Z' },
    { id: 2, event_type: 'checklist.approval_requested', status: 'failed', last_error: 'no token', recipient_count: 1, created_at: '2026-07-10T10:00:00Z' },
    { id: 3, event_type: 'x', status: 'queued', recipient_count: 2, created_at: '2026-07-11T09:00:00Z' },
    { id: 4, event_type: 'y', status: 'error', response_status: 500, recipient_count: 0, created_at: '2026-07-11T10:00:00Z' },
  ]

  it('counts delivered / failed / queued and sums recipients', () => {
    const s = pushStats(rows)
    expect(s.delivered).toBe(1)
    expect(s.failed).toBe(2) // failed + error
    expect(s.queued).toBe(1)
    expect(s.recipients).toBe(6)
  })

  it('computes failure rate over settled (delivered + failed) only', () => {
    const s = pushStats(rows)
    expect(s.failureRate).toBeCloseTo(2 / 3, 5)
  })

  it('surfaces http status as an error detail when no last_error', () => {
    const s = pushStats(rows)
    const httpFail = s.recentFailures.find((r) => r.id === 4)
    expect(httpFail.error).toBe('HTTP 500')
  })

  it('is empty-safe', () => {
    const s = pushStats(undefined)
    expect(s).toMatchObject({ delivered: 0, failed: 0, queued: 0, recipients: 0, failureRate: 0 })
  })
})

describe('mergeTrend', () => {
  it('merges email + push per-day series on shared dates', () => {
    const email = emailStats([
      { status: 'sent', report_type: 'kpi', sent_at: '2026-07-10T09:00:00Z' },
      { status: 'error', report_type: 'kpi', sent_at: '2026-07-10T10:00:00Z' },
    ])
    const push = pushStats([
      { status: 'delivered', recipient_count: 1, created_at: '2026-07-10T11:00:00Z' },
      { status: 'delivered', recipient_count: 1, created_at: '2026-07-11T09:00:00Z' },
    ])
    const t = mergeTrend(email, push)
    expect(t.map((r) => r.date)).toEqual(['2026-07-10', '2026-07-11'])
    expect(t[0]).toMatchObject({ emailSent: 1, emailFailed: 1, pushDelivered: 1, pushFailed: 0 })
    expect(t[1]).toMatchObject({ emailSent: 0, pushDelivered: 1 })
  })

  it('is empty-safe with empty stats', () => {
    expect(mergeTrend({}, {})).toEqual([])
  })
})
