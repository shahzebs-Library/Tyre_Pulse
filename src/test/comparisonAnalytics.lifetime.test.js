import { describe, it, expect } from 'vitest'
import { buildComparison } from '../lib/comparisonAnalytics'
import { MOVED, REFIT } from './lifetimeFixture.helpers'

const A = { year: 2025, months: [0, 1, 2, 3, 4] }
const B = { year: 2025, months: [5, 6, 7, 8, 9, 10, 11] }

describe('comparisonAnalytics with one price per tyre', () => {
  it('one tyre on three vehicles is bought once', () => {
    const r = buildComparison(MOVED, { periodA: A, periodB: B, metric: 'cost' })
    expect(r.totals.a + r.totals.b).toBe(900)
  })

  it('a refit is not a second purchase (cost metric)', () => {
    const r = buildComparison(REFIT, { periodA: A, periodB: B, metric: 'cost' })
    expect(r.totals.a).toBe(800)
    expect(r.totals.b).toBe(0) // was 800: the June refit counted as a purchase
    expect(r.pricedPctB).toBe(100) // the refit was priced, once, earlier
    expect(r.avgCostA).toBe(800)
  })

  it('the count metric still counts replacement events per row', () => {
    const r = buildComparison([...MOVED, ...REFIT], { periodA: A, periodB: B, metric: 'count' })
    expect(r.totals.a + r.totals.b).toBe(5)
  })
})
