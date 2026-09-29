import { describe, expect, it } from 'vitest'
import {
  siteStatus, enrichOperational, operationalKpis, healthSummary, statusCounts, siteTypeSegments,
  countryBubbles, siteInsights, sortSites, siteOpsExportRows, countryFlag,
} from '../lib/siteOperations'

const now = new Date('2026-09-28T00:00:00Z')
const asset = (no, extra = {}) => ({ asset_no: no, country: 'KSA', active: true, ...extra })
const sites = [
  { name: 'NHC', country: 'KSA', region: 'Central', governed: true, active: true, siteType: 'depot', assetCount: 2, activeAssetCount: 2,
    assets: [asset('A1', { insurance_expiry: '2027-01-01', ops_status: 'breakdown' }), asset('A2', { insurance_expiry: '2026-01-01' })] },
  { name: 'Quarry', country: 'KSA', region: null, governed: false, active: true, siteType: null, assetCount: 4, activeAssetCount: 1,
    assets: [asset('B1'), asset('B2', { active: false }), asset('B3', { active: false }), asset('B4', { active: false })] },
  { name: 'Closed', country: 'UAE', region: 'West', governed: true, active: false, siteType: 'yard', assetCount: 0, activeAssetCount: 0, assets: [] },
]
const util = [
  { asset_no: 'A1', country: 'KSA', utilization_pct: 80, captured_at: '2026-08-01' },
  { asset_no: 'A1', country: 'KSA', utilization_pct: 60, captured_at: '2026-09-01' },
  { asset_no: 'B1', country: 'KSA', utilization_pct: 40, captured_at: '2026-09-01' },
]
const insp = [{ asset_no: 'A1', country: 'KSA', inspection_date: '2026-07-01' }, { asset_no: 'B1', country: 'KSA', inspection_date: '2026-09-20' }]
const master = [{ name: 'NHC', site_code: 'N-1' }, { name: 'Closed', site_code: '' }]

describe('siteOperations', () => {
  it('classifies site status by the stated rule', () => {
    expect(sites.map(siteStatus)).toEqual(['active', 'limited', 'inactive'])
    expect(siteStatus({ active: true, assetCount: 3, activeAssetCount: 0 })).toBe('inactive')
    expect(siteStatus({ active: true, assetCount: 0 })).toBe('active')
  })

  it('adds utilisation, compliance, breakdowns and inspections per site', () => {
    const [nhc, quarry, closed] = enrichOperational(sites, { masterRows: master, utilRows: util, inspectionRows: insp, opsKnown: true, now })
    expect(nhc).toMatchObject({ _code: 'N-1', _util: 60, _utilAssets: 1, _assessed: 2, _expiredAssets: 1, _compliance: 50, _down: 1, _inspDue: 1 })
    expect(quarry).toMatchObject({ _code: null, _util: 40, _assessed: 0, _compliance: null, _inspDue: 0, _status: 'limited' })
    expect(closed._code).toBeNull()
    expect(closed._util).toBeNull()
  })

  it('leaves unmeasurable figures null', () => {
    const [nhc] = enrichOperational(sites, { now })
    expect(nhc._down).toBeNull()
    expect(nhc._inspDue).toBeNull()
    const h = healthSummary(enrichOperational(sites, { now }))
    expect(h.inMaintenance).toBeNull()
    expect(h.inspectionsDue).toBeNull()
    expect(operationalKpis([])).toMatchObject({ total: 0, avgUtil: null, complianceRate: null })
  })

  it('computes KPIs, health, counts, types and bubbles', () => {
    const rows = enrichOperational(sites, { masterRows: master, utilRows: util, inspectionRows: insp, opsKnown: true, now })
    expect(operationalKpis(rows)).toMatchObject({ total: 3, active: 1, avgUtil: 50, utilAssets: 2, complianceRate: 50, assets: 6 })
    expect(healthSummary(rows, { opsKnown: true, inspectionsKnown: true })).toMatchObject({ compliantPct: 0, atRisk: 1, inMaintenance: 1, inspectionsDue: 1, inspectionSites: 1 })
    expect(statusCounts(rows)).toEqual({ all: 3, active: 1, limited: 1, inactive: 1 })
    const segs = siteTypeSegments(rows)
    expect(segs.map((s) => s.label)).toEqual(['Depot', 'Yard', 'Not recorded'])
    expect(countryBubbles(rows)[0]).toMatchObject({ country: 'KSA', total: 2, active: 1, limited: 1 })
  })

  it('builds insights only from what the data shows', () => {
    const rows = enrichOperational(sites, { masterRows: master, utilRows: util, inspectionRows: insp, opsKnown: true, now })
    const keys = siteInsights(rows, { health: healthSummary(rows, { inspectionsKnown: true }) }).map((i) => i.key)
    expect(keys).toEqual(['risk', 'limited', 'lowutil', 'insp', 'region'])
    expect(siteInsights([])).toEqual([])
  })

  it('sorts with blanks last and exports rows', () => {
    const rows = enrichOperational(sites, { utilRows: util, now })
    expect(sortSites(rows, 'util', 'desc').map((s) => s.name)).toEqual(['NHC', 'Quarry', 'Closed'])
    expect(sortSites(rows, 'util', 'asc').map((s) => s.name)).toEqual(['Quarry', 'NHC', 'Closed'])
    const out = siteOpsExportRows(rows)
    expect(out[2]).toMatchObject({ utilization: 'N/A', compliance: 'N/A', status: 'Inactive' })
    expect(countryFlag('KSA')).not.toBe('')
    expect(countryFlag('Mars')).toBe('')
  })
})
