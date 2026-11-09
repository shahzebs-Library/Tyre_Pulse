import { describe, it, expect } from 'vitest'
import {
  markScrapped, isScrap, scrapKpis, brandScrapAnalysis, siteScrapAnalysis, fleetAvgKmLife,
  kmLife, tyreCost, reasonBreakdown,
} from '../lib/tyreScrapManagementAnalytics'

const three = [
  { id: '1', serial_no: 'YMA55312', country: 'KSA', brand: 'X', site: 'NHC', asset_no: 'TM1', issue_date: '2025-01-01', removal_date: '2025-03-01', km_at_fitment: 10000, km_at_removal: 30000, cost_per_tyre: 1000, status: 'Removed', removal_reason: 'Wear' },
  { id: '2', serial_no: 'YMA55312', country: 'KSA', brand: 'X', site: 'NHC', asset_no: 'TM2', issue_date: '2025-03-05', removal_date: '2025-06-01', km_at_fitment: 50000, km_at_removal: 60000, cost_per_tyre: 1000, status: 'Removed', removal_reason: 'Rotation' },
  { id: '3', serial_no: 'YMA55312', country: 'KSA', brand: 'X', site: 'NHC', asset_no: 'TM3', issue_date: '2025-06-05', removal_date: '2025-09-01', km_at_fitment: 5000, km_at_removal: 35000, cost_per_tyre: 1200, status: 'Scrapped', removal_reason: 'Burst' },
]

describe('scrap analytics on physical tyres', () => {
  it('one tyre on 3 vehicles scrapped: one scrapped tyre, lifetime km, price once', () => {
    const rows = markScrapped(three, [])
    const scrapped = rows.filter(isScrap)
    expect(scrapped).toHaveLength(1)
    expect(kmLife(scrapped[0])).toBe(60000)
    expect(tyreCost(scrapped[0])).toBe(1000)
    const k = scrapKpis(rows, scrapped)
    expect(k.tyreCount).toBe(1)
    expect(k.scrapRate).toBe(100)
    expect(k.totalCost).toBe(1000)
    expect(k.avgKmLife).toBe(60000)
    const b = brandScrapAnalysis(rows, null)[0]
    expect(b).toMatchObject({ brand: 'X', total: 1, scrap: 1, avgKm: 60000, totalCost: 1000 })
    expect(b.avgCPK).toBeCloseTo(1000 / 60000, 9)
    expect(siteScrapAnalysis(rows)[0]).toMatchObject({ site: 'NHC', total: 1, scrap: 1, cost: 1000 })
    expect(fleetAvgKmLife(rows)).toBe(60000)
  })
  it('a refit on the same vehicle is not a second purchase', () => {
    const refit = markScrapped([three[0], { ...three[1], asset_no: 'TM1', status: 'Scrapped' }], [])
    const s = refit.filter(isScrap)
    expect(scrapKpis(refit, s).totalCost).toBe(1000)
  })
  it('removal reasons (events) still count the scrapped rows given', () => {
    expect(reasonBreakdown(three).reduce((a, x) => a + x.count, 0)).toBe(3)
  })
})
