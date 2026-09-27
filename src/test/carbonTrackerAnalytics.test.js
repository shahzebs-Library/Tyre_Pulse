import { describe, it, expect } from 'vitest'
import {
  toNum, asTonnes, fmtNum, fmtTonnes, scopeRowsByPeriod, lifecycleKpis, esgBand,
  fuelKpis, vehicleRows, filterVehicleRows, siteOptions, offsetsSummary,
  netAfterOffsetsKg, initiativesSummary, filterOffsets, filterInitiatives, vehicleExportRows,
} from '../lib/carbonTrackerAnalytics'
import { computeLifecycleCarbon, computeCarbon } from '../lib/carbon'

describe('carbonTrackerAnalytics formatting', () => {
  it('treats blank and junk as null, never 0', () => {
    expect(toNum('')).toBeNull()
    expect(toNum(null)).toBeNull()
    expect(toNum('abc')).toBeNull()
    expect(toNum('12.5')).toBe(12.5)
    expect(asTonnes(null)).toBeNull()
    expect(asTonnes(1250)).toBe(1.3)
    expect(fmtNum(null)).toBe('N/A')
    expect(fmtTonnes(undefined)).toBe('N/A')
    expect(fmtTonnes(2000)).toBe('2 t')
  })
})

describe('scopeRowsByPeriod', () => {
  const now = new Date('2026-09-26T10:00:00')
  const rows = [{ date: '2026-09-01' }, { date: '2025-01-01' }, { date: null }, { date: 'bad' }]
  it('keeps every row for all time', () => {
    expect(scopeRowsByPeriod(rows, 0, now)).toHaveLength(4)
  })
  it('drops undated rows and rows outside the window', () => {
    expect(scopeRowsByPeriod(rows, 3, now)).toEqual([{ date: '2026-09-01' }])
  })
  it('handles non-array input', () => {
    expect(scopeRowsByPeriod(null, 3, now)).toEqual([])
  })
})

describe('lifecycleKpis', () => {
  it('reports N/A for an empty estate instead of a perfect ESG score', () => {
    const carbon = computeLifecycleCarbon({ tyres: [], vehicles: [] })
    // The raw model claims ~100% pressure compliance on nothing.
    expect(carbon.summary.pressureCompliancePct).toBeGreaterThan(0)
    const k = lifecycleKpis(carbon)
    expect(k.hasData).toBe(false)
    expect(k.esgScore).toBeNull()
    expect(k.pressureCompliancePct).toBeNull()
    expect(k.retreadRatePct).toBeNull()
    expect(k.netCo2Kg).toBeNull()
    expect(k.certificationReady).toBeNull()
  })
  it('passes through measurable figures when there is data', () => {
    const carbon = computeLifecycleCarbon({
      vehicles: [{ asset_no: 'A1', vehicle_type: 'TR-MIXER', is_active: true, current_km: 1000 }],
      tyres: [{ asset_no: 'A1', status: 'Scrapped', issue_date: new Date().toISOString().slice(0, 10) }],
    })
    const k = lifecycleKpis(carbon)
    expect(k.hasData).toBe(true)
    expect(k.vehicles).toBe(1)
    expect(k.esgScore).not.toBeNull()
    expect(k.retreadRatePct).toBe(0)
    expect(k.pressureCompliancePct).not.toBeNull()
  })
  it('bands the ESG score', () => {
    expect(esgBand(null).key).toBe('none')
    expect(esgBand(75).key).toBe('good')
    expect(esgBand(55).key).toBe('watch')
    expect(esgBand(10).key).toBe('poor')
  })
})

describe('fuel view', () => {
  const carbon = computeCarbon([
    { vehicle: 'V1', site: 'S1', litres: 100, date: '2026-09-01' },
    { vehicle: 'V2', site: 'S2', litres: 300, date: '2026-09-02' },
  ])
  it('computes honest KPIs', () => {
    const k = fuelKpis(carbon)
    if (carbon.totalCo2 > 0) {
      expect(k.co2PerVehicleKg).toBeCloseTo(carbon.totalCo2 / carbon.vehicleCount)
      expect(k.topSiteSharePct).toBeGreaterThan(0)
    }
    const empty = fuelKpis(computeCarbon([]))
    expect(empty.totalCo2Kg).toBeNull()
    expect(empty.co2PerVehicleKg).toBeNull()
    expect(empty.topSite).toBeNull()
  })
  it('builds, filters and exports vehicle rows', () => {
    const rows = vehicleRows({ totalCo2: 400, byVehicle: [{ vehicle: 'V2', site: 'S2', litres: 3, co2: 300 }, { vehicle: 'V1', site: 'S1', litres: 1, co2: 100 }] })
    expect(rows[0]).toMatchObject({ rank: 1, sharePct: 75 })
    expect(vehicleRows({ totalCo2: 0, byVehicle: [{ vehicle: 'X', co2: 0 }] })[0].sharePct).toBeNull()
    expect(filterVehicleRows(rows, { site: 'S1' })).toHaveLength(1)
    expect(filterVehicleRows(rows, { search: 'v2' })).toHaveLength(1)
    expect(vehicleExportRows(rows)[1]).toMatchObject({ vehicle: 'V1', sharePct: 25 })
    expect(siteOptions({ bySite: [{ site: 'Z' }, { site: 'A' }] })).toEqual(['A', 'Z'])
  })
})

describe('ledgers', () => {
  it('does not fabricate a cost total when nothing is costed', () => {
    const s = offsetsSummary([{ tonnes: '2', provider: 'Verra' }, { tonnes: 1.5 }])
    expect(s.totalTonnes).toBe(3.5)
    expect(s.totalCost).toBeNull()
    expect(s.avgCostPerTonne).toBeNull()
    const c = offsetsSummary([{ tonnes: 2, aed_cost: 100 }, { tonnes: 2 }])
    expect(c.totalCost).toBe(100)
    expect(c.costedCount).toBe(1)
    expect(offsetsSummary([]).totalTonnes).toBeNull()
  })
  it('nets offsets against a measured footprint only', () => {
    expect(netAfterOffsetsKg(5000, 2)).toBe(3000)
    expect(netAfterOffsetsKg(5000, null)).toBe(5000)
    expect(netAfterOffsetsKg(null, 2)).toBeNull()
  })
  it('rolls up initiatives', () => {
    const s = initiativesSummary([
      { status: 'active', claimed_savings_kg: 100 },
      { status: 'pilot' },
      { status: 'completed', claimed_savings_kg: '50' },
    ])
    expect(s).toMatchObject({ count: 3, live: 2, completed: 1, totalSavingsKg: 150, claimedCount: 2 })
    expect(initiativesSummary([{ status: 'planned' }]).totalSavingsKg).toBeNull()
  })
  it('filters offsets and initiatives', () => {
    expect(filterOffsets([{ provider: 'Verra' }, { project: 'Mangrove' }], 'mangr')).toHaveLength(1)
    const list = [{ name: 'Retread push', status: 'active', owner: 'Ali' }, { name: 'Pressure', status: 'planned' }]
    expect(filterInitiatives(list, { status: 'planned' })).toHaveLength(1)
    expect(filterInitiatives(list, { search: 'ali' })).toHaveLength(1)
  })
})
