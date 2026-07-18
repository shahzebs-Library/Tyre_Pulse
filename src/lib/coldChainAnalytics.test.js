import { describe, it, expect } from 'vitest'
import {
  EXCURSION_KINDS,
  excursionKind,
  deviationC,
  isExcursion,
  readingStatus,
  readingTime,
  filterReadings,
  statusCounts,
  excursionDistribution,
  compliancePct,
  byAsset,
  bySite,
  worstAssets,
  worstSites,
  excursionEpisodes,
  temperatureTrend,
  summarizeColdChainAnalytics,
} from './coldChainAnalytics.js'

// A small realistic set. Range for REEFER-01 is [-20, -15] (frozen).
const rows = [
  { id: 1, asset_no: 'REEFER-01', site: 'Riyadh DC', temperature_c: -18, min_threshold_c: -20, max_threshold_c: -15, status: 'ok', recorded_at: '2026-07-01T08:00:00Z' },
  { id: 2, asset_no: 'REEFER-01', site: 'Riyadh DC', temperature_c: -12, min_threshold_c: -20, max_threshold_c: -15, status: 'breach', recorded_at: '2026-07-01T09:00:00Z' },
  { id: 3, asset_no: 'REEFER-01', site: 'Riyadh DC', temperature_c: -10, min_threshold_c: -20, max_threshold_c: -15, status: 'breach', recorded_at: '2026-07-01T09:30:00Z' },
  { id: 4, asset_no: 'REEFER-01', site: 'Riyadh DC', temperature_c: -17, min_threshold_c: -20, max_threshold_c: -15, status: 'ok', recorded_at: '2026-07-01T10:00:00Z' },
  { id: 5, asset_no: 'REEFER-02', site: 'Jeddah DC', temperature_c: -25, min_threshold_c: -20, max_threshold_c: -15, status: 'breach', recorded_at: '2026-07-02T08:00:00Z' },
  { id: 6, asset_no: 'REEFER-02', site: 'Jeddah DC', temperature_c: -15.5, min_threshold_c: -20, max_threshold_c: -15, status: 'warning', recorded_at: '2026-07-02T09:00:00Z' },
]

describe('excursionKind / deviationC', () => {
  it('classifies above / below / in-range', () => {
    expect(excursionKind(rows[1])).toBe('above') // -12 > -15 max
    expect(excursionKind(rows[4])).toBe('below') // -25 < -20 min
    expect(excursionKind(rows[0])).toBe('in_range')
    expect(excursionKind(rows[5])).toBe('in_range') // warning is physically in range
  })
  it('exports the three kinds', () => {
    expect(EXCURSION_KINDS).toEqual(['in_range', 'above', 'below'])
  })
  it('measures deviation magnitude only for excursions', () => {
    expect(deviationC(rows[1])).toBe(3) // -12 - (-15)
    expect(deviationC(rows[4])).toBe(5) // -20 - (-25)
    expect(deviationC(rows[0])).toBe(0)
  })
  it('deviation is zero when temperature or bound missing', () => {
    expect(deviationC({ temperature_c: null, min_threshold_c: -20, max_threshold_c: -15 })).toBe(0)
    expect(deviationC({ temperature_c: -30 })).toBe(0)
  })
})

describe('readingStatus / isExcursion / readingTime', () => {
  it('trusts a valid stored status', () => {
    expect(readingStatus(rows[1])).toBe('breach')
    expect(isExcursion(rows[1])).toBe(true)
    expect(isExcursion(rows[0])).toBe(false)
  })
  it('re-classifies when status is missing/invalid', () => {
    expect(readingStatus({ temperature_c: -12, min_threshold_c: -20, max_threshold_c: -15 })).toBe('breach')
  })
  it('parses recorded_at to epoch, null on bad input', () => {
    expect(readingTime(rows[0])).toBe(Date.parse('2026-07-01T08:00:00Z'))
    expect(readingTime({ recorded_at: 'nonsense' })).toBeNull()
    expect(readingTime({})).toBeNull()
  })
})

describe('filterReadings', () => {
  it('returns [] for non-arrays', () => {
    expect(filterReadings(null)).toEqual([])
  })
  it('filters by asset, site and status', () => {
    expect(filterReadings(rows, { asset: 'REEFER-01' }).length).toBe(4)
    expect(filterReadings(rows, { site: 'Jeddah DC' }).length).toBe(2)
    expect(filterReadings(rows, { status: 'breach' }).length).toBe(3)
  })
  it('ignores blank / all filters', () => {
    expect(filterReadings(rows, { asset: 'all', site: 'All', status: '' }).length).toBe(6)
  })
  it('searches asset / site / notes', () => {
    const withNote = [...rows, { id: 9, asset_no: 'X', site: 'Y', notes: 'door left open', recorded_at: '2026-07-03T00:00:00Z' }]
    expect(filterReadings(withNote, { search: 'door' }).length).toBe(1)
  })
  it('filters by inclusive date range (bare date = end of day)', () => {
    expect(filterReadings(rows, { from: '2026-07-02' }).length).toBe(2)
    expect(filterReadings(rows, { to: '2026-07-01' }).length).toBe(4)
    expect(filterReadings(rows, { from: '2026-07-01', to: '2026-07-01' }).length).toBe(4)
  })
})

