import { describe, it, expect } from 'vitest'
import {
  localIsoDate, passTime, passSummary, siteBreakdown, hourlyProfile, denialReasons,
  filterPasses, passRegisterRows, passExportRows,
} from '../lib/gatePassAnalytics'

const at = (h, m = 0) => new Date(2026, 6, 20, h, m).toISOString()
const PASSES = [
  { id: 1, asset_no: 'TM1', site: 'NHC', status: 'Cleared', created_at: at(7, 5), pass_date: '2026-07-20' },
  { id: 2, asset_no: 'TM2', site: 'NHC', status: 'Denied', denial_reason: 'No inspection', created_at: at(7, 30) },
  { id: 3, asset_no: 'TM3', site: null, status: 'Denied', denial_reason: ' no  INSPECTION', created_at: at(9) },
  { id: 4, asset_no: 'TM4', site: 'RED SEA', status: 'Pending' },
  { id: 5, asset_no: 'TM5', site: 'RED SEA', status: 'Denied' },
]

describe('gatePassAnalytics', () => {
  it('builds LOCAL calendar dates, not UTC ones', () => {
    // 23:30 local on the 19th must stay the 19th in any timezone.
    const late = new Date(2026, 6, 19, 23, 30)
    expect(localIsoDate(late)).toBe('2026-07-19')
    expect(localIsoDate(late, -1)).toBe('2026-07-18')
    expect(localIsoDate(new Date(2026, 0, 1), -1)).toBe('2025-12-31')
    expect(localIsoDate('garbage')).toBe('')
  })

  it('summarises the day with an honest clearance rate', () => {
    expect(passSummary(PASSES)).toEqual({ total: 5, cleared: 1, denied: 3, pending: 1, clearRate: 25 })
    expect(passSummary([{ status: 'Pending' }]).clearRate).toBeNull()
    expect(passSummary([]).clearRate).toBeNull()
  })

  it('keeps passes without a site in the site breakdown', () => {
    const s = siteBreakdown(PASSES)
    expect(s.map((x) => x.site)).toEqual(['NHC', '(No Site)', 'RED SEA'])
    expect(s[0]).toMatchObject({ cleared: 1, denied: 1 })
  })

  it('profiles by hour and groups denial reasons', () => {
    const h = hourlyProfile(PASSES)
    expect(h.hours[7]).toMatchObject({ cleared: 1, denied: 1 })
    expect(h.hours[9].denied).toBe(1)
    expect(h.untimed).toBe(2)
    const r = denialReasons(PASSES)
    expect(r.top).toEqual([{ reason: 'No inspection', count: 2 }])
    expect(r.unstated).toBe(1)
  })

  it('filters and shapes the log', () => {
    expect(filterPasses(PASSES, { status: 'Denied' }).map((p) => p.id)).toEqual([2, 3, 5])
    expect(filterPasses(PASSES, { search: 'sea' }).map((p) => p.id)).toEqual([4, 5])
    const reg = passRegisterRows(PASSES)
    expect(reg[0].timeLabel).toBe('07:05')
    expect(reg[3].createdTime).toBeNull()
    expect(passTime(null)).toBe('')
    expect(passExportRows(PASSES)[3]).toMatchObject({ time: '', site: 'RED SEA', denial_reason: '' })
  })
})
