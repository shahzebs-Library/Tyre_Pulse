import { describe, it, expect } from 'vitest'
import {
  filterShareRows, shareKpis, expiryText, relativeAgo, viewsByLink, viewsByStatus, boardList, shareDetail,
  channelOf, channelCounts, viewsByChannel,
} from '../lib/reportSharingView'
import { enrichShares, summarizeShares, STATUS_META } from '../lib/reportSharingAnalytics'

const NOW = '2026-10-05T12:00:00Z'
const RAW = [
  { id: 'a', name: 'Exec board', pages: ['board_kpis'], layout: null, active: true, created_at: '2026-10-01T00:00:00Z', last_viewed_at: '2026-10-05T11:40:00Z', view_count: 12, expires_at: '2026-10-08T00:00:00Z', rotate_seconds: 30, refresh_seconds: 300 },
  { id: 'b', name: 'Wall', pages: [], layout: { boards: [{ title: 'Ops' }, {}] }, active: true, created_at: '2026-09-01T00:00:00Z', last_viewed_at: null, view_count: null, expires_at: null },
  { id: 'c', name: 'Old', pages: ['ops_today'], layout: null, active: true, created_at: '2026-08-01T00:00:00Z', view_count: 3, expires_at: '2026-09-01T00:00:00Z' },
]
const rows = enrichShares(RAW, { now: NOW })

describe('filterShareRows', () => {
  it('filters by type, expiry, status and search incl. page labels', () => {
    expect(filterShareRows(rows, { type: 'custom' }).map((r) => r.id)).toEqual(['b'])
    expect(filterShareRows(rows, { expiry: 'none' }).map((r) => r.id)).toEqual(['b'])
    expect(filterShareRows(rows, { status: 'expired' }).map((r) => r.id)).toEqual(['c'])
    expect(filterShareRows(rows, { search: 'operations', pageLabels: { ops_today: 'Operations today' } }).map((r) => r.id)).toEqual(['c'])
  })
})

describe('kpis and charts', () => {
  it('shareKpis keeps unknowns null', () => {
    const k = shareKpis(summarizeShares(RAW, { now: NOW }), rows)
    expect(k.totalViews).toBe(15)
    expect(k.viewedLinks).toBe(2)
    expect(shareKpis(null).live).toBeNull()
  })
  it('viewsByLink skips unknown counts', () => {
    expect(viewsByLink(rows).map((v) => v.id)).toEqual(['a', 'c'])
  })
  it('viewsByStatus groups views', () => {
    const seg = viewsByStatus(rows, STATUS_META)
    expect(seg.reduce((s, x) => s + x.count, 0)).toBe(15)
  })
})

describe('text helpers', () => {
  it('expiryText', () => {
    expect(expiryText(rows[1]).text).toBe('Never')
    expect(expiryText(rows[0]).sub).toBe('3 days left')
    expect(expiryText(rows[2]).sub).toBe('Expired')
  })
  it('relativeAgo', () => {
    expect(relativeAgo('2026-10-05T11:42:00Z', NOW)).toBe('18 min ago')
    expect(relativeAgo(undefined, NOW)).toBeNull()
  })
  it('boardList + shareDetail', () => {
    expect(boardList(rows[1])).toEqual(['Ops', 'Custom board 2'])
    expect(boardList(rows[0], { board_kpis: 'Board KPIs' })).toEqual(['Board KPIs'])
    const d = shareDetail(rows[1], { now: NOW })
    expect(d.views).toBe('N/A')
    expect(d.lastViewed).toBe('Never viewed')
    expect(d.expires).toBe('Never')
    expect(shareDetail(null)).toBeNull()
  })
})

describe('channels', () => {
  const extra = enrichShares([
    ...RAW,
    { id: 'w', name: 'Workshop wall', pages: ['workshop_live'], layout: null, active: true, created_at: '2026-10-01T00:00:00Z', view_count: 5, expires_at: null },
  ], { now: NOW })
  it('derives the channel from the board behind the link', () => {
    const by = Object.fromEntries(extra.map((r) => [r.id, channelOf(r)]))
    expect(by).toEqual({ a: 'link', b: 'tv', c: 'link', w: 'workshop' })
  })
  it('counts live links per channel and leaves expired out', () => {
    expect(channelCounts(extra)).toEqual({ link: 1, tv: 1, workshop: 1 })
  })
  it('splits views by channel and filters by channel and access', () => {
    expect(viewsByChannel(extra).map((s) => [s.key, s.count])).toEqual([['link', 15], ['workshop', 5]])
    expect(filterShareRows(extra, { channel: 'workshop' }).map((r) => r.id)).toEqual(['w'])
    expect(filterShareRows(extra, { access: 'edit' })).toEqual([])
    expect(filterShareRows(extra, { access: 'view' })).toHaveLength(4)
  })
})

describe('reportSharingView row actions', () => {
  it('offers copy, open, manage and revoke with honest reasons', async () => {
    const { shareRowActions } = await import('../lib/reportSharingView')
    const ok = shareRowActions({ id: 1, token: 'rpt_x', status: 'active' })
    expect(ok.map((a) => a.key)).toEqual(['copy', 'open', 'manage', 'revoke'])
    expect(ok.every((a) => !a.disabled)).toBe(true)
    const expired = shareRowActions({ id: 2, token: 'rpt_y', status: 'expired' })
    expect(expired.find((a) => a.key === 'open')).toMatchObject({ disabled: true, reason: expect.stringMatching(/expired/) })
    expect(expired.find((a) => a.key === 'copy').disabled).toBe(false)
    const noToken = shareRowActions({ id: 3, status: 'active' })
    expect(noToken.find((a) => a.key === 'copy').disabled).toBe(true)
    expect(noToken.find((a) => a.key === 'revoke')).toMatchObject({ disabled: false, danger: true })
  })
})
