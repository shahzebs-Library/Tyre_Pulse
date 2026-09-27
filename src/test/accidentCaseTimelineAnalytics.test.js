import { describe, it, expect } from 'vitest'
import {
  summarizeTimeline, filterEntries, sortNotifications, notificationChannels,
  filterNotifications, notificationRows, timelineExportRows, categoryLabel,
} from '../lib/accidentCaseTimelineAnalytics'

const NOW = new Date('2026-08-29T12:00:00Z').getTime()
const entries = [
  { id: 'a', at: '2026-08-28T09:00:00Z', category: 'actions', title: 'Accident reported', actor: 'Ibrahim', status: 'completed', chips: ['Verified 2/3'] },
  { id: 'b', at: '2026-08-28T10:00:00Z', category: 'sla', title: 'Vendor receipt', status: 'completed', slaMet: true, durationMs: 3600000 },
  { id: 'c', at: '2026-08-28T11:00:00Z', category: 'sla', title: 'Repair start', status: 'pending' },
]
const notifications = [
  { id: 'n1', occurred_at: '2026-08-28T09:40:00Z', channel: 'comment', direction: 'internal', subject: 'Note' },
  { id: 'n2', occurred_at: '2026-08-28T10:05:00Z', channel: 'email_out', direction: 'outbound', subject: 'Package', to_party: 'Insurance' },
]

describe('accidentCaseTimelineAnalytics', () => {
  it('summarises the feed honestly', () => {
    const s = summarizeTimeline({ entries, notifications, participants: [{ name: 'X' }] }, NOW)
    expect(s.entries).toBe(3)
    expect(s.pending).toBe(1)
    expect(s.slaEntries).toBe(2)
    expect(s.slaMet).toBe(1)
    expect(s.slaMetPct).toBe(50)
    expect(s.outbound).toBe(1)
    expect(s.spanLabel).toBe('2h')
    expect(s.lastActivityAt).toBe('2026-08-28T11:00:00.000Z')
    expect(s.sinceLastActivityLabel).toBe('1d 1h')
  })

  it('returns null, not zero, when nothing can be measured', () => {
    const s = summarizeTimeline({}, NOW)
    expect(s.slaMetPct).toBeNull()
    expect(s.spanLabel).toBeNull()
    expect(s.lastActivityAt).toBeNull()
    expect(s.entries).toBe(0)
  })

  it('filters entries by category and search including chips', () => {
    expect(filterEntries(entries, { category: 'sla' })).toHaveLength(2)
    expect(filterEntries(entries, { search: 'verified' }).map((e) => e.id)).toEqual(['a'])
    expect(filterEntries(entries, { category: 'actions', search: 'repair' })).toHaveLength(0)
  })

  it('sorts notifications newest first and lists channels', () => {
    expect(sortNotifications(notifications).map((n) => n.id)).toEqual(['n2', 'n1'])
    expect(notificationChannels(notifications).map((c) => c.label)).toEqual(['Comment', 'Email'])
    expect(filterNotifications(notifications, { channel: 'comment' })).toHaveLength(1)
  })

  it('flattens notifications with honest labels', () => {
    const rows = notificationRows(notifications, new Map([['insurance', 3]]), NOW)
    expect(rows[0].statusText).toBe('Logged')
    expect(rows[0].recipients).toBe('Not set')
    expect(rows[1].statusText).toBe('Sent')
    expect(rows[1].recipients).toBe('Insurance · 3')
    expect(rows[1].channelText).toBe('Email')
  })

  it('builds timeline export rows', () => {
    const rows = timelineExportRows(entries)
    expect(rows[0]).toMatchObject({ category: 'Actions', elapsed: 'First entry', detail: 'Verified 2/3' })
    expect(rows[1].status).toBe('Completed (SLA met)')
    expect(rows[2].status).toBe('Pending')
    expect(categoryLabel('nope')).toBe('Not set')
  })
})
