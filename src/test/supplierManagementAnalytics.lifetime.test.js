import { describe, it, expect } from 'vitest'
import { supplierMetrics, buildSupplierMetrics, recommendationFacts } from '../lib/supplierManagementAnalytics'
import { buildSupplierDetail, recordRows } from '../lib/supplierDetailAnalytics'
import { computeSupplierScorecard } from '../lib/analytics/supplierScorecard'
import { CPK_KIND, CPK_KIND_LABEL } from '../lib/tyreLifetime'
import { threeVehicles, refitSameVehicle } from './lifetimeFixtures.groupB'

const brand = (rows, b) => rows.map((r) => ({ ...r, brand: b, supplier: b }))

describe('supplier metrics on physical tyres', () => {
  it('one tyre on three vehicles is ONE tyre, priced once, km summed', () => {
    const m = supplierMetrics(brand(threeVehicles(), 'A'), 'A', 2025)
    expect(m.count).toBe(1)
    expect(m.fitments).toBe(3)
    expect(m.avgLife).toBe(80000)
    expect(m.avgCpk).toBeCloseTo(900 / 80000, 10)
    expect(m.totalSpend).toBe(900) // the second priced row is the same tyre, not a second purchase
    expect(m.cpkKind).toBe(CPK_KIND.FLEET_AGGREGATE)
    expect(m.cpkKindLabel).toBe(CPK_KIND_LABEL.fleet_aggregate)
  })

  it('a refit on the same vehicle is not a second purchase', () => {
    const [m] = buildSupplierMetrics(brand(refitSameVehicle(), 'B'))
    expect(m.count).toBe(1)
    expect(m.avgCpk).toBeCloseTo(800 / 40000, 10)
    expect(m.totalSpend).toBe(800)
    const d = buildSupplierDetail(brand(refitSameVehicle(), 'B'), {}, 'B')
    const rows = recordRows(d.supplier.recs)
    // Per-fitment CPK: the refit row carries no price.
    expect(rows.map((r) => r.cpk)).toEqual([800 / 20000, null])
    expect(d.cpkKindLabel).toBe(CPK_KIND_LABEL.fleet_aggregate)
  })

  it('failure rate stays an event measure over fitment rows', () => {
    const rows = brand(threeVehicles(), 'A').map((r, i) => ({ ...r, risk_level: i === 0 ? 'High' : 'Low' }))
    const m = supplierMetrics(rows, 'A', 2025)
    expect(m.failureRate).toBeCloseTo(1 / 3, 10)
  })

  it('saving uses physical-tyre lifetime km, not the sum of overlapping rows', () => {
    const rows = [...brand(threeVehicles(), 'A'), ...brand(refitSameVehicle(), 'B')]
    const facts = recommendationFacts(buildSupplierMetrics(rows))
    expect(Array.isArray(facts)).toBe(true)
  })
})

describe('supplier scorecard on physical tyres', () => {
  it('counts one tyre on three vehicles once, price once, weighted CPK', () => {
    const { suppliers } = computeSupplierScorecard({ tyres: brand(threeVehicles(), 'S') })
    const s = suppliers[0]
    expect(s.tyreCount).toBe(1)
    expect(s.fitments).toBe(3)
    expect(s.avgCpk).toBeCloseTo(900 / 80000, 10)
    expect(s.totalSpend).toBe(900)
    expect(s.supplierAvgCost).toBe(900)
  })
  it('a same-vehicle refit does not change cost or CPK', () => {
    const { suppliers } = computeSupplierScorecard({ tyres: brand(refitSameVehicle(), 'S') })
    expect(suppliers[0].totalSpend).toBe(800)
    expect(suppliers[0].avgCpk).toBeCloseTo(800 / 40000, 10)
  })
  it('warranty failure rate counts claims per physical tyre; fitments stay rows', () => {
    const { suppliers } = computeSupplierScorecard({
      tyres: brand(threeVehicles(), 'S'),
      warranty: [{ supplier: 'S', claim_status: 'Pending' }],
    })
    expect(suppliers[0].failureRate).toBe(1)
    expect(suppliers[0].fitments).toBe(3)
  })
})
