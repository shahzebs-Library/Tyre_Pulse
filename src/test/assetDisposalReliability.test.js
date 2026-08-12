import { describe, it, expect } from 'vitest'
import {
  PARKED_CARD_HOURS,
  MIN_BAND_PEERS,
  BELOW_AVAILABILITY_PCT,
  PREVENTIVE_MAJORITY_PCT,
  RELIABILITY_METRICS,
  TIME_BASED_METRICS,
  metricMeta,
  metricValue,
  shapeReliability,
  mergeReliability,
  unmatchedHistory,
  metricBand,
  bandMeta,
  reliabilityRanking,
  fleetReliability,
  spendByYear,
  spendTrend,
  shapeFleetBaseline,
  baselineComparison,
  boardRecommendations,
  reliabilityExportRows,
} from '../lib/assetDisposalReliability'

/** Pinned so ages, idle windows and "last full year" never drift with the clock. */
const NOW = Date.parse('2026-08-12T00:00:00Z')

/** A reliability asset with the shape get_asset_disposal_reliability returns. */
function asset(over = {}) {
  return {
    asset_no: 'MP049',
    job_cards: 300,
    dated_cards: 200,
    date_coverage_pct: 66.7,
    breakdown_hours: 4000,
    breakdown_hours_recorded: 4000,
    parked_cards: 0,
    parked_hours: 0,
    longest_card_hours: 300,
    failures: 277,
    dated_failures: 200,
    emergency_cards: 250,
    preventive_cards: 12,
    repair_cards: 38,
    preventive_share_pct: 4,
    first_seen: '2017-01-01',
    last_seen: '2026-06-01',
    observed_days: 3462,
    idle_days: 72,
    mtbf_days: 12.5,
    failures_per_year: 22,
    availability_pct: 76,
    spend: 400000,
    spend_by_year: { 2023: 80000, 2024: 90000, 2025: 120000, 2026: 40000 },
    cost_per_breakdown_hour: 100,
    cost_per_failure: 1444,
    currency: 'SAR',
    ...over,
  }
}

/** A committee row, only the fields this engine reads. */
function listRow(over = {}) {
  return { asset_no: 'MP049', asset_type: 'M-PUMP', in_register: true, fleet_status: 'Active', tyres_active: 0, currency: 'SAR', ...over }
}

/** Four machines with real spread, so bands can actually be computed. */
function spreadFleet() {
  return [
    asset({ asset_no: 'A1', failures_per_year: 1, mtbf_days: 300, availability_pct: 99, cost_per_failure: 100, spend: 1000, failures: 4, job_cards: 10, dated_cards: 5, preventive_cards: 5, idle_days: 10 }),
    asset({ asset_no: 'A2', failures_per_year: 2, mtbf_days: 200, availability_pct: 97, cost_per_failure: 200, spend: 2000, failures: 6, job_cards: 12, dated_cards: 6, preventive_cards: 5, idle_days: 20 }),
    asset({ asset_no: 'A3', failures_per_year: 3, mtbf_days: 100, availability_pct: 95, cost_per_failure: 300, spend: 3000, failures: 8, job_cards: 14, dated_cards: 7, preventive_cards: 6, idle_days: 30 }),
    asset({ asset_no: 'A4', failures_per_year: 40, mtbf_days: 9, availability_pct: 55, cost_per_failure: 9000, spend: 90000, failures: 200, job_cards: 220, dated_cards: 110, preventive_cards: 0, idle_days: 40 }),
  ]
}

