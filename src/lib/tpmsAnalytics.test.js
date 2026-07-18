import { describe, it, expect } from 'vitest'
import {
  bandOf,
  signedDeviationPct,
  isAlert,
  computeKpis,
  bandDistribution,
  worstOffenders,
  complianceTrend,
  siteCompliance,
  positionBreakdown,
  underInflationInsights,
  ALERT_BANDS,
  UNDER_BANDS,
  BAND_SEVERITY,
  BAND_LABELS,
} from './tpmsAnalytics'

// Target 8.0 bar, tolerance 15% -> under < 6.8, critical < 5.6, over > 9.2.
const T = 8.0
const mk = (pressure, extra = {}) => ({ pressure, target: T, ...extra })

describe('constants', () => {
  it('exposes alert and under band sets', () => {
    expect(ALERT_BANDS).toEqual(['under', 'over', 'critical'])
    expect(UNDER_BANDS).toEqual(['under', 'critical'])
    expect(BAND_SEVERITY.critical).toBeLessThan(BAND_SEVERITY.under)
    expect(BAND_LABELS.optimal).toBe('Optimal')
  })
})

describe('bandOf', () => {
  it('uses a valid precomputed band', () => {
    expect(bandOf({ pressure: 8, target: 8, band: 'critical' })).toBe('critical')
  })
  it('classifies when band absent', () => {
    expect(bandOf(mk(8.0))).toBe('optimal')
    expect(bandOf(mk(6.0))).toBe('under')
    expect(bandOf(mk(5.0))).toBe('critical')
    expect(bandOf(mk(10.0))).toBe('over')
  })
  it('recomputes when band is an unknown token', () => {
    expect(bandOf({ pressure: 8, target: 8, band: 'weird' })).toBe('optimal')
  })
  it('returns unknown for invalid pressure', () => {
    expect(bandOf(mk(null))).toBe('unknown')
    expect(bandOf(mk(-2))).toBe('unknown')
  })
  it('reads raw pressure_reading / target_pressure fields', () => {
    expect(bandOf({ pressure_reading: 6.0, target_pressure: 8.0 })).toBe('under')
  })
})

describe('signedDeviationPct', () => {
  it('is negative when under, positive when over, ~0 at target', () => {
    expect(signedDeviationPct(mk(4))).toBeCloseTo(-50, 5)
    expect(signedDeviationPct(mk(12))).toBeCloseTo(50, 5)
    expect(signedDeviationPct(mk(8))).toBeCloseTo(0, 5)
  })
  it('is null when pressure is unmeasurable', () => {
    expect(signedDeviationPct(mk(null))).toBeNull()
    expect(signedDeviationPct(mk(-2))).toBeNull()
  })
  it('falls back to the default target when target is invalid', () => {
    // target 0 is invalid, so the fleet default (8.0) is used -> 8 vs 8 = 0.
    expect(signedDeviationPct({ pressure: 8, target: 0 })).toBeCloseTo(0, 5)
  })
})

describe('isAlert', () => {
  it('flags under/over/critical only', () => {
    expect(isAlert(mk(8))).toBe(false)
    expect(isAlert(mk(6))).toBe(true)
    expect(isAlert(mk(5))).toBe(true)
    expect(isAlert(mk(10))).toBe(true)
    expect(isAlert(mk(null))).toBe(false)
  })
})

describe('computeKpis', () => {
  const rows = [
    mk(8.0, { site: 'A' }),   // optimal
    mk(8.1, { site: 'A' }),   // optimal
    mk(6.0, { site: 'A' }),   // under
    mk(5.0, { site: 'B' }),   // critical
    mk(10.0, { site: 'B' }),  // over
    mk(null, { site: 'B' }),  // unknown
  ]
  it('counts bands and derives compliance over assessed only', () => {
    const k = computeKpis(rows)
    expect(k.total).toBe(6)
    expect(k.assessed).toBe(5) // excludes the unknown
    expect(k.bands).toEqual({ optimal: 2, under: 1, over: 1, critical: 1, unknown: 1 })
    expect(k.underInflated).toBe(2) // under + critical
    expect(k.overInflated).toBe(1)
    expect(k.alerts).toBe(3)
    expect(k.critical).toBe(1)
    expect(k.compliancePct).toBe(40) // 2 optimal / 5 assessed
    expect(k.underInflatedPct).toBe(40) // 2 / 5
  })
  it('averages pressure over finite readings only', () => {
    const k = computeKpis(rows)
    // (8.0+8.1+6.0+5.0+10.0)/5 = 7.42
    expect(k.avgPressure).toBeCloseTo(7.42, 2)
    expect(k.avgTarget).toBe(8)
    expect(k.avgAbsDeviationPct).not.toBeNull()
    expect(k.avgUnderDeviationPct).toBeGreaterThan(0)
  })
  it('is null-safe for empty / non-array input', () => {
    const k = computeKpis(null)
    expect(k.total).toBe(0)
    expect(k.assessed).toBe(0)
    expect(k.compliancePct).toBe(0)
    expect(k.avgPressure).toBeNull()
    expect(k.avgUnderDeviationPct).toBeNull()
  })
})

