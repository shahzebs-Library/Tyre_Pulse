/**
 * Accident analytics: basis and the breakdowns the data actually supports.
 *
 * The whole point of this engine is restraint. It must not dress a figure
 * computed from two records as one computed from thirty-five, it must not call
 * a column of zeros "recorded", and it must return null rather than 0 when
 * there was nothing to measure. Most of these tests check exactly that.
 */
import { describe, it, expect } from 'vitest'
import {
  coverageOf, basisNote, isReliable, metricBasis, METRIC_BASIS, analyticsCaveats,
  concentration, repeatAssets, weekdayProfile, closureDistribution, recoveryRatio,
  buildAccidentIntelligence, RELIABLE_COVERAGE, possibleDuplicates,
} from '../lib/accidentAnalytics'

// Shaped like the live set: site and asset complete, cost and cause absent.
const live = [
  { site: 'NHC', asset_no: 'TM1', incident_date: '2026-07-06', severity: 'minor', status: 'closed', release_date: '2026-07-10', parts_cost: 0, repair_cost: 5000, claim_amount: 8000, recovered_amount: 2000, accident_type: 'collision' },
  { site: 'NHC', asset_no: 'TM1', incident_date: '2026-07-20', severity: 'minor', status: 'reported', parts_cost: 0, accident_type: 'collision' },
  { site: 'NHC', asset_no: 'TM2', incident_date: '2026-07-07', severity: 'moderate', status: 'closed', release_date: '2026-08-20', parts_cost: 0, accident_type: 'rollover' },
  { site: 'REDSEA', asset_no: 'TM3', incident_date: '2026-07-11', severity: 'severe', status: 'reported', parts_cost: 0, driver_name: 'A', accident_type: 'fire' },
]

describe('coverageOf', () => {
  it('counts a filled field', () => {
    expect(coverageOf(live, 'site')).toMatchObject({ filled: 4, total: 4, pct: 1 })
    expect(coverageOf(live, 'driver_name')).toMatchObject({ filled: 1, total: 4 })
  })

  it('does NOT count a money column of zeros as recorded', () => {
    // parts_cost is present on every live row and is 0.00 on every one. Treating
    // that as data is how a cost total came to look complete while adding nothing.
    expect(coverageOf(live, 'parts_cost', { money: true }).filled).toBe(0)
    expect(coverageOf(live, 'parts_cost').filled).toBe(4)   // present, just worthless
  })

  it('counts a real money value and skips a missing one', () => {
    expect(coverageOf(live, 'repair_cost', { money: true })).toMatchObject({ filled: 1, total: 4 })
  })

  it('treats a boolean false as not recorded and true as recorded', () => {
    const rows = [{ vor: true }, { vor: false }, {}]
    expect(coverageOf(rows, 'vor').filled).toBe(1)
  })

  it('survives junk', () => {
    expect(coverageOf(null, 'site')).toMatchObject({ filled: 0, total: 0, pct: null })
  })
})

describe('basisNote', () => {
  it('stays silent on a complete field, because saying so on every tile is noise', () => {
    expect(basisNote(coverageOf(live, 'site'))).toBe('')
  })

  it('states the basis on a partial field', () => {
    expect(basisNote(coverageOf(live, 'driver_name'))).toBe('from 1 of 4')
  })

  it('says plainly when a field is never recorded', () => {
    expect(basisNote(coverageOf(live, 'root_cause'))).toBe('never recorded')
  })

  it('handles an empty set', () => {
    expect(basisNote(coverageOf([], 'site'))).toBe('')
    expect(basisNote(null)).toBe('')
  })
})

describe('isReliable', () => {
  it('holds a figure to a real share of the records', () => {
    expect(isReliable({ pct: 1 })).toBe(true)
    expect(isReliable({ pct: RELIABLE_COVERAGE })).toBe(true)
    expect(isReliable({ pct: 0.25 })).toBe(false)
    expect(isReliable(null)).toBe(false)
  })
})

describe('metricBasis', () => {
  it('takes the better of the columns a metric can draw on', () => {
    // repair cost is satisfied by repair_cost OR parts_cost; parts is all zeros
    const b = metricBasis(live, 'repairCost')
    expect(b.filled).toBe(1)
    expect(b.label).toBe('Repair cost')
  })

  it('covers every advertised metric', () => {
    for (const k of Object.keys(METRIC_BASIS)) {
      expect(metricBasis(live, k), k).toBeTruthy()
    }
    expect(metricBasis(live, 'nope')).toBeNull()
  })
})

