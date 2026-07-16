import { describe, it, expect } from 'vitest'
import {
  months12, bucketMonthly, buildBoardKpis, buildTrends, buildBreakdowns, buildBoardRecommendations,
} from '../lib/boardOverview'

const NOW = new Date('2026-07-15T00:00:00Z')

describe('boardOverview engine', () => {
  it('months12 returns 12 ordered YYYY-MM buckets ending at now', () => {
    const m = months12(NOW)
    expect(m).toHaveLength(12)
    expect(m[11].key).toBe('2026-07')
    expect(m[0].key).toBe('2025-08')
    expect(m.every((x) => /^\d{4}-\d{2}$/.test(x.key))).toBe(true)
  })

  it('bucketMonthly counts and sums into the right months', () => {
    const rows = [
      { d: '2026-07-03', v: 10 }, { d: '2026-07-20', v: 5 },
      { d: '2026-06-01', v: 7 }, { d: '2020-01-01', v: 99 }, // out of window ignored
    ]
    const counts = bucketMonthly(rows, 'd', () => 1, NOW)
    expect(counts[11]).toBe(2) // July
    expect(counts[10]).toBe(1) // June
    const sums = bucketMonthly(rows, 'd', (r) => r.v, NOW)
    expect(sums[11]).toBe(15)
    expect(sums[10]).toBe(7)
    expect(sums.reduce((a, b) => a + b, 0)).toBe(22) // 2020 row excluded
  })

  it('bucketMonthly is safe on empty / bad input', () => {
    expect(bucketMonthly(null, 'd', undefined, NOW)).toHaveLength(12)
    expect(bucketMonthly([], 'd', undefined, NOW).every((x) => x === 0)).toBe(true)
  })

  it('buildTrends emits 12-point labelled series with no colours', () => {
    const tyres = [{ issue_date: '2026-07-01', cost_per_tyre: 100, qty: 2 }]
    const accidents = [
      { incident_date: '2026-07-02', claim_amount: 500, recovered_amount: 100 },
      { incident_date: '2026-06-02' },
    ]
    const inspections = [{ completed_date: '2026-07-05' }]
    const t = buildTrends({ tyres, accidents, inspections, now: NOW })
    expect(t.labels).toHaveLength(12)
    expect(t.tyreSpend.datasets[0].data[11]).toBe(200) // 100 * 2
    expect(t.accidents.datasets[0].data[11]).toBe(1)
    expect(t.accidents.datasets[0].data[10]).toBe(1)
    expect(t.claims.datasets).toHaveLength(2) // claimed + recovered
    expect(t.claims.datasets[0].data[11]).toBe(500)
    expect(t.claims.datasets[1].data[11]).toBe(100)
    // engine emits no colours - the page applies the palette
    expect(t.tyreSpend.datasets[0].backgroundColor).toBeUndefined()
  })

  it('buildBreakdowns tallies severity / site / claim status', () => {
    const accidents = [
      { severity: 'minor', site: 'NHC', claim_amount: 10, claim_status: 'filed' },
      { severity: 'minor', site: 'NHC' },
      { severity: 'major', site: 'RED SEA' },
    ]
    const tyres = [{ site: 'NHC' }, { site: 'NHC' }, { site: 'RED SEA' }]
    const b = buildBreakdowns({ accidents, tyres })
    expect(b.accidentSeverity.labels[0]).toBe('minor') // most common first
    expect(b.accidentSeverity.datasets[0].data[0]).toBe(2)
    expect(b.accidentsBySite.labels).toContain('NHC')
    expect(b.tyresBySite.datasets[0].data[0]).toBe(2)
    // only claim-carrying rows counted in claim status
    expect(b.claimStatus.datasets[0].data.reduce((a, x) => a + x, 0)).toBe(1)
  })

  it('buildBoardKpis consolidates counts honestly and buildBoardRecommendations flags issues', () => {
    const k = buildBoardKpis({
      tyres: [{ cost_per_tyre: 100, qty: 1, issue_date: '2026-07-01' }],
      inspections: [], actions: [], fleetSize: 5,
      accidents: [{ incident_date: '2026-07-01', status: 'reported' }],
      workOrders: [{ status: 'open', due_date: '2000-01-01' }],
      stock: [{ quantity: 1, reorder_level: 5 }],
      now: NOW,
    })
    expect(k.fleetSize).toBe(5)
    expect(k.tyresTracked).toBe(1)
    expect(k.tyreSpend).toBe(100)
    expect(k.accidents).toBe(1)
    expect(k.openAccidents).toBe(1)
    expect(k.workOrdersOverdue).toBe(1)
    expect(k.lowStock).toBe(1)

    const recs = buildBoardRecommendations(k)
    expect(recs.some((r) => /overdue/i.test(r.text))).toBe(true)
    expect(recs.some((r) => /open/i.test(r.text))).toBe(true)
    expect(recs.some((r) => /reorder/i.test(r.text))).toBe(true)
    expect(buildBoardRecommendations(null)).toEqual([])
  })
})
