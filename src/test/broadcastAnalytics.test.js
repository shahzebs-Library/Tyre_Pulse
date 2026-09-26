import { describe, it, expect } from 'vitest'
import {
  broadcastTime, isTargeted, hasArabic, filterBroadcasts, broadcastKpis,
  statusBreakdown, targetBreakdown, monthlyVolume, broadcastExportRows,
} from '../lib/broadcastAnalytics'

const NOW = Date.parse('2026-09-26T12:00:00Z')
const MSGS = [
  { id: 1, title: 'Site meeting', body: 'NHC 07:00', target_roles: ['Manager'], target_countries: ['KSA'], target_sites: [], send_push: true, status: 'sent', recipient_count: 10, push_count: 2, sent_at: '2026-09-20T08:00:00Z' },
  { id: 2, title: 'Holiday', body: 'Office closed', title_ar: 'عطلة', body_ar: 'مغلق', target_roles: [], target_countries: [], target_sites: [], send_push: false, status: 'sent', recipient_count: 30, push_count: 0, sent_at: '2026-06-01T08:00:00Z' },
  { id: 3, title: 'Draft', body: 'x', status: null, recipient_count: null, push_count: null, created_at: 'bad' },
]

describe('broadcastAnalytics', () => {
  it('reads time, targeting and Arabic honestly', () => {
    expect(broadcastTime(MSGS[2])).toBeNull()
    expect(isTargeted(MSGS[0])).toBe(true)
    expect(isTargeted(MSGS[1])).toBe(false)
    expect(hasArabic(MSGS[1])).toBe(true)
    expect(hasArabic({ title_ar: 'x' })).toBe(false)
  })

  it('filters by period, audience, push and search', () => {
    expect(filterBroadcasts(MSGS, { period: '30', now: NOW }).map((m) => m.id)).toEqual([1])
    expect(filterBroadcasts(MSGS, { audience: 'everyone' }).map((m) => m.id)).toEqual([2, 3])
    expect(filterBroadcasts(MSGS, { push: 'push' }).map((m) => m.id)).toEqual([1])
    expect(filterBroadcasts(MSGS, { search: 'manager', labelFn: (m) => (m.target_roles || []).join(',') }).map((m) => m.id)).toEqual([1])
  })

  it('computes KPIs with null rates on empty', () => {
    const k = broadcastKpis(MSGS, NOW)
    expect(k).toMatchObject({ messages: 3, recipients: 40, pushes: 2, arabic: 1, targeted: 1, everyone: 2, last30Days: 1, daysSinceLast: 6 })
    expect(k.phoneReachPct).toBe(5)
    const e = broadcastKpis([], NOW)
    expect(e.phoneReachPct).toBeNull()
    expect(e.avgRecipients).toBeNull()
    expect(e.lastSentAt).toBeNull()
  })

  it('breaks down status, targets and months', () => {
    expect(statusBreakdown(MSGS)[0]).toEqual({ status: 'sent', count: 2 })
    expect(statusBreakdown(MSGS).some((s) => s.status === 'Unrecorded')).toBe(true)
    expect(targetBreakdown(MSGS, 'target_countries')).toEqual([{ value: 'KSA', count: 1 }])
    const mv = monthlyVolume(MSGS, NOW, 6)
    expect(mv).toHaveLength(6)
    expect(mv[mv.length - 1]).toMatchObject({ key: '2026-09', messages: 1, recipients: 10 })
    expect(mv.find((b) => b.key === '2026-06').recipients).toBe(30)
  })

  it('exports with N/A for missing values', () => {
    const rows = broadcastExportRows(MSGS)
    expect(rows[0].audience).toBe('Targeted')
    expect(rows[2].sent).toBe('N/A')
    expect(rows[1].arabic).toBe('Yes')
  })
})