describe('analyticsCaveats', () => {
  it('says outright when no cost is recorded anywhere', () => {
    const none = live.map((r) => ({ ...r, repair_cost: null, parts_cost: 0 }))
    const c = analyticsCaveats(none)
    expect(c.find((x) => x.key === 'cost')?.severity).toBe('high')
    expect(c.find((x) => x.key === 'cost')?.text).toMatch(/missing, not because nothing was spent/)
  })

  it('calls the cost total a floor when it is partial', () => {
    expect(analyticsCaveats(live).find((x) => x.key === 'cost')?.severity).toBe('medium')
  })

  it('explains that pending police reports means the field is never captured', () => {
    expect(analyticsCaveats(live).find((x) => x.key === 'police')?.text)
      .toMatch(/never recorded/)
  })

  it('flags a missing root cause as "what and where, but not why"', () => {
    expect(analyticsCaveats(live).find((x) => x.key === 'root_cause')).toBeTruthy()
  })

  it('says nothing at all when the data is complete', () => {
    const full = live.map((r, i) => ({
      ...r, repair_cost: 100, parts_cost: 50, police_report_no: `P${i}`,
      root_cause: 'driver error', driver_name: 'D', claim_amount: 100,
      status: 'closed', release_date: '2026-07-30',
    }))
    expect(analyticsCaveats(full)).toEqual([])
  })

  it('returns nothing for an empty set rather than inventing warnings', () => {
    expect(analyticsCaveats([])).toEqual([])
    expect(analyticsCaveats(null)).toEqual([])
  })
})

describe('concentration', () => {
  it('reports the top holder and its share, which is what makes it a finding', () => {
    const c = concentration(live, 'site')
    expect(c.top).toEqual({ label: 'NHC', value: 3 })
    expect(c.topShare).toBeCloseTo(0.75)
    expect(c.distinct).toBe(2)
  })

  it('counts how many entries it takes to reach 80 percent', () => {
    // NHC is 3 of 4 = 75%, which is UNDER the 80% line, so it takes both sites.
    expect(concentration(live, 'site').paretoCount).toBe(2)
    // one holder at or above 80% needs only itself
    const skewed = [{ site: 'A' }, { site: 'A' }, { site: 'A' }, { site: 'A' }, { site: 'B' }]
    expect(concentration(skewed, 'site').paretoCount).toBe(1)
  })

  it('ignores blanks instead of inventing an empty bucket', () => {
    const c = concentration([{ site: 'A' }, { site: '' }, {}], 'site')
    expect(c.counted).toBe(1)
    expect(c.distinct).toBe(1)
  })

  it('survives an empty set', () => {
    expect(concentration([], 'site')).toMatchObject({ top: null, topShare: null, paretoCount: 0 })
  })
})

describe('repeatAssets', () => {
  it('finds only assets with more than one incident', () => {
    const out = repeatAssets(live)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ asset: 'TM1', incidents: 2, first: '2026-07-06', last: '2026-07-20' })
    expect(out[0].spanDays).toBe(14)
    expect(out[0].meanGapDays).toBe(14)
  })

  it('lists the sites an asset had incidents at', () => {
    expect(repeatAssets(live)[0].sites).toEqual(['NHC'])
  })

  it('returns nothing when every asset appears once', () => {
    expect(repeatAssets([{ asset_no: 'A' }, { asset_no: 'B' }])).toEqual([])
    expect(repeatAssets(null)).toEqual([])
  })
})

describe('weekdayProfile', () => {
  it('buckets by ISO weekday with Monday first', () => {
    const w = weekdayProfile([{ incident_date: '2026-07-06' }])  // a Monday
    expect(w.rows[0]).toEqual({ label: 'Mon', value: 1 })
    expect(w.dated).toBe(1)
  })

  it('reports the peak and its share', () => {
    const w = weekdayProfile(live)
    expect(w.peak.value).toBeGreaterThan(0)
    expect(w.peakShare).toBeGreaterThan(0)
  })

  it('ignores an unparseable date rather than counting it somewhere', () => {
    const w = weekdayProfile([{ incident_date: 'not a date' }, { incident_date: '' }])
    expect(w.dated).toBe(0)
    expect(w.peak).toBeNull()
  })
})

