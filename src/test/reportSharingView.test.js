import { describe, it, expect } from 'vitest'
import {
  filterShareRows, shareKpis, expiryText, relativeAgo, viewsByLink, viewsByStatus, boardList, shareDetail,
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