describe('the metric catalog', () => {
  it('declares every metric once with an explanation a reader can act on', () => {
    const keys = RELIABILITY_METRICS.map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const m of RELIABILITY_METRICS) {
      expect(typeof m.label).toBe('string')
      expect(m.label.length).toBeGreaterThan(0)
      expect(typeof m.explain).toBe('string')
      expect(m.explain.length).toBeGreaterThan(10)
      expect(typeof m.higherIsBetter).toBe('boolean')
    }
  })

  it('makes every time based metric declare the coverage field that qualifies it', () => {
    expect(TIME_BASED_METRICS).toContain('mtbf_days')
    expect(TIME_BASED_METRICS).toContain('availability_pct')
    for (const k of TIME_BASED_METRICS) {
      expect(metricMeta(k).basisKey).toBe('date_coverage_pct')
    }
  })

  it('carries no em dashes, en dashes, arrows or curly quotes anywhere', () => {
    const blob = JSON.stringify(RELIABILITY_METRICS)
    expect(blob).not.toMatch(/[^\x00-\x7F]/)
  })

  it('reads a metric off a bare asset and off a merged row alike', () => {
    expect(metricValue(asset(), 'mtbf_days')).toBe(12.5)
    expect(metricValue({ ...listRow(), reliability: asset() }, 'mtbf_days')).toBe(12.5)
    expect(metricValue(null, 'mtbf_days')).toBe(null)
  })

  it('does not let the history spend overwrite the committee spend on a merged row', () => {
    const merged = mergeReliability([listRow({ spend: 111 })], [asset({ spend: 999 })])[0]
    expect(merged.spend).toBe(111)
    expect(merged.reliability.spend).toBe(999)
  })
})

describe('shapeReliability', () => {
  it('tells a failed read apart from a fleet with no history', () => {
    const failed = shapeReliability({ ok: false, reason: 'forbidden' })
    expect(failed.ok).toBe(false)
    expect(failed.reason).toBe('forbidden')
    expect(failed.assets).toEqual([])

    const empty = shapeReliability({ ok: true, country: 'KSA', assets: [] })
    expect(empty.ok).toBe(true)
    expect(empty.reason).toBe(null)
    expect(empty.assets).toEqual([])
  })

  it('never throws on rubbish', () => {
    expect(shapeReliability(null).ok).toBe(false)
    expect(shapeReliability(undefined).reason).toBe('unavailable')
    expect(shapeReliability('nope').ok).toBe(false)
  })

  it('recomputes totals from the assets in hand and keeps the server ones beside them', () => {
    const out = shapeReliability({
      ok: true,
      country: 'KSA',
      assets: [asset({ job_cards: 10, dated_cards: 5 })],
      totals: { job_cards: 99999, parked_threshold_hours: PARKED_CARD_HOURS },
    })
    expect(out.totals.job_cards).toBe(10)
    expect(out.serverTotals.job_cards).toBe(99999)
    expect(out.totals.parkedThresholdHours).toBe(PARKED_CARD_HOURS)
  })
})

describe('null is not zero', () => {
  it('gives an asset with one failure no MTBF rather than a flattering number', () => {
    const one = asset({ failures: 1, mtbf_days: null, failures_per_year: null })
    expect(metricValue(one, 'mtbf_days')).toBe(null)
    expect(metricBand('mtbf_days', metricValue(one, 'mtbf_days'), spreadFleet())).toBe('unknown')
    const t = fleetReliability([one])
    expect(t.medians.mtbf_days).toBe(null)
  })

  it('gives an asset with no dated card no idle days, no MTBF and no availability', () => {
    const undated = asset({
      asset_no: 'NODATE', dated_cards: 0, date_coverage_pct: 0, dated_failures: 0,
      idle_days: null, mtbf_days: null, failures_per_year: null, availability_pct: null,
      observed_days: null, first_seen: null, last_seen: null,
    })
    const t = fleetReliability([undated])
    expect(t.medians.idle_days).toBe(null)
    expect(t.medians.availability_pct).toBe(null)
    // Nothing measurable means nothing counted, NOT zero machines below the line.
    expect(t.belowAvailability).toBe(null)
    expect(t.idleOverYear).toBe(null)
    // The card counts are still real; only the rates are missing.
    expect(t.job_cards).toBe(300)
    expect(t.date_coverage_pct).toBe(0)
  })

  it('prints Not measured in the export rather than a zero somebody could average', () => {
    const { rows } = reliabilityExportRows([asset({ mtbf_days: null, availability_pct: null })])
    expect(rows[0].mtbf_days).toBe('Not measured')
    expect(rows[0].availability_pct).toBe('Not measured')
    expect(rows[0].job_cards).toBe(300)
  })
})

