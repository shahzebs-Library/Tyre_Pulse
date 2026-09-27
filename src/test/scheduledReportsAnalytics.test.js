import { describe, expect, it } from 'vitest'
import {
  filterSchedules, recipientCountOf, shortReason, validateEmails, nextScheduledRun, nextRunBucket,
  scheduleKpis, typeBreakdown, deliveryRows, scheduleExportRows,
} from '../lib/scheduledReportsAnalytics'

const NOW = Date.UTC(2026, 8, 27, 8, 0, 0)
const schedules = [
  { id: 'a', name: 'Weekly Exec', report_type: 'executive', frequency: 'weekly', active: true, recipients: ['ceo@x.com', 'OPS@x.com'], next_run_at: new Date(NOW + 3600_000).toISOString() },
  { id: 'b', name: 'Daily Fleet', report_type: 'fleet', frequency: 'daily', active: false, recipients: ['ops@x.com'], next_run_at: new Date(NOW + 60_000).toISOString() },
  { id: 'c', name: 'Claims', report_type: 'claims', frequency: 'monthly', active: true, recipients: [], next_run_at: 'junk' },
]

describe('filters', () => {
  it('filters by frequency, status and text incl. recipients and type label', () => {
    expect(filterSchedules(schedules, { frequency: 'daily' })).toHaveLength(1)
    expect(filterSchedules(schedules, { status: 'active' })).toHaveLength(2)
    expect(filterSchedules(schedules, { status: 'inactive' })[0].id).toBe('b')
    expect(filterSchedules(schedules, { search: 'ceo@' })[0].id).toBe('a')
    expect(filterSchedules(schedules, { search: 'insurance', typeLabelFor: (t) => (t === 'claims' ? 'Insurance claims' : t) })[0].id).toBe('c')
  })
})

describe('helpers', () => {
  it('recipients, reasons, emails', () => {
    expect(recipientCountOf({ recipients: ['a', 'b'] })).toBe(2); expect(recipientCountOf({})).toBe(0)
    expect(shortReason('x'.repeat(200))).toHaveLength(120); expect(shortReason('  ')).toBe('')
    expect(validateEmails('a@b.co\nbad\n\n')).toEqual({ emails: ['a@b.co', 'bad'], invalid: ['bad'] })
  })
  it('next run ignores paused and junk schedules', () => {
    expect(nextScheduledRun(schedules).name).toBe('Weekly Exec')
    expect(nextScheduledRun([{ active: false, next_run_at: '2026-01-01' }])).toBeNull()
  })
  it('buckets relative to injected now', () => {
    expect(nextRunBucket(null, NOW)).toBeNull()
    expect(nextRunBucket(new Date(NOW - 1).toISOString(), NOW).bucket).toBe('due')
    expect(nextRunBucket(new Date(NOW + 3600_000).toISOString(), NOW).bucket).toBe('today')
    expect(nextRunBucket(new Date(NOW + 30 * 3600_000).toISOString(), NOW).bucket).toBe('tomorrow')
    expect(nextRunBucket(new Date(NOW + 72 * 3600_000).toISOString(), new Date(NOW)).bucket).toBe('later')
  })
})

describe('kpis and rows', () => {
  const runs = [
    { id: 1, schedule_id: 'a', status: 'sent', sent_at: '2026-09-20T07:00:00Z', recipients: ['x'] },
    { id: 2, schedule_id: 'a', status: 'failed', sent_at: '2026-09-21T07:00:00Z', error: 'Resend 429' },
    { id: 3, schedule_id: 'c', status: 'sent', sent_at: '2026-09-21T07:00:00Z' },
  ]
  it('success rate is null without deliveries', () => {
    expect(scheduleKpis(schedules, []).successRate).toBeNull()
  })
  it('computes counts, failing schedules and unique recipients', () => {
    const k = scheduleKpis(schedules, runs)
    expect(k.active).toBe(2); expect(k.paused).toBe(1); expect(k.successRate).toBeCloseTo(66.7)
    expect(k.failingSchedules).toBe(1); expect(k.uniqueRecipients).toBe(2)
  })
  it('breakdown, delivery rows, export rows', () => {
    expect(typeBreakdown(schedules)[0].count).toBe(1)
    const d = deliveryRows(runs)
    expect(d[0].reason).toBe('N/A'); expect(d[1].reason).toBe('Resend 429'); expect(d[1].status).toBe('Failed')
    const e = scheduleExportRows(schedules, { health: new Map([['a', { lastStatus: 'failed' }]]) })
    expect(e[0].last_delivery).toBe('Failed'); expect(e[1].next_run).toBe('N/A'); expect(e[2].last_delivery).toBe('No deliveries')
  })
})
