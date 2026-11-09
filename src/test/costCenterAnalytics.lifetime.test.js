import { describe, it, expect } from 'vitest'
import {
  normaliseRecords, groupBySite, groupByBrand, groupByVehicle, buildRecordKpis,
} from '../lib/costCenterAnalytics'
import { CPK_KIND_LABEL } from '../lib/tyreLifetime'
import { threeVehicles, refitSameVehicle } from './lifetimeFixtures.groupB'

const tag = (rows) => rows.map((r) => ({ ...r, site: 'NHC', brand: 'X' }))

describe('cost center on physical tyres', () => {
  it('one tyre on three vehicles: one tyre, price once, km summed, in its latest vehicle', () => {
    const rows = normaliseRecords(tag(threeVehicles()))
    const k = buildRecordKpis(rows)
    expect(k.tyres).toBe(1)
    expect(k.records).toBe(3)
    expect(k.fleetAvgCpk).toBeCloseTo(900 / 80000, 10)
    expect(k.cpkKindLabel).toBe(CPK_KIND_LABEL.fleet_aggregate)
    const [site] = groupBySite(rows)
    expect(site.totalCost).toBe(900) // the repeat price on the second fitment is dropped
    expect(site.tyres).toBe(1)
    expect(site.avgCpk).toBeCloseTo(900 / 80000, 10)
    const v = groupByVehicle(rows)
    expect(v.find((x) => x.asset === 'TM3').avgCpk).toBeCloseTo(900 / 80000, 10)
    expect(v.find((x) => x.asset === 'TM1').avgCpk).toBeNull()
  })

  it('a same-vehicle refit is not a second purchase', () => {
    const rows = normaliseRecords(tag(refitSameVehicle()))
    const [b] = groupByBrand(rows)
    expect(b.totalCost).toBe(800)
    expect(b.avgCpk).toBeCloseTo(800 / 40000, 10)
    expect(rows[1].cpk).toBeNull() // per-fitment CPK of the refit row: no price
  })

  it('failures stay per fitment row', () => {
    const rows = normaliseRecords(tag(threeVehicles()).map((r, i) => ({ ...r, removal_reason: i < 2 ? 'Burst' : 'Worn' })))
    const [b] = groupByBrand(rows)
    expect(b.count).toBe(3)
    expect(b.failures).toBe(2)
  })
})