describe('parked machines are kept apart from breakdowns', () => {
  const parked = asset({
    asset_no: 'PARKED1',
    breakdown_hours: 400,
    breakdown_hours_recorded: 19000,
    parked_cards: 2,
    parked_hours: 18600,
    longest_card_hours: 18575,
  })

  it('never folds parked hours into the reliability figure', () => {
    const t = fleetReliability([parked])
    expect(t.breakdown_hours).toBe(400)
    expect(t.breakdown_hours_recorded).toBe(19000)
    expect(t.parked_hours).toBe(18600)
    expect(t.breakdown_hours).toBeLessThan(t.breakdown_hours_recorded)
  })

  it('raises the open cards as a finding in their own right', () => {
    const recs = boardRecommendations([parked], null, { now: NOW })
    const point = recs.find((r) => r.id === 'parked-cards')
    expect(point).toBeTruthy()
    expect(point.priority).toBe('high')
    expect(point.assets).toContain('PARKED1')
    expect(point.detail).toContain('18,600')
    expect(point.detail).toMatch(/90 day|standing still/)
  })
})

describe('metricBand judges against this fleet and nothing else', () => {
  it('returns unknown below three comparable machines', () => {
    expect(MIN_BAND_PEERS).toBe(3)
    const two = [asset({ mtbf_days: 5 }), asset({ mtbf_days: 500 })]
    expect(metricBand('mtbf_days', 5, two)).toBe('unknown')
    expect(metricBand('mtbf_days', 5, [])).toBe('unknown')
  })

  it('returns unknown for a null value and for a metric it does not publish', () => {
    expect(metricBand('mtbf_days', null, spreadFleet())).toBe('unknown')
    expect(metricBand('made_up_metric', 5, spreadFleet())).toBe('unknown')
  })

  it('never calls a machine good or bad when every peer holds the same value', () => {
    const flat = [asset({ availability_pct: 95 }), asset({ availability_pct: 95 }), asset({ availability_pct: 95 })]
    expect(metricBand('availability_pct', 95, flat)).toBe('watch')
  })

  it('respects each metric own direction', () => {
    const peers = spreadFleet()
    expect(metricBand('failures_per_year', 40, peers)).toBe('bad')
    expect(metricBand('failures_per_year', 1, peers)).toBe('good')
    expect(metricBand('mtbf_days', 9, peers)).toBe('bad')
    expect(metricBand('mtbf_days', 300, peers)).toBe('good')
    expect(bandMeta('bad').tone).toBe('danger')
    expect(bandMeta(null).label).toBe('Not measured')
  })
})

describe('reliabilityRanking', () => {
  it('excludes unmeasured machines rather than sorting them to one end', () => {
    const rows = [...spreadFleet(), asset({ asset_no: 'UNKNOWN', mtbf_days: null })]
    const worst = reliabilityRanking(rows, 'mtbf_days', { limit: 10 })
    expect(worst.map((x) => x.assetNo)).not.toContain('UNKNOWN')
    expect(worst[0].assetNo).toBe('A4')
    const best = reliabilityRanking(rows, 'mtbf_days', { limit: 10, worst: false })
    expect(best.map((x) => x.assetNo)).not.toContain('UNKNOWN')
    expect(best[0].assetNo).toBe('A1')
  })

  it('returns nothing for a metric it does not publish', () => {
    expect(reliabilityRanking(spreadFleet(), 'invented', {})).toEqual([])
  })
})

describe('fleetReliability', () => {
  it('rolls up counts, medians and the fleet wide coverage share', () => {
    const t = fleetReliability(spreadFleet())
    expect(t.assets).toBe(4)
    expect(t.withHistory).toBe(4)
    expect(t.job_cards).toBe(256)
    expect(t.failures).toBe(218)
    expect(t.medians.mtbf_days).toBe(150)
    expect(t.neverPreventive).toBe(1)
    expect(t.belowAvailabilityPct).toBe(BELOW_AVAILABILITY_PCT)
    expect(t.belowAvailability).toBe(1)
    expect(t.spend).toBe(96000)
    expect(t.currency).toBe('SAR')
  })

  it('refuses to blend two currencies into one total', () => {
    const t = fleetReliability([asset({ spend: 100, currency: 'SAR' }), asset({ asset_no: 'X', spend: 100, currency: 'AED' })])
    expect(t.spend).toBe(null)
    expect(t.mixedCurrency).toBe(true)
    expect(t.money.spend.byCurrency).toEqual({ SAR: 100, AED: 100 })
  })

  it('is empty safe', () => {
    const t = fleetReliability([])
    expect(t.assets).toBe(0)
    expect(t.date_coverage_pct).toBe(null)
    expect(t.medians.mtbf_days).toBe(null)
  })
})

