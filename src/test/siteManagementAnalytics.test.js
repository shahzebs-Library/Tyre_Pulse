import { describe, expect, it } from 'vitest'
import {
  siteGaps, enrichSites, filterSites, siteKpis, topSitesByAssets, sitesByRegion, countryOptions,
  regionOptions, activeSiteFilterCount, siteExportRows, EMPTY_SITE_FILTERS,
} from '../lib/siteManagementAnalytics'

const rollup = [
  { name: 'NHC', country: 'KSA', region: 'CENTRAL', city: 'Riyadh', active: true, governed: true, siteType: 'depot', assetCount: 10, activeAssetCount: 8, assets: [] },
  { name: 'DIRIYAH', country: 'KSA', region: null, active: true, governed: false, assetCount: 4, activeAssetCount: 4, assets: [] },
  { name: 'EMPTY', country: 'UAE', region: 'WEST', active: false, governed: true, assetCount: 0, activeAssetCount: 0, assets: [] },
]

describe('siteManagementAnalytics', () => {
  it('identifies data gaps per site', () => {
    expect(rollup.map(siteGaps)).toEqual([[], ['no_region', 'derived'], ['empty']])
  })

  it('computes KPIs with null for empty denominators', () => {
    const k = siteKpis(enrichSites(rollup))
    expect(k).toMatchObject({ total: 3, governed: 2, derived: 1, assets: 14, activeAssets: 12, countries: 2, noRegion: 1, emptyGoverned: 1 })
    expect(k.governedPct).toBe(66.7)
    expect(k.activeAssetPct).toBe(85.7)
    expect(k.avgAssetsPerSite).toBe(7)
    const empty = siteKpis([])
    expect(empty.governedPct).toBeNull()
    expect(empty.activeAssetPct).toBeNull()
    expect(empty.avgAssetsPerSite).toBeNull()
    expect(enrichSites(rollup)[2]._activePct).toBeNull()
  })

  it('filters by country, region, source, status, gap and search', () => {
    const e = enrichSites(rollup)
    expect(filterSites(e, { ...EMPTY_SITE_FILTERS, country: 'KSA' })).toHaveLength(2)
    expect(filterSites(e, { ...EMPTY_SITE_FILTERS, region: 'WEST' }).map((s) => s.name)).toEqual(['EMPTY'])
    expect(filterSites(e, { ...EMPTY_SITE_FILTERS, governed: 'derived' }).map((s) => s.name)).toEqual(['DIRIYAH'])
    expect(filterSites(e, { ...EMPTY_SITE_FILTERS, active: 'inactive' }).map((s) => s.name)).toEqual(['EMPTY'])
    expect(filterSites(e, { ...EMPTY_SITE_FILTERS, gap: 'no_region' }).map((s) => s.name)).toEqual(['DIRIYAH'])
    expect(filterSites(e, { ...EMPTY_SITE_FILTERS, search: 'riyadh' }).map((s) => s.name)).toEqual(['NHC'])
    expect(activeSiteFilterCount({ ...EMPTY_SITE_FILTERS, gap: 'empty', country: 'UAE' })).toBe(2)
  })

  it('builds chart series, options and export rows', () => {
    const e = enrichSites(rollup)
    expect(topSitesByAssets(e)).toEqual([{ name: 'NHC', active: 8, inactive: 2 }, { name: 'DIRIYAH', active: 4, inactive: 0 }])
    expect(sitesByRegion(e).map((r) => r.region)).toEqual(['CENTRAL', 'No region', 'WEST'])
    expect(countryOptions(rollup)).toEqual(['KSA', 'UAE'])
    expect(regionOptions(rollup)).toEqual(['CENTRAL', 'WEST'])
    const out = siteExportRows(e)
    expect(out[1]).toMatchObject({ governed: 'Derived', gaps: 'No region set; Not in the site register', active_pct: 100 })
    expect(out[0].gaps).toBe('None')
    expect(out[2].active_pct).toBe('N/A')
  })
})
