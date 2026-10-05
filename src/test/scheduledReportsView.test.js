import { describe, it, expect } from 'vitest'
import {
  moduleOf, time12, ordinal, scheduleLabel, scheduleStatus, healthSegments, registryKpis,
  expectedOn, deliveryTrend, recentActivity, filterRegistry, recipientOptions, recipientInitials,
} from '../lib/scheduledReportsView'

const NOW = new Date(2026, 9, 5, 14, 30).getTime() // 5 Oct 2026 local
const iso = (y, m, d, h = 9) => new Date(y, m, d, h).toISOString()

describe('scheduledReportsView', () => {
  it('maps report types to modules', () => {
    expect(moduleOf('kpi')).toBe('Tyres')
    expect(moduleOf('builder:abc')).toBe('Custom layout')
    expect(moduleOf('zzz')).toBe('Other')
  })

  it('formats cadence labels', () => {
    expect(time12('07:00')).toBe('07:00 AM')
    expect(time12('18:30:00')).toBe('06:30 PM')
    expect(time12('00:05')).toBe('12:05 AM')
    expect(time12('junk')).toBeNull()
    expect(ordinal(1)).toBe('1st'); expect(ordinal(12)).toBe('12th'); expect(ordinal(22)).toBe('22nd')
    expect(scheduleLabel({ frequency: 'weekly', day_of_week: 1, time_of_day: '07:00' })).toEqual({ line1: 'Weekly', line2: 'Mon 07:00 AM' })
    expect(scheduleLabel({ frequency: 'monthly', day_of_month: 28, time_of_day: '08:00' }).line2).toBe('28th 08:00 AM')
    expect(scheduleLabel({ frequency: 'daily' }).line2).toBe('Time not set')
  })

  it('derives status', () => {
    expect(scheduleStatus({ active: false }, null, NOW)).toBe('paused')
    expect(scheduleStatus({ active: true }, { status: 'failed' }, NOW)).toBe('failing')
    expect(scheduleStatus({ active: true }, { status: 'sent' }, NOW)).toBe('active')
    expect(scheduleStatus({ active: true, frequency: 'once', run_at: iso(2026, 8, 1) }, null, NOW)).toBe('expired')
  })

  it('counts health segments', () => {
    const seg = healthSegments([{ id: 1, active: true }, { id: 2, active: false }, { id: 3, active: true }],
      [{ schedule_id: 3, status: 'failed', sent_at: iso(2026, 9, 4) }], NOW)
    expect(Object.fromEntries(seg.map((s) => [s.key, s.count]))).toEqual({ active: 1, paused: 1, failing: 1, expired: 0 })
  })

  it('computes KPIs with honest trends', () => {
    const schedules = [{ id: 1, active: true, recipients: ['a@x.com', 'B@x.com'] }, { id: 2, active: false, recipients: ['c@x.com'] }]
    const runs = [
      { status: 'sent', sent_at: iso(2026, 9, 2) },
      { status: 'sent', sent_at: iso(2026, 9, 3) },
      { status: 'failed', sent_at: iso(2026, 9, 3) },
      { status: 'sent', sent_at: iso(2026, 8, 10) },
    ]
    const k = registryKpis(schedules, runs, { now: NOW, windowStart: NOW - 70 * 86400000 })
    expect(k).toMatchObject({ total: 2, active: 1, activePct: 50, deliveries: 2, failed: 1, recipients: 2 })
    expect(k.deliveriesTrend).toBe(100)
    expect(k.failedTrend).toBeNull() // last month had 0 failures: no trend
    expect(k.successPct).toBeCloseTo(66.7)
    const short = registryKpis(schedules, runs, { now: NOW, windowStart: NOW - 7 * 86400000 })
    expect(short.deliveriesTrend).toBeNull() // previous month not loaded
    expect(registryKpis([], [], { now: NOW }).activePct).toBeNull()
  })

  it('derives expected runs and the 7-day trend', () => {
    const mon = new Date(2026, 9, 5) // a Monday
    expect(expectedOn({ active: true, frequency: 'weekly', day_of_week: 1 }, mon)).toBe(true)
    expect(expectedOn({ active: true, frequency: 'weekly', day_of_week: 2 }, mon)).toBe(false)
    expect(expectedOn({ active: false, frequency: 'daily' }, mon)).toBe(false)
    expect(expectedOn({ active: true, frequency: 'daily', start_date: '2026-10-10' }, mon)).toBe(false)
    const t = deliveryTrend([{ status: 'sent', sent_at: iso(2026, 9, 5) }, { status: 'failed', sent_at: iso(2026, 9, 4) }],
      [{ active: true, frequency: 'daily' }], NOW, 7)
    expect(t).toHaveLength(7)
    expect(t[6]).toMatchObject({ date: '2026-10-05', sent: 1, failed: 0, expected: 1 })
    expect(t[5].failed).toBe(1)
  })

  it('builds recent activity and filters', () => {
    const a = recentActivity([
      { id: 1, status: 'sent', sent_at: iso(2026, 9, 1), recipients: ['a'], schedule_name: 'A' },
      { id: 2, status: 'failed', sent_at: iso(2026, 9, 2), error: 'SMTP  down', schedule_name: 'B' },
      { id: 3, status: 'sent', sent_at: null },
    ])
    expect(a.map((x) => x.id)).toEqual([2, 1])
    expect(a[0].detail).toBe('SMTP down')
    expect(a[1].detail).toBe('to 1 recipient')
    const rows = [
      { id: 1, report_type: 'kpi', output_formats: ['excel'], recipients: ['A@x.com'], active: true },
      { id: 2, report_type: 'fleet', active: true },
    ]
    expect(filterRegistry(rows, { module: 'Tyres' }, { now: NOW }).map((r) => r.id)).toEqual([1])
    expect(filterRegistry(rows, { format: 'pdf' }, { now: NOW }).map((r) => r.id)).toEqual([2])
    expect(filterRegistry(rows, { recipient: 'a@x.com' }, { now: NOW }).map((r) => r.id)).toEqual([1])
    expect(recipientOptions(rows)).toEqual(['a@x.com'])
  })
})

describe('recipientInitials', () => {
  it('builds avatar initials from the address', () => {
    expect(recipientInitials('ahmad.khan@x.com')).toBe('AK')
    expect(recipientInitials('ops@x.com')).toBe('O')
    expect(recipientInitials('')).toBe('?')
    expect(recipientInitials('__@x.com')).toBe('?')
  })
})