describe('mergeReliability', () => {
  it('keeps a machine that has no history at all', () => {
    const rows = [listRow({ asset_no: 'MP049' }), listRow({ asset_no: 'BP022', in_register: false })]
    const merged = mergeReliability(rows, [asset({ asset_no: 'MP049' })])
    expect(merged).toHaveLength(2)
    const orphan = merged.find((r) => r.asset_no === 'BP022')
    expect(orphan.hasHistory).toBe(false)
    expect(orphan.reliability).toBe(null)
    // No history is not a zero: nothing pretends this machine cost nothing.
    expect(metricValue(orphan, 'spend')).toBe(null)
  })

  it('joins on the asset code regardless of case or padding', () => {
    const merged = mergeReliability([listRow({ asset_no: ' mp049 ' })], [asset({ asset_no: 'MP049' })])
    expect(merged[0].hasHistory).toBe(true)
  })

  it('surfaces history that is not on the committee list rather than dropping it', () => {
    expect(unmatchedHistory([listRow({ asset_no: 'MP049' })], [asset(), asset({ asset_no: 'TM900' })])).toEqual(['TM900'])
  })

  it('is empty safe on both sides', () => {
    expect(mergeReliability(null, null)).toEqual([])
    expect(unmatchedHistory(null, null)).toEqual([])
  })
})

describe('spend by year', () => {
  it('compares the last two COMPLETE years and leaves the year in progress out', () => {
    const tr = spendTrend(asset(), { now: NOW })
    expect(tr.latestYear).toBe(2025)
    expect(tr.priorYear).toBe(2024)
    expect(tr.latestSpend).toBe(120000)
    expect(tr.rising).toBe(true)
    // 2026 is part year and must never be read as a fall.
    expect(spendByYear(asset()).map((e) => e.year)).toEqual([2023, 2024, 2025, 2026])
  })

  it('returns null when there are not two complete years to compare', () => {
    expect(spendTrend(asset({ spend_by_year: { 2025: 10, 2026: 900 } }), { now: NOW })).toBe(null)
    expect(spendTrend(asset({ spend_by_year: null }), { now: NOW })).toBe(null)
  })
})

