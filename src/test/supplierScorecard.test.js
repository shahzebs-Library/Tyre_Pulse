import { describe, it, expect } from 'vitest'
import { computeSupplierScorecard } from '../lib/analytics/supplierScorecard'

describe('computeSupplierScorecard', () => {
  it('returns an empty structure for empty/undefined input', () => {
    expect(computeSupplierScorecard()).toEqual({
      suppliers: [],
      totals: { supplierCount: 0, totalSpend: 0, totalTyres: 0, totalWarrantyClaims: 0, totalWarrantyCredit: 0 },
    })
    expect(computeSupplierScorecard({ tyres: [], warranty: [], purchaseOrders: [] }).suppliers).toEqual([])
  })

  it('computes actual total spend as cost_per_tyre × qty (qty defaults to 1, missing cost → 0)', () => {
    const { suppliers } = computeSupplierScorecard({
      tyres: [
        { supplier: 'Bridgestone', cost_per_tyre: 100, qty: 2 },
        { supplier: 'Bridgestone', cost_per_tyre: 50 },
        { supplier: 'Bridgestone' },
      ],
    })
    const b = suppliers.find((s) => s.supplier === 'Bridgestone')
    expect(b.tyreCount).toBe(3)
    expect(b.totalSpend).toBe(250)
  })

  it('averages CPK only over rows with a valid km run', () => {
    const { suppliers } = computeSupplierScorecard({
      tyres: [
        { supplier: 'X', cost_per_tyre: 1000, km_at_fitment: 0, km_at_removal: 10000 }, // 0.1
        { supplier: 'X', cost_per_tyre: 600, km_at_fitment: 0, km_at_removal: 20000 }, // 0.03
        { supplier: 'X', cost_per_tyre: 500, km_at_fitment: 5000, km_at_removal: 5000 }, // km<=0 skip
        { supplier: 'X', cost_per_tyre: 500, km_at_removal: 8000 }, // fitment null skip
      ],
    })
    expect(suppliers.find((s) => s.supplier === 'X').avgCpk).toBeCloseTo((0.1 + 0.03) / 2, 6)
  })

  it('computes failure rate, approved warranty recovery, and on-time delivery', () => {
    const { suppliers } = computeSupplierScorecard({
      tyres: [{ supplier: 'Y' }, { supplier: 'Y' }, { supplier: 'Y' }, { supplier: 'Y' }],
      warranty: [
        { supplier: 'Y', claim_status: 'Approved', credit_amount: 300 },
        { supplier: 'Y', claim_status: 'Rejected', credit_amount: 0 },
      ],
      purchaseOrders: [
        { supplier_name: 'Y', expected_delivery: '2026-01-10', actual_delivery: '2026-01-09' }, // on time
        { vendor_name: 'Y', expected_delivery: '2026-02-10', actual_delivery: '2026-02-20' }, // late
      ],
    })
    const y = suppliers.find((s) => s.supplier === 'Y')
    expect(y.failureRate).toBeCloseTo(2 / 4, 6)
    expect(y.warrantyCredit).toBe(300)
    expect(y.warrantyRecoveryRate).toBeCloseTo(300 / 2, 6)
    expect(y.onTimeRate).toBeCloseTo(0.5, 6)
  })

  it('ranks suppliers by composite score and never fabricates cost', () => {
    const { suppliers, totals } = computeSupplierScorecard({
      tyres: [
        { supplier: 'Good', cost_per_tyre: 500, km_at_fitment: 0, km_at_removal: 100000 }, // CPK 0.005
        { supplier: 'Bad', cost_per_tyre: 500, km_at_fitment: 0, km_at_removal: 10000 }, // CPK 0.05
      ],
      warranty: [{ supplier: 'Bad', claim_status: 'Approved', credit_amount: 100 }],
    })
    expect(suppliers[0].rank).toBe(1)
    expect(suppliers.find((s) => s.supplier === 'Good').score)
      .toBeGreaterThanOrEqual(suppliers.find((s) => s.supplier === 'Bad').score)
    expect(totals.totalSpend).toBe(1000) // actual only
  })

  it('buckets missing supplier as Unknown', () => {
    const { suppliers } = computeSupplierScorecard({ tyres: [{ cost_per_tyre: 10 }, { supplier: '  ' }] })
    expect(suppliers.find((s) => s.supplier === 'Unknown').tyreCount).toBe(2)
  })
})