describe('bandDistribution', () => {
  it('orders bands and omits unknown when zero', () => {
    const d = bandDistribution([mk(8), mk(6), mk(10), mk(5)])
    expect(d.map(x => x.band)).toEqual(['optimal', 'under', 'over', 'critical'])
    expect(d.find(x => x.band === 'optimal').count).toBe(1)
    expect(d.find(x => x.band === 'optimal').pct).toBe(25)
  })
  it('includes unknown when present', () => {
    const d = bandDistribution([mk(8), mk(null)])
    expect(d.some(x => x.band === 'unknown')).toBe(true)
  })
})

describe('worstOffenders', () => {
  const rows = [
    mk(6.5, { asset_no: 'U1' }),  // under, dev ~ -18.75
    mk(5.0, { asset_no: 'C1' }),  // critical, dev -37.5
    mk(9.5, { asset_no: 'O1' }),  // over, dev +18.75
    mk(8.0, { asset_no: 'OK' }),  // optimal (excluded)
  ]
  it('ranks critical first, then by deviation, excludes optimal', () => {
    const w = worstOffenders(rows)
    expect(w.map(r => r.asset_no)).toEqual(['C1', 'U1', 'O1'])
    expect(w[0].band).toBe('critical')
    expect(w[0].absDeviationPct).toBeCloseTo(37.5, 1)
  })
  it('respects limit', () => {
    expect(worstOffenders(rows, { limit: 1 })).toHaveLength(1)
  })
  it('underOnly excludes over-inflation', () => {
    const w = worstOffenders(rows, { underOnly: true })
    expect(w.map(r => r.asset_no)).toEqual(['C1', 'U1'])
  })
  it('is null-safe', () => {
    expect(worstOffenders(undefined)).toEqual([])
  })
})

describe('complianceTrend', () => {
  const rows = [
    mk(8.0, { date: '2026-01-10' }), // optimal
    mk(6.0, { date: '2026-01-20' }), // under
    mk(8.0, { date: '2026-02-05' }), // optimal
    mk(8.1, { date: '2026-02-15' }), // optimal
    mk(5.0, { date: '2026-03-01' }), // critical
  ]
  it('buckets by month ascending with per-month compliance', () => {
    const t = complianceTrend(rows, { months: 12 })
    expect(t.map(m => m.key)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(t[0].compliancePct).toBe(50) // 1 optimal of 2
    expect(t[1].compliancePct).toBe(100)
    expect(t[2].critical).toBe(1)
    expect(t[0].label).toMatch(/Jan/)
  })
  it('keeps only the last N months', () => {
    const t = complianceTrend(rows, { months: 1 })
    expect(t).toHaveLength(1)
    expect(t[0].key).toBe('2026-03')
  })
  it('ignores rows without a parseable date', () => {
    const t = complianceTrend([mk(8, { date: null }), mk(8, { date: 'not-a-date' })])
    expect(t).toEqual([])
  })
  it('falls back to recorded_at / issue_date fields', () => {
    const t = complianceTrend([mk(8, { recorded_at: '2026-05-01' }), mk(6, { issue_date: '2026-05-02' })])
    expect(t).toHaveLength(1)
    expect(t[0].key).toBe('2026-05')
  })
})

describe('siteCompliance', () => {
  const rows = [
    mk(8.0, { site: 'A' }), mk(8.0, { site: 'A' }),   // A: 2 optimal
    mk(5.0, { site: 'B' }), mk(6.0, { site: 'B' }),   // B: 2 alerts
    mk(8.0, { site: null }),                           // Unspecified
  ]
  it('ranks worst (most alerts) first and computes compliance', () => {
    const s = siteCompliance(rows)
    expect(s[0].site).toBe('B')
    expect(s[0].alerts).toBe(2)
    expect(s[0].underInflated).toBe(2)
    expect(s[0].compliancePct).toBe(0)
    const a = s.find(x => x.site === 'A')
    expect(a.compliancePct).toBe(100)
    expect(s.some(x => x.site === 'Unspecified')).toBe(true)
  })
})

describe('positionBreakdown', () => {
  it('groups by position (normalized or raw field) worst first', () => {
    const rows = [
      mk(5.0, { position: 'Steer L' }),
      mk(8.0, { tyre_position: 'Drive R' }),
      mk(8.0, { position: 'Drive R' }),
    ]
    const p = positionBreakdown(rows)
    expect(p[0].position).toBe('Steer L')
    expect(p[0].alerts).toBe(1)
    const drive = p.find(x => x.position === 'Drive R')
    expect(drive.total).toBe(2)
    expect(drive.compliancePct).toBe(100)
  })
})

describe('underInflationInsights', () => {
  it('summarizes honestly with a worst site', () => {
    const rows = [
      mk(5.0, { site: 'B' }), mk(6.0, { site: 'B' }),
      mk(6.0, { site: 'C' }),
      mk(8.0, { site: 'A' }),
    ]
    const ins = underInflationInsights(rows)
    expect(ins.underInflatedCount).toBe(3)
    expect(ins.criticalCount).toBe(1)
    expect(ins.sitesAffected).toBe(2)
    expect(ins.worstSite.site).toBe('B')
    expect(ins.worstSite.underInflated).toBe(2)
  })
  it('reports zero and null worst site when all optimal', () => {
    const ins = underInflationInsights([mk(8.0), mk(8.1)])
    expect(ins.underInflatedCount).toBe(0)
    expect(ins.sitesAffected).toBe(0)
    expect(ins.worstSite).toBeNull()
  })
})