describe('boardRecommendations', () => {
  it('returns nothing on a clean fleet rather than manufacturing a point', () => {
    const clean = [1, 2, 3, 4].map((i) => asset({
      asset_no: `C${i}`,
      job_cards: 10, dated_cards: 10, date_coverage_pct: 100,
      failures: 1, failures_per_year: 0.5, mtbf_days: 700,
      availability_pct: 100, breakdown_hours: 10, breakdown_hours_recorded: 10,
      parked_cards: 0, parked_hours: 0,
      preventive_cards: 8, preventive_share_pct: 80,
      idle_days: 5, spend: 1000, cost_per_failure: 1000,
      spend_by_year: { 2024: 600, 2025: 400 },
    }))
    const rows = clean.map((a) => ({ ...listRow({ asset_no: a.asset_no }), reliability: a }))
    expect(boardRecommendations(rows, null, { now: NOW })).toEqual([])
  })

  it('returns nothing for an empty fleet', () => {
    expect(boardRecommendations([], null, { now: NOW })).toEqual([])
    expect(boardRecommendations(null, null, { now: NOW })).toEqual([])
  })

  it('names the worst offenders and the figures each point rests on', () => {
    const rows = spreadFleet().map((a) => ({ ...listRow({ asset_no: a.asset_no }), reliability: a }))
    const recs = boardRecommendations(rows, null, { now: NOW })
    const ids = recs.map((r) => r.id)
    expect(ids).toContain('frequent-failures')
    expect(ids).toContain('low-availability')
    expect(ids).toContain('preventive-share')

    const fails = recs.find((r) => r.id === 'frequent-failures')
    expect(fails.assets).toContain('A4')
    expect(fails.evidence.length).toBeGreaterThan(0)
    expect(fails.evidence.join(' ')).toContain('A4')

    // Ordered by priority, most urgent first.
    const ranks = recs.map((r) => ['critical', 'high', 'medium', 'info'].indexOf(r.priority))
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
  })

  it('flags a machine still absorbing a rising budget in the last full year', () => {
    const rows = [{ ...listRow(), reliability: asset() }]
    const rec = boardRecommendations(rows, null, { now: NOW }).find((r) => r.id === 'spend-still-rising')
    expect(rec.priority).toBe('critical')
    expect(rec.assets).toEqual(['MP049'])
    expect(rec.detail).toContain('2025')
    expect(rec.detail).toContain('2024')
  })

  it('states what the time based figures rest on and never hides the coverage gap', () => {
    const rows = spreadFleet().map((a) => ({ ...listRow({ asset_no: a.asset_no }), reliability: a }))
    const recs = boardRecommendations(rows, null, { now: NOW })
    const dq = recs.find((r) => r.id === 'data-quality')
    expect(dq).toBeTruthy()
    expect(dq.priority).toBe('info')
    expect(dq.detail).toMatch(/mean time between failures/i)
    // and the point that uses those figures carries the caveat too
    const fails = recs.find((r) => r.id === 'frequent-failures')
    expect(fails.evidence.some((e) => /usable date/.test(e))).toBe(true)
  })

  it('separates a machine idle over a year that is still marked Active', () => {
    const rows = [{ ...listRow({ asset_no: 'IDLE1', fleet_status: 'Active' }), reliability: asset({ asset_no: 'IDLE1', idle_days: 644 }) }]
    const rec = boardRecommendations(rows, null, { now: NOW }).find((r) => r.id === 'idle-machines')
    expect(rec.priority).toBe('high')
    expect(rec.detail).toContain('644')
    expect(rec.detail).toMatch(/Active/)
  })

  it('quantifies nothing it cannot see: no scrap value, resale price or saving anywhere', () => {
    const rows = spreadFleet().map((a) => ({ ...listRow({ asset_no: a.asset_no, tyres_active: 6 }), reliability: a }))
    const blob = JSON.stringify(boardRecommendations(rows, null, { now: NOW, fleetBaseline: baseline() }))
    expect(blob).not.toMatch(/scrap value|resale|residual|salvage|savings of|would save/i)
    // ASCII only: this text reaches a PowerPoint and a PDF.
    expect(blob).not.toMatch(/[^\x00-\x7F]/)
  })

  it('raises the tyres still fitted on the machines', () => {
    const rows = [{ ...listRow({ tyres_active: 6 }), reliability: asset() }]
    const rec = boardRecommendations(rows, null, { now: NOW }).find((r) => r.id === 'tyres-fitted')
    expect(rec.headline).toContain('6 tyres')
    expect(rec.assets).toEqual(['MP049'])
  })

  it('keeps machines the register has never heard of visible', () => {
    const rows = [
      { ...listRow({ asset_no: 'BP022', in_register: false }), reliability: null },
      { ...listRow({ asset_no: 'MP049' }), reliability: asset() },
    ]
    const rec = boardRecommendations(rows, null, { now: NOW }).find((r) => r.id === 'not-in-register')
    expect(rec.assets).toEqual(['BP022'])
    expect(rec.detail).toMatch(/NOT that they cost nothing/)
  })
})

/** The live KSA shape of get_asset_disposal_fleet_baseline. */
function baseline(over = {}) {
  return {
    ok: true,
    country: 'KSA',
    on_list: {
      assets: 34, cards: 2026, failures: 1777, breakdown_hours: 121457,
      breakdown_hours_per_asset: 3572, preventive_share_pct: 4.1,
      avg_failures_per_year: 13.92, avg_availability_pct: 85.9,
      spend: 2260917, spend_per_asset: 68513,
    },
    rest_of_fleet: {
      assets: 969, cards: 59765, failures: 54046, breakdown_hours: 1153578,
      breakdown_hours_per_asset: 1190, preventive_share_pct: 1.6,
      avg_failures_per_year: 27.06, avg_availability_pct: 79.8,
      spend: 33719335, spend_per_asset: 37218,
    },
    idle_confound: true,
    note: 'Failures per year is depressed for parked machines. Compare breakdown hours per asset instead.',
    ...over,
  }
}