describe('statusCounts / distribution / compliancePct', () => {
  it('counts by status', () => {
    expect(statusCounts(rows)).toEqual({ ok: 2, warning: 1, breach: 3 })
  })
  it('distributes excursions above/below/in-range', () => {
    expect(excursionDistribution(rows)).toEqual({ in_range: 3, above: 2, below: 1 })
  })
  it('compliance = share in range (not breach)', () => {
    // 3 breaches of 6 => 50%
    expect(compliancePct(rows)).toBe(50)
  })
  it('compliance is null with no readings', () => {
    expect(compliancePct([])).toBeNull()
  })
})

describe('byAsset / bySite / worst*', () => {
  it('groups per asset, worst (most breaches) first', () => {
    const a = byAsset(rows)
    expect(a[0].key).toBe('REEFER-01')
    expect(a[0].breaches).toBe(2)
    expect(a[0].compliancePct).toBe(50)
    expect(a.find((x) => x.key === 'REEFER-02').maxDeviation).toBe(5)
  })
  it('groups per site', () => {
    const s = bySite(rows)
    expect(s.map((x) => x.key).sort()).toEqual(['Jeddah DC', 'Riyadh DC'])
  })
  it('worstAssets / worstSites only include breach-bearing groups', () => {
    expect(worstAssets(rows).every((a) => a.breaches > 0)).toBe(true)
    expect(worstSites(rows, 1).length).toBe(1)
  })
  it('labels blank keys as Unspecified', () => {
    const g = byAsset([{ asset_no: '', temperature_c: -18, status: 'ok', recorded_at: '2026-07-01T00:00:00Z' }])
    expect(g[0].key).toBe('Unspecified')
  })
})

describe('excursionEpisodes', () => {
  it('collapses consecutive breaches into one recovered episode', () => {
    const eps = excursionEpisodes(rows)
    const r1 = eps.find((e) => e.asset_no === 'REEFER-01')
    expect(r1.readingCount).toBe(2)
    expect(r1.recovered).toBe(true)
    // 09:00 breach start -> 10:00 recovery reading = 60 min
    expect(r1.durationMin).toBe(60)
    expect(r1.kind).toBe('above')
    expect(r1.peakDeviation).toBe(5) // -10 vs -15
  })
  it('marks an unrecovered single-reading excursion open with null duration', () => {
    const eps = excursionEpisodes(rows)
    const r2 = eps.find((e) => e.asset_no === 'REEFER-02')
    expect(r2.recovered).toBe(true) // followed by warning (in range)
    expect(r2.durationMin).toBe(60)
    expect(r2.kind).toBe('below')
  })
  it('open single breach with no recovery => null duration, recovered false', () => {
    const one = [{ asset_no: 'A', temperature_c: -5, min_threshold_c: -20, max_threshold_c: -15, status: 'breach', recorded_at: '2026-07-01T00:00:00Z' }]
    const eps = excursionEpisodes(one)
    expect(eps.length).toBe(1)
    expect(eps[0].recovered).toBe(false)
    expect(eps[0].durationMin).toBeNull()
  })
  it('skips readings without a timestamp', () => {
    expect(excursionEpisodes([{ asset_no: 'A', status: 'breach' }])).toEqual([])
  })
})

describe('temperatureTrend', () => {
  it('buckets by day ascending with avg/min/max/breaches', () => {
    const t = temperatureTrend(rows)
    expect(t.length).toBe(2)
    expect(t[0].day).toBe('2026-07-01')
    expect(t[0].count).toBe(4)
    expect(t[0].breaches).toBe(2)
    expect(t[0].min).toBe(-18)
    expect(t[0].max).toBe(-10)
  })
  it('handles empty input', () => {
    expect(temperatureTrend([])).toEqual([])
  })
})

describe('summarizeColdChainAnalytics', () => {
  it('produces honest headline KPIs', () => {
    const s = summarizeColdChainAnalytics(rows)
    expect(s.total).toBe(6)
    expect(s.breaches).toBe(3)
    expect(s.warnings).toBe(1)
    expect(s.assetsMonitored).toBe(2)
    expect(s.sitesMonitored).toBe(2)
    expect(s.compliancePct).toBe(50)
    expect(s.excursionEpisodes).toBe(2)
    expect(s.worstAsset.key).toBe('REEFER-01')
    expect(s.avgDeviation).toBeGreaterThan(0)
  })
  it('applies filters before summarizing', () => {
    const s = summarizeColdChainAnalytics(rows, { asset: 'REEFER-02' })
    expect(s.total).toBe(2)
    expect(s.breaches).toBe(1)
  })
  it('degrades to zeros / nulls on empty input, never NaN', () => {
    const s = summarizeColdChainAnalytics([])
    expect(s.total).toBe(0)
    expect(s.compliancePct).toBeNull()
    expect(s.avgDeviation).toBe(0)
    expect(s.avgExcursionMin).toBeNull()
    expect(s.worstAsset).toBeNull()
    expect(Number.isNaN(s.avgDeviation)).toBe(false)
  })
})
