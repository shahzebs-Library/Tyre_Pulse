import { describe, it, expect } from 'vitest'
import {
  canonAssetNo,
  assetKey,
  rowIsAsset,
  crossCountryMatches,
  READ_STATE,
  sourceState,
  readStateLabel,
  HISTORY_SOURCES,
  HISTORY_GROUPS,
  historySource,
  fetchableSources,
  buildTimeline,
  groupTimelineByPeriod,
  periodLabel,
  meterHistory,
  downtimeEpisodes,
  formatHours,
  documentChain,
  chainForCard,
  summarizeAssetHistory,
  assetLifecycleStages,
  historyGaps,
  historyExportRows,
  filterTimeline,
  formatSpend,
  formatPerUnitValue,
  MEASURED_AT,
  isoDay,
} from '../lib/assetHistory'

/** A fixed clock. Every function under test takes `now` explicitly. */
const NOW = new Date('2026-08-24T12:00:00.000Z').getTime()

/** Wrap rows in the envelope shape the service returns. */
const src = (rows) => ({ ok: true, rows, error: null, missing: false })
const boom = () => ({ ok: false, rows: [], error: new Error('nope'), missing: false })
const none = () => ({ ok: true, rows: [], error: null, missing: false })
const absent = () => ({ ok: true, rows: [], error: null, missing: true })

describe('asset identity - (country, asset_no), never asset_no alone', () => {
  it('canonicalises a code to UPPER with all whitespace stripped', () => {
    // The ERP pads fixed-width columns, so a trim alone is not enough (V337/V490).
    expect(canonAssetNo(' tm 514 ')).toBe('TM514')
    expect(canonAssetNo('tm514')).toBe('TM514')
    expect(canonAssetNo(null)).toBe('')
  })

  it('keys on country AND code, so the same code in two countries is two machines', () => {
    // V376: GN103 is a CATERPILLAR generator in KSA and a Sany one in UAE.
    expect(assetKey('KSA', 'GN103')).not.toBe(assetKey('UAE', 'GN103'))
    expect(assetKey('KSA', ' gn103 ')).toBe(assetKey('ksa', 'GN103'))
  })

  it('refuses a row from another country, and keeps a country-less row', () => {
    expect(rowIsAsset({ asset_no: 'TM514', country: 'KSA' }, 'KSA', 'TM514')).toBe(true)
    expect(rowIsAsset({ asset_no: 'TM514', country: 'UAE' }, 'KSA', 'TM514')).toBe(false)
    // A NULL country is not evidence of a DIFFERENT machine.
    expect(rowIsAsset({ asset_no: 'TM514', country: null }, 'KSA', 'TM514')).toBe(true)
    // Under the All scope nothing is excluded on country.
    expect(rowIsAsset({ asset_no: 'TM514', country: 'UAE' }, 'All', 'TM514')).toBe(true)
  })

  it('reports the other countries carrying the same code so the clash can be stated', () => {
    const fleet = [
      { asset_no: 'GN103', country: 'KSA', make: 'CATERPILLAR', vehicle_type: 'GENERATOR' },
      { asset_no: 'GN103', country: 'UAE', make: 'Sany', vehicle_type: 'GENERATOR' },
      { asset_no: 'TM360', country: 'UAE', make: 'Sany' },
    ]
    const other = crossCountryMatches(fleet, 'KSA', 'GN103')
    expect(other).toHaveLength(1)
    expect(other[0]).toMatchObject({ country: 'UAE', make: 'Sany' })
    // A code that exists only here reports no clash.
    expect(crossCountryMatches(fleet, 'UAE', 'TM360')).toEqual([])
  })
})

