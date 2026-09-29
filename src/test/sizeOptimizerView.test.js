import { describe, it, expect } from 'vitest'
import {
  deriveApplication, assetRecommendations, optimizerKpis, savingsByCurrency, filterRows,
  runOptimization, fiveYearCost, annualTyreKm, loadIndexOf, catalogueFor, byVehicleType,
} from '../lib/sizeOptimizerView'
import { makeSizeLabeller } from '../lib/tyreSizeAnalytics'

const t = (id, asset, size, cost, km, country = 'KSA', date = '2026-05-01', type = 'TR-MIXER') => ({
  id, asset_no: asset, size, cost_per_tyre: cost, km_at_fitment: 0, km_at_removal: km, country, issue_date: date, vehicle_type: type, site: 'NHC',
})

// Size A: 5 tyres at 2000/40000 = 0.05. Size B: 5 tyres at 1000/50000 = 0.02 (better).
const recs = [
  ...[1, 2, 3, 4, 5].map((i) => t(i, 'TM1', '315/80R22.5', 2000, 40000)),
  ...[6, 7, 8, 9, 10].map((i) => t(i, 'TM2', '385/65R22.5', 1000, 50000)),
]

describe('sizeOptimizerView', () => {
  it('derives an application from the vehicle type, null when unknown', () => {
    expect(deriveApplication('TR-MIXER')).toBe('Construction')
    expect(deriveApplication('WHEEL LOADER')).toBe('Off Road')
    expect(deriveApplication('BUS')).toBe('On Road')
    expect(deriveApplication('SOMETHING')).toBeNull()
    expect(deriveApplication('')).toBeNull()
  })

  it('recommends a cheaper size for the same type and computes savings from real km', () => {
    const rows = assetRecommendations(recs, makeSizeLabeller(recs), [])
    const tm1 = rows.find((r) => r.asset_no === 'TM1')
    expect(tm1.status).toBe('Recommended')
    expect(tm1.recommendedSize).toBe('385/65R22.5')
    expect(tm1.lifeDeltaPct).toBeCloseTo(25)
    // (0.05 - 0.02) x 200,000 km recorded = 6000
    expect(tm1.saving).toBeCloseTo(6000)
    const tm2 = rows.find((r) => r.asset_no === 'TM2')
    expect(tm2.status).toBe('Current is best')
    expect(tm2.saving).toBeNull()
  })

  it('never compares sizes across countries and keeps money per currency', () => {
    const mixed = [...recs, ...[11, 12, 13, 14, 15].map((i) => t(i, 'U1', '385/65R22.5', 10, 100000, 'UAE'))]
    const rows = assetRecommendations(mixed, makeSizeLabeller(mixed), [])
    const u1 = rows.find((r) => r.asset_no === 'U1')
    expect(u1.status).toBe('Current is best')
    const k = optimizerKpis(rows)
    expect(k.savings).toEqual([{ currency: 'SAR', amount: expect.any(Number) }])
    expect(savingsByCurrency([{ saving: 1, currency: 'SAR' }, { saving: 2, currency: 'AED' }])).toHaveLength(2)
    expect(optimizerKpis([{ saving: 1, currency: 'SAR', status: 'Recommended' }, { saving: 2, currency: 'AED', status: 'Recommended' }]).savingSingle).toBeNull()
  })

  it('marks thin samples as not enough data or under review, never a guess', () => {
    const thin = [t(1, 'X1', '315/80R22.5', 2000, 40000), ...[2, 3, 4, 5, 6].map((i) => t(i, 'X2', '385/65R22.5', 1000, 50000))]
    const rows = assetRecommendations(thin, makeSizeLabeller(thin), [])
    expect(rows.find((r) => r.asset_no === 'X1').status).toBe('Under Review')
    expect(rows.find((r) => r.asset_no === 'X1').saving).toBeNull()
    expect(optimizerKpis([]).fuelGainPct).toBeNull()
    expect(optimizerKpis([]).lifeImprovementPct).toBeNull()
  })

  it('reads the vehicle type from the fleet register when the record has none', () => {
    const r = recs.map((x) => ({ ...x, vehicle_type: null }))
    const fleet = [{ asset_no: 'TM1', country: 'KSA', vehicle_type: 'TR-MIXER' }, { asset_no: 'TM2', country: 'KSA', vehicle_type: 'TR-MIXER' }]
    const rows = assetRecommendations(r, makeSizeLabeller(r), fleet)
    expect(rows.find((x) => x.asset_no === 'TM1').status).toBe('Recommended')
    expect(byVehicleType(rows)[0].assets).toBe(2)
  })

  it('filters rows by search, type and status', () => {
    const rows = assetRecommendations(recs, makeSizeLabeller(recs), [])
    expect(filterRows(rows, { status: 'Recommended' })).toHaveLength(1)
    expect(filterRows(rows, { search: 'tm2' })).toHaveLength(1)
    expect(filterRows(rows, { vehicleType: 'All' })).toHaveLength(2)
  })

  it('runs an optimization and says which inputs were used or not', () => {
    const res = runOptimization({
      records: recs, label: makeSizeLabeller(recs), asset: { asset_no: 'TM1', country: 'KSA', vehicle_type: 'TR-MIXER' },
      currentSize: '315/80R22.5', terrain: 'Rocky', priority: 'cpk', target: 10,
    })
    expect(res.ok).toBe(true)
    expect(res.best.size).toBe('385/65R22.5')
    expect(res.best.gainPct).toBeCloseTo(60)
    expect(res.unused.join(' ')).toMatch(/Terrain/)
    expect(res.unused.join(' ')).toMatch(/Fuel/)
    const none = runOptimization({ records: recs, label: (s) => s, asset: { asset_no: 'Z', country: 'KSA' } })
    expect(none.ok).toBe(false)
  })

  it('reads catalogue load index and five-year cost honestly', () => {
    expect(loadIndexOf({ load_index_single: '154/150' })).toBe(154)
    expect(loadIndexOf({})).toBeNull()
    expect(catalogueFor([{ size: '315/80 R22.5', approval_status: 'approved' }], '315/80R22.5')).toHaveLength(1)
    expect(fiveYearCost(0.02, 10000)).toBeCloseTo(1000)
    expect(fiveYearCost(null, 10000)).toBeNull()
    expect(annualTyreKm(recs, 'TM1', 'KSA')).toBeNull()
  })
})
