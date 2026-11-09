import { describe, it, expect } from 'vitest'
import { buildPassport, passportKpiValues } from '../lib/tyrePassport'

// One physical tyre (real serial) fitted on three vehicles, each with its own odometer.
const three = [
  { id: 'a', serial_no: 'YMA55312', country: 'KSA', asset_no: 'TM1', fitment_date: '2025-01-01', issue_date: '2025-01-01', removal_date: '2025-03-01', km_at_fitment: 10000, km_at_removal: 30000, cost_per_tyre: 1000, status: 'Removed' },
  { id: 'b', serial_no: 'YMA55312', country: 'KSA', asset_no: 'TM2', fitment_date: '2025-03-05', issue_date: '2025-03-05', removal_date: '2025-06-01', km_at_fitment: 50000, km_at_removal: 60000, cost_per_tyre: 1000, status: 'Removed' },
  { id: 'c', serial_no: 'YMA55312', country: 'KSA', asset_no: 'TM3', fitment_date: '2025-06-05', issue_date: '2025-06-05', removal_date: '2025-09-01', km_at_fitment: 5000, km_at_removal: 35000, cost_per_tyre: 1200, status: 'Removed' },
]

describe('tyrePassport on the lifetime layer', () => {
  it('one tyre on 3 vehicles: price once, km summed per vehicle odometer', () => {
    const p = buildPassport(three)
    expect(p.lifetime.physicalTyres).toBe(1)
    expect(p.lifetime.vehicles).toBe(3)
    expect(p.lifetime.km).toBe(60000)
    expect(p.lifetime.kmPerFitment.map((f) => f.km)).toEqual([20000, 10000, 30000])
    expect(p.costBreakdown.purchase).toBe(1000)
    expect(p.totals.cpk).toBeCloseTo(1000 / 60000, 3)
    expect(p.lifetime.purchaseCpk).toBeCloseTo(1000 / 60000, 3)
    expect(p.lifetime.kmCoverage).toBe('complete')
    expect(p.lifetime.provisional).toBe(false)
    expect(p.lifetime.kind).toBe('tyre_lifetime')
  })

  it('never picks a later different price silently: flags it for review', () => {
    const p = buildPassport(three)
    expect(p.priceReview.message).toBe('Priced on 3 fitments - needs review')
    expect(p.lifetime.costStatus).toBe('DISPUTED')
    expect(p.journey[2].cost).toBeNull()
    expect(p.events[2].priceCopied).toBe(true)
  })

  it('a refit on the same vehicle is not a second purchase', () => {
    const base = [three[0]]
    const refit = [...base, { ...three[1], id: 'r', asset_no: 'TM1' }]
    expect(buildPassport(refit).costBreakdown.purchase).toBe(buildPassport(base).costBreakdown.purchase)
    expect(buildPassport(refit).lifetime.km).toBe(30000)
  })

  it('still-fitted tyre is provisional; stint CPK is labelled per fitment', () => {
    const p = buildPassport([{ ...three[0], removal_date: null, km_at_removal: null, status: 'Active' }])
    expect(p.lifetime.provisional).toBe(true)
    expect(p.totals.cpk).toBeNull()
    expect(p.journey[0].cpkKind).toBe('per_fitment')
    expect(passportKpiValues(p).cpkKindLabel).toBe('Physical tyre lifetime CPK')
  })

  it('events stay per fitment: record count and journey stints', () => {
    const p = buildPassport(three)
    expect(p.recordCount).toBe(3)
    expect(p.journey).toHaveLength(3)
  })
})