describe('three states - a value, not recorded, and could not read', () => {
  it('separates all three rather than collapsing any pair', () => {
    expect(sourceState(src([{ id: 1 }]))).toBe(READ_STATE.OK)
    expect(sourceState(none())).toBe(READ_STATE.EMPTY)
    expect(sourceState(boom())).toBe(READ_STATE.UNREADABLE)
    expect(sourceState(absent())).toBe(READ_STATE.NOT_PROVISIONED)
    // "we did not look" is NOT "the read failed" - a source that was never
    // requested must not be reported as a fault.
    expect(sourceState(undefined)).toBe(READ_STATE.NOT_LOADED)
  })

  it('says "could not be read" for a failure and "not recorded" for an empty', () => {
    expect(readStateLabel(READ_STATE.EMPTY, 'Washes')).toMatch(/not recorded/i)
    expect(readStateLabel(READ_STATE.UNREADABLE, 'Washes')).toMatch(/could not be read/i)
    expect(readStateLabel(READ_STATE.NOT_LOADED, 'Washes')).toMatch(/not included in this view/i)
    expect(readStateLabel(READ_STATE.OK)).toBeNull()
  })

  it('carries the unreadable sources through the timeline instead of showing zero', () => {
    const t = buildTimeline({ parts_line: boom(), job_card: none() }, { now: NOW, country: 'KSA' })
    expect(t.unreadable).toContain('parts_line')
    expect(t.states.job_card).toBe(READ_STATE.EMPTY)
    expect(t.states.parts_line).toBe(READ_STATE.UNREADABLE)
  })
})

