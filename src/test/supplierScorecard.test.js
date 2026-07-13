import { describe, it, expect } from 'vitest'
import {
  computeSupplierScorecard,
  scoreGrade,
  lifecycleBand,
  priceCompetitivenessScore,
  deriveFlags,
  GRADE_CUTOFFS,
  FLAG_THRESHOLDS,
  TREND_DELTA_PTS,
} from '../lib/analytics/supplierScorecard'

describe('computeSupplierScorecard', () => {
  it('returns an empty structure for empty/undefined input', () => {
    expect(computeSupplierScorecard()).toEqual({
      suppliers: [],
      totals: {
        supplierCount: 0, totalSpend: 0, totalTyres: 0, totalWarrantyClaims: 0, totalWarrantyCredit: 0,
        avgScore: 0, preferredCount: 0, atRiskCount: 0, flaggedCount: 0, marketAvgCost: null,
      },
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

  it('keeps base score/rank fields (backward compatible) and adds new dimensions', () => {
    const { suppliers } = computeSupplierScorecard({
      tyres: [{ supplier: 'Z', cost_per_tyre: 500, km_at_fitment: 0, km_at_removal: 100000 }],
    })
    const z = suppliers[0]
    // legacy fields preserved
    expect(z).toHaveProperty('score')
    expect(z).toHaveProperty('rank', 1)
    expect(z).toHaveProperty('avgCpk')
    // additive fields present
    expect(z).toHaveProperty('grade')
    expect(z.band).toHaveProperty('band')
    expect(z).toHaveProperty('warrantyAcceptanceRate')
    expect(z).toHaveProperty('priceCompetitiveness')
    expect(z).toHaveProperty('flags')
    expect(z).toHaveProperty('trend')
    expect(z).toHaveProperty('scoreExpanded')
  })
})

describe('scoreGrade — letter grade thresholds', () => {
  it('applies A/B/C/D/F cutoffs at the documented boundaries', () => {
    expect(scoreGrade(100)).toBe('A')
    expect(scoreGrade(GRADE_CUTOFFS.A)).toBe('A')      // 85
    expect(scoreGrade(GRADE_CUTOFFS.A - 1)).toBe('B')  // 84
    expect(scoreGrade(GRADE_CUTOFFS.B)).toBe('B')      // 70
    expect(scoreGrade(GRADE_CUTOFFS.B - 1)).toBe('C')  // 69
    expect(scoreGrade(GRADE_CUTOFFS.C)).toBe('C')      // 55
    expect(scoreGrade(GRADE_CUTOFFS.C - 1)).toBe('D')  // 54
    expect(scoreGrade(GRADE_CUTOFFS.D)).toBe('D')      // 40
    expect(scoreGrade(GRADE_CUTOFFS.D - 1)).toBe('F')  // 39
    expect(scoreGrade(0)).toBe('F')
    expect(scoreGrade(null)).toBe('F')
    expect(scoreGrade(undefined)).toBe('F')
  })
})

describe('lifecycleBand — classifier boundaries', () => {
  it('classifies preferred/approved/watch/probation/disqualified at the exact edges', () => {
    expect(lifecycleBand(80).band).toBe('preferred')
    expect(lifecycleBand(79).band).toBe('approved')
    expect(lifecycleBand(65).band).toBe('approved')
    expect(lifecycleBand(64).band).toBe('watch')
    expect(lifecycleBand(50).band).toBe('watch')
    expect(lifecycleBand(49).band).toBe('probation')
    expect(lifecycleBand(30).band).toBe('probation')
    expect(lifecycleBand(29).band).toBe('disqualified')
    expect(lifecycleBand(0).band).toBe('disqualified')
  })

  it('returns urgency + label, and unknown for non-numeric/null', () => {
    expect(lifecycleBand(90)).toMatchObject({ band: 'preferred', urgency: 'none', score: 90 })
    expect(lifecycleBand(45)).toMatchObject({ band: 'probation', urgency: 'high' })
    expect(lifecycleBand(20)).toMatchObject({ band: 'disqualified', urgency: 'critical' })
    expect(lifecycleBand(null)).toEqual({ band: 'unknown', label: 'Unscored', urgency: 'none', score: null })
    expect(lifecycleBand('abc')).toMatchObject({ band: 'unknown', score: null })
    expect(lifecycleBand(62.4).label).toContain('62')
  })
})

describe('warranty acceptance %', () => {
  it('counts approved|accepted / total claims, defaulting to 100% when no claims', () => {
    const { suppliers } = computeSupplierScorecard({
      tyres: [{ supplier: 'A' }, { supplier: 'B' }],
      warranty: [
        { supplier: 'A', claim_status: 'Approved' },
        { supplier: 'A', claim_status: 'accepted' },
        { supplier: 'A', claim_status: 'Rejected' },
        { supplier: 'A', claim_status: 'pending' },
      ],
    })
    const a = suppliers.find((s) => s.supplier === 'A')
    const b = suppliers.find((s) => s.supplier === 'B')
    expect(a.warrantyAccepted).toBe(2)
    expect(a.warrantyAcceptanceRate).toBeCloseTo(0.5, 6) // 2 of 4
    expect(b.warrantyClaims).toBe(0)
    expect(b.warrantyAcceptanceRate).toBe(1) // default 100%
  })
})

describe('priceCompetitivenessScore — clamp + formula', () => {
  it('scores 50 at market avg, higher when cheaper, clamped to [0,100]', () => {
    expect(priceCompetitivenessScore(100, 100)).toBe(50)      // (2-1)*50
    expect(priceCompetitivenessScore(50, 100)).toBe(75)       // (2-0.5)*50
    expect(priceCompetitivenessScore(150, 100)).toBe(25)      // (2-1.5)*50
    expect(priceCompetitivenessScore(200, 100)).toBe(0)       // (2-2)*50
    expect(priceCompetitivenessScore(300, 100)).toBe(0)       // clamp low
    expect(priceCompetitivenessScore(1, 100)).toBe(100)       // clamp high (≈99.5→ round 100? (2-0.01)*50=99.5→100? )
    expect(priceCompetitivenessScore(null, 100)).toBe(50)     // default
    expect(priceCompetitivenessScore(100, 0)).toBe(50)        // market 0 → default
    expect(priceCompetitivenessScore(100, null)).toBe(50)     // default
  })

  it('derives supplier vs fleet-market unit cost inside the engine', () => {
    const { suppliers, totals } = computeSupplierScorecard({
      tyres: [
        { supplier: 'Cheap', cost_per_tyre: 100 },
        { supplier: 'Pricey', cost_per_tyre: 300 },
      ],
    })
    // market avg = 200
    expect(totals.marketAvgCost).toBe(200)
    const cheap = suppliers.find((s) => s.supplier === 'Cheap')
    const pricey = suppliers.find((s) => s.supplier === 'Pricey')
    expect(cheap.priceCompetitiveness).toBe(75)  // (2 - 100/200)*50
    expect(pricey.priceCompetitiveness).toBe(25) // (2 - 300/200)*50
  })
})

describe('deriveFlags — threshold-driven issues', () => {
  it('flags low on-time, low acceptance, and high failures', () => {
    expect(deriveFlags({ onTimeRate: 0.7, warrantyAcceptanceRate: 1, failureRate: 0, warrantyClaims: 0 }))
      .toEqual(['Low on-time delivery rate'])
    expect(deriveFlags({ onTimeRate: 1, warrantyAcceptanceRate: 0.5, failureRate: 0, warrantyClaims: 4 }))
      .toEqual(['Low warranty claim acceptance'])
    expect(deriveFlags({ onTimeRate: 1, warrantyAcceptanceRate: 1, failureRate: 0.06, warrantyClaims: 0 }))
      .toEqual(['High failure/defect rate'])
  })

  it('does not flag acceptance when there are no claims, and clears when all thresholds pass', () => {
    expect(deriveFlags({ onTimeRate: 1, warrantyAcceptanceRate: 0, failureRate: 0, warrantyClaims: 0 })).toEqual([])
    expect(deriveFlags({ onTimeRate: 0.95, warrantyAcceptanceRate: 1, failureRate: 0.02, warrantyClaims: 3 })).toEqual([])
  })

  it('uses the documented threshold constants', () => {
    expect(FLAG_THRESHOLDS).toMatchObject({ onTimePct: 80, acceptancePct: 80, defectPct: 5 })
  })
})

describe('trend — period-over-period delta from issue_date buckets', () => {
  // Anchor = latest date across inputs (2026-05-15). current bucket ≈ last 90d,
  // prior bucket ≈ the 90d before that (2026-01-15 falls in prior).
  const cur = '2026-05-15'
  const prior = '2026-01-15'

  it('improving: current period quality beats prior by > delta band', () => {
    const { suppliers } = computeSupplierScorecard({
      tyres: [
        ...Array(4).fill(0).map(() => ({ supplier: 'Up', issue_date: cur })),
        ...Array(4).fill(0).map(() => ({ supplier: 'Up', issue_date: prior })),
      ],
      warranty: [
        { supplier: 'Up', claim_status: 'rejected', created_at: prior },
        { supplier: 'Up', claim_status: 'rejected', created_at: prior },
        { supplier: 'Up', claim_status: 'rejected', created_at: prior },
      ],
    })
    const up = suppliers.find((s) => s.supplier === 'Up')
    expect(up.trend).toBe('improving')
    expect(up.trendDelta).toBeGreaterThan(TREND_DELTA_PTS)
  })

  it('declining: current period quality worse than prior by > delta band', () => {
    const { suppliers } = computeSupplierScorecard({
      tyres: [
        ...Array(4).fill(0).map(() => ({ supplier: 'Down', issue_date: cur })),
        ...Array(4).fill(0).map(() => ({ supplier: 'Down', issue_date: prior })),
      ],
      warranty: [
        { supplier: 'Down', claim_status: 'rejected', created_at: cur },
        { supplier: 'Down', claim_status: 'rejected', created_at: cur },
        { supplier: 'Down', claim_status: 'rejected', created_at: cur },
      ],
    })
    const down = suppliers.find((s) => s.supplier === 'Down')
    expect(down.trend).toBe('declining')
    expect(down.trendDelta).toBeLessThan(-TREND_DELTA_PTS)
  })

  it('stable: only one period of data → null delta, stable', () => {
    const { suppliers } = computeSupplierScorecard({
      tyres: [{ supplier: 'Flat', issue_date: cur }, { supplier: 'Flat', issue_date: cur }],
    })
    const flat = suppliers.find((s) => s.supplier === 'Flat')
    expect(flat.trend).toBe('stable')
    expect(flat.trendDelta).toBeNull()
  })
})
