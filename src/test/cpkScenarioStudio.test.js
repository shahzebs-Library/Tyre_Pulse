import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LEVERS,
  buildBaseline,
  applyLevers,
  scenarioRows,
  groupByArea,
  branchImpact,
  areaExportRows,
  num,
  pctDelta,
} from '../lib/cpkScenarioStudio'

// Realistic fleet slice: two km assets + one engine-hours asset, one currency.
const fleet = [{ country: 'KSA', currency: 'SAR', km: {}, hours: {} }]

const perVehicle = [
  {
    asset_no: 'TM634',
    vehicle_type: 'TR-MIXER',
    unit: 'km',
    distance_or_hours: 187080,
    tyre_cost: 9000,
    maintenance_cost: 3000,
    total_cost: 12000,
    cpk_tyre: 9000 / 187080,
    cpk_total: 12000 / 187080,
  },
  {
    asset_no: 'TM700',
    vehicle_type: 'TR-MIXER',
    unit: 'km',
    distance_or_hours: 100000,
    tyre_cost: 5000,
    maintenance_cost: 2000,
    total_cost: 7000,
    cpk_tyre: 5000 / 100000,
    cpk_total: 7000 / 100000,
  },
  {
    asset_no: 'GEN12',
    vehicle_type: 'GENERATOR',
    unit: 'engine_hours',
    distance_or_hours: 1200,
    tyre_cost: 0,
    maintenance_cost: 6000,
    total_cost: 6000,
    cpk_tyre: null,
    cpk_total: 6000 / 1200,
  },
]

describe('helpers', () => {
  it('num returns finite numbers else null', () => {
    expect(num(5)).toBe(5)
    expect(num('12.5')).toBe(12.5)
    expect(num(null)).toBe(null)
    expect(num('x')).toBe(null)
    expect(num(Infinity)).toBe(null)
    // 0 is finite and must be preserved (not coerced to null)
    expect(num(0)).toBe(0)
  })

  it('pctDelta computes percent change, null when base is 0/null', () => {
    expect(pctDelta(110, 100)).toBeCloseTo(10, 6)
    expect(pctDelta(90, 100)).toBeCloseTo(-10, 6)
    expect(pctDelta(5, 0)).toBe(null)
    expect(pctDelta(5, null)).toBe(null)
    expect(pctDelta(null, 100)).toBe(null)
  })

  it('DEFAULT_LEVERS has the documented shape', () => {
    expect(DEFAULT_LEVERS.kmTotalOverride).toBe(null)
    expect(DEFAULT_LEVERS.hoursTotalOverride).toBe(null)
    expect(DEFAULT_LEVERS.tyreCostPct).toBe(100)
    expect(DEFAULT_LEVERS.maintCostPct).toBe(100)
    expect(DEFAULT_LEVERS.extraCost).toBe(0)
    expect(DEFAULT_LEVERS.tyrePricePct).toBe(100)
    expect(DEFAULT_LEVERS.excludedAssets).toEqual([])
  })
})

describe('buildBaseline', () => {
  it('splits km vs hours and computes cpk = total / distance', () => {
    const b = buildBaseline({ perVehicle, fleet })
    expect(b.currency).toBe('SAR')

    // km side = TM634 + TM700
    expect(b.km.distance).toBe(287080)
    expect(b.km.tyreCost).toBe(14000)
    expect(b.km.maintCost).toBe(5000)
    expect(b.km.totalCost).toBe(19000)
    expect(b.km.assetCount).toBe(2)
    expect(b.km.cpkTotal).toBeCloseTo(19000 / 287080, 10)
    expect(b.km.cpkTyre).toBeCloseTo(14000 / 287080, 10)

    // hours side = GEN12
    expect(b.hours.distance).toBe(1200)
    expect(b.hours.totalCost).toBe(6000)
    expect(b.hours.cpkTotal).toBeCloseTo(6000 / 1200, 10)
    expect(b.hours.assetCount).toBe(1)
  })

  it('falls back to tyre + maint when total_cost is missing', () => {
    const b = buildBaseline({
      perVehicle: [{ asset_no: 'A1', unit: 'km', distance_or_hours: 1000, tyre_cost: 400, maintenance_cost: 100 }],
      fleet,
    })
    expect(b.km.totalCost).toBe(500)
    expect(b.km.cpkTotal).toBeCloseTo(0.5, 10)
  })

  it('cpk is null when the side has no measured distance', () => {
    const b = buildBaseline({
      perVehicle: [{ asset_no: 'Z', unit: 'km', distance_or_hours: 0, tyre_cost: 1000, maintenance_cost: 0, total_cost: 1000 }],
      fleet,
    })
    expect(b.km.distance).toBe(0)
    expect(b.km.cpkTotal).toBe(null)
    expect(b.km.cpkTyre).toBe(null)
  })

  it('is defensive on bad input', () => {
    const b = buildBaseline()
    expect(b.km.distance).toBe(0)
    expect(b.km.cpkTotal).toBe(null)
    expect(b.hours.cpkTotal).toBe(null)
    expect(b.currency).toBe('')
    const b2 = buildBaseline({ perVehicle: 'nope', fleet: null })
    expect(b2.km.assetCount).toBe(0)
  })
})

