import { describe, it, expect } from 'vitest'
import {
  linkStatus, enrichShares, summarizeShares, filterShares, shareFindings,
  exportRows, boardCountOf, daysBetween,
} from '../lib/reportSharingAnalytics'

const NOW = '2026-09-26T12:00:00Z'
const base = { active: true, created_at: '2026-09-20T00:00:00Z', pages: ['a', 'b'], view_count: 3, last_viewed_at: '2026-09-25T00:00:00Z' }

describe('reportSharingAnalytics', () => {
  it('classifies status with precedence', () => {
    expect(linkStatus({ ...base, active: false }, { now: NOW })).toBe('revoked')
    expect(linkStatus({ ...base, expires_at: '2026-09-01' }, { now: NOW })).toBe('expired')
    expect(linkStatus({ ...base, expires_at: '2026-09-30T00:00:00Z' }, { now: NOW })).toBe('expiring')
    expect(linkStatus({ ...base, last_viewed_at: '2026-07-01' }, { now: NOW })).toBe('stale')
    expect(linkStatus({ ...base, last_viewed_at: null, created_at: '2026-06-01' }, { now: NOW })).toBe('stale')
    expect(linkStatus({ ...base, last_viewed_at: null }, { now: NOW })).toBe('active')
    expect(linkStatus(base, { now: NOW })).toBe('active')
  })

  it('counts boards from custom layout else pages', () => {
    expect(boardCountOf({ layout: { boards: [{}, {}, {}] }, pages: ['x'] })).toBe(3)
    expect(boardCountOf({ pages: ['x'] })).toBe(1)
    expect(boardCountOf({})).toBe(0)
  })

  it('summarizes with honest nulls', () => {
    const rows = [
      base,
      { ...base, id: 2, expires_at: '2026-09-01', view_count: 10 },
      { ...base, id: 3, last_viewed_at: null, view_count: 0, created_at: '2026-05-01' },
    ]
    const s = summarizeShares(rows, { now: NOW })
    expect(s.total).toBe(3)
    expect(s.expired).toBe(1)
    expect(s.stale).toBe(1)
    expect(s.revoked).toBeNull()
    expect(s.totalViews).toBe(13)
    expect(s.neverViewed).toBe(1)
    expect(s.avgViewsPerLiveLink).toBe(1.5)
    expect(summarizeShares(rows, { now: NOW, includesRevoked: true }).revoked).toBe(0)
  })

  it('returns null views and averages when nothing is measurable', () => {
    const s = summarizeShares([{ ...base, view_count: null }], { now: NOW })
    expect(s.totalViews).toBeNull()
    expect(s.avgViewsPerLiveLink).toBeNull()
    const e = summarizeShares([], { now: NOW })
    expect(e.total).toBe(0)
    expect(e.totalViews).toBeNull()
    expect(shareFindings(e)).toEqual([])
  })

  it('filters by status and search', () => {
    const en = enrichShares([{ ...base, name: 'Board room' }, { ...base, name: 'Workshop TV', expires_at: '2026-09-01' }], { now: NOW })
    expect(filterShares(en, { status: 'expired' })).toHaveLength(1)
    expect(filterShares(en, { search: 'board' })).toHaveLength(1)
    expect(filterShares(en, {})).toHaveLength(2)
  })

  it('emits findings and export rows without the token', () => {
    const rows = [{ ...base, token: 'rpt_secret', expires_at: '2026-09-01' }]
    const s = summarizeShares(rows, { now: NOW })
    expect(shareFindings(s)[0].tone).toBe('danger')
    const out = exportRows(enrichShares(rows, { now: NOW }))
    expect(JSON.stringify(out)).not.toContain('rpt_secret')
    expect(out[0].expires).toBe('2026-09-01')
    expect(exportRows(enrichShares([{ ...base, view_count: null, last_viewed_at: null }], { now: NOW }))[0])
      .toMatchObject({ views: 'N/A', lastViewed: 'Never', expires: 'No expiry' })
  })

  it('daysBetween is null on bad input', () => {
    expect(daysBetween(null, NOW)).toBeNull()
    expect(daysBetween('2026-09-24T12:00:00Z', NOW)).toBe(2)
  })
})
