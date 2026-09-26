import { describe, it, expect } from 'vitest'
import {
  isScrap, kmLife, tyreCost, serialOf, dataAnchor, cutoffFor, fleetAvgKmLife,
  scrapKpis, monthlyScrapTrend, reasonBreakdown, positionBreakdown, earlyScrap,
  retreadOpportunity, brandScrapAnalysis, siteScrapAnalysis, siteMonthlySeries,
  brandSiteMatrix, heatLevel, filterDisposalLog, disposalSummary, rateBand,
} from '../lib/tyreScrapManagementAnalytics'

const t = (o) => ({ id: Math.random().toString(36).slice(2), ...o })

describe('tyreScrapManagementAnalytics', () => {
  it('isScrap follows the heuristic, not a scrap mark', () => {
    expect(isScrap({ risk_level: 'Critical' })).toBe(true)
    expect(isScrap({ category: 'Scrap' })).toBe(true)
    expect(isScrap({ status: 'Scrapped' })).toBe(false)
  })

  it('kmLife and tyreCost are null, never 0, when unmeasurable', () => {
    expect(kmLife({ km_at_fitment: 100, km_at_removal: 50 })).toBeNull()
    expect(kmLife({ km_at_fitment: null, km_at_removal: 50 })).toBeNull()
    expect(kmLife({ km_at_fitment: 100, km_at_removal: 5100 })).toBe(5000)
    expect(tyreCost({ cost_per_tyre: null, qty: 2 })).toBeNull()
    expect(tyreCost({ cost_per_tyre: 100, qty: 2 })).toBe(200)
    expect(tyreCost({ cost_per_tyre: 100, qty: 0 })).toBe(100)
  })

  it('serialOf reads serial_no first, then serial_number', () => {
    expect(serialOf({ serial_no: ' A1 ', serial_number: 'B' })).toBe('A1')
    expect(serialOf({ serial_number: 'B' })).toBe('B')
    expect(serialOf({})).toBeNull()
  })

  it('anchors to the data, falling back to injected now', () => {
    const now = new Date('2026-09-26T00:00:00')
    expect(dataAnchor([], now).toISOString()).toBe(now.toISOString())
    const a = dataAnchor([{ removal_date: '2025-03-05' }, { issue_date: '2025-04-01' }], now)
    expect(a.getFullYear()).toBe(2025)
    expect(a.getMonth()).toBe(3)
    expect(cutoffFor(null, a)).toBeNull()
    expect(cutoffFor(30, a).getMonth()).toBe(2)
  })

  it('scrapKpis: rate is null with no tyres; cost only sums priced rows', () => {
    expect(scrapKpis([], []).scrapRate).toBeNull()
    expect(scrapKpis([], []).totalCost).toBeNull()
    expect(scrapKpis([], []).retreadSavings).toBeNull()
    const scr = [t({ risk_level: 'Critical', cost_per_tyre: 100 }), t({ risk_level: 'Critical' })]
    const k = scrapKpis([...scr, t({}), t({})], scr)
    expect(k.scrapRate).toBe(50)
    expect(k.totalCost).toBe(100)
    expect(k.costedCount).toBe(1)
    expect(k.avgKmLife).toBeNull()
  })

  it('monthlyScrapTrend zero-fills and buckets by removal else issue date', () => {
    const rows = [t({ removal_date: '2026-09-02', cost_per_tyre: 10 }), t({ issue_date: '2026-08-15' }), t({ removal_date: '2020-01-01' })]
    const m = monthlyScrapTrend(rows, new Date('2026-09-20T00:00:00'), 12)
    expect(m).toHaveLength(12)
    expect(m[11]).toMatchObject({ key: '2026-09', count: 1, cost: 10 })
    expect(m[10]).toMatchObject({ key: '2026-08', count: 1 })
    expect(m.reduce((s, x) => s + x.count, 0)).toBe(2)
  })

  it('breakdowns count reasons and positions', () => {
    const rows = [t({ removal_reason: 'Wear', position: 'LHF1' }), t({ removal_reason: 'Wear' }), t({})]
    expect(reasonBreakdown(rows)[0]).toEqual({ label: 'Wear', count: 2 })
    expect(positionBreakdown(rows).find((x) => x.label === 'Unknown').count).toBe(2)
  })

  it('earlyScrap returns [] when the fleet average is unknown', () => {
    const rows = [t({ km_at_fitment: 0, km_at_removal: 1000 })]
    expect(earlyScrap(rows, null)).toEqual([])
    const e = earlyScrap(rows, 10000)
    expect(e).toHaveLength(1)
    expect(e[0].pctOfAvg).toBe(10)
  })

  it('fleetAvgKmLife ignores unmeasurable rows', () => {
    expect(fleetAvgKmLife([{}])).toBeNull()
    expect(fleetAvgKmLife([{ km_at_fitment: 0, km_at_removal: 100 }, {}])).toBe(100)
  })

  it('retreadOpportunity: savings null when nothing this month is priced', () => {
    const anchor = new Date('2026-09-20T00:00:00')
    const r = retreadOpportunity([t({ removal_date: '2026-09-01' }), t({ removal_date: '2026-09-02' }), t({ removal_date: '2026-09-03' }), t({ removal_date: '2026-09-04' })], anchor)
    expect(r.count).toBe(1)
    expect(r.savings).toBeNull()
  })

  it('brand and site analysis rank by rate and keep unmeasured as null', () => {
    const rows = [
      t({ brand: 'A', site: 'S1', risk_level: 'Critical', removal_date: '2026-08-01' }),
      t({ brand: 'A', site: 'S1' }),
      t({ brand: 'B', site: 'S2' }),
    ]
    const b = brandScrapAnalysis(rows, null)
    expect(b[0]).toMatchObject({ brand: 'A', scrap: 1, total: 2, scrapRate: 50, earlyPct: null, band: 'review' })
    expect(b[1]).toMatchObject({ brand: 'B', scrapRate: 0, band: 'normal' })
    const s = siteScrapAnalysis(rows)
    expect(s[0]).toMatchObject({ site: 'S1', scrap: 1, cost: null, worstBrand: 'A', trend: 'unknown' })
    const series = siteMonthlySeries(s, new Date('2026-09-10T00:00:00'), 6, 5)
    expect(series.labels).toHaveLength(6)
    expect(series.series[0].data[4]).toBe(1)
  })

  it('rateBand bands and handles null', () => {
    expect(rateBand(null)).toBe('unknown')
    expect(rateBand(25)).toBe('review')
    expect(rateBand(15)).toBe('watch')
    expect(rateBand(5)).toBe('normal')
  })

  it('brandSiteMatrix counts and heatLevel labels', () => {
    const m = brandSiteMatrix([t({ brand: 'A', site: 'S' }), t({ brand: 'A', site: 'S' }), t({ brand: 'X', site: 'S' })], ['A'], ['S'])
    expect(m.rows[0]).toEqual({ brand: 'A', S: 2 })
    expect(m.maxVal).toBe(2)
    expect(heatLevel(0, 2)).toBe('none')
    expect(heatLevel(2, 2)).toBe('high')
    expect(heatLevel(1, 4)).toBe('low')
  })

  it('filterDisposalLog filters and sorts newest first; disposalSummary counts', () => {
    const rows = [
      t({ id: 'a', serial_no: 'SN1', brand: 'A', site: 'S', removal_date: '2026-01-01' }),
      t({ id: 'b', serial_no: 'SN2', brand: 'B', site: 'S', removal_date: '2026-03-01' }),
    ]
    expect(filterDisposalLog(rows).map((r) => r.id)).toEqual(['b', 'a'])
    expect(filterDisposalLog(rows, { search: 'sn1' }).map((r) => r.id)).toEqual(['a'])
    expect(filterDisposalLog(rows, { from: '2026-02-01' }).map((r) => r.id)).toEqual(['b'])
    expect(disposalSummary(rows, { a: 'Disposed' })).toEqual({ Disposed: 1, Retreaded: 0, Pending: 1 })
  })
})
