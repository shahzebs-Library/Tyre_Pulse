import { describe, it, expect } from 'vitest'
import {
  calcCpk, calcLife, avg, stdFlag, cpkBand, makeSizeLabeller, filterSizeRecords,
  filterOptionsFor, datePresetRange, sizeMetrics, bySizeCount, sizeKpis,
  sizeBrandMatrix, brandBreakdown, positionCompliance, comboTrend, consolidationOps,
  lastNMonths, monthLabel, UNKNOWN_SIZE,
} from '../lib/tyreSizeAnalytics'

const rec = (o) => ({ km_at_fitment: 0, km_at_removal: 10000, cost_per_tyre: 1000, ...o })

describe('tyreSizeAnalytics', () => {
  it('computes life and CPK only from forward, priced runs', () => {
    expect(calcLife(rec())).toBe(10000)
    expect(calcLife(rec({ km_at_removal: null }))).toBeNull()
    expect(calcLife(rec({ km_at_fitment: 20000 }))).toBeNull()
    expect(calcCpk(rec())).toBe(0.1)
    expect(calcCpk(rec({ cost_per_tyre: 0 }))).toBeNull()
    expect(calcCpk(rec({ cost_per_tyre: null }))).toBeNull()
    expect(avg([1, null, 3])).toBe(2)
    expect(avg([])).toBeNull()
    expect([stdFlag(6), stdFlag(2), stdFlag(1)]).toEqual(['Standard', 'Low Volume', 'Outlier'])
    expect([cpkBand(1), cpkBand(1.5), cpkBand(3), cpkBand(null)]).toEqual(['good', 'avg', 'poor', null])
  })

  it('folds spacing variants into one size but keeps unplaceable labels', () => {
    const label = makeSizeLabeller([{ size: '315/80 R 22.5' }, { size: '315/80R22.5' }, { size: 'weird-size' }])
    expect(label('315/80 R 22.5')).toBe(label('315/80R22.5'))
    expect(label('weird-size')).toBe('weird-size')
    expect(label('')).toBe(UNKNOWN_SIZE)
    expect(label(null)).toBe(UNKNOWN_SIZE)
  })

  it('filters by dimension and date, keeping rows with no date', () => {
    const rows = [
      { country: 'KSA', site: 'A', brand: 'X', position: 'S', issue_date: '2026-01-10' },
      { country: 'UAE', site: 'B', brand: 'Y', position: 'D', issue_date: null },
    ]
    expect(filterSizeRecords(rows, { country: 'KSA' })).toHaveLength(1)
    expect(filterSizeRecords(rows, { from: '2026-02-01' })).toHaveLength(1)
    expect(filterSizeRecords(rows, { position: 'D' }, (p) => p)).toHaveLength(1)
    expect(filterOptionsFor(rows).brands).toEqual(['All', 'X', 'Y'])
  })

  it('computes a date preset from an injected clock', () => {
    expect(datePresetRange(null)).toEqual({ from: '', to: '' })
    const r = datePresetRange(30, new Date('2026-09-26T12:00:00Z'))
    expect(r.to).toBe('2026-09-26')
    expect(r.from).toBe('2026-08-27')
  })

  it('measures failure rate only over rated tyres, null when none are rated', () => {
    const rows = [
      rec({ size: 'A', risk_level: 'High', brand: 'X', asset_no: 'T1' }),
      rec({ size: 'A', risk_level: 'Low', brand: 'X', asset_no: 'T2' }),
      rec({ size: 'A', risk_level: null, brand: 'X', asset_no: 'T2' }),
      rec({ size: 'B', risk_level: null, asset_no: 'T3' }),
    ]
    const m = sizeMetrics(rows, (s) => s)
    const a = m.find((x) => x.size === 'A')
    const b = m.find((x) => x.size === 'B')
    expect(a.failRate).toBe(50)
    expect(a.ratedCount).toBe(2)
    expect(b.failRate).toBeNull()
    expect(a.avgCpk).toBeNull() // fewer than MIN_RECORDS_CPK samples
    expect(bySizeCount(m)[0].size).toBe('A')
    const k = sizeKpis(rows, m)
    expect(k.uniqueSz).toBe(2)
    expect(k.rated).toBe(2)
    expect(k.fleetAvgCpk).toBeCloseTo(0.1)
    expect(sizeKpis([], []).stdScore).toBeNull()
  })

  it('builds a size by brand matrix and a brand breakdown', () => {
    const rows = [rec({ size: 'A', brand: 'X' }), rec({ size: 'A', brand: 'X', cost_per_tyre: 2000 }), rec({ size: 'A', brand: 'Y' })]
    const m = sizeMetrics(rows, (s) => s)
    const mx = sizeBrandMatrix(rows, m, (s) => s)
    expect(mx.sizes).toEqual(['A'])
    expect(mx.matrix.A.X).toBeCloseTo(0.15)
    expect(mx.matrix.A.Y).toBeNull()
    const bd = brandBreakdown(rows, 'A', (s) => s)
    expect(bd[0]).toMatchObject({ brand: 'X', count: 2 })
    expect(bd[1].avgCpk).toBeNull()
  })

  it('scores position compliance against the two most used sizes', () => {
    const rows = [{ size: 'A', position: 'S' }, { size: 'A', position: 'S' }, { size: 'B', position: 'S' }, { size: 'C', position: 'S' }]
    const [p] = positionCompliance(rows, (s) => s, (x) => x)
    expect(p.nonStd).toBe(1)
    expect(p.compliance).toBe(75)
  })

  it('builds a 12-month combo trend with gaps as null', () => {
    const now = new Date('2026-09-15T00:00:00Z')
    expect(lastNMonths(12, now)).toHaveLength(12)
    expect(monthLabel('2026-09')).toBe('Sep 2026')
    const rows = [rec({ size: 'A', brand: 'X', issue_date: '2026-09-02' }), rec({ size: 'A', brand: 'X', issue_date: '2020-01-01' })]
    const t = comboTrend(rows, (s) => s, now)
    expect(t.series).toHaveLength(1)
    expect(t.series[0].data.at(-1)).toBeCloseTo(0.1)
    expect(t.series[0].data.filter((v) => v == null)).toHaveLength(11)
    expect(comboTrend([], (s) => s, now).series).toEqual([])
  })

  it('never invents a tyre life when estimating consolidation savings', () => {
    const mk = (brand, cost, removal) => ({ size: 'A', brand, asset_no: brand, km_at_fitment: 0, km_at_removal: removal, cost_per_tyre: cost })
    const rows = [...Array(5)].flatMap(() => [mk('X', 1000, 10000), mk('Y', 3000, 10000)])
    const m = sizeMetrics(rows, (s) => s)
    const ops = consolidationOps(rows, m, (s) => s, 0.05)
    const std = ops.find((o) => o.type === 'standardize')
    expect(std.best.brand).toBe('X')
    expect(std.savings).toBeCloseTo(5 * 0.2 * 10000)
    const review = ops.find((o) => o.type === 'review')
    expect(review.impact).toBe('Critical')
    expect(ops[0].impact).toBe('Critical')
    const noLife = consolidationOps(rows, m.map((x) => ({ ...x, avgLife: null })), (s) => s, 0.05)
    expect(noLife.every((o) => o.savings == null)).toBe(true)
    const single = consolidationOps([{ size: 'Z', asset_no: 'T9' }], [{ size: 'Z', vehicles: ['T9'], brands: [], avgCpk: null, count: 1 }], (s) => s, null)
    expect(single).toEqual([{ type: 'eliminate', impact: 'Low', size: 'Z', vehicle: 'T9', savings: null }])
  })
})