describe('applyLevers', () => {
  it('kmTotalOverride replaces distance so cpk = totalCost / override (headline feature)', () => {
    const b = buildBaseline({ perVehicle, fleet })
    const res = applyLevers(b, { kmTotalOverride: 500000 })
    expect(res.km.distance).toBe(500000)
    // costs unchanged (all pct 100, no exclusion, no extra)
    expect(res.km.totalCost).toBe(19000)
    expect(res.km.cpkTotal).toBeCloseTo(19000 / 500000, 10)
    // a bigger denominator lowers cpk
    expect(res.km.cpkTotal).toBeLessThan(b.km.cpkTotal)
    // hours side untouched by a km override
    expect(res.hours.cpkTotal).toBeCloseTo(b.hours.cpkTotal, 10)
  })

  it('hoursTotalOverride overrides the hours side only', () => {
    const b = buildBaseline({ perVehicle, fleet })
    const res = applyLevers(b, { hoursTotalOverride: 2400 })
    expect(res.hours.distance).toBe(2400)
    expect(res.hours.cpkTotal).toBeCloseTo(6000 / 2400, 10)
    expect(res.km.distance).toBe(b.km.distance)
  })

  it('excludedAssets removes that asset cost + distance from the side', () => {
    const b = buildBaseline({ perVehicle, fleet })
    const res = applyLevers(b, { excludedAssets: ['TM700'] })
    // km side is now just TM634
    expect(res.km.distance).toBe(187080)
    expect(res.km.tyreCost).toBe(9000)
    expect(res.km.maintCost).toBe(3000)
    expect(res.km.totalCost).toBe(12000)
    expect(res.km.cpkTotal).toBeCloseTo(12000 / 187080, 10)
  })

  it('tyreCostPct and maintCostPct scale the respective costs; extraCost adds to km total', () => {
    const b = buildBaseline({ perVehicle, fleet })
    const res = applyLevers(b, { tyreCostPct: 50, maintCostPct: 200, extraCost: 1000 })
    // tyre 14000 * 0.5 = 7000 ; maint 5000 * 2 = 10000 ; + extra 1000 = 18000
    expect(res.km.tyreCost).toBeCloseTo(7000, 6)
    expect(res.km.maintCost).toBeCloseTo(10000, 6)
    expect(res.km.totalCost).toBeCloseTo(18000, 6)
    expect(res.km.cpkTotal).toBeCloseTo(18000 / 287080, 10)
    // extraCost does NOT touch the hours side
    expect(res.hours.totalCost).toBeCloseTo(12000, 6) // 6000 maint * 2
  })

  it('tyrePricePct compounds with tyreCostPct', () => {
    const b = buildBaseline({ perVehicle, fleet })
    const res = applyLevers(b, { tyreCostPct: 100, tyrePricePct: 50 })
    expect(res.km.tyreCost).toBeCloseTo(7000, 6)
  })

  it('zeroing the distance yields cpkTotal null (not 0/Infinity)', () => {
    const b = buildBaseline({ perVehicle, fleet })
    const res = applyLevers(b, { kmTotalOverride: 0 })
    expect(res.km.distance).toBe(0)
    expect(res.km.cpkTotal).toBe(null)
    expect(res.km.cpkTyre).toBe(null)
    expect(Number.isFinite(res.km.cpkTotal)).toBe(false)
  })

  it('clamps negative percentages and costs to 0', () => {
    const b = buildBaseline({ perVehicle, fleet })
    const res = applyLevers(b, { tyreCostPct: -50, maintCostPct: -10, extraCost: -9999 })
    expect(res.km.tyreCost).toBe(0)
    expect(res.km.maintCost).toBe(0)
    expect(res.km.totalCost).toBe(0)
  })

  it('delta signs are correct: raising cost raises cpkTotal', () => {
    const b = buildBaseline({ perVehicle, fleet })
    const res = applyLevers(b, { maintCostPct: 200 })
    expect(res.delta.km.cpkTotalAbs).toBeGreaterThan(0)
    expect(res.delta.km.cpkTotalPct).toBeGreaterThan(0)
    expect(res.delta.km.totalCostAbs).toBeGreaterThan(0)
    // distance unchanged
    expect(res.delta.km.distanceAbs).toBe(0)
  })

  it('delta is null when a side cpk is null', () => {
    const b = buildBaseline({ perVehicle, fleet })
    const res = applyLevers(b, { kmTotalOverride: 0 })
    expect(res.delta.km.cpkTotalAbs).toBe(null)
    expect(res.delta.km.cpkTotalPct).toBe(null)
  })

  it('merges partial levers over DEFAULT_LEVERS and never mutates the baseline', () => {
    const b = buildBaseline({ perVehicle, fleet })
    const before = b.km.cpkTotal
    applyLevers(b, { tyreCostPct: 10 })
    expect(b.km.cpkTotal).toBe(before)
  })
})

