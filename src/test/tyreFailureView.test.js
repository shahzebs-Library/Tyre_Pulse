import { describe, it, expect } from 'vitest'
import {
  lifeKmOf, lifeDistribution, reasonSegments, cpkBars, removedRows, riskTone,
  previousWindow, pctChange, periodTrends, pickTarget, TARGET_METRICS, drillSummary,
} from '../lib/tyreFailureView'

const rec = (id, extra) => ({ id, brand: 'A', site: 'NHC', status: 'Removed', ...extra })

describe('tyreFailureView', () => {
  it('measures life only with real fitment and removal km', () => {
    expect(lifeKmOf({ km_at_fitment: 1000, km_at_removal: 51000 })).toBe(50000)
    expect(lifeKmOf({ km_at_fitment: 5000, km_at_removal: 1000 })).toBeNull()
    expect(lifeKmOf({})).toBeNull()
  })

  it('bands tyre life and counts the measurable share', () => {
    const d = lifeDistribution([
      { km_at_fitment: 0, km_at_removal: 20000 },
      { km_at_fitment: 0, km_at_removal: 30000 },
      { km_at_fitment: 0, km_at_removal: 95000 },
      {},
    ])
    expect(d.measured).toBe(3)
    expect(d.total).toBe(4)
    expect(d.bands.map((b) => b.count)).toEqual([1, 1, 0, 0, 1])
  })

  it('folds reasons past the top n into Other and assigns fixed colours', () => {
    const chart = { labels: ['a', 'b', 'c'], datasets: [{ data: [5, 3, 1] }] }
    const s = reasonSegments(chart, ['#1', '#2', '#3'], 2)
    expect(s.map((x) => [x.label, x.count, x.color])).toEqual([['a', 5, '#1'], ['b', 3, '#2'], ['Other', 1, '#3']])
    expect(reasonSegments(null)).toEqual([])
  })

  it('shapes CPK bars from chart data', () => {
    expect(cpkBars({ labels: ['X', 'Y'], datasets: [{ data: [0.1, 0.2] }] })).toEqual([{ brand: 'X', value: 0.1 }, { brand: 'Y', value: 0.2 }])
  })

  it('adds purchase cost and risk to the removed register, newest first', () => {
    const rows = removedRows([
      rec(1, { removal_date: '2026-01-01', cost_per_tyre: 900, risk_level: 'High' }),
      rec(2, { removal_date: '2026-03-01', cost_per_tyre: 0 }),
      { id: 3, status: 'Active' },
    ])
    expect(rows.map((r) => r.id)).toEqual([2, 1])
    expect(rows[1]).toMatchObject({ purchaseCost: 900, risk: 'High' })
    expect(rows[0]).toMatchObject({ purchaseCost: null, risk: null })
    expect(riskTone('Critical')).toBe('bad')
    expect(riskTone('Medium')).toBe('warn')
    expect(riskTone('')).toBeNull()
  })

  it('compares only a closed window with the equal window before it', () => {
    expect(previousWindow('2026-02-01', '2026-02-10')).toEqual({ from: '2026-01-22', to: '2026-01-31' })
    expect(previousWindow('2026-02-01', '')).toBeNull()
    expect(pctChange(110, 100)).toBe(10)
    expect(pctChange(5, 0)).toBeNull()
    expect(pctChange(null, 4)).toBeNull()
    const records = [
      rec(1, { issue_date: '2026-01-25' }),
      rec(2, { issue_date: '2026-02-03' }),
      rec(3, { issue_date: '2026-02-05' }),
    ]
    const t = periodTrends(records, { from: '2026-02-01', to: '2026-02-10' })
    expect(t.removed).toBe(100)
    expect(periodTrends(records, { from: '2026-02-01' })).toBeNull()
    const none = periodTrends([rec(1, { issue_date: '2026-02-03' })], { from: '2026-02-01', to: '2026-02-10' })
    expect(none.removed).toBeNull()
  })

  it('picks the country target before a country-blank one and ignores monthly rows', () => {
    const rows = [
      { metric: TARGET_METRICS.cpk, target_value: 0.2, country: null, month: null },
      { metric: TARGET_METRICS.cpk, target_value: 0.12, country: 'KSA', month: null },
      { metric: TARGET_METRICS.cpk, target_value: 0.01, country: 'KSA', month: 3 },
    ]
    expect(pickTarget(rows, TARGET_METRICS.cpk, 'KSA')).toBe(0.12)
    expect(pickTarget(rows, TARGET_METRICS.cpk, 'UAE')).toBe(0.2)
    expect(pickTarget([], TARGET_METRICS.life, 'KSA')).toBeNull()
  })

  it('writes the drill-down from measured fields only', () => {
    const s = drillSummary({ serial_no: 'S1', asset_no: 'TM1', position: 'LHF1', reason: 'Puncture', lifeKm: 32450, cpk: 0.024 }, { currency: 'SAR' })
    expect(s).toBe('S1 on TM1 (LHF1) removed for puncture after 32,450 km. Cost per km 0.024 SAR/km.')
    expect(drillSummary({ serial_no: 'S2' })).toMatch(/no reason recorded.*cannot be measured/)
    expect(drillSummary(null)).toBe('')
  })
})