describe('the source catalog', () => {
  it('gives every source a group that exists', () => {
    const groups = new Set(HISTORY_GROUPS.map((g) => g.key))
    for (const s of HISTORY_SOURCES) {
      expect(groups.has(s.group), `${s.key} -> ${s.group}`).toBe(true)
    }
  })

  it('has unique keys and resolves them', () => {
    const keys = HISTORY_SOURCES.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(historySource('job_card').table).toBe('work_orders')
    expect(historySource('nope')).toBeNull()
  })

  it('does not fetch a derived source twice', () => {
    // tyre_removal comes off the same tyre_records read as tyre_fitment.
    const fetchable = fetchableSources().map((s) => s.key)
    expect(fetchable).toContain('tyre_fitment')
    expect(fetchable).not.toContain('tyre_removal')
  })

  it('names an icon that EXISTS in the installed lucide-react', async () => {
    // A dangling icon reference ships past a clean build - vite does no
    // undefined analysis - and then crashes the page at render. That has
    // happened here before (`Route` does not exist in this version), so the
    // catalog is checked against the real library rather than from memory.
    const lucide = await import('lucide-react')
    for (const s of HISTORY_SOURCES) {
      expect(s.icon, `${s.key} names icon ${s.icon}`).toBeTruthy()
      expect(s.icon in lucide, `lucide-react has no export "${s.icon}" (source ${s.key})`).toBe(true)
    }
  })

  it('records a measured row count for every source, so the gaps panel cannot lie', () => {
    // liveRows is not documentation: it is what lets historyGaps tell "this
    // asset has nothing" apart from "nobody has recorded this anywhere".
    for (const s of HISTORY_SOURCES) {
      const measured = s.liveRows === null || Number.isInteger(s.liveRows)
      expect(measured, `${s.key} must carry a measured liveRows or an explicit null`).toBe(true)
    }
    expect(MEASURED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('buildTimeline', () => {
  const sources = {
    job_card: src([
      { id: 'c1', work_order_no: 'JC-1', rfr_no: 'RFR-9', opened_at: '2026-03-02T08:00:00Z', country: 'KSA', status: 'Completed', work_type: 'Repair', labour_cost: 100, parts_cost: 50 },
    ]),
    parts_line: src([
      { id: 'p1', event_date: '2026-03-02', work_order_no: 'JC-1', issue_number: 'MIS-7', item_description: 'Filter', qty: 2, line_cost: 150, currency: 'SAR', country: 'KSA' },
      { id: 'p2', event_date: '2026-03-02', work_order_no: 'JC-1', issue_number: 'MIS-7', item_description: 'Oil', qty: 1, line_cost: 50, currency: 'SAR', country: 'KSA' },
    ]),
    tyre_fitment: src([
      { id: 't1', asset_no: 'TM514', serial_no: 'S1', position: 'LHF1', brand: 'TRIANGLE', issue_date: '2026-01-10', removal_date: '2026-05-10', total_km: 40000, country: 'KSA' },
    ]),
    disposal: src([{ id: 'd1', asset_no: 'TM514', disposition: 'Scrap', country: 'KSA' }]),
  }

  it('merges every source into one stream, newest first', () => {
    const t = buildTimeline(sources, { now: NOW, country: 'KSA' })
    const dated = t.events.filter((e) => !e.undated).map((e) => e.day)
    expect(dated).toEqual([...dated].sort().reverse())
    expect(t.counts.job_card).toBe(1)
    expect(t.counts.parts_line).toBe(2)
  })

  it('derives a removal event from the same tyre record as the fitment', () => {
    const t = buildTimeline(sources, { now: NOW, country: 'KSA' })
    expect(t.counts.tyre_fitment).toBe(1)
    expect(t.counts.tyre_removal).toBe(1)
    const removal = t.events.find((e) => e.source === 'tyre_removal')
    expect(removal.day).toBe('2026-05-10')
    expect(removal.detail).toMatch(/40,000 km run/)
  })

  it('puts an undated event LAST and flags it, never giving it a plausible date', () => {
    const t = buildTimeline(sources, { now: NOW, country: 'KSA' })
    const last = t.events[t.events.length - 1]
    expect(last.source).toBe('disposal')
    expect(last.undated).toBe(true)
    expect(last.at).toBeNull()
    expect(t.undatedCount).toBe(1)
  })

  it('sorts STABLY, so the same input never reshuffles between loads', () => {
    // Two same-day events from the same source: the date alone cannot order
    // them, so the id tiebreak must.
    const a = buildTimeline(sources, { now: NOW, country: 'KSA' }).events.map((e) => e.id)
    const b = buildTimeline(sources, { now: NOW, country: 'KSA' }).events.map((e) => e.id)
    expect(a).toEqual(b)
    // ...and reversing the input rows does not change the output order.
    const flipped = { ...sources, parts_line: src([...sources.parts_line.rows].reverse()) }
    expect(buildTimeline(flipped, { now: NOW, country: 'KSA' }).events.map((e) => e.id)).toEqual(a)
  })

  it('marks ONLY grid lines as counting toward spend', () => {
    const t = buildTimeline(sources, { now: NOW, country: 'KSA' })
    const counted = t.events.filter((e) => e.countsToSpend).map((e) => e.source)
    // The job card and the tyre carry a value for display but are never added:
    // the grid already counts that money (governedCost exclusions).
    expect([...new Set(counted)]).toEqual(['parts_line'])
  })
})

describe('grouping by period', () => {
  const events = [
    { id: 'a', day: '2026-05-10', undated: false, source: 'x', group: 'tyres' },
    { id: 'b', day: '2026-05-02', undated: false, source: 'x', group: 'tyres' },
    { id: 'c', day: '2026-01-10', undated: false, source: 'x', group: 'tyres' },
    { id: 'd', day: null, undated: true, source: 'x', group: 'tyres' },
  ]

  it('groups by month and keeps order', () => {
    const g = groupTimelineByPeriod(events, 'month')
    expect(g.map((b) => b.key)).toEqual(['2026-05', '2026-01', null])
    expect(g[0].events).toHaveLength(2)
  })

  it('groups by year and by day', () => {
    expect(groupTimelineByPeriod(events, 'year').map((b) => b.key)).toEqual(['2026', null])
    expect(groupTimelineByPeriod(events, 'day').map((b) => b.key))
      .toEqual(['2026-05-10', '2026-05-02', '2026-01-10', null])
  })

  it('puts undated events in their OWN bucket, not the last real period', () => {
    const g = groupTimelineByPeriod(events, 'month')
    const tail = g[g.length - 1]
    expect(tail.undated).toBe(true)
    expect(tail.label).toMatch(/not recorded/i)
    expect(tail.events).toHaveLength(1)
  })

  it('labels periods readably', () => {
    expect(periodLabel('2026-05', 'month')).toBe('May 2026')
    expect(periodLabel('2026', 'year')).toBe('2026')
    expect(periodLabel('2026-05-10', 'day')).toBe('10 May 2026')
    expect(periodLabel(null)).toMatch(/not recorded/i)
  })

  it('reads an ISO day locally, so a positive offset cannot roll the day back', () => {
    expect(isoDay('2026-05-10')).toBe('2026-05-10')
    expect(isoDay('2026-05-10T23:30:00')).toBe('2026-05-10')
    expect(isoDay(null)).toBeNull()
  })
})

describe('meterHistory - a reset is flagged, never smoothed away', () => {
  it('flags a reading below the previous one and excludes it from distance', () => {
    // The live shape: TM634 runs 75,399 then reads 7,174 after a meter change.
    const odo = [
      { id: 1, reading_date: '2026-01-01', odometer_km: 1000 },
      { id: 2, reading_date: '2026-02-01', odometer_km: 1500 },
      { id: 3, reading_date: '2026-03-01', odometer_km: 200 },   // reset
      { id: 4, reading_date: '2026-04-01', odometer_km: 400 },
    ]
    const m = meterHistory(odo, [])
    expect(m.km.resets).toBe(1)
    expect(m.km.points[2].reset).toBe(true)
    expect(m.km.points[2].delta).toBeNull()   // a reset is not a negative distance
    // Positive deltas only: 500 + 200. A naive last-minus-first would say -600.
    expect(m.km.distance).toBe(700)
    expect(m.km.reliable).toBe(false)
  })

  it('returns null distance - not zero - when there is nothing to measure', () => {
    expect(meterHistory([], []).km.distance).toBeNull()
    expect(meterHistory([{ id: 1, reading_date: '2026-01-01', odometer_km: 900 }], []).km.distance).toBeNull()
    expect(meterHistory([], []).km.first).toBeNull()
    expect(meterHistory([], []).km.readings).toBe(0)
  })

  it('keeps hours as its own series - the unit plant is managed by', () => {
    const m = meterHistory([], [
      { id: 1, reading_date: '2026-01-01', engine_hours: 100 },
      { id: 2, reading_date: '2026-02-01', engine_hours: 160 },
    ])
    expect(m.hours.distance).toBe(60)
    expect(m.hours.unit).toBe('hours')
    expect(m.hours.reliable).toBe(true)
  })

  it('ignores a reading with no value rather than treating it as zero', () => {
    const m = meterHistory([
      { id: 1, reading_date: '2026-01-01', odometer_km: 100 },
      { id: 2, reading_date: '2026-02-01', odometer_km: null },
      { id: 3, reading_date: '2026-03-01', odometer_km: 300 },
    ], [])
    expect(m.km.readings).toBe(2)
    expect(m.km.distance).toBe(200)
    expect(m.km.resets).toBe(0)
  })
})

describe('downtimeEpisodes - scheduling vs workshop vs release', () => {
  const card = {
    id: 'c1', work_order_no: 'JC-1', status: 'Completed',
    production_out_at: '2026-03-01T00:00:00Z',
    started_at: '2026-03-02T00:00:00Z',      // 24h scheduling gap
    completed_at: '2026-03-03T00:00:00Z',    // 24h in workshop
    production_in_at: '2026-03-05T00:00:00Z', // 48h release gap
  }

  it('splits the three gaps rather than reporting one blended number', () => {
    const d = downtimeEpisodes([card], [], { now: NOW })
    expect(d.totals.scheduling).toBe(24)
    expect(d.totals.workshop).toBe(24)
    expect(d.totals.release).toBe(48)
    expect(d.totals.total).toBe(96)
    // The split is what tells a manager WHICH of the three costs availability.
    expect(d.totals.release).toBeGreaterThan(d.totals.workshop)
  })

  it('leaves an unmeasurable gap NULL, never zero', () => {
    // No production_out_at at all: the scheduling gap cannot be measured.
    const partial = { id: 'c2', work_order_no: 'JC-2', status: 'Completed', started_at: '2026-03-02T00:00:00Z', completed_at: '2026-03-03T00:00:00Z' }
    const d = downtimeEpisodes([partial], [], { now: NOW })
    expect(d.totals.scheduling).toBeNull()   // NOT 0 - a 0 flatters the average
    expect(d.totals.workshop).toBe(24)
    expect(d.totals.total).toBeNull()
    expect(d.episodes[0].scheduling).toBeNull()
  })

  it('states how much of the record is measurable', () => {
    const nothing = { id: 'c3', work_order_no: 'JC-3', status: 'Open' }
    const d = downtimeEpisodes([card, nothing], [], { now: NOW })
    expect(d.measurableCards).toBe(1)
    expect(d.unmeasurableCards).toBe(1)
  })

  it('keeps breakdown days beside the job-card flow, never added into it', () => {
    const d = downtimeEpisodes([card], [
      { id: 'b1', reported_on: '2026-08-01', returned_to_service: false },
    ], { now: NOW })
    expect(d.openBreakdowns).toBe(1)
    expect(d.breakdownDays).toBe(23)          // measured to `now`, deterministic
    expect(d.totals.total).toBe(96)           // unchanged by the breakdown
  })

  it('renders an unmeasurable duration as a refusal, never as 0 h', () => {
    expect(formatHours(null)).toBe('Not measurable')
    expect(formatHours(undefined)).toBe('Not measurable')
    expect(formatHours(6)).toBe('6.0 h')
    expect(formatHours(96)).toBe('4.0 days')
  })
})

describe('documentChain - RFR to job card to store issue to parts line', () => {
  const cards = [{ id: 'c1', work_order_no: 'JC-1', rfr_no: 'RFR-9' }]
  const lines = [
    { id: 'p1', work_order_no: 'JC-1', issue_number: 'MIS-7', line_cost: 150, currency: 'SAR' },
    { id: 'p2', work_order_no: 'JC-1', issue_number: 'MIS-7', line_cost: 50, currency: 'SAR' },
    { id: 'p3', work_order_no: 'JC-1', issue_number: 'MIS-8', line_cost: 25, currency: 'SAR' },
    { id: 'p4', work_order_no: 'JC-OTHER', issue_number: 'MIS-9', line_cost: 10, currency: 'SAR' },
  ]
  const items = [{ id: 'i1', work_order_no: 'JC-1', task: 'Replace filter' }]

  it('walks the whole chain and totals the slips under their card', () => {
    const chain = documentChain(cards, lines, items)
    const entry = chainForCard(chain, 'JC-1')
    expect(entry.rfrNo).toBe('RFR-9')
    expect(entry.lines).toHaveLength(3)
    expect(entry.issueList.map((i) => i.issueNumber)).toEqual(['MIS-7', 'MIS-8'])
    expect(entry.issueList[0].lines).toHaveLength(2)
    expect(entry.lineTotal).toBe(225)
    expect(entry.items).toHaveLength(1)
  })

  it('keeps a line whose card is not on this asset as an orphan, never mis-attached', () => {
    const chain = documentChain(cards, lines, items)
    expect(chain.orphanLines.map((l) => l.id)).toEqual(['p4'])
  })

  it('matches a card number regardless of padding or case', () => {
    const chain = documentChain(cards, [{ id: 'p9', work_order_no: ' jc-1 ', line_cost: 5 }], [])
    expect(chainForCard(chain, 'JC-1').lines).toHaveLength(1)
  })

  it('reports MIXED rather than one plausible wrong number when slips span currencies', () => {
    const chain = documentChain(cards, [
      { id: 'a', work_order_no: 'JC-1', line_cost: 10, currency: 'SAR' },
      { id: 'b', work_order_no: 'JC-1', line_cost: 10, currency: 'AED' },
    ], [])
    expect(chainForCard(chain, 'JC-1').currency).toBe('MIXED')
  })

  it('leaves a card with no lines at a NULL total, not zero', () => {
    const chain = documentChain(cards, [], [])
    expect(chainForCard(chain, 'JC-1').lineTotal).toBeNull()
  })
})

describe('summarizeAssetHistory - currency is never blended, averages are never faked', () => {
  const oneCountry = {
    parts_line: src([
      { id: 'p1', event_date: '2026-03-02', line_cost: 1000, currency: 'SAR', country: 'KSA' },
      { id: 'p2', event_date: '2026-04-02', line_cost: 500, currency: 'SAR', country: 'KSA' },
    ]),
  }

  it('gives ONE Money only when the scope carries one currency', () => {
    const t = buildTimeline(oneCountry, { now: NOW, country: 'KSA' })
    const s = summarizeAssetHistory(t, { asset_no: 'TM514', country: 'KSA' }, { now: NOW, country: 'KSA' })
    expect(s.spend).toEqual({ amount: 1500, currency: 'SAR' })
    expect(s.mixedCurrency).toBe(false)
    expect(s.spendByCurrency).toEqual({ SAR: 1500 })
  })

  it('REFUSES a scalar when two currencies are present - a blend is not a quantity', () => {
    const mixed = {
      parts_line: src([
        { id: 'p1', event_date: '2026-03-02', line_cost: 1000, currency: 'SAR', country: 'KSA' },
        { id: 'p2', event_date: '2026-03-03', line_cost: 900, currency: 'AED', country: 'UAE' },
      ]),
    }
    const t = buildTimeline(mixed, { now: NOW })
    const s = summarizeAssetHistory(t, null, { now: NOW })
    expect(s.mixedCurrency).toBe(true)
    expect(s.spend).toBeNull()                       // no single number exists
    expect(s.spendByCurrency).toEqual({ SAR: 1000, AED: 900 })
    // ...and the display never adds them.
    expect(formatSpend(s)).toBe('AED 900 | SAR 1,000')
    expect(formatSpend(s)).not.toContain('1900')
  })

  it('does NOT add job card or tyre amounts to spend - the grid already counts them', () => {
    const both = {
      parts_line: src([{ id: 'p1', event_date: '2026-03-02', line_cost: 1000, currency: 'SAR', country: 'KSA' }]),
      job_card: src([{ id: 'c1', work_order_no: 'JC-1', opened_at: '2026-03-02', labour_cost: 999, parts_cost: 999, country: 'KSA' }]),
      tyre_fitment: src([{ id: 't1', issue_date: '2026-03-02', cost_per_tyre: 888, country: 'KSA', serial_no: 'S1' }]),
    }
    const t = buildTimeline(both, { now: NOW, country: 'KSA' })
    const s = summarizeAssetHistory(t, null, { now: NOW, country: 'KSA' })
    expect(s.spend.amount).toBe(1000)
  })

  it('says spend is UNKNOWN when the grid read failed, rather than reporting zero', () => {
    const t = buildTimeline({ parts_line: boom() }, { now: NOW, country: 'KSA' })
    const s = summarizeAssetHistory(t, null, { now: NOW, country: 'KSA' })
    expect(s.spendKnown).toBe(false)
    expect(formatSpend(s)).toMatch(/could not be read/i)
    // ...and an EMPTY grid is a different statement again.
    const t2 = buildTimeline({ parts_line: none() }, { now: NOW, country: 'KSA' })
    const s2 = summarizeAssetHistory(t2, null, { now: NOW, country: 'KSA' })
    expect(s2.spendKnown).toBe(true)
    expect(formatSpend(s2)).toMatch(/not recorded/i)
  })

  it('returns NULL for every average it cannot measure, never 0', () => {
    const t = buildTimeline({}, { now: NOW, country: 'KSA' })
    const s = summarizeAssetHistory(t, null, { now: NOW, country: 'KSA' })
    expect(s.avgTyreLifeKm).toBeNull()
    expect(s.costPerKm).toBeNull()
    expect(s.costPerHour).toBeNull()
    expect(s.daysInService).toBeNull()
    expect(s.spanDays).toBeNull()
    expect(s.km).toBeNull()
    expect(s.hours).toBeNull()
    // Counts of things that genuinely did not happen ARE zero - that is a
    // measured absence, not an unmeasurable one.
    expect(s.jobCards).toBe(0)
    expect(s.totalEvents).toBe(0)
  })

  it('computes cost per km only when BOTH the money and the distance exist', () => {
    const t = buildTimeline(oneCountry, { now: NOW, country: 'KSA' })
    const meters = meterHistory([
      { id: 1, reading_date: '2026-01-01', odometer_km: 0 },
      { id: 2, reading_date: '2026-06-01', odometer_km: 3000 },
    ], [])
    const s = summarizeAssetHistory(t, null, { now: NOW, country: 'KSA', meters })
    expect(s.km).toBe(3000)
    expect(s.costPerKm.value).toBeCloseTo(0.5, 6)
    expect(s.costPerKm.currency).toBe('SAR')
    // With no meter series at all the rate is unknown, not free.
    const s2 = summarizeAssetHistory(t, null, { now: NOW, country: 'KSA' })
    expect(s2.costPerKm).toBeNull()
    expect(formatPerUnitValue(s2.costPerKm)).toBe('Not measurable')
  })

  it('averages tyre life over removals that carry a life, and reports the span', () => {
    const t = buildTimeline({
      tyre_fitment: src([
        { id: 't1', issue_date: '2026-01-01', removal_date: '2026-03-01', total_km: 40000, serial_no: 'A', country: 'KSA' },
        { id: 't2', issue_date: '2026-01-01', removal_date: '2026-04-01', total_km: 60000, serial_no: 'B', country: 'KSA' },
        { id: 't3', issue_date: '2026-02-01', serial_no: 'C', country: 'KSA' },
      ]),
    }, { now: NOW, country: 'KSA' })
    const s = summarizeAssetHistory(t, null, { now: NOW, country: 'KSA' })
    expect(s.tyresFitted).toBe(3)
    expect(s.tyresRemoved).toBe(2)
    expect(s.avgTyreLifeKm).toBe(50000)
    expect(s.spanDays).toBe(90)   // 2026-01-01 to 2026-04-01
  })
})

describe('assetLifecycleStages', () => {
  it('marks a stage it has no evidence for as UNKNOWN rather than omitting it', () => {
    const t = buildTimeline({}, { now: NOW })
    const l = assetLifecycleStages(null, t, { now: NOW })
    const acquired = l.stages.find((s) => s.key === 'acquired')
    expect(acquired.known).toBe(false)
    expect(acquired.detail).toMatch(/no operation start date/i)
  })

  it('surfaces an open breakdown and a disposal proposal as standing states', () => {
    const t = buildTimeline({
      breakdown: src([{ id: 'b1', reported_on: '2026-08-01', returned_to_service: false }]),
      disposal: src([{ id: 'd1', disposition: 'Scrap' }]),
    }, { now: NOW })
    const l = assetLifecycleStages({ asset_no: 'TM514', status: 'Active' }, t, { now: NOW })
    expect(l.stages.find((s) => s.key === 'breakdown').known).toBe(true)
    expect(l.stages.find((s) => s.key === 'disposal').known).toBe(true)
    expect(l.status).toBe('Active')
  })

  it('measures how long the record has been silent', () => {
    const t = buildTimeline({
      inspection: src([{ id: 'i1', inspection_date: '2026-08-14', title: 'Check' }]),
    }, { now: NOW })
    const l = assetLifecycleStages(null, t, { now: NOW })
    expect(l.silentDays).toBe(10)
  })
})

describe('historyGaps - three different absences, three different meanings', () => {
  it('separates not recorded, not in use anywhere, and could not read', () => {
    const t = buildTimeline({
      job_card: none(),          // the table has rows; this asset has none
      pm_service: none(),        // measured 0 rows system-wide
      parts_line: boom(),        // the read failed
    }, { now: NOW })
    const g = historyGaps(t, { asset_no: 'TM514', vehicle_type: 'TR-MIXER' })
    const by = Object.fromEntries(g.gaps.map((x) => [x.key, x]))

    expect(by.job_card.kind).toBe('not_recorded')
    expect(by.job_card.message).toMatch(/no job cards recorded for this asset/i)

    // The silence of an empty table says NOTHING about this asset.
    expect(by.pm_service.kind).toBe('not_in_use')
    expect(by.pm_service.message).toMatch(/says nothing about this asset/i)

    expect(by.parts_line.kind).toBe('unreadable')
    expect(by.parts_line.message).toMatch(/unknown rather than empty/i)

    // ONLY the source that actually failed is reported as a fault. The sources
    // this fixture never supplied are "not loaded", which claims nothing.
    expect(g.unreadableCount).toBe(1)
    expect(g.notInUseCount).toBeGreaterThanOrEqual(1)
    expect(by.wash.kind).toBe('not_loaded')
    expect(by.wash.message).toMatch(/nothing is claimed about it/i)
    expect(g.notLoadedCount).toBeGreaterThan(0)
  })

  it('reports a source that returned rows as covered, not as a gap', () => {
    const t = buildTimeline({
      job_card: src([{ id: 'c1', work_order_no: 'JC-1', opened_at: '2026-03-01' }]),
    }, { now: NOW })
    const g = historyGaps(t, null)
    expect(g.gaps.some((x) => x.key === 'job_card')).toBe(false)
    expect(g.covered).toBe(1)
    expect(g.total).toBe(HISTORY_SOURCES.length)
  })

  it('names the register fields the page leans on when they are missing', () => {
    const t = buildTimeline({}, { now: NOW })
    expect(historyGaps(t, null).registerGaps[0]).toMatch(/no row in the fleet register/i)
    const g = historyGaps(t, { asset_no: 'TM514', vehicle_type: null, registration_no: 'ABC' })
    expect(g.registerGaps.join(' ')).toMatch(/no vehicle type/i)
    expect(g.registerGaps.join(' ')).not.toMatch(/no plate number/i)
  })
})

describe('filterTimeline', () => {
  const t = buildTimeline({
    job_card: src([{ id: 'c1', work_order_no: 'JC-1', opened_at: '2026-03-01', description: 'Brake job' }]),
    wash: src([{ id: 'w1', wash_date: '2026-06-01', wash_type: 'Full' }]),
    disposal: src([{ id: 'd1', disposition: 'Scrap' }]),
  }, { now: NOW, country: 'KSA' })

  it('filters by source and by group', () => {
    expect(filterTimeline(t.events, { sources: ['job_card'] })).toHaveLength(1)
    expect(filterTimeline(t.events, { groups: ['workshop'] })).toHaveLength(1)
    expect(filterTimeline(t.events, {})).toHaveLength(3)
  })

  it('searches title, detail and reference', () => {
    expect(filterTimeline(t.events, { search: 'brake' })).toHaveLength(1)
    expect(filterTimeline(t.events, { search: 'JC-1' })).toHaveLength(1)
    expect(filterTimeline(t.events, { search: 'nothing here' })).toHaveLength(0)
  })

  it('EXCLUDES an undated event from a date window instead of sweeping it in', () => {
    const inWindow = filterTimeline(t.events, { from: '2026-01-01', to: '2026-12-31' })
    expect(inWindow.map((e) => e.source)).not.toContain('disposal')
    expect(inWindow).toHaveLength(2)
  })
})

describe('historyExportRows', () => {
  it('renders a blank as N/A - never a dash and never 0', () => {
    const t = buildTimeline({
      wash: src([{ id: 'w1', wash_date: '2026-06-01' }]),
      disposal: src([{ id: 'd1' }]),
    }, { now: NOW, country: 'KSA' })
    const rows = historyExportRows(t.events)
    const joined = JSON.stringify(rows)
    expect(joined).not.toMatch(/[–—]/)      // no en or em dash
    const disposal = rows.find((r) => r.source === 'Disposal')
    expect(disposal.date).toBe('Not recorded')
    expect(disposal.reference).toBe('N/A')
    // A missing value is N/A, not the number zero.
    expect(disposal.value).toBe('N/A')
  })

  it('states a wash with no charge as a fact rather than a gap', () => {
    // Washing is done in house and carries no charge, so 0 is deliberate.
    const t = buildTimeline({ wash: src([{ id: 'w1', wash_date: '2026-06-01', cost: 0, country: 'KSA' }]) },
      { now: NOW, country: 'KSA' })
    expect(t.events[0].detail).toMatch(/no charge/i)
    expect(historyExportRows(t.events)[0].value).toBe(0)
  })
})