describe('scenarioRows', () => {
  it('returns a baseline row plus one row per scenario', () => {
    const b = buildBaseline({ perVehicle, fleet })
    const rows = scenarioRows(b, [
      { name: 'Manual 500k km', levers: { kmTotalOverride: 500000 } },
      { name: 'Drop TM700', levers: { excludedAssets: ['TM700'] } },
    ])
    expect(rows).toHaveLength(3)
    expect(rows[0].name).toBe('Baseline (measured)')
    expect(rows[0].note).toBe('measured')
    expect(rows[0].kmDistance).toBe(287080)
    expect(rows[0].kmCpkTotal).toBeCloseTo(19000 / 287080, 10)

    expect(rows[1].name).toBe('Manual 500k km')
    expect(rows[1].kmDistance).toBe(500000)
    expect(rows[1].kmCpkTotal).toBeCloseTo(19000 / 500000, 10)

    expect(rows[2].name).toBe('Drop TM700')
    expect(rows[2].kmDistance).toBe(187080)
  })

  it('handles no scenarios (baseline only) and honest nulls', () => {
    const b = buildBaseline({ perVehicle: [], fleet })
    const rows = scenarioRows(b)
    expect(rows).toHaveLength(1)
    expect(rows[0].kmCpkTotal).toBe(null)
    expect(rows[0].hoursCpkTotal).toBe(null)
  })
})

describe('dropHoursSide lever', () => {
  it('is in DEFAULT_LEVERS and defaults to false', () => {
    expect(DEFAULT_LEVERS.dropHoursSide).toBe(false)
  })

  it('zeroes the hours side (km unchanged) when true', () => {
    const b = buildBaseline({ perVehicle, fleet })
    const res = applyLevers(b, { dropHoursSide: true })
    // hours side removed entirely
    expect(res.hours.distance).toBe(0)
    expect(res.hours.tyreCost).toBe(0)
    expect(res.hours.maintCost).toBe(0)
    expect(res.hours.totalCost).toBe(0)
    expect(res.hours.cpkTotal).toBe(null)
    expect(res.hours.cpkTyre).toBe(null)
    // km side is completely unaffected
    expect(res.km.distance).toBe(b.km.distance)
    expect(res.km.totalCost).toBe(b.km.totalCost)
    expect(res.km.cpkTotal).toBeCloseTo(b.km.cpkTotal, 10)
  })

  it('leaves the hours side intact when false (default)', () => {
    const b = buildBaseline({ perVehicle, fleet })
    const res = applyLevers(b, {})
    expect(res.hours.distance).toBe(1200)
    expect(res.hours.cpkTotal).toBeCloseTo(6000 / 1200, 10)
  })
})

// area map joins by asset_no; sites give the branch grouping.
const areaMap = [
  { asset_no: 'TM634', site: 'NHC', region: 'Central', vehicle_type: 'TR-MIXER' },
  { asset_no: 'TM700', site: 'RED SEA', region: 'Western', vehicle_type: 'TR-MIXER' },
  { asset_no: 'GEN12', site: 'NHC', region: 'Central', vehicle_type: 'GENERATOR' },
]