describe('closureDistribution', () => {
  it('buckets the spread and reports how many it measured', () => {
    const d = closureDistribution(live)
    expect(d.measured).toBe(2)          // only two rows carry both dates
    expect(d.total).toBe(4)
    expect(d.rows.find((r) => r.label === '0 to 7 days').value).toBe(1)
    expect(d.rows.find((r) => r.label === '31 to 60 days').value).toBe(1)
  })

  it('gives a median and a longest, not just a mean', () => {
    // an average hides whether every case is the same or the spread is wide
    const d = closureDistribution(live)
    expect(d.median).toBe(24)
    expect(d.longest).toBe(44)
  })

  it('returns null rather than zero when nothing could be measured', () => {
    // "we did not measure this" and "everything closed same day" are opposites
    const d = closureDistribution([{ incident_date: '2026-07-01' }])
    expect(d.measured).toBe(0)
    expect(d.mean).toBeNull()
    expect(d.median).toBeNull()
    expect(d.longest).toBeNull()
  })

  it('drops a release date that precedes the incident', () => {
    const d = closureDistribution([{ incident_date: '2026-07-10', release_date: '2026-07-01' }])
    expect(d.measured).toBe(0)
  })
})

describe('recoveryRatio', () => {
  it('divides recovered by claimed and says how many claims that was', () => {
    const r = recoveryRatio(live)
    expect(r.claimed).toBe(8000)
    expect(r.recovered).toBe(2000)
    expect(r.outstanding).toBe(6000)
    expect(r.ratio).toBeCloseTo(0.25)
    expect(r.withClaim).toBe(1)
  })

  it('returns a null ratio rather than 0 when nothing was claimed', () => {
    expect(recoveryRatio([{ }]).ratio).toBeNull()
    expect(recoveryRatio(null).ratio).toBeNull()
  })
})

describe('possibleDuplicates', () => {
  it('groups one asset on one day and says what differs', () => {
    const out = possibleDuplicates([
      { id: 1, asset_no: 'MP083', incident_date: '2026-07-08', site: 'NHC', release_date: '2026-07-11' },
      { id: 2, asset_no: 'MP083', incident_date: '2026-07-08', site: 'NHC', release_date: null },
      { id: 3, asset_no: 'TM1', incident_date: '2026-07-08' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ asset: 'MP083', date: '2026-07-08', count: 2, identical: false })
    expect(out[0].differingFields).toContain('release_date')
    expect(out[0].ids).toEqual([1, 2])
  })

  it('folds case, which is what hid these before the asset numbers were normalised', () => {
    const out = possibleDuplicates([
      { asset_no: 'tm673', incident_date: '2026-06-25', site: 'UNASSIGNED' },
      { asset_no: 'TM673', incident_date: '2026-06-25', site: 'NHC' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].asset).toBe('TM673')
    expect(out[0].differingFields).toContain('site')
  })

  it('marks a group where nothing distinguishes the rows', () => {
    const out = possibleDuplicates([
      { asset_no: 'A', incident_date: '2026-01-01', site: 'X', severity: 'minor' },
      { asset_no: 'A', incident_date: '2026-01-01', site: 'X', severity: 'minor' },
    ])
    expect(out[0].identical).toBe(true)
  })

  it('never reports a single incident, and tolerates missing keys', () => {
    expect(possibleDuplicates([{ asset_no: 'A', incident_date: '2026-01-01' }])).toEqual([])
    expect(possibleDuplicates([{ asset_no: '', incident_date: '' }, {}])).toEqual([])
    expect(possibleDuplicates(null)).toEqual([])
  })
})

describe('buildAccidentIntelligence', () => {
  it('assembles one object the page and the report can both read', () => {
    const out = buildAccidentIntelligence(live)
    expect(out.total).toBe(4)
    expect(out.bySite.top.label).toBe('NHC')
    expect(out.repeats[0].asset).toBe('TM1')
    expect(out.caveats.length).toBeGreaterThan(0)
    expect(out.basis.repairCost.filled).toBe(1)
  })

  it('adds a duplicate caveat only when a repeat vehicle-and-date exists', () => {
    const dup = [...live, { ...live[0] }]
    const out = buildAccidentIntelligence(dup)
    expect(out.duplicates).toHaveLength(1)
    expect(out.caveats.some((c) => c.key === 'duplicates')).toBe(true)
    // and never claims one when there is none
    expect(buildAccidentIntelligence(live).caveats.some((c) => c.key === 'duplicates')).toBe(false)
  })

  it('counts one asset once even when its number is spelled two ways', () => {
    const mixed = [{ asset_no: 'tm1', site: 'A' }, { asset_no: 'TM1', site: 'A' }]
    expect(buildAccidentIntelligence(mixed).byAsset.distinct).toBe(1)
  })

  it('survives an empty set without throwing', () => {
    const out = buildAccidentIntelligence([])
    expect(out.total).toBe(0)
    expect(out.caveats).toEqual([])
    expect(out.repeats).toEqual([])
    expect(out.closure.mean).toBeNull()
  })
})