describe('the rest of the fleet', () => {
  it('tells a failed baseline read apart from a fleet with no comparison', () => {
    expect(shapeFleetBaseline({ ok: false, reason: 'forbidden' }).ok).toBe(false)
    expect(shapeFleetBaseline(null).reason).toBe('unavailable')
    expect(shapeFleetBaseline(baseline()).onList.assets).toBe(34)
  })

  it('publishes both measures and names the one idleness cannot flatter', () => {
    const cmp = baselineComparison(baseline())
    expect(cmp.ratios.spend_per_asset).toBe(1.84)
    expect(cmp.ratios.breakdown_hours_per_asset).toBe(3)
    // The list looks BETTER on failures a year, which is the confound.
    expect(cmp.ratios.avg_failures_per_year).toBeLessThan(1)
    expect(cmp.trust).toBe('breakdown_hours_per_asset')
    expect(cmp.confoundNote).toMatch(/parked/)
    expect(cmp.shares.spend).toBe(6.3)
  })

  it('returns null when there is nothing to compare against', () => {
    expect(baselineComparison(null)).toBe(null)
    expect(baselineComparison({ ok: false })).toBe(null)
    expect(baselineComparison({ ok: true, on_list: {} })).toBe(null)
  })

  it('makes the case for the list and states the confound rather than correcting it', () => {
    const rows = spreadFleet().map((a) => ({ ...listRow({ asset_no: a.asset_no }), reliability: a }))
    const rec = boardRecommendations(rows, null, { now: NOW, fleetBaseline: baseline() }).find((r) => r.id === 'list-justified')
    expect(rec.headline).toContain('1.8')
    expect(rec.headline).toContain('3.0')
    expect(rec.evidence.join(' ')).toMatch(/parked machine cannot fail/)
    expect(rec.evidence.join(' ')).toMatch(/13.9/)
    expect(rec.evidence.join(' ')).toMatch(/27.1/)
  })

  it('says plainly what the write off does NOT fix', () => {
    const rows = spreadFleet().map((a) => ({ ...listRow({ asset_no: a.asset_no }), reliability: a }))
    const recs = boardRecommendations(rows, null, { now: NOW, fleetBaseline: baseline() })
    const rec = recs.find((r) => r.id === 'beyond-the-list')
    expect(rec.priority).toBe('critical')
    expect(rec.headline).toContain('6.3%')
    expect(rec.headline).toContain('93.7%')
    expect(rec.detail).toContain('969')
    expect(rec.detail).toContain('27.1')
    expect(rec.detail).toContain('79.8')
  })

  it('raises planned maintenance to critical once the fleet wide share is known', () => {
    const rows = spreadFleet().map((a) => ({ ...listRow({ asset_no: a.asset_no }), reliability: a }))
    const without = boardRecommendations(rows, null, { now: NOW }).find((r) => r.id === 'preventive-share')
    const withBase = boardRecommendations(rows, null, { now: NOW, fleetBaseline: baseline() }).find((r) => r.id === 'preventive-share')
    expect(without.priority).toBe('high')
    expect(withBase.priority).toBe('critical')
    expect(withBase.headline).toContain('1.6%')
    expect(withBase.detail).toMatch(/same place/)
    expect(PREVENTIVE_MAJORITY_PCT).toBe(50)
  })

  it('keeps every other point working when no baseline is supplied', () => {
    const rows = spreadFleet().map((a) => ({ ...listRow({ asset_no: a.asset_no }), reliability: a }))
    const ids = boardRecommendations(rows, null, { now: NOW }).map((r) => r.id)
    expect(ids).not.toContain('list-justified')
    expect(ids).not.toContain('beyond-the-list')
    expect(ids).toContain('frequent-failures')
  })
})

describe('reliabilityExportRows', () => {
  it('returns head/body for the PDF and columns/rows for the spreadsheet', () => {
    const out = reliabilityExportRows([asset()])
    expect(out.head[0]).toBe('Asset')
    expect(out.head).toContain('Parked hours')
    expect(out.body).toHaveLength(1)
    expect(out.body[0]).toHaveLength(out.head.length)
    expect(out.rows[0].asset_no).toBe('MP049')
    expect(out.columns).toContain('mtbf_days')
  })

  it('is empty safe', () => {
    const out = reliabilityExportRows(null)
    expect(out.body).toEqual([])
    expect(out.head.length).toBeGreaterThan(0)
  })
})