describe('groupByArea', () => {
  it('joins per-asset rows to branches and computes per-site cpk', () => {
    const areas = groupByArea(perVehicle, areaMap)
    // two sites: NHC (TM634 km + GEN12 hours) and RED SEA (TM700 km)
    expect(areas).toHaveLength(2)

    const nhc = areas.find((a) => a.site === 'NHC')
    expect(nhc.region).toBe('Central')
    expect(nhc.assetCount).toBe(2)
    // km side of NHC = TM634 only
    expect(nhc.km.distance).toBe(187080)
    expect(nhc.km.totalCost).toBe(12000)
    expect(nhc.km.cpkTotal).toBeCloseTo(12000 / 187080, 10)
    // hours side of NHC = GEN12
    expect(nhc.hours.distance).toBe(1200)
    expect(nhc.hours.cpkTotal).toBeCloseTo(6000 / 1200, 10)

    const red = areas.find((a) => a.site === 'RED SEA')
    expect(red.km.distance).toBe(100000)
    expect(red.km.cpkTotal).toBeCloseTo(7000 / 100000, 10)
    // no hours side -> null cpk, not 0
    expect(red.hours.distance).toBe(0)
    expect(red.hours.cpkTotal).toBe(null)
  })

  it('sorts sites by km total cost descending', () => {
    const areas = groupByArea(perVehicle, areaMap)
    // NHC km total 12000 > RED SEA 7000
    expect(areas[0].site).toBe('NHC')
    expect(areas[1].site).toBe('RED SEA')
  })

  it('joins case/space-insensitively on asset_no', () => {
    const areas = groupByArea(
      [{ asset_no: ' tm634 ', unit: 'km', distance_or_hours: 1000, tyre_cost: 100, maintenance_cost: 0, total_cost: 100 }],
      [{ asset_no: 'TM634', site: 'NHC', region: 'Central' }],
    )
    expect(areas).toHaveLength(1)
    expect(areas[0].site).toBe('NHC')
  })

  it('buckets assets with no matching site into Unassigned', () => {
    const areas = groupByArea(
      [{ asset_no: 'X99', unit: 'km', distance_or_hours: 1000, tyre_cost: 100, maintenance_cost: 0, total_cost: 100 }],
      areaMap,
    )
    expect(areas).toHaveLength(1)
    expect(areas[0].site).toBe('Unassigned')
    expect(areas[0].km.cpkTotal).toBeCloseTo(0.1, 10)
  })

  it('is defensive on empty / bad input', () => {
    expect(groupByArea()).toEqual([])
    expect(groupByArea('x', null)).toEqual([])
    expect(groupByArea([], [])).toEqual([])
  })
})

describe('branchImpact', () => {
  it('projects moved km at the target branch cpk and computes a signed delta', () => {
    const imp = branchImpact(perVehicle, areaMap, { fromSite: 'RED SEA', toSite: 'NHC' })
    expect(imp.movedAssets).toBe(1)
    expect(imp.movedKm).toBe(100000)
    expect(imp.currentCost).toBe(7000)
    expect(imp.currentCpk).toBeCloseTo(7000 / 100000, 10)
    // NHC km cpk = 12000 / 187080
    const targetCpk = 12000 / 187080
    expect(imp.targetCpk).toBeCloseTo(targetCpk, 10)
    // projectedCost = movedKm * targetCpk
    expect(imp.projectedCost).toBeCloseTo(100000 * targetCpk, 6)
    expect(imp.costDelta).toBeCloseTo(100000 * targetCpk - 7000, 6)
    expect(imp.costDeltaPct).toBeCloseTo(((100000 * targetCpk - 7000) / 7000) * 100, 6)
  })

  it('is null-safe when the target branch has no measured km cpk', () => {
    // ORPHAN site has only an hours asset -> no km cpk
    const pv = [
      { asset_no: 'A', unit: 'km', distance_or_hours: 1000, tyre_cost: 100, maintenance_cost: 0, total_cost: 100 },
      { asset_no: 'B', unit: 'engine_hours', distance_or_hours: 500, tyre_cost: 0, maintenance_cost: 200, total_cost: 200 },
    ]
    const am = [
      { asset_no: 'A', site: 'FROM', region: '' },
      { asset_no: 'B', site: 'TO', region: '' },
    ]
    const imp = branchImpact(pv, am, { fromSite: 'FROM', toSite: 'TO' })
    expect(imp.targetCpk).toBe(null)
    expect(imp.projectedCost).toBe(null)
    expect(imp.costDelta).toBe(null)
    expect(imp.costDeltaPct).toBe(null)
  })

  it('returns an empty shape when a selection is missing', () => {
    const imp = branchImpact(perVehicle, areaMap, { fromSite: 'NHC' })
    expect(imp.movedAssets).toBe(0)
    expect(imp.projectedCost).toBe(null)
  })
})

describe('areaExportRows', () => {
  it('flattens area rows with numbers or null', () => {
    const areas = groupByArea(perVehicle, areaMap)
    const rows = areaExportRows(areas)
    expect(rows).toHaveLength(2)
    const nhc = rows.find((r) => r.site === 'NHC')
    expect(nhc.region).toBe('Central')
    expect(nhc.kmDistance).toBe(187080)
    expect(nhc.kmCpkTotal).toBeCloseTo(12000 / 187080, 10)
    expect(nhc.assetCount).toBe(2)
    const red = rows.find((r) => r.site === 'RED SEA')
    expect(red.hoursCpkTotal).toBe(null)
  })

  it('is defensive on bad input', () => {
    expect(areaExportRows()).toEqual([])
    expect(areaExportRows(null)).toEqual([])
  })
})
